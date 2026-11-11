import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { transaction } from "../db/connection.js";
import type { Principal } from "../identity/Authorization.js";
import {
  digest,
  equalHash,
  hash,
  ResponseCipher,
  secret,
} from "../shared/crypto.js";
import { requireCondition } from "../shared/errors.js";
import {
  eventView,
  readContext,
} from "../vehicle-history/PostgresVehicleEventStore.js";
import type {
  ReportCreated,
  ReportRequest,
  ReportSnapshot,
  ReportStatus,
  ReportStore,
} from "./contracts.js";

type ShareRow = {
  report_id: string;
  vehicle_ref: string;
  snapshot: ReportSnapshot;
  snapshot_hash: string;
  issued_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  evidence_revision: string;
  current_revision: string;
  secret_hash: string;
};
const shareQuery = `SELECT r.*,s.secret_hash,s.expires_at,s.revoked_at,v.evidence_revision AS current_revision
 FROM trust.report r JOIN trust.report_share s USING(report_id) JOIN ops.vehicle_stream v USING(vehicle_ref)`;
// 자료는 발급 때 고정해도 열람 가능 여부는 지금 기준임. 취소 → 만료 → 근거 변경 순서로 확인. _ma
function state(row: ShareRow, now: Date): ReportStatus["state"] {
  if (row.revoked_at) return "revoked";
  if (now >= row.expires_at) return "expired";
  if (row.evidence_revision !== row.current_revision) return "changed";
  return "active";
}
function readable(row: ShareRow, now: Date) {
  const current = state(row, now);
  requireCondition(
    current !== "revoked" && current !== "expired",
    410,
    current === "revoked" ? "share_revoked" : "share_expired",
  );
  requireCondition(current !== "changed", 409, "report_changed_reissue");
}
export class PostgresReportStore implements ReportStore {
  constructor(
    private readonly pool: Pool,
    private readonly cipher: ResponseCipher,
    private readonly origin: string,
  ) {}
  // 차량 스트림 잠근 채 자료랑 근거 버전 같이 저장함. 같은 발급 키로 또 만들진 않음. _ma
  async create(
    principal: Principal,
    request: ReportRequest,
    key: string,
    now: Date,
  ) {
    return transaction(this.pool, async (client) => {
      const stream = (
        await client.query(
          "SELECT * FROM ops.vehicle_stream WHERE vehicle_ref=$1 FOR UPDATE",
          [principal.vehicleRef],
        )
      ).rows[0];
      const requestHash = digest(request);
      const previous = (
        await client.query(
          `SELECT r.*,s.expires_at,c.encrypted_response,c.expires_at AS cache_expires
    FROM trust.report r JOIN trust.report_share s USING(report_id) LEFT JOIN ops.idempotency_response c USING(report_id)
    WHERE r.principal_id=$1 AND r.idempotency_key=$2`,
          [principal.id, key],
        )
      ).rows[0];
      if (previous) {
        requireCondition(
          previous.request_hash === requestHash,
          409,
          "idempotency_conflict",
        );
        // 해시로 공유 비밀 복구는 안 됨. 그래서 발급 응답을 10분만 암호화 보관. 지나면 재발급 필요로 반환. _ma
        if (previous.encrypted_response && previous.cache_expires > now)
          return {
            result: this.cipher.open<ReportCreated>(
              previous.encrypted_response,
            ),
            replay: true,
          };
        return {
          result: {
            report_id: previous.report_id,
            issued_at: previous.issued_at.toISOString(),
            expires_at: previous.expires_at.toISOString(),
            reissue_required: true,
          },
          replay: true,
        };
      }
      const all = (
        await client.query(
          `SELECT e.*,s.source_kind,s.status AS source_status,c.new_event_id AS corrected_by
    FROM trust.vehicle_event e JOIN trust.source s USING(source_ref) LEFT JOIN trust.correction c ON c.original_event_id=e.event_id
    WHERE e.vehicle_ref=$1 ORDER BY e.server_seq LIMIT 10001`,
          [principal.vehicleRef],
        )
      ).rows;
      requireCondition(all.length <= 10000, 422, "report_range_too_large");
      const inPeriod = all.filter((e) => {
        const time = (e.occurred_at ?? e.observed_at).getTime();
        return (
          time >= Date.parse(request.scope.from) &&
          time <= Date.parse(request.scope.to)
        );
      });
      const chosen = new Set(
        request.kind === "full"
          ? inPeriod.map((e) => e.event_id)
          : request.scope.selected_event_ids,
      );
      requireCondition(
        [...chosen].every((id) => inPeriod.some((e) => e.event_id === id)),
        422,
        "selection_outside_scope",
      );
      const context = await readContext(
        client,
        principal.vehicleRef,
        Number(stream.last_seq),
      );
      // 원본 또는 정정이 범위 안에 있으면 연결된 전체 체인을 맥락으로 포함한다.
      // 연결된 정정이 더 없을 때까지 따라감. 일부만 골랐어도 원본·후속 정정은 같이 보여줘야 함. _ma
      let changed = true;
      while (changed) {
        changed = false;
        for (const c of context.corrections)
          if (chosen.has(c.original_event_id) || chosen.has(c.new_event_id)) {
            for (const id of [c.original_event_id, c.new_event_id])
              if (!chosen.has(id)) {
                chosen.add(id);
                changed = true;
              }
          }
      }
      const id = randomUUID();
      const snapshot: ReportSnapshot = {
        report_id: id,
        kind: request.kind,
        environment: principal.environment,
        issued_at: now.toISOString(),
        expires_at: new Date(
          now.getTime() + request.expires_in * 1000,
        ).toISOString(),
        data_cutoff_seq: Number(stream.last_seq),
        period: { from: request.scope.from, to: request.scope.to },
        events: all.filter((e) => chosen.has(e.event_id)).map(eventView),
        corrections: context.corrections.filter((c) =>
          chosen.has(c.original_event_id),
        ),
        gaps: context.gaps.filter(
          (g) =>
            Date.parse(g.start) <= Date.parse(request.scope.to) &&
            Date.parse(g.end) >= Date.parse(request.scope.from),
        ),
        assessment: null,
        notice:
          request.kind === "full"
            ? "지정 기간의 전체 기록 · 합성/에뮬레이터 자료 · 실차 진위 보증 아님"
            : "일부 자료 공개 · 전체 차량 평가 및 종합 점수 아님",
      };
      const shareSecret = secret();
      const expires = new Date(now.getTime() + request.expires_in * 1000);
      const result: ReportCreated = {
        report_id: id,
        share_url: `${this.origin}/r/${id}#${shareSecret}`,
        issued_at: now.toISOString(),
        expires_at: expires.toISOString(),
      };
      await client.query(
        "INSERT INTO trust.report VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          id,
          principal.vehicleRef,
          principal.id,
          key,
          requestHash,
          snapshot,
          digest(snapshot),
          stream.evidence_revision,
          now,
        ],
      );
      await client.query(
        "INSERT INTO trust.report_share(report_id,secret_hash,expires_at) VALUES($1,$2,$3)",
        [id, hash(shareSecret), expires],
      );
      await client.query(
        "INSERT INTO ops.idempotency_response VALUES($1,$2,$3)",
        [id, this.cipher.seal(result), new Date(now.getTime() + 600000)],
      );
      await client.query(
        "INSERT INTO ops.audit_event(vehicle_ref,action,object_id,created_at) VALUES($1,$2,$3,$4)",
        [principal.vehicleRef, "report.issued", id, now],
      );
      // 만료 데이터 정리는 기능적으로 독립적. 공유 유효성은 정리 작업 성공 여부와 무관하다.
      await client.query(
        "DELETE FROM ops.idempotency_response WHERE expires_at<=$1",
        [now],
      );
      await client.query(
        "DELETE FROM ops.report_session WHERE expires_at<=$1",
        [now],
      );
      return { result, replay: false };
    });
  }
  async list(principal: Principal, now: Date): Promise<ReportStatus[]> {
    const rows = (
      await this.pool.query(
        `${shareQuery} WHERE r.vehicle_ref=$1 ORDER BY r.issued_at DESC,r.report_id DESC LIMIT 50`,
        [principal.vehicleRef],
      )
    ).rows as ShareRow[];
    return rows.map((row) => ({
      report_id: row.report_id,
      issued_at: row.issued_at.toISOString(),
      expires_at: row.expires_at.toISOString(),
      state: state(row, now),
      snapshot_hash: row.snapshot_hash,
    }));
  }
  async status(
    principal: Principal,
    id: string,
    now: Date,
  ): Promise<ReportStatus> {
    const row = (
      await this.pool.query(
        `${shareQuery} WHERE r.report_id=$1 AND r.vehicle_ref=$2`,
        [id, principal.vehicleRef],
      )
    ).rows[0] as ShareRow | undefined;
    requireCondition(row, 404, "not_found");
    return {
      report_id: id,
      issued_at: row.issued_at.toISOString(),
      expires_at: row.expires_at.toISOString(),
      state: state(row, now),
      snapshot_hash: row.snapshot_hash,
    };
  }
  async revoke(principal: Principal, id: string, now: Date): Promise<void> {
    await transaction(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE trust.report_share s SET revoked_at=COALESCE(s.revoked_at,$3)
    FROM trust.report r WHERE s.report_id=r.report_id AND r.report_id=$1 AND r.vehicle_ref=$2 RETURNING s.report_id`,
        [id, principal.vehicleRef, now],
      );
      requireCondition(result.rowCount, 404, "not_found");
      await client.query(
        "INSERT INTO ops.audit_event(vehicle_ref,action,object_id,created_at) VALUES($1,$2,$3,$4)",
        [principal.vehicleRef, "report.revoked", id, now],
      );
    });
  }
  // 링크 비밀을 최대 15분짜리 열람 세션으로 바꿈. 원래 공유 만료보다 길게 주면 안 됨. _ma
  async exchange(id: string, shareSecret: string, now: Date): Promise<string> {
    return transaction(this.pool, async (client) => {
      const row = (
        await client.query(`${shareQuery} WHERE r.report_id=$1`, [id])
      ).rows[0] as ShareRow | undefined;
      requireCondition(
        row && equalHash(row.secret_hash, hash(shareSecret)),
        404,
        "not_found",
      );
      readable(row, now);
      const token = secret();
      await client.query("INSERT INTO ops.report_session VALUES($1,$2,$3)", [
        hash(token),
        id,
        new Date(Math.min(now.getTime() + 900000, row.expires_at.getTime())),
      ]);
      return token;
    });
  }
  // 세션 있어도 매번 공유 상태 다시 봄. 취소됐거나 근거 바뀐 리포트는 못 엶. _ma
  async view(id: string, session: string, now: Date): Promise<ReportSnapshot> {
    const row = (
      await this.pool.query(
        `${shareQuery} JOIN ops.report_session vs ON vs.report_id=r.report_id
    WHERE r.report_id=$1 AND vs.session_hash=$2 AND vs.expires_at>$3`,
        [id, hash(session), now],
      )
    ).rows[0] as ShareRow | undefined;
    // 공유 만료와 세션 만료를 구분하되 비밀 없이 존재 여부를 노출하지 않는다.
    if (!row) {
      const expired = (
        await this.pool.query(
          `${shareQuery} JOIN ops.report_session vs ON vs.report_id=r.report_id
    WHERE r.report_id=$1 AND vs.session_hash=$2`,
          [id, hash(session)],
        )
      ).rows[0] as ShareRow | undefined;
      if (expired) readable(expired, now);
      requireCondition(false, 404, "session_unavailable");
    }
    readable(row, now);
    return { ...row.snapshot, expires_at: row.expires_at.toISOString() };
  }
}
