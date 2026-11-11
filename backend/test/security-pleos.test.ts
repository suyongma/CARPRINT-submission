import { beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { createPool } from "../src/db/connection.js";
import { seedData, type DemoCredential } from "../scripts/seed-data.js";
import { checkMaintenanceWindow } from "../src/maintenance/MaintenanceWritePolicy.js";
import { assessDrivingSignals } from "../src/driving-evidence/DrivingSignalCalculator.js";
import type { EventRequest } from "../src/vehicle-history/contracts.js";
const config = readConfig(),
  url = new URL(process.env.TEST_DATABASE_URL!);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/carprint_test");
const ownerUrl = new URL(process.env.OWNER_DATABASE_URL!);
ownerUrl.pathname = "/carprint_test";
const owner = createPool(ownerUrl.toString()),
  pool = createPool(url.toString());
let now = new Date(),
  credentials: DemoCredential[],
  issuer: DemoCredential,
  pleos: DemoCredential;
const app = await buildApp(config, pool, () => now);
beforeEach(async () => {
  now = new Date();
  await owner.query("TRUNCATE identity.vehicle CASCADE");
  credentials = await seedData(owner, config.receiptKeyPath, now);
  issuer = credentials.find((c) => c.role === "maintenance_issuer")!;
  pleos = credentials.find(
    (c) => c.environment === "pleos_emulator" && c.source_ref,
  )!;
});
after(async () => {
  await app.close();
  await pool.end();
  await owner.end();
});
const call = (
  actor: DemoCredential,
  method: any,
  path: string,
  payload: any,
  key = randomUUID(),
  extra = {},
) =>
  app.inject({
    method,
    url: path,
    payload,
    headers: {
      authorization: `Bearer ${actor.token}`,
      "idempotency-key": key,
      ...extra,
    },
  });
const event = (ageMs = 86400000): EventRequest => ({
  event_id: randomUUID(),
  event_type: "maintenance.completed",
  occurred_at: new Date(now.getTime() - ageMs).toISOString(),
  observed_at: new Date(now.getTime() - ageMs).toISOString(),
  payload_version: 1,
  payload: { task_code: "demo-brake-inspection" },
  source_ref: issuer.source_ref!,
  environment: "simulation",
  collection_scope: ["maintenance"],
  source_signature: null,
});
const correct = (id: string, replacement: EventRequest) =>
  call(
    issuer,
    "POST",
    `/v1/events/${id}/corrections`,
    {
      replacement: { ...replacement, event_type: "maintenance.corrected" },
      reason_code: "performed_date_corrected",
    },
    randomUUID(),
    { "if-match": id },
  );
test("M: 168-hour inclusive boundary, one ms over, future and unknown time denied", () => {
  checkMaintenanceWindow(event(7 * 86400000), now);
  assert.throws(() => checkMaintenanceWindow(event(7 * 86400000 + 1), now));
  assert.throws(() => checkMaintenanceWindow(event(-1), now));
  assert.throws(() =>
    checkMaintenanceWindow({ ...event(), occurred_at: null }, now),
  );
  assert.throws(() =>
    checkMaintenanceWindow(event(), now, [
      new Date(now.getTime() - 8 * 86400000),
    ]),
  );
});
test("M: current credential allows recent record; expired/revoked/future/missing credential rejects", async () => {
  assert.equal(
    (await call(issuer, "POST", "/v1/vehicle-events", event())).statusCode,
    201,
  );
  for (const sql of [
    "UPDATE identity.mechanic_credential SET revoked_at=now()",
    "UPDATE identity.mechanic_credential SET revoked_at=NULL,valid_until=now()-interval '1 hour'",
    "UPDATE identity.mechanic_credential SET valid_until=now()+interval '1 year',valid_from=now()+interval '1 hour'",
    "DELETE FROM identity.mechanic_credential",
  ]) {
    await owner.query(sql);
    assert.equal(
      (await call(issuer, "POST", "/v1/vehicle-events", event())).statusCode,
      403,
    );
  }
});
test("M: scope alone cannot become a certified mechanic; old and future dates rejected", async () => {
  const collector = credentials[0]!;
  await owner.query(
    "UPDATE identity.authorization_grant SET scopes=array_append(scopes,'events:append:maintenance') WHERE principal_id=$1",
    [collector.principal_id],
  );
  assert.equal(
    (
      await call(collector, "POST", "/v1/vehicle-events", {
        ...event(),
        source_ref: collector.source_ref,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await call(issuer, "POST", "/v1/vehicle-events", event(8 * 86400000)))
      .statusCode,
    403,
  );
  assert.equal(
    (await call(issuer, "POST", "/v1/vehicle-events", event(-60000)))
      .statusCode,
    422,
  );
});
test("M: correction cannot extend original deadline, originals immutable, repeat is not a new write", async () => {
  const original = event(6 * 86400000),
    key = randomUUID();
  assert.equal(
    (await call(issuer, "POST", "/v1/vehicle-events", original, key))
      .statusCode,
    201,
  );
  const replacement = event(86400000);
  assert.equal((await correct(original.event_id, replacement)).statusCode, 201);
  now = new Date(now.getTime() + 2 * 86400000);
  assert.equal((await correct(replacement.event_id, event())).statusCode, 403);
  assert.equal(
    (await call(issuer, "POST", "/v1/vehicle-events", original, key))
      .statusCode,
    200,
  );
  await assert.rejects(
    pool.query(
      "UPDATE trust.vehicle_event SET occurred_at=now() WHERE event_id=$1",
      [original.event_id],
    ),
    { code: "42501" },
  );
  assert.equal(
    (
      await owner.query(
        "SELECT occurred_at FROM trust.vehicle_event WHERE event_id=$1",
        [original.event_id],
      )
    ).rows[0].occurred_at.toISOString(),
    original.occurred_at,
  );
});
test("M: DB trigger denies direct old insert and API cannot mint mechanic credentials", async () => {
  await assert.rejects(
    pool.query(
      "INSERT INTO identity.mechanic_credential SELECT principal_id,'forged','local_demo','self',now(),now()+interval '1 year',NULL FROM identity.principal LIMIT 1",
    ),
    { code: "42501" },
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO trust.vehicle_event SELECT $1,vehicle_ref,environment,source_ref,principal_id,event_type,now()-interval '8 days',now()-interval '8 days',now(),999,request,review_flags FROM trust.vehicle_event WHERE event_type='maintenance.completed' LIMIT 1`,
      [randomUUID()],
    ),
    { code: "42501" },
  );
});
test("D: speed samples compute exposure; sustained deceleration counted once, gaps/reverse withhold", () => {
  const stable = Array.from({ length: 601 }, (_, i) => ({
    elapsedMs: i * 1000,
    metersPerSecond: 20,
  }));
  let result = assessDrivingSignals(stable);
  assert.equal(result.candidateScore, 100);
  assert.equal(result.scoreEligible, false);
  assert.equal(result.distanceKm, 12);
  const decel = Array.from({ length: 11 }, (_, i) => ({
    elapsedMs: i * 100,
    metersPerSecond: 20 - i * 0.4,
  }));
  assert.equal(assessDrivingSignals(decel).harshDecelerationCandidates, 1);
  stable[30]!.elapsedMs += 5000;
  result = assessDrivingSignals(stable);
  assert.equal(result.candidateScore, null);
  assert.ok(result.reasons.includes("sampling_gap_or_invalid_value"));
  assert.equal(
    assessDrivingSignals([
      { elapsedMs: 0, metersPerSecond: -1 },
      { elapsedMs: 100, metersPerSecond: -1 },
    ]).candidateScore,
    null,
  );
});
test("D: Pleos-bound challenge, no client points, persisted once, altered replay and DB rewrite blocked", async () => {
  assert.equal(
    (await call(credentials[0]!, "POST", "/v1/driving-observations", {}))
      .statusCode,
    403,
  );
  const created = await call(pleos, "POST", "/v1/driving-observations", {});
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().observationId;
  assert.equal(
    (await call(pleos, "POST", "/v1/driving-observations", {})).statusCode,
    409,
  );
  const samples = Array.from({ length: 301 }, (_, i) => ({
    elapsedMs: i * 1000,
    metersPerSecond: 20,
  }));
  assert.equal(
    (await call(pleos, "PUT", `/v1/driving-observations/${id}`, { samples }))
      .statusCode,
    422,
  );
  now = new Date(now.getTime() + 300000);
  assert.equal(
    (
      await call(pleos, "PUT", `/v1/driving-observations/${id}`, {
        samples,
        score: 100,
      })
    ).statusCode,
    422,
  );
  const result = await call(pleos, "PUT", `/v1/driving-observations/${id}`, {
    samples,
  });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().candidateScore, 100);
  assert.equal(result.json().scoreEligible, false);
  assert.deepEqual(
    (
      await call(pleos, "PUT", `/v1/driving-observations/${id}`, { samples })
    ).json(),
    result.json(),
  );
  samples[0]!.metersPerSecond = 19;
  assert.equal(
    (await call(pleos, "PUT", `/v1/driving-observations/${id}`, { samples }))
      .statusCode,
    409,
  );
  await assert.rejects(
    pool.query(
      "UPDATE trust.driving_observation SET assessment='{}' WHERE observation_id=$1",
      [id],
    ),
    { code: "42501" },
  );
});
test("D: source revocation and stale observation prevent completion", async () => {
  const id = (await call(pleos, "POST", "/v1/driving-observations", {})).json()
    .observationId;
  now = new Date(now.getTime() + 901000);
  assert.equal(
    (
      await call(pleos, "PUT", `/v1/driving-observations/${id}`, {
        samples: [],
      })
    ).statusCode,
    410,
  );
  await owner.query(
    "UPDATE trust.source SET status='revoked' WHERE source_ref=$1",
    [pleos.source_ref],
  );
  assert.equal(
    (
      await call(pleos, "PUT", `/v1/driving-observations/${id}`, {
        samples: [],
      })
    ).statusCode,
    403,
  );
});
