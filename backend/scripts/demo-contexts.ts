/** 기존 차량 이력을 건드리지 않고 차량 B 관리자와 조회 전용 시연 사용자를 추가한다. */
import { readFileSync, writeFileSync } from "node:fs";
import type { Pool } from "pg";
import { createPool, transaction } from "../src/db/connection.js";
import { hash, secret } from "../src/shared/crypto.js";
import type { DemoCredential } from "./seed-data.js";
export async function seedDemoContexts(
  pool: Pool,
  credentials: DemoCredential[],
): Promise<DemoCredential[]> {
  // 파일 배열 순서가 달라져도 차량 권한이 뒤바뀌지 않도록 합성 별칭으로 연결한다.
  const fixture = JSON.parse(
    readFileSync(
      new URL("../../fixtures/stages-5-7/seed-bundle.json", import.meta.url),
      "utf8",
    ),
  );
  const vehicleA = fixture.alias_to_uuid["demo-vehicle-a"] as string;
  const vehicleB = fixture.alias_to_uuid["demo-vehicle-b"] as string;
  if (!vehicleA || !vehicleB) throw new Error("Demo vehicle aliases missing");
  const additions = [
    {
      id: "fa24a99e-0715-489c-bdad-53cb70186111",
      vehicle: vehicleB,
      role: "report_manager",
      scopes: [
        "timeline:read",
        "reports:create",
        "reports:read",
        "reports:revoke",
      ],
    },
    {
      id: "fa24a99e-0715-489c-bdad-53cb70186222",
      vehicle: vehicleA,
      role: "demo_user_b",
      scopes: ["timeline:read"],
    },
    {
      id: "fa24a99e-0715-489c-bdad-53cb70186333",
      vehicle: vehicleB,
      role: "demo_user_b",
      scopes: ["timeline:read"],
    },
  ];
  await transaction(pool, async (client) => {
    for (const addition of additions) {
      const saved = credentials.find((c) => c.principal_id === addition.id);
      const token = saved?.token ?? secret();
      const existing = await client.query(
        "SELECT token_hash FROM identity.principal WHERE principal_id=$1",
        [addition.id],
      );
      if (existing.rowCount && existing.rows[0].token_hash !== hash(token))
        throw new Error("Existing credential mismatch; refusing rotation");
      await client.query(
        "INSERT INTO identity.principal(principal_id,vehicle_ref,role,token_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [addition.id, addition.vehicle, addition.role, hash(token)],
      );
      await client.query(
        "INSERT INTO identity.authorization_grant VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [addition.id, addition.scopes, new Date(Date.now() + 30 * 86400000)],
      );
      if (!saved)
        credentials.push({
          principal_id: addition.id,
          vehicle_ref: addition.vehicle,
          environment: "simulation",
          role: addition.role,
          token,
        });
    }
  });
  return credentials;
}
if (process.argv[1]?.endsWith("demo-contexts.ts")) {
  const url = new URL(process.env.OWNER_DATABASE_URL!);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/carprint_demo")
    throw new Error("Local demo only");
  const pool = createPool(url.toString());
  const path = ".local/credentials.json";
  try {
    const credentials = await seedDemoContexts(
      pool,
      JSON.parse(readFileSync(path, "utf8")),
    );
    writeFileSync(path, JSON.stringify(credentials, null, 2), { mode: 0o600 });
    console.log("Demo context roles ready. Existing vehicle events preserved.");
  } finally {
    await pool.end();
  }
}
