import { lockPersonalSession, type SessionRow } from "./session-access.js";
import type { PersonalScoreReader } from "../personal-score/contracts.js";
import { randomUUID, randomInt } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Principal } from "../identity/Authorization.js";
import { transaction } from "../db/connection.js";
import { hash, secret } from "../shared/crypto.js";
import { requireCondition } from "../shared/errors.js";
import { SimulatedPreferencePlanner } from "./SimulatedPreferencePlanner.js";
import type {
  PersonalizationStore,
  PersonalScope,
  PersonalSession,
  ConnectionRequest,
  ApplicationPreview,
  ApplicationItem,
} from "./contracts.js";
export class PostgresPersonalizationStore implements PersonalizationStore {
  constructor(
    private readonly pool: Pool,
    private readonly planner: SimulatedPreferencePlanner,
    private readonly scores: (client: PoolClient) => PersonalScoreReader,
  ) {}
  async accounts() {
    return (
      await this.pool.query(
        "SELECT account_id AS id,display_name AS name FROM personal.account ORDER BY account_id",
      )
    ).rows;
  }
  private async locked(
    client: PoolClient,
    actor: Principal,
    token: string,
    now: Date,
  ): Promise<SessionRow> {
    return lockPersonalSession(client, actor, token, now);
  }
  // 동의한 scope만 내보냄. 시트는 현재 차량 값. DB 프로필 통째로 화면에 넘기지 말 것. _ma
  private view(row: SessionRow): Omit<PersonalSession, "personalScore"> {
    const preferences: PersonalSession["preferences"] = {};
    for (const scope of row.scopes)
      preferences[scope] =
        scope === "seat"
          ? (row.profile.seat?.[row.vehicle_ref] ?? null)
          : row.profile[scope];
    return {
      sessionId: row.session_id,
      accountId: row.account_id,
      displayName: row.display_name,
      scopes: row.scopes,
      seat: row.seat,
      availableSeats: row.available_seats,
      expiresAt: row.expires_at.toISOString(),
      revision: row.revision,
      profileRevision: row.profile_revision,
      preferences,
    };
  }
  private async accountView(
    row: SessionRow,
    now: Date,
    client: PoolClient,
  ): Promise<PersonalSession> {
    return {
      ...this.view(row),
      personalScore: await this.scores(client).read(row.account_id, now),
    };
  }
  async request(actor: Principal, input: ConnectionRequest, now: Date) {
    const requestId = randomUUID(),
      code = String(randomInt(100000, 1000000)),
      expiresAt = new Date(now.getTime() + 300000);
    await this.pool.query(
      "INSERT INTO personal.connection_request(request_id,principal_id,vehicle_ref,scopes,code,expires_at,mode) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        requestId,
        actor.id,
        actor.vehicleRef,
        input.scopes,
        code,
        expiresAt,
        input.mode,
      ],
    );
    return { requestId, code, expiresAt: expiresAt.toISOString() };
  }
  // 요청 잠그고 세션 생성·요청 소비 같이 커밋. 동시에 승인 눌러도 두 개 안 생김. 외부 계정 인증은 아님. _ma
  async approve(
    actor: Principal,
    id: string,
    accountId: string,
    code: string,
    now: Date,
  ) {
    return transaction(this.pool, async (client) => {
      const request = (
        await client.query(
          "SELECT * FROM personal.connection_request WHERE request_id=$1 AND principal_id=$2 AND vehicle_ref=$3 FOR UPDATE",
          [id, actor.id, actor.vehicleRef],
        )
      ).rows[0];
      requireCondition(
        request && request.code === code,
        404,
        "connection_request_unavailable",
      );
      requireCondition(
        !request.consumed_at && request.expires_at > now,
        410,
        "connection_request_expired_or_used",
      );
      const account = (
        await client.query(
          "SELECT 1 FROM personal.account WHERE account_id=$1",
          [accountId],
        )
      ).rowCount;
      requireCondition(account, 404, "demo_account_unavailable");
      // 같은 계정의 이전 연결을 조용히 교체하지 않는다. 종료 후 다시 승인한다.
      await client.query(
        "SELECT 1 FROM ops.vehicle_stream WHERE vehicle_ref=$1 FOR UPDATE",
        [actor.vehicleRef],
      );
      const active = await client.query(
        "SELECT 1 FROM personal.session WHERE principal_id=$1 AND account_id=$2 AND ended_at IS NULL AND expires_at>$3",
        [actor.id, accountId, now],
      );
      requireCondition(!active.rowCount, 409, "account_already_connected");
      const token = secret(),
        sessionId = randomUUID(),
        expires = new Date(
          now.getTime() + (request.mode === "temporary" ? 30 : 120) * 60000,
        );
      await client.query(
        "INSERT INTO personal.session(session_id,request_id,principal_id,vehicle_ref,account_id,token_hash,scopes,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          sessionId,
          id,
          actor.id,
          actor.vehicleRef,
          accountId,
          hash(token),
          request.scopes,
          expires,
        ],
      );
      await client.query(
        "UPDATE personal.connection_request SET consumed_at=$2 WHERE request_id=$1",
        [id, now],
      );
      return {
        token,
        session: await this.accountView(
          await this.locked(client, actor, token, now),
          now,
          client,
        ),
      };
    });
  }
  async cancelRequest(actor: Principal, id: string, now: Date) {
    await transaction(this.pool, async (client) => {
      const request = (
        await client.query(
          "UPDATE personal.connection_request SET consumed_at=COALESCE(consumed_at,$4) WHERE request_id=$1 AND principal_id=$2 AND vehicle_ref=$3 RETURNING request_id",
          [id, actor.id, actor.vehicleRef, now],
        )
      ).rows[0];
      if (!request) return;
      // 승인 응답 유실 뒤에도 요청 ID로 생긴 세션을 닫는다. 개인 토큰 복구 없이 정리 가능.
      const ended = await client.query(
        "UPDATE personal.session SET ended_at=COALESCE(ended_at,$2),seat=NULL,scopes='{}',revision=revision+1 WHERE request_id=$1 RETURNING session_id",
        [id, now],
      );
      for (const row of ended.rows)
        await client.query(
          "DELETE FROM personal.application_preview WHERE session_id=$1",
          [row.session_id],
        );
    });
  }

  async session(actor: Principal, token: string, now: Date) {
    return transaction(this.pool, async (c) =>
      this.accountView(await this.locked(c, actor, token, now), now, c),
    );
  }
  // 차량부터 잠그고 좌석 확인·배정함. 따로 하면 둘 다 빈자리인 줄 알고 같은 좌석 잡음. _ma
  async assignSeat(actor: Principal, token: string, seat: string, now: Date) {
    return transaction(this.pool, async (client) => {
      await client.query(
        "SELECT 1 FROM ops.vehicle_stream WHERE vehicle_ref=$1 FOR UPDATE",
        [actor.vehicleRef],
      );
      const row = await this.locked(client, actor, token, now);
      requireCondition(
        row.available_seats.includes(seat),
        422,
        "seat_layout_unavailable",
      );
      const occupied = await client.query(
        "SELECT 1 FROM personal.session WHERE vehicle_ref=$1 AND seat=$2 AND ended_at IS NULL AND expires_at>$3 AND session_id<>$4",
        [actor.vehicleRef, seat, now, row.session_id],
      );
      requireCondition(!occupied.rowCount, 409, "seat_already_assigned");
      await client.query(
        "UPDATE personal.session SET seat=$2,revision=revision+1 WHERE session_id=$1",
        [row.session_id, seat],
      );
      return this.accountView(
        { ...row, seat, revision: row.revision + 1 },
        now,
        client,
      );
    });
  }
  // 이미 동의한 범위 안에서 줄이기만 됨. 항목 추가하려면 새 승인 받아야 함. _ma
  async narrowScopes(
    actor: Principal,
    token: string,
    scopes: PersonalScope[],
    now: Date,
  ) {
    return transaction(this.pool, async (client) => {
      const row = await this.locked(client, actor, token, now);
      requireCondition(
        scopes.every((s) => row.scopes.includes(s)),
        403,
        "additional_approval_required",
      );
      await client.query(
        "UPDATE personal.session SET scopes=$2,revision=revision+1 WHERE session_id=$1",
        [row.session_id, scopes],
      );
      return this.accountView(
        { ...row, scopes, revision: row.revision + 1 },
        now,
        client,
      );
    });
  }
  async preview(
    actor: Principal,
    token: string,
    now: Date,
  ): Promise<ApplicationPreview> {
    return transaction(this.pool, async (client) => {
      const row = await this.locked(client, actor, token, now);
      const items = this.planner.plan(
        actor.environment,
        row.seat,
        this.view(row).preferences,
      );
      const id = randomUUID(),
        expires = new Date(now.getTime() + 60000);
      await client.query(
        "INSERT INTO personal.application_preview(preview_id,session_id,session_revision,profile_revision,expires_at,items) VALUES($1,$2,$3,$4,$5,$6)",
        [
          id,
          row.session_id,
          row.revision,
          row.profile_revision,
          expires,
          JSON.stringify(items),
        ],
      );
      return {
        previewId: id,
        expiresAt: expires.toISOString(),
        items,
        profileRevision: row.profile_revision,
      };
    });
  }
  // 미리보기랑 현재 세션·프로필 버전 맞으면 모의 결과 저장. 좌석·동의·선호 바뀌었으면 다시 미리보기. _ma
  async apply(
    actor: Principal,
    token: string,
    id: string,
    now: Date,
  ): Promise<ApplicationItem[]> {
    return transaction(this.pool, async (client) => {
      const row = await this.locked(client, actor, token, now);
      const preview = (
        await client.query(
          "SELECT * FROM personal.application_preview WHERE preview_id=$1 AND session_id=$2 FOR UPDATE",
          [id, row.session_id],
        )
      ).rows[0];
      requireCondition(preview, 404, "preview_not_found");
      requireCondition(
        preview.session_revision === row.revision &&
          preview.profile_revision === row.profile_revision,
        412,
        "preview_changed",
      );
      if (preview.result) return preview.result;
      requireCondition(preview.expires_at > now, 412, "preview_expired");
      const result = this.planner.confirm(preview.items);
      await client.query(
        "UPDATE personal.application_preview SET result=$2,confirmed_at=$3 WHERE preview_id=$1",
        [id, JSON.stringify(result), now],
      );
      return result;
    });
  }
  // 화면이 읽었던 revision이 아직 맞는지 봄. 오래된 화면으로 남의 변경 덮으려 하면 412. _ma
  async savePreferences(
    actor: Principal,
    token: string,
    revision: number,
    values: Partial<Record<PersonalScope, unknown>>,
    now: Date,
  ) {
    return transaction(this.pool, async (client) => {
      const row = await this.locked(client, actor, token, now);
      requireCondition(
        row.profile_revision === revision,
        412,
        "profile_revision_changed",
      );
      requireCondition(
        Object.keys(values).every((s) =>
          row.scopes.includes(s as PersonalScope),
        ),
        403,
        "scope_not_approved",
      );
      const profile = { ...row.profile, ...values };
      if (values.climate !== undefined && profile.comfort)
        profile.comfort = { ...profile.comfort, temperature: values.climate };
      await client.query(
        "UPDATE personal.account SET profile=$2,revision=revision+1 WHERE account_id=$1",
        [row.account_id, profile],
      );
      return this.accountView(
        {
          ...row,
          profile,
          profile_revision: row.profile_revision + 1,
        },
        now,
        client,
      );
    });
  }
  // 차량 자격이랑 세션 ID로 끝낼 수 있음. 개인 토큰 지운 뒤에도 재시도 가능. 계정 선호·차량 원장은 남겨둠. _ma
  async end(actor: Principal, id: string, now: Date) {
    await transaction(this.pool, async (client) => {
      const row = (
        await client.query(
          "UPDATE personal.session SET ended_at=COALESCE(ended_at,$4),seat=NULL,scopes='{}',revision=revision+1 WHERE session_id=$1 AND principal_id=$2 AND vehicle_ref=$3 RETURNING session_id",
          [id, actor.id, actor.vehicleRef, now],
        )
      ).rows[0];
      requireCondition(row, 404, "session_not_found");
      // 개인 값이 있는 미리보기만 종료 시 폐기. 차량 이력·계정 원본은 유지한다.
      await client.query(
        "DELETE FROM personal.application_preview WHERE session_id=$1",
        [id],
      );
    });
  }
}
