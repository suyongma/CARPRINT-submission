import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { transaction } from "../db/connection.js";
import { authorize, type Principal } from "../identity/Authorization.js";
import { requireCondition } from "../shared/errors.js";
import { digest } from "../shared/crypto.js";
import type { DrivingObservationStore, SpeedSample } from "./contracts.js";
import { assessDrivingSignals } from "./DrivingSignalCalculator.js";

export class PostgresDrivingObservationStore implements DrivingObservationStore {
  constructor(private readonly pool: Pool) {}
  private allowed(actor: Principal) {
    authorize(actor, "events:append:odometer");
    requireCondition(
      actor.environment === "pleos_emulator",
      403,
      "pleos_observation_required",
    );
  }
  // 차량·수집 주체·Pleos 출처 묶어서 15분 관측 창 만듦. 이 주체에 아직 열린 유효 관측 있으면 새로 못 시작함. _ma
  async begin(actor: Principal, now: Date) {
    this.allowed(actor);
    return transaction(this.pool, async (c) => {
      await c.query(
        "SELECT 1 FROM ops.vehicle_stream WHERE vehicle_ref=$1 FOR UPDATE",
        [actor.vehicleRef],
      );
      const source = (
        await c.query(
          "SELECT source_ref FROM trust.source WHERE principal_id=$1 AND vehicle_ref=$2 AND source_kind='pleos_emulator' AND status<>'revoked'",
          [actor.id, actor.vehicleRef],
        )
      ).rows[0];
      requireCondition(source, 403, "source_forbidden");
      const active = (
        await c.query(
          "SELECT 1 FROM trust.driving_observation WHERE principal_id=$1 AND completed_at IS NULL AND expires_at>$2",
          [actor.id, now],
        )
      ).rowCount;
      requireCondition(!active, 409, "observation_already_active");
      const observationId = randomUUID(),
        expiresAt = new Date(now.getTime() + 900000);
      await c.query(
        "INSERT INTO trust.driving_observation(observation_id,principal_id,vehicle_ref,source_ref,issued_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
        [
          observationId,
          actor.id,
          actor.vehicleRef,
          source.source_ref,
          now,
          expiresAt,
        ],
      );
      return { observationId, expiresAt: expiresAt.toISOString() };
    });
  }
  async finish(
    actor: Principal,
    id: string,
    samples: SpeedSample[],
    now: Date,
  ) {
    this.allowed(actor);
    return transaction(this.pool, async (c) => {
      const row = (
        await c.query(
          "SELECT d.*,s.status FROM trust.driving_observation d JOIN trust.source s USING(source_ref) WHERE observation_id=$1 AND d.principal_id=$2 AND d.vehicle_ref=$3 FOR UPDATE OF d",
          [id, actor.id, actor.vehicleRef],
        )
      ).rows[0];
      requireCondition(row, 404, "observation_not_found");
      requireCondition(row.status !== "revoked", 403, "source_forbidden");
      const hash = digest(samples);
      // 완료 응답 놓쳤으면 같은 표본 해시일 때만 결과 다시 줌. 완료한 ID에 다른 표본 덮어쓰기 금지. _ma
      if (row.completed_at) {
        requireCondition(
          row.input_hash === hash,
          409,
          "observation_body_changed",
        );
        return row.assessment;
      }
      requireCondition(row.expires_at > now, 410, "observation_expired");
      requireCondition(
        (samples.at(-1)?.elapsedMs ?? 0) <=
          now.getTime() - row.issued_at.getTime() + 1000,
        422,
        "observation_duration_invalid",
      );
      const result = assessDrivingSignals(samples);
      if (
        now.getTime() -
          row.issued_at.getTime() -
          (samples.at(-1)?.elapsedMs ?? 0) >
        15000
      ) {
        result.candidateScore = null;
        result.reasons.push("observation_tail_or_start_gap");
      }

      await c.query(
        "UPDATE trust.driving_observation SET input_hash=$2,samples=$3,assessment=$4,completed_at=$5 WHERE observation_id=$1",
        [id, hash, JSON.stringify(samples), result, now],
      );
      return result;
    });
  }
}
