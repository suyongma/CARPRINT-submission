import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { hash, secret, CursorCodec } from "../src/shared/crypto.js";
import { Ed25519ReceiptSigner } from "../src/vehicle-history/Ed25519ReceiptSigner.js";
import { PostgresVehicleEventStore } from "../src/vehicle-history/PostgresVehicleEventStore.js";
import type { EventRequest } from "../src/vehicle-history/contracts.js";
export interface DemoCredential {
  principal_id: string;
  vehicle_ref: string;
  environment: string;
  role: string;
  token: string;
  source_ref?: string;
}
export async function seedData(
  pool: Pool,
  keyPath: string,
  clock = new Date(),
): Promise<DemoCredential[]> {
  const fixture = JSON.parse(
    readFileSync(
      new URL("../../fixtures/stages-5-7/seed-bundle.json", import.meta.url),
      "utf8",
    ),
  );
  const credentials: DemoCredential[] = [];
  for (const v of fixture.vehicles) {
    await pool.query(
      "INSERT INTO identity.vehicle VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [v.vehicle_ref, v.alias, v.environment],
    );
    await pool.query(
      "INSERT INTO ops.vehicle_stream(vehicle_ref) VALUES($1) ON CONFLICT DO NOTHING",
      [v.vehicle_ref],
    );
  }
  const principals = [
    ...fixture.principals,
    {
      principal_id: "7c05f660-9aa0-48e1-9a31-d42d4ef6b9cc",
      vehicle_ref: fixture.vehicles[2].vehicle_ref,
      role: "report_manager",
      scopes: [
        "timeline:read",
        "reports:create",
        "reports:read",
        "reports:revoke",
      ],
    },
  ];
  for (const p of principals) {
    const token = secret();
    await pool.query(
      "INSERT INTO identity.principal(principal_id,vehicle_ref,role,token_hash) VALUES($1,$2,$3,$4)",
      [p.principal_id, p.vehicle_ref, p.role, hash(token)],
    );
    await pool.query(
      "INSERT INTO identity.authorization_grant VALUES($1,$2,$3)",
      [p.principal_id, p.scopes, new Date(clock.getTime() + 30 * 86400000)],
    );
    credentials.push({
      principal_id: p.principal_id,
      vehicle_ref: p.vehicle_ref,
      environment: fixture.vehicles.find(
        (v: any) => v.vehicle_ref === p.vehicle_ref,
      ).environment,
      role: p.role,
      token,
      source_ref: fixture.sources.find(
        (s: any) => s.principal_id === p.principal_id,
      )?.source_ref,
    });
  }
  // 합성 과거 예제는 당시 수신 시각으로 재생한다. 외부 API의 소급 입력 예외가 아니다.
  for (const p of credentials.filter((p) => p.role === "maintenance_issuer"))
    await pool.query(
      "INSERT INTO identity.mechanic_credential VALUES($1,$2,'local_demo','CARPRINT fixture authority','2026-01-01Z','2027-01-01Z',NULL) ON CONFLICT DO NOTHING",
      [p.principal_id, `demo-mechanic:${p.principal_id}`],
    );
  for (const s of fixture.sources)
    await pool.query(
      "INSERT INTO trust.source(source_ref,vehicle_ref,environment,principal_id,source_kind) VALUES($1,$2,$3,$4,$5)",
      [
        s.source_ref,
        s.vehicle_ref,
        s.environment,
        s.principal_id,
        s.source_kind,
      ],
    );
  const store = new PostgresVehicleEventStore(
    pool,
    new Ed25519ReceiptSigner(readFileSync(keyPath, "utf8")),
    new CursorCodec(Buffer.alloc(32)),
  );
  for (const e of fixture.events) {
    const { vehicle_ref, received_at, server_seq, correction_of, ...request } =
      e;
    const p = credentials.find((p) => p.source_ref === request.source_ref)!;
    await store.append(
      {
        id: p.principal_id,
        vehicleRef: p.vehicle_ref,
        environment: p.environment,
        scopes: [],
      },
      request as EventRequest,
      `seed:${request.event_id}`,
      new Date(received_at),
      correction_of
        ? {
            originalId: correction_of,
            replacement: request,
            reason: "performed_date_corrected",
            expectedHead: correction_of,
          }
        : undefined,
    );
  }
  for (const g of fixture.gaps)
    await pool.query(
      "INSERT INTO trust.collection_gap VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        g.gap_id,
        g.vehicle_ref,
        g.environment,
        g.start,
        g.end,
        g.scope,
        g.reason,
      ],
    );
  return credentials;
}
