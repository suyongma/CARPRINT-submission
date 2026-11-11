/** 전용 carprint_test에서만 실행하는 수동 브라우저 검증 서버. OS 시각은 바꾸지 않는다. */
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { createPool } from "../src/db/connection.js";
import { seedData } from "./seed-data.js";
const config = {
  ...readConfig(),
  databaseUrl: process.env.TEST_DATABASE_URL!,
  publicOrigin: "http://127.0.0.1:18180",
  port: 18180,
};
const target = new URL(config.databaseUrl);
if (target.hostname !== "127.0.0.1" || target.pathname !== "/carprint_test")
  throw new Error("Test database only");
const ownerUrl = new URL(process.env.OWNER_DATABASE_URL!);
ownerUrl.pathname = "/carprint_test";
const owner = createPool(ownerUrl.toString()),
  pool = createPool(config.databaseUrl);
let now = new Date();
await owner.query("TRUNCATE identity.vehicle CASCADE");
const credentials = await seedData(owner, config.receiptKeyPath, now);
const manager = credentials.find(
  (c) => c.environment === "simulation" && c.role === "report_manager",
)!;
const app = await buildApp(config, pool, () => now);
await app.listen({ host: "127.0.0.1", port: config.port });
let latest: { report_id: string; share_url: string; expires_at: string };
async function create() {
  const response = await app.inject({
    method: "POST",
    url: "/v1/reports",
    headers: {
      authorization: `Bearer ${manager.token}`,
      "idempotency-key": randomUUID(),
    },
    payload: {
      vehicle_ref: manager.vehicle_ref,
      kind: "full",
      scope: {
        from: "2026-01-01T00:00:00Z",
        to: "2026-12-31T23:59:59Z",
        selected_event_ids: [],
      },
      expires_in: 3600,
    },
  });
  if (response.statusCode !== 201) throw new Error(response.body);
  latest = response.json();
  writeFileSync(".local/browser-review.json", JSON.stringify(latest), {
    mode: 0o600,
  });
  console.log(latest.share_url);
}
await create();
console.log(
  "Commands: expire / new / revoke / change / stop. Local test DB only.",
);
const input = createInterface({ input: process.stdin });
for await (const line of input) {
  if (line === "expire") {
    now = new Date(latest!.expires_at);
    console.log("Injected clock: exact expiry");
  } else if (line === "new") await create();
  else if (line === "revoke") {
    const r = await app.inject({
      method: "DELETE",
      url: `/v1/reports/${latest!.report_id}/share`,
      headers: {
        authorization: `Bearer ${manager.token}`,
        "idempotency-key": randomUUID(),
      },
    });
    console.log("Revoked:", r.statusCode);
  } else if (line === "change") {
    await owner.query(
      "UPDATE trust.source SET status='revoked' WHERE source_ref=$1",
      [credentials[0]!.source_ref],
    );
    console.log("Test source revoked; revision advanced");
  } else if (line === "stop") break;
}
await app.close();
await pool.end();
await owner.end();
