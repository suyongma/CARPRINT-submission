import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { transaction } from "../db/connection.js";
import type { Principal } from "../identity/Authorization.js";
import { digest } from "../shared/crypto.js";
import { requireCondition } from "../shared/errors.js";
import { calculateCare, departureCheck } from "./CareScoreCalculator.js";
import type {
  CareInput,
  AssessmentView,
  CareAssessmentStore,
} from "./contracts.js";

// 문서 fixture와 런타임 업무 계약 사이 변환. 점수·q·과거 assessment 값은 가져오지 않는다.
export function inputFromExample(bundle: any): CareInput {
  const flags = bundle.eligibility_inputs;
  return {
    period: {
      from: bundle.assessments[0].window_start,
      to: bundle.assessments[0].window_end,
    },
    specificationKnown: flags.spec_known,
    ruleKnown: flags.rule_known,
    endpointsKnown: flags.window_endpoints_known,
    requiredInputsKnown: flags.all_required_inputs_known,
    anomaly: flags.unresolved_anomaly,
    gapCount: bundle.collection_gaps.length,
    events: bundle.vehicle_events.map((e: any) => ({
      id: e.event_id,
      type: e.event_type,
      occurredAt: e.occurred_at,
      correctionOf: e.correction_of,
      payload: e.payload,
      sourceValid:
        flags.sources_valid &&
        ["simulated_verified", "simulated_approved_observation"].includes(
          bundle.sources.find((s: any) => s.source_ref === e.source_ref)
            ?.verification_status,
        ),
    })),
    opportunities: bundle.opportunities.map((o: any) => ({
      id: o.opportunity_id,
      group: o.group,
      label: o.label,
      dueAt: o.due_at,
      graceDays: o.grace_basis === "synthetic-rule-only" ? o.grace_days : null,
      evidenceId: o.evidence_event_id,
    })),
  };
}
export class PostgresCareAssessmentStore implements CareAssessmentStore {
  constructor(private readonly pool: Pool) {}
  async examples() {
    return (
      await this.pool.query(
        "SELECT example_id AS id,label FROM trust.care_example ORDER BY example_id",
      )
    ).rows;
  }
  async assess(
    principal: Principal,
    exampleId: string | null,
    now: Date,
  ): Promise<AssessmentView> {
    return transaction(this.pool, async (client) => {
      const stream = (
        await client.query(
          "SELECT evidence_revision FROM ops.vehicle_stream WHERE vehicle_ref=$1 FOR UPDATE",
          [principal.vehicleRef],
        )
      ).rows[0];
      let input: CareInput;
      if (exampleId) {
        const row = (
          await client.query(
            "SELECT input FROM trust.care_example WHERE example_id=$1",
            [exampleId],
          )
        ).rows[0];
        requireCondition(row, 404, "example_not_found");
        input = inputFromExample(row.input);
      } else {
        const events = (
          await client.query(
            `SELECT e.*,s.status FROM trust.vehicle_event e JOIN trust.source s USING(source_ref) WHERE e.vehicle_ref=$1 ORDER BY server_seq`,
            [principal.vehicleRef],
          )
        ).rows;
        const gaps = Number(
          (
            await client.query(
              "SELECT count(*) FROM trust.collection_gap WHERE vehicle_ref=$1",
              [principal.vehicleRef],
            )
          ).rows[0].count,
        );
        // 현 로컬 차량의 사양·제조사 정비 기준·사업자 진위는 확인하지 않았다. 숫자를 억지로 만들지 않는다.
        input = {
          period: {
            from: new Date(now.getTime() - 180 * 86400000).toISOString(),
            to: now.toISOString(),
          },
          specificationKnown: false,
          ruleKnown: false,
          endpointsKnown:
            events.filter((e) => e.event_type === "odometer.observed").length >=
            2,
          requiredInputsKnown: false,
          anomaly: events.some((e) =>
            e.review_flags.includes("odometer_decreased_review"),
          ),
          gapCount: gaps,
          opportunities: [],
          events: events.map((e) => ({
            id: e.event_id,
            type: e.event_type,
            occurredAt: e.occurred_at?.toISOString() ?? null,
            sourceValid: false,
            correctionOf: null,
            payload: e.request.payload,
          })),
        };
      }
      // 현재 기간은 일 단위로 고정해 단순 새로고침이 같은 평가를 무한 발급하지 않게 한다.
      if (!exampleId) {
        input.period.to = now.toISOString().slice(0, 10) + "T23:59:59Z";
        input.period.from = new Date(
          Date.parse(input.period.to) - 180 * 86400000,
        ).toISOString();
      }
      const key = digest({
        exampleId,
        input,
        evidenceRevision: exampleId ? null : stream.evidence_revision,
      });
      const saved = (
        await client.query(
          "SELECT snapshot FROM trust.care_assessment WHERE vehicle_ref=$1 AND input_digest=$2",
          [principal.vehicleRef, key],
        )
      ).rows[0];
      if (saved) return saved.snapshot;
      const previous = (
        await client.query(
          "SELECT assessment_id,snapshot FROM trust.care_assessment WHERE vehicle_ref=$1 AND snapshot->>'exampleId' IS NOT DISTINCT FROM $2 ORDER BY created_at DESC LIMIT 1",
          [principal.vehicleRef, exampleId],
        )
      ).rows[0];
      const result: AssessmentView = {
        ...calculateCare(input),
        assessmentId: randomUUID(),
        exampleId,
        evaluatedAt: now.toISOString(),
        departure: departureCheck(input),
        previousAssessmentId: previous?.assessment_id ?? null,
        changeReason: previous
          ? "근거 또는 관측 기간 변경으로 재평가"
          : "최초 평가",
        comparable:
          !!previous &&
          JSON.stringify(previous.snapshot.period) ===
            JSON.stringify(input.period),
      };
      await client.query(
        "INSERT INTO trust.care_assessment VALUES($1,$2,$3,$4,$5)",
        [result.assessmentId, principal.vehicleRef, key, result, now],
      );
      return result;
    });
  }
}
