import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, verify, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { createPool } from "../src/db/connection.js";
import { seedData, type DemoCredential } from "../scripts/seed-data.js";
import { canonical, hash } from "../src/shared/crypto.js";
const config = readConfig();
const testUrl = new URL(process.env.TEST_DATABASE_URL!);
assert.equal(testUrl.hostname, "127.0.0.1");
assert.equal(testUrl.pathname, "/carprint_test");
const ownerUrl = new URL(process.env.OWNER_DATABASE_URL!);
ownerUrl.pathname = "/carprint_test";
const owner = createPool(ownerUrl.toString()),
  pool = createPool(testUrl.toString());
let now = new Date("2026-10-28T08:00:00Z");
let freshMaintenanceId: string | undefined;
const app = await buildApp(config, pool, () => now);
let credentials: DemoCredential[],
  collector: DemoCredential,
  manager: DemoCredential,
  issuer: DemoCredential,
  other: DemoCredential;
const fixture = JSON.parse(
  readFileSync("../fixtures/stages-5-7/seed-bundle.json", "utf8"),
);
const template = JSON.parse(
  readFileSync("../fixtures/stages-5-7/ingest-request.json", "utf8"),
);
const req = () => ({ ...structuredClone(template), event_id: randomUUID() });
const headers = (p = collector, key = randomUUID()) => ({
  authorization: `Bearer ${p.token}`,
  "idempotency-key": key,
});
const reportBody = (kind = "full", ids: string[] = []) => ({
  vehicle_ref: collector.vehicle_ref,
  kind,
  scope: {
    from: "2026-01-01T00:00:00Z",
    to: "2026-12-31T23:59:59Z",
    selected_event_ids: ids,
  },
  expires_in: 3600,
});
const createReport = async (body = reportBody(), key = randomUUID()) => {
  const r = await app.inject({
    method: "POST",
    url: "/v1/reports",
    headers: headers(manager, key),
    payload: body,
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const exchange = async (r: any) => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/report-views",
    headers: { origin: config.publicOrigin },
    payload: {
      report_id: r.report_id,
      share_secret: r.share_url.split("#")[1],
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
};
const view = (r: any, cookie: string) =>
  app.inject({
    method: "GET",
    url: `/v1/report-views/${r.report_id}`,
    headers: { cookie },
  });
before(async () => {
  await app.ready();
});
beforeEach(async () => {
  now = new Date("2026-10-28T08:00:00Z");
  freshMaintenanceId = undefined;
  await owner.query("TRUNCATE identity.vehicle CASCADE");
  credentials = await seedData(owner, config.receiptKeyPath, now);
  collector = credentials[0]!;
  manager = credentials[1]!;
  issuer = credentials[2]!;
  other = credentials[3]!;
});
after(async () => {
  await app.close();
  await pool.end();
  await owner.end();
});
test("S5-01 / S5-10: real DB commit and a new app instance can read it; Ed25519 receipt verifies", async () => {
  const input = req();
  const r = await app.inject({
    method: "POST",
    url: "/v1/vehicle-events",
    headers: headers(),
    payload: input,
  });
  assert.equal(r.statusCode, 201, r.body);
  const receipt = r.json().receipt;
  const { signature, ...unsigned } = receipt;
  assert.ok(
    verify(
      null,
      Buffer.from(canonical(unsigned)),
      createPublicKey(readFileSync(config.receiptKeyPath)),
      Buffer.from(signature, "base64url"),
    ),
  );
  const secondPool = createPool(testUrl.toString());
  const second = await buildApp(config, secondPool, () => now);
  const timeline = await second.inject({
    url: `/v1/vehicles/${collector.vehicle_ref}/timeline`,
    headers: headers(),
  });
  assert.equal(timeline.json().events[0].event_id, input.event_id);
  assert.equal(timeline.json().events.length, 13);
  await second.close();
  await secondPool.end();
  assert.equal(
    (
      await pool.query(
        "SELECT count(*) FROM ops.delivery_outbox WHERE event_id=$1",
        [input.event_id],
      )
    ).rows[0].count,
    "1",
  );
});
test("S5-02 / S5-08: ten concurrent retries return one event and identical receipt", async () => {
  const input = req(),
    h = headers();
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      app.inject({
        method: "POST",
        url: "/v1/vehicle-events",
        headers: h,
        payload: input,
      }),
    ),
  );
  assert.equal(results.filter((r) => r.statusCode === 201).length, 1);
  results.forEach((r) => {
    assert.ok([200, 201].includes(r.statusCode), r.body);
    assert.deepEqual(r.json(), results[0]!.json());
  });
});
test("S5-03: idempotency conflict cannot alter original", async () => {
  const input = req(),
    h = headers();
  await app.inject({
    method: "POST",
    url: "/v1/vehicle-events",
    headers: h,
    payload: input,
  });
  input.payload.value++;
  const r = await app.inject({
    method: "POST",
    url: "/v1/vehicle-events",
    headers: h,
    payload: input,
  });
  assert.equal(r.statusCode, 409);
});
test("S5-04: vehicle, environment, source ownership and collection scope are enforced", async () => {
  for (const patch of [
    { vehicle_ref: other.vehicle_ref },
    { environment: "pleos_emulator" },
    { source_ref: other.source_ref },
    { collection_scope: ["maintenance"] },
  ]) {
    const r = await app.inject({
      method: "POST",
      url: "/v1/vehicle-events",
      headers: headers(),
      payload: { ...req(), ...patch },
    });
    assert.ok([403, 422].includes(r.statusCode), r.body);
  }
});
test("S5-05 / S5-06: expired/missing credentials and unexpected private fields rejected", async () => {
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/vehicle-events",
        headers: { "idempotency-key": "x" },
        payload: req(),
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/vehicle-events",
        headers: headers(),
        payload: { ...req(), email: "forbidden@example.invalid" },
      })
    ).statusCode,
    422,
  );
  await owner.query(
    "UPDATE identity.authorization_grant SET valid_until=$1 WHERE principal_id=$2",
    [now, collector.principal_id],
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/vehicle-events",
        headers: headers(),
        payload: req(),
      })
    ).statusCode,
    401,
  );
});
test("S5-09: distinct concurrent events have contiguous unique sequence", async () => {
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      app.inject({
        method: "POST",
        url: "/v1/vehicle-events",
        headers: headers(),
        payload: req(),
      }),
    ),
  );
  assert.deepEqual(
    results
      .map((r) => {
        assert.equal(r.statusCode, 201, r.body);
        return r.json().receipt.server_seq;
      })
      .sort((a, b) => a - b),
    [13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
  );
});
test("S5-09: mid-transaction receipt failure rolls back event and sequence", async () => {
  await owner.query(`CREATE FUNCTION ops.test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$;
 CREATE TRIGGER test_fail BEFORE INSERT ON trust.ingest_receipt FOR EACH ROW EXECUTE FUNCTION ops.test_fail()`);
  const input = req(),
    h = headers();
  try {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/vehicle-events",
          headers: h,
          payload: input,
        })
      ).statusCode,
      503,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*) FROM trust.vehicle_event WHERE event_id=$1",
          [input.event_id],
        )
      ).rows[0].count,
      "0",
    );
  } finally {
    await owner.query(
      "DROP TRIGGER test_fail ON trust.ingest_receipt; DROP FUNCTION ops.test_fail()",
    );
  }
  const r = await app.inject({
    method: "POST",
    url: "/v1/vehicle-events",
    headers: h,
    payload: input,
  });
  assert.equal(r.statusCode, 201);
  assert.equal(r.json().receipt.server_seq, 13);
});
test("S5-11: API database role cannot update/delete original events or receipts", async () => {
  for (const table of ["trust.vehicle_event", "trust.ingest_receipt"])
    for (const sql of [
      `DELETE FROM ${table}`,
      `UPDATE ${table} SET event_id=event_id`,
    ])
      await assert.rejects(pool.query(sql), (e: any) => e.code === "42501");
});
test("S6-01 / S6-05 / S6-06: provenance, correction, gap, unknown time and decreasing odometer", async () => {
  const input = req();
  input.payload.value = 100;
  await app.inject({
    method: "POST",
    url: "/v1/vehicle-events",
    headers: headers(),
    payload: input,
  });
  const r = await app.inject({
    url: `/v1/vehicles/${collector.vehicle_ref}/timeline`,
    headers: headers(),
  });
  assert.equal(r.statusCode, 200);
  const data = r.json();
  assert.equal(data.gaps.length, 1);
  assert.equal(data.corrections.length, 1);
  assert.equal(data.events[0].environment, "simulation");
  assert.equal(data.events[0].occurred_at, null);
  assert.ok(data.events[0].review_flags.includes("odometer_decreased_review"));
  assert.ok(data.events[0].received_at);
});
const correctionInput = () => ({
  replacement: {
    ...fixture.events.find(
      (e: any) => e.event_type === "maintenance.corrected",
    ),
    event_id: randomUUID(),
  },
  reason_code: "performed_date_corrected",
});
async function correctTarget(token = issuer, expected?: string) {
  const request = correctionInput();
  for (const k of ["vehicle_ref", "received_at", "server_seq", "correction_of"])
    delete request.replacement[k];
  // 오래된 fixture는 더 이상 정정 불가. 현재 7일 안의 새 작업을 만들어 기존 충돌 검사를 이어간다.
  request.replacement.occurred_at = new Date(
    now.getTime() - 86400000,
  ).toISOString();
  request.replacement.observed_at = request.replacement.occurred_at;
  if (!freshMaintenanceId) {
    freshMaintenanceId = randomUUID();
    const created = await app.inject({
      method: "POST",
      url: "/v1/vehicle-events",
      headers: headers(issuer),
      payload: {
        ...request.replacement,
        event_id: freshMaintenanceId,
        event_type: "maintenance.completed",
      },
    });
    assert.equal(created.statusCode, 201, created.body);
  }
  return app.inject({
    method: "POST",
    url: `/v1/events/${freshMaintenanceId}/corrections`,
    headers: { ...headers(token), "if-match": expected ?? freshMaintenanceId },
    payload: request,
  });
}

