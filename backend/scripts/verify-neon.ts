/** 실 Neon DB의 역할·원장과 API 계약 검증. 쓰기 시나리오는 전용 검증 브랜치에서만 실행한다. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { createPool } from "../src/db/connection.js";
import { PostgresPersonalScoreReader } from "../src/personal-score/PostgresPersonalScoreReader.js";
import { neonTarget } from "./neon-target.js";
import type { DemoCredential } from "./seed-data.js";

neonTarget();
const exercise = process.argv.includes("--exercise");
if (exercise && process.env.CARPRINT_NEON_BRANCH !== "codex-cloud-validation")
  throw new Error(
    "Write verification only accepts the isolated validation branch",
  );
const config = readConfig();
const pool = createPool(config.databaseUrl);
const app = await buildApp(config, pool);
const credentials: DemoCredential[] = JSON.parse(
  readFileSync(process.env.CARPRINT_CREDENTIALS_PATH!, "utf8"),
);
const managers = credentials.filter(
  (c) => c.environment === "simulation" && c.role === "report_manager",
);
const sessions: { manager: DemoCredential; id: string }[] = [];
const checks: string[] = [];
try {
  const role = (
    await pool.query(
      "SELECT current_user AS role,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls FROM pg_roles WHERE rolname=current_user",
    )
  ).rows[0];
  assert.equal(role.role, "carprint_api");
  for (const flag of [
    role.rolsuper,
    role.rolcreaterole,
    role.rolcreatedb,
    role.rolbypassrls,
  ])
    assert.equal(flag, false);
  for (const [table, privilege] of [
    ["trust.vehicle_event", "UPDATE"],
    ["trust.vehicle_event", "DELETE"],
    ["identity.mechanic_credential", "INSERT"],
    ["identity.mechanic_credential", "UPDATE"],
    ["personal.score_revision", "INSERT"],
    ["personal.score_revision", "UPDATE"],
  ])
    assert.equal(
      (
        await pool.query(
          "SELECT has_table_privilege(current_user,$1,$2) AS allowed",
          [table, privilege],
        )
      ).rows[0].allowed,
      false,
    );
  checks.push(
    "API role restricted; history, mechanic credentials and score ledger protected",
  );
  assert.equal(
    Number(
      (await pool.query("SELECT count(*) FROM personal.comfort_capability"))
        .rows[0].count,
    ),
    2,
  );
  checks.push(
    "Two synthetic vehicle capabilities available; API cannot update capability",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT has_table_privilege(current_user,'personal.comfort_capability','UPDATE') AS allowed",
      )
    ).rows[0].allowed,
    false,
  );
  const scoreReader = new PostgresPersonalScoreReader(pool);
  assert.equal((await scoreReader.read("demo-a", new Date())).score, 69);
  assert.equal((await scoreReader.read("demo-b", new Date())).score, 50);
  checks.push("Account A=69, B=50 read from remote account ledger");
  assert.equal(
    (await app.inject({ method: "GET", url: "/health" })).statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ method: "GET", url: "/v1/demo/accounts" })).statusCode,
    401,
  );
  assert.equal(managers.length, 2);
  for (const manager of managers) {
    const response = await app.inject({
      method: "GET",
      url: `/v1/vehicles/${manager.vehicle_ref}/timeline`,
      headers: { authorization: `Bearer ${manager.token}` },
    });
    assert.equal(response.statusCode, 200);
  }
  checks.push(
    "API health, unauthorized rejection and both vehicle timelines verified",
  );
  if (exercise) {
    const connect = async (manager: DemoCredential) => {
      const headers = { authorization: `Bearer ${manager.token}` };
      const request = await app.inject({
        method: "POST",
        url: "/v1/personal/connections",
        headers,
        payload: { scopes: ["climate", "seat"], mode: "temporary" },
      });
      assert.equal(request.statusCode, 200);
      const challenge = request.json();
      const response = await app.inject({
        method: "POST",
        url: `/v1/demo/personal/connections/${challenge.requestId}/approve`,
        headers,
        payload: { accountId: "demo-a", code: challenge.code, confirmed: true },
      });
      assert.equal(response.statusCode, 200);
      const body = response.json();
      sessions.push({ manager, id: body.session.sessionId });
      return {
        body,
        headers: { ...headers, "x-personal-session": body.token },
      };
    };
    const first = await connect(managers[0]!);
    const original = first.body.session.preferences.climate;
    const changed = 29.5;
    const saved = await app.inject({
      method: "PUT",
      url: "/v1/personal/profile",
      headers: first.headers,
      payload: {
        revision: first.body.session.profileRevision,
        values: { climate: changed },
      },
    });
    assert.equal(saved.statusCode, 200);
    try {
      const second = await connect(managers[1]!);
      assert.equal(second.body.session.preferences.climate, changed);
      assert.equal(
        second.body.session.personalScore.score,
        first.body.session.personalScore.score,
      );
      for (const [index, connection] of [first, second].entries()) {
        const assigned = await app.inject({
          method: "PUT",
          url: "/v1/personal/session/seat",
          headers: connection.headers,
          payload: { seat: "driver" },
        });
        assert.equal(assigned.statusCode, 200, assigned.body);
        const read = await app.inject({
          method: "GET",
          url: "/v1/personal/comfort",
          headers: connection.headers,
        });
        assert.equal(read.statusCode, 200, read.body);
        const view = read.json();
        assert.equal(
          view.items.find((i: any) => i.key === "temperature").target,
          index === 0 ? 29.5 : 28,
        );
        assert.equal(
          view.items.find((i: any) => i.key === "seatVentilation").target,
          index === 0 ? 2 : null,
        );
        const preview = (
          await app.inject({
            method: "POST",
            url: "/v1/personal/comfort/previews",
            headers: connection.headers,
            payload: {},
          })
        ).json();
        const applied = await app.inject({
          method: "POST",
          url: `/v1/personal/comfort/previews/${preview.id}/apply`,
          headers: connection.headers,
          payload: { confirmed: true },
        });
        assert.equal(applied.statusCode, 200, applied.body);
        assert.equal(applied.json().items.length, index === 0 ? 5 : 4);
      }
      checks.push(
        "A/B comfort conversion, unsupported ventilation filtering and server-saved simulated apply verified",
      );
    } finally {
      const restored = await app.inject({
        method: "PUT",
        url: "/v1/personal/profile",
        headers: first.headers,
        payload: {
          revision: saved.json().profileRevision,
          values: { climate: original },
        },
      });
      assert.equal(restored.statusCode, 200);
    }
    checks.push(
      "Temporary login, preference save and score carry-over across vehicle A/B verified",
    );
    const issuer = credentials.find((c) => c.role === "maintenance_issuer")!;
    const maintenance = (ageDays: number) => ({
      event_id: randomUUID(),
      event_type: "maintenance.completed",
      occurred_at: new Date(Date.now() - ageDays * 86400000).toISOString(),
      observed_at: new Date(Date.now() - ageDays * 86400000).toISOString(),
      payload_version: 1,
      payload: { task_code: "demo-brake-inspection" },
      source_ref: issuer.source_ref!,
      environment: "simulation",
      collection_scope: ["maintenance"],
      source_signature: null,
    });
    const headers = {
      authorization: `Bearer ${issuer.token}`,
      "idempotency-key": randomUUID(),
    };
    const old = await app.inject({
      method: "POST",
      url: "/v1/vehicle-events",
      headers,
      payload: maintenance(8),
    });
    assert.equal(old.statusCode, 403);
    const payload = maintenance(1);
    headers["idempotency-key"] = randomUUID();
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/vehicle-events",
          headers,
          payload,
        })
      ).statusCode,
      201,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/vehicle-events",
          headers,
          payload,
        })
      ).statusCode,
      200,
    );
    checks.push(
      "8-day record denied, recent local_demo mechanic accepted, replay deduplicated",
    );
  }
  console.log(
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        branch: process.env.CARPRINT_NEON_BRANCH,
        transport: "PostgreSQL TLS verify-full; API inject (no public hosting)",
        checks,
      },
      null,
      2,
    ),
  );
} finally {
  for (const { manager, id } of sessions)
    await app.inject({
      method: "DELETE",
      url: `/v1/personal/sessions/${id}`,
      headers: { authorization: `Bearer ${manager.token}` },
    });
  await app.close();
  await pool.end();
}
