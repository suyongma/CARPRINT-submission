import type { PoolClient } from "pg";
import type { Principal } from "../identity/Authorization.js";
import type { PersonalScope } from "./contracts.js";
import { hash } from "../shared/crypto.js";
import { requireCondition } from "../shared/errors.js";
export type SessionRow = {
  session_id: string;
  vehicle_ref: string;
  account_id: string;
  display_name: string;
  profile: any;
  profile_revision: number;
  available_seats: string[];
  scopes: PersonalScope[];
  seat: string | null;
  expires_at: Date;
  revision: number;
};

/** 같은 트랜잭션에서 세션과 계정 버전을 잠근다. 토큰·차량 결속과 만료를 반드시 함께 검사한다. */
// 호출한 쪽 트랜잭션에서 세션이랑 계정 같이 잠금. 버전 확인하고 바꾸는 것도 이 잠금 안에서 끝낼 것. _ma
export async function lockPersonalSession(
  client: PoolClient,
  actor: Principal,
  token: string,
  now: Date,
): Promise<SessionRow> {
  const row = (
    await client.query(
      `SELECT s.*,a.display_name,a.profile,a.revision AS profile_revision,COALESCE(l.seats,'{}') AS available_seats FROM personal.session s JOIN personal.account a USING(account_id) LEFT JOIN personal.vehicle_layout l ON l.vehicle_ref=s.vehicle_ref
   WHERE s.token_hash=$1 AND s.principal_id=$2 AND s.vehicle_ref=$3 AND s.ended_at IS NULL AND s.expires_at>$4 FOR UPDATE OF s,a`,
      [hash(token), actor.id, actor.vehicleRef, now],
    )
  ).rows[0];
  requireCondition(row, 401, "personal_session_unavailable");
  return row;
}