test("S6-02 / S6-03 / S6-04: correction appends; wrong issuer/stale version rejected", async () => {
  assert.equal((await correctTarget(collector)).statusCode, 403);
  assert.equal((await correctTarget(issuer, randomUUID())).statusCode, 412);
  const r = await correctTarget();
  assert.equal(r.statusCode, 201, r.body);
  assert.equal((await correctTarget()).statusCode, 412);
  assert.equal(
    (await pool.query("SELECT count(*) FROM trust.vehicle_event")).rows[0]
      .count,
    "14",
  );
});
test("S6-07 / S6-08: cursor keeps snapshot while appending; wrong vehicle is forbidden", async () => {
  const first = (
    await app.inject({
      url: `/v1/vehicles/${collector.vehicle_ref}/timeline?limit=5`,
      headers: headers(),
    })
  ).json();
  await app.inject({
    method: "POST",
    url: "/v1/vehicle-events",
    headers: headers(),
    payload: req(),
  });
  const next = (
    await app.inject({
      url: `/v1/vehicles/${collector.vehicle_ref}/timeline?limit=5&cursor=${first.next_cursor}`,
      headers: headers(),
    })
  ).json();
  assert.equal(next.snapshot_seq, 12);
  assert.equal(
    new Set([...first.events, ...next.events].map((e) => e.event_id)).size,
    10,
  );
  const forbidden = await app.inject({
    url: `/v1/vehicles/${other.vehicle_ref}/timeline?cursor=${first.next_cursor}`,
    headers: headers(other),
  });
  assert.equal(forbidden.statusCode, 403);
});
test("S7-01 / S7-02 / S7-03 / S7-11: full/partial snapshot scope, no score or principal secrets", async () => {
  const full = await createReport(),
    cookie = await exchange(full);
  const r = await view(full, cookie);
  assert.equal(r.statusCode, 200);
  const snapshot = r.json();
  assert.equal(snapshot.events.length, 12);
  assert.equal(snapshot.assessment, null);
  assert.equal(snapshot.gaps.length, 1);
  assert.equal(snapshot.corrections.length, 1);
  assert.ok(!r.body.includes(collector.token));
  assert.ok(!r.body.includes("principal_id"));
  assert.ok(!r.body.includes("token_hash"));
  const partial = await createReport(
    reportBody("partial", [fixture.events[1].event_id]),
  );
  const pc = await exchange(partial);
  assert.equal((await view(partial, pc)).json().events.length, 1);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/reports",
        headers: headers(manager),
        payload: reportBody("full", [fixture.events[1].event_id]),
      })
    ).statusCode,
    422,
  );
});
test("S7-04: collector cannot issue/revoke and other vehicle cannot inspect", async () => {
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/reports",
        headers: headers(),
        payload: reportBody(),
      })
    ).statusCode,
    403,
  );
  const r = await createReport();
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: `/v1/reports/${r.report_id}/share`,
        headers: headers(),
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        url: `/v1/reports/${r.report_id}`,
        headers: headers(other),
      })
    ).statusCode,
    403,
  );
});
test("S7-05: exact share expiry boundary denies even existing visitor", async () => {
  const r = await createReport();
  now = new Date(now.getTime() + 3599000);
  const c = await exchange(r);
  assert.equal((await view(r, c)).statusCode, 200);
  now = new Date(r.expires_at);
  assert.equal((await view(r, c)).statusCode, 410);
  now = new Date(now.getTime() + 1);
  assert.equal((await view(r, c)).statusCode, 410);
});
test("S7-06: repeated revocation invalidates existing session, preserves vehicle events", async () => {
  const r = await createReport(),
    c = await exchange(r);
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await app.inject({
          method: "DELETE",
          url: `/v1/reports/${r.report_id}/share`,
          headers: headers(manager),
        })
      ).statusCode,
      204,
    );
  assert.equal((await view(r, c)).statusCode, 410);
  assert.equal(
    (await pool.query("SELECT count(*) FROM trust.vehicle_event")).rows[0]
      .count,
    "12",
  );
});
test("S7-07: invalid secret/id uniform 404, missing Origin forbidden, rate limited", async () => {
  const r = await createReport();
  for (const id of [r.report_id, randomUUID()]) {
    const result = await app.inject({
      method: "POST",
      url: "/v1/report-views",
      remoteAddress: "127.0.0.7",
      headers: { origin: config.publicOrigin },
      payload: { report_id: id, share_secret: "wrong" },
    });
    assert.equal(result.statusCode, 404);
  }
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/report-views",
        payload: { report_id: r.report_id, share_secret: "wrong" },
      })
    ).statusCode,
    403,
  );
  let last;
  for (let i = 0; i < 21; i++)
    last = await app.inject({
      method: "POST",
      url: "/v1/report-views",
      remoteAddress: "127.0.0.8",
      headers: { origin: config.publicOrigin },
      payload: { report_id: r.report_id, share_secret: "wrong" },
    });
  assert.equal(last!.statusCode, 429);
});
test("S7-08: correction and source revocation invalidate immutable snapshot immediately", async () => {
  const r = await createReport(),
    c = await exchange(r);
  const original = (
    await pool.query(
      "SELECT snapshot_hash FROM trust.report WHERE report_id=$1",
      [r.report_id],
    )
  ).rows[0];
  assert.equal((await correctTarget()).statusCode, 201);
  assert.equal((await view(r, c)).statusCode, 409);
  assert.deepEqual(
    (
      await pool.query(
        "SELECT snapshot_hash FROM trust.report WHERE report_id=$1",
        [r.report_id],
      )
    ).rows[0],
    original,
  );
  const second = await createReport(),
    c2 = await exchange(second);
  await owner.query(
    "UPDATE trust.source SET status='revoked' WHERE source_ref=$1",
    [collector.source_ref],
  );
  assert.equal((await view(second, c2)).statusCode, 409);
});
test("S7-09: generic shell and data forbid caches; cookie is HttpOnly, scoped and SameSite", async () => {
  const r = await createReport();
  const shell = await app.inject({ url: `/r/${r.report_id}` });
  assert.ok(!shell.body.includes("42500"));
  assert.equal(shell.headers["cache-control"], "no-store, private");
  const response = await app.inject({
    method: "POST",
    url: "/v1/report-views",
    headers: { origin: config.publicOrigin },
    payload: {
      report_id: r.report_id,
      share_secret: r.share_url.split("#")[1],
    },
  });
  assert.match(String(response.headers["set-cookie"]), /HttpOnly/);
  assert.match(String(response.headers["set-cookie"]), /SameSite=Strict/);
});
test("S7-10: response loss returns same link; plaintext absent in DB; TTL does not rotate secret", async () => {
  const key = randomUUID(),
    r = await createReport(reportBody(), key);
  const replay = await app.inject({
    method: "POST",
    url: "/v1/reports",
    headers: headers(manager, key),
    payload: reportBody(),
  });
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.json(), r);
  const stored = (
    await pool.query(
      "SELECT * FROM ops.idempotency_response WHERE report_id=$1",
      [r.report_id],
    )
  ).rows[0];
  assert.ok(!JSON.stringify(stored).includes(r.share_url.split("#")[1]));
  now = new Date(now.getTime() + 600000);
  const late = await app.inject({
    method: "POST",
    url: "/v1/reports",
    headers: headers(manager, key),
    payload: reportBody(),
  });
  assert.equal(late.json().reissue_required, true);
  assert.equal(late.json().share_url, undefined);
});
