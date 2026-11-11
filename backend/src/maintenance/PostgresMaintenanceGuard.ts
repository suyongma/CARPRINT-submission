import type { PoolClient } from "pg";
import type { Principal } from "../identity/Authorization.js";
import type { EventRequest } from "../vehicle-history/contracts.js";
import { requireCondition } from "../shared/errors.js";
import { checkMaintenanceWindow } from "./MaintenanceWritePolicy.js";

/** 이벤트 저장 트랜잭션에서 자격을 잠근다. 철회/만료 확인과 원본 보존 정정을 함께 수행한다. */
export async function guardMaintenanceWrite(
  client: PoolClient,
  principal: Principal,
  request: EventRequest,
  now: Date,
  originalId?: string,
) {
  const credential = (
    await client.query("SELECT identity.active_mechanic($1,$2) AS active", [
      principal.id,
      now,
    ])
  ).rows[0];
  requireCondition(
    credential?.active,
    403,
    "active_mechanic_credential_required",
  );
  let anchors: Date[] = [];
  // 정정 조상 전부 뒤져서 발생·수신 시각 모음. 최근 정정만 보면 오래된 정비도 기한 우회가 됨. _ma
  if (originalId) {
    const { rows } = await client.query(
      `WITH RECURSIVE ancestors AS (
         SELECT event_id,occurred_at,received_at FROM trust.vehicle_event WHERE event_id=$1 AND vehicle_ref=$2
         UNION
         SELECT e.event_id,e.occurred_at,e.received_at FROM ancestors a
           JOIN trust.correction c ON c.new_event_id=a.event_id
           JOIN trust.vehicle_event e ON e.event_id=c.original_event_id WHERE e.vehicle_ref=$2
       ) SELECT occurred_at,received_at FROM ancestors`,
      [originalId, principal.vehicleRef],
    );
    requireCondition(
      rows.length > 0 && rows.every((row) => row.occurred_at),
      403,
      "maintenance_original_time_required",
    );
    anchors = rows.flatMap((row) => [row.occurred_at, row.received_at]);
  }
  checkMaintenanceWindow(request, now, anchors);
}
