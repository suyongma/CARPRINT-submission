import { guardMaintenanceWrite } from "../maintenance/PostgresMaintenanceGuard.js";
import { isMaintenance } from "../maintenance/MaintenanceWritePolicy.js";
import type { Pool, PoolClient } from "pg";
import { transaction } from "../db/connection.js";
import type { Principal } from "../identity/Authorization.js";
import { CursorCodec, digest } from "../shared/crypto.js";
import { DomainError, requireCondition } from "../shared/errors.js";
import type {
  AppendResult,
  CorrectionInput,
  EventRequest,
  EventView,
  Receipt,
  ReceiptSigner,
  Timeline,
  VehicleEventStore,
  VehicleHistoryReader,
} from "./contracts.js";

export function eventView(row: Record<string, any>): EventView {
  return {
    ...row.request,
    vehicle_ref: row.vehicle_ref,
    server_seq: Number(row.server_seq),
    received_at: row.received_at.toISOString(),
    source_kind: row.source_kind,
    source_status: row.source_status,
    review_flags: row.review_flags,
    corrected_by: row.corrected_by ?? null,
  };
}
export async function readContext(
  client: PoolClient,
  vehicle: string,
  maxSeq: number,
) {
  const corrections = (
    await client.query(
      `SELECT c.original_event_id,c.new_event_id,c.reason_code FROM trust.correction c
 JOIN trust.vehicle_event e ON e.event_id=c.new_event_id WHERE c.vehicle_ref=$1 AND e.server_seq<=$2`,
      [vehicle, maxSeq],
    )
  ).rows;
  const gaps = (
    await client.query(
      `SELECT gap_id,starts_at AS start,ends_at AS end,scope,reason FROM trust.collection_gap WHERE vehicle_ref=$1 ORDER BY starts_at`,
      [vehicle],
    )
  ).rows;
  return {
    corrections,
    gaps: gaps.map((g) => ({
      ...g,
      start: g.start.toISOString(),
      end: g.end.toISOString(),
    })),
  };
}
export class PostgresVehicleEventStore
  implements VehicleEventStore, VehicleHistoryReader
{
  constructor(
    private readonly pool: Pool,
    private readonly signer: ReceiptSigner,
    private readonly cursors: CursorCodec,
  ) {}
  // 이벤트·영수증·순번·전달 대기열은 한 번에 저장. 중간에 터지면 전부 롤백. _ma
  async append(
    principal: Principal,
    request: EventRequest,
    key: string,
    now: Date,
    correction?: CorrectionInput,
  ): Promise<AppendResult> {
    const requestHash = digest(
      correction
        ? {
            request,
            original_id: correction.originalId,
            reason: correction.reason,
            expected_head: correction.expectedHead,
          }
        : request,
    );
    try {
      return await transaction(this.pool, async (client) => {
        // 같은 차량은 순번 행 잠그고 하나씩 처리함. 안 그러면 다음 순번이랑 해시 체인 꼬임. _ma
        const stream = (
          await client.query(
            "SELECT * FROM ops.vehicle_stream WHERE vehicle_ref=$1 FOR UPDATE",
            [principal.vehicleRef],
          )
        ).rows[0];
        requireCondition(stream, 403, "vehicle_not_bound");
        const existing = (
          await client.query(
            "SELECT request_hash,receipt FROM trust.ingest_receipt WHERE principal_id=$1 AND idempotency_key=$2",
            [principal.id, key],
          )
        ).rows[0];
        // 같은 키에 같은 내용이면 기존 영수증 줌. 내용 다르면 충돌. 재전송했다고 두 번 저장 안 함. _ma
        if (existing) {
          requireCondition(
            existing.request_hash === requestHash,
            409,
            "idempotency_conflict",
          );
          return { receipt: existing.receipt, replay: true };
        }
        const source = (
          await client.query("SELECT * FROM trust.source WHERE source_ref=$1", [
            request.source_ref,
          ])
        ).rows[0];
        requireCondition(
          source &&
            source.vehicle_ref === principal.vehicleRef &&
            source.environment === principal.environment &&
            source.principal_id === principal.id &&
            source.status !== "revoked",
          403,
          "source_forbidden",
        );
        if (correction) {
          const original = (
            await client.query(
              "SELECT * FROM trust.vehicle_event WHERE event_id=$1 AND vehicle_ref=$2",
              [correction.originalId, principal.vehicleRef],
            )
          ).rows[0];
          requireCondition(
            original &&
              original.principal_id === principal.id &&
              original.source_ref === request.source_ref,
            403,
            "correction_forbidden",
          );
          requireCondition(
            ["maintenance.completed", "maintenance.corrected"].includes(
              original.event_type,
            ) &&
              original.request.payload.task_code === request.payload.task_code,
            422,
            "correction_scope_mismatch",
          );
          const newer = (
            await client.query(
              "SELECT 1 FROM trust.correction WHERE original_event_id=$1",
              [correction.originalId],
            )
          ).rowCount;
          requireCondition(
            !newer && correction.expectedHead === correction.originalId,
            412,
            "revision_changed",
          );
        }
        if (isMaintenance(request.event_type)) {
          await guardMaintenanceWrite(
            client,
            principal,
            request,
            now,
            correction?.originalId,
          );
        }
        if (request.payload.resolves_event_id) {
          const target = (
            await client.query(
              "SELECT 1 FROM trust.vehicle_event WHERE event_id=$1 AND vehicle_ref=$2 AND event_type='warning.observed'",
              [request.payload.resolves_event_id, principal.vehicleRef],
            )
          ).rowCount;
          requireCondition(target, 422, "resolution_target_invalid");
        }
        // 시각 이상이나 거리 감소는 표시만 남김. 정상값인 척 고치거나 원본 바꾸지 말 것. _ma
        const flags: string[] = [];
        if (!request.occurred_at) flags.push("measurement_time_unknown");
        if (Date.parse(request.observed_at) > now.getTime() + 300000)
          flags.push("client_clock_ahead");
        if (
          request.occurred_at &&
          Date.parse(request.observed_at) - Date.parse(request.occurred_at) >
            86400000
        )
          flags.push("delayed_observation");
        if (request.event_type === "odometer.observed") {
          const previous = (
            await client.query(
              "SELECT request FROM trust.vehicle_event WHERE vehicle_ref=$1 AND event_type='odometer.observed' ORDER BY server_seq DESC LIMIT 1",
              [principal.vehicleRef],
            )
          ).rows[0];
          if (
            previous &&
            request.payload.value! < previous.request.payload.value
          )
            flags.push("odometer_decreased_review");
        }
        const seq = Number(stream.last_seq) + 1;
        const eventHash = digest(request);
        // 받은 기록이랑 순서에 서명하는 거임. 실제 차 상태나 센서 원본이 맞다는 보증은 아님. _ma
        const unsigned: Omit<Receipt, "signature"> = {
          version: "carprint.receipt.v1",
          event_id: request.event_id,
          vehicle_ref: principal.vehicleRef,
          environment: principal.environment,
          server_seq: seq,
          received_at: now.toISOString(),
          event_hash: eventHash,
          previous_hash: stream.head_hash,
          chain_hash: digest({
            previous_hash: stream.head_hash,
            event_hash: eventHash,
            server_seq: seq,
            received_at: now.toISOString(),
          }),
          key_id: this.signer.keyId,
        };
        const receipt: Receipt = {
          ...unsigned,
          signature: this.signer.sign(unsigned),
        };
        await client.query(
          `INSERT INTO trust.vehicle_event(event_id,vehicle_ref,environment,source_ref,principal_id,event_type,occurred_at,observed_at,received_at,server_seq,request,review_flags)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            request.event_id,
            principal.vehicleRef,
            principal.environment,
            request.source_ref,
            principal.id,
            request.event_type,
            request.occurred_at,
            request.observed_at,
            now,
            seq,
            request,
            flags,
          ],
        );
        await client.query(
          "INSERT INTO trust.ingest_receipt VALUES($1,$2,$3,$4,$5)",
          [request.event_id, principal.id, key, requestHash, receipt],
        );
        await client.query(
          "UPDATE ops.vehicle_stream SET last_seq=$2,head_hash=$3 WHERE vehicle_ref=$1",
          [principal.vehicleRef, seq, receipt.chain_hash],
        );
        await client.query(
          "INSERT INTO ops.delivery_outbox VALUES($1,'event.received',$2)",
          [request.event_id, now],
        );
        if (correction)
          await client.query(
            "INSERT INTO trust.correction VALUES($1,$2,$3,$4,$5,$6)",
            [
              correction.originalId,
              request.event_id,
              principal.vehicleRef,
              principal.environment,
              principal.id,
              correction.reason,
            ],
          );
        await client.query(
          "INSERT INTO ops.audit_event(vehicle_ref,action,object_id,created_at) VALUES($1,$2,$3,$4)",
          [
            principal.vehicleRef,
            correction ? "event.corrected" : "event.received",
            request.event_id,
            now,
          ],
        );
        return { receipt, replay: false };
      });
    } catch (error) {
      if ((error as { code?: string }).code === "42501")
        throw new DomainError(403, "maintenance_write_forbidden");
      if ((error as { code?: string }).code === "23505")
        throw new DomainError(409, "event_or_key_conflict");
      throw error;
    }
  }
  // 첫 페이지 최대 순번을 커서에 넣어둠. 새 기록 들어와도 범위 유지. 근거 버전 바뀌면 처음부터 다시 조회. _ma
  async timeline(
    principal: Principal,
    cursor?: string,
    limit = 30,
  ): Promise<Timeline> {
    return transaction(this.pool, async (client) => {
      // 동일 응답의 원본·정정·공백을 같은 snapshot으로 읽는다.
      await client.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
      );
      const stream = (
        await client.query(
          "SELECT * FROM ops.vehicle_stream WHERE vehicle_ref=$1",
          [principal.vehicleRef],
        )
      ).rows[0];
      let maxSeq = Number(stream.last_seq),
        lastSeq = maxSeq + 1;
      if (cursor) {
        let decoded: {
          vehicle: string;
          environment: string;
          max: number;
          last: number;
          revision: number;
        };
        try {
          decoded = this.cursors.decode(cursor);
        } catch {
          throw new DomainError(422, "invalid_cursor");
        }
        requireCondition(
          decoded.vehicle === principal.vehicleRef &&
            decoded.environment === principal.environment,
          403,
          "cursor_forbidden",
        );
        requireCondition(
          decoded.revision === Number(stream.evidence_revision),
          409,
          "timeline_changed_reload",
        );
        maxSeq = decoded.max;
        lastSeq = decoded.last;
      }
      const rows = (
        await client.query(
          `SELECT e.*,s.source_kind,s.status AS source_status,c.new_event_id AS corrected_by
    FROM trust.vehicle_event e JOIN trust.source s USING(source_ref)
    LEFT JOIN trust.correction c ON c.original_event_id=e.event_id
    WHERE e.vehicle_ref=$1 AND e.server_seq<=$2 AND e.server_seq<$3 ORDER BY e.server_seq DESC LIMIT $4`,
          [principal.vehicleRef, maxSeq, lastSeq, limit + 1],
        )
      ).rows;
      // 한 건 더 읽어서 다음 페이지 있는지 봄. 응답은 limit개만 줌. _ma
      const page = rows.slice(0, limit);
      const context = await readContext(client, principal.vehicleRef, maxSeq);
      return {
        vehicle_ref: principal.vehicleRef,
        environment: principal.environment,
        snapshot_seq: maxSeq,
        evidence_revision: Number(stream.evidence_revision),
        events: page.map(eventView),
        ...context,
        next_cursor:
          rows.length > limit
            ? this.cursors.encode({
                vehicle: principal.vehicleRef,
                environment: principal.environment,
                max: maxSeq,
                last: Number(page.at(-1)!.server_seq),
                revision: Number(stream.evidence_revision),
              })
            : null,
      };
    });
  }
}
