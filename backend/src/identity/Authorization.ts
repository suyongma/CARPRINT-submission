import type { Pool } from "pg";
import { hash } from "../shared/crypto.js";
import { requireCondition } from "../shared/errors.js";
export interface Principal {
  id: string;
  vehicleRef: string;
  environment: string;
  scopes: string[];
}
export interface Authorization {
  /** 현재 자격 만료·철회와 차량 결속을 조회. 실패 401. 토큰을 보관/출력하지 않는다. */
  authenticate(token: string, now: Date): Promise<Principal>;
}
export class PostgresAuthorization implements Authorization {
  constructor(private readonly pool: Pool) {}
  // 토큰은 해시로 조회함. 여기서 받은 scopes로 나중에 기능별 권한 체크. _ma
  async authenticate(token: string, now: Date): Promise<Principal> {
    const { rows } = await this.pool.query(
      `SELECT p.principal_id, p.vehicle_ref, v.environment, g.scopes
      FROM identity.principal p JOIN identity.vehicle v USING(vehicle_ref)
      JOIN identity.authorization_grant g USING(principal_id)
      WHERE p.token_hash=$1 AND p.revoked_at IS NULL AND g.valid_until>$2`,
      [hash(token), now],
    );
    const row = rows[0];
    requireCondition(row, 401, "authentication_required");
    return {
      id: row.principal_id,
      vehicleRef: row.vehicle_ref,
      environment: row.environment,
      scopes: row.scopes,
    };
  }
}
// 로그인 됐다고 남의 차까지 되는 건 아님. 차량이랑 허용 동작 둘 다 확인. _ma
export function authorize(
  principal: Principal,
  scope: string,
  vehicleRef = principal.vehicleRef,
): void {
  requireCondition(
    principal.vehicleRef === vehicleRef && principal.scopes.includes(scope),
    403,
    "scope_or_vehicle_forbidden",
  );
}
