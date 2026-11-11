import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { createPool } from "../src/db/connection.js";
import { seedData, type DemoCredential } from "../scripts/seed-data.js";
import { seedExperience } from "../scripts/seed-experience.js";
import { calculatePersonalScore } from "../src/personal-score/PersonalScoreCalculator.js";
import type { PersonalScoreEvidence } from "../src/personal-score/contracts.js";
const now = new Date("2026-10-28T10:00:00Z");
const config = readConfig(),
  url = new URL(process.env.TEST_DATABASE_URL!);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/carprint_test");
const ownerUrl = new URL(process.env.OWNER_DATABASE_URL!);
ownerUrl.pathname = "/carprint_test";
const owner = createPool(ownerUrl.toString()),
  pool = createPool(url.toString());
const app = await buildApp(config, pool, () => now);
let credentials: DemoCredential[];
beforeEach(async () => {
  await owner.query("TRUNCATE personal.account CASCADE");
  await owner.query("TRUNCATE identity.vehicle CASCADE");
  credentials = await seedData(owner, config.receiptKeyPath, now);
  await seedExperience(owner);
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
  payload?: any,
  token?: string,
) =>
  app.inject({
    method,
    url: path,
    headers: {
      authorization: `Bearer ${actor.token}`,
      ...(token ? { "x-personal-session": token } : {}),
    },
    ...(payload === undefined ? {} : { payload }),
  });
async function connect(actor: DemoCredential, accountId: string) {
  const request = await call(actor, "POST", "/v1/personal/connections", {
    scopes: [],
    mode: "temporary",
  });
  assert.equal(request.statusCode, 200, request.body);
  const challenge = request.json();
  const result = await call(
    actor,
    "POST",
    `/v1/demo/personal/connections/${challenge.requestId}/approve`,
    { accountId, code: challenge.code, confirmed: true },
  );
  assert.equal(result.statusCode, 200, result.body);
  return result.json();
}
const trip = (id = "trip-1"): PersonalScoreEvidence => ({
  observationId: id,
  category: "driving",
  occurredAt: "2026-10-20T10:00:00Z",
  attributionConfirmed: true,
  revoked: false,
  source: "simulation",
  metrics: { distanceKm: 50, observedMinutes: 60, harshEvents: 0 },
});
test("P0.1: neutral 50 stays unassessed; incomplete evidence is not earned performance", () => {
  const empty = calculatePersonalScore([], now);
  assert.equal(empty.score, 50);
  assert.equal(empty.state, "unassessed");
  const incomplete = [trip("a"), trip("b"), trip("c"), trip("d")];
  incomplete[0]!.attributionConfirmed = false;
  incomplete[1]!.revoked = true;
  incomplete[2]!.metrics.distanceKm = 0;
  incomplete[3]!.occurredAt = "2099-01-01T00:00:00Z";
  const result = calculatePersonalScore(incomplete, now);
  assert.equal(result.score, 50);
  assert.equal(result.excludedCount, 4);
  assert.equal(result.state, "unassessed");
});
test("P0.1: duplicate trip cannot farm score; low outcomes and sample thresholds", () => {
  const one = calculatePersonalScore([trip(), trip()], now);
  assert.equal(one.driving.evidenceCount, 1);
  assert.equal(one.driving.score, 55);
  assert.equal(one.care.score, 50);
  const poor = Array.from({ length: 10 }, (_, i) => ({
    ...trip(String(i)),
    metrics: { distanceKm: 50, observedMinutes: 60, harshEvents: 20 },
  }));
  const result = calculatePersonalScore(poor, now);
  assert.equal(result.driving.score, 25);
  assert.equal(result.driving.state, "sample_ready");
  assert.equal(result.state, "accumulating");
});
test("P0.1: timely / late / not-yet-due care and invalid metrics", () => {
  const care: PersonalScoreEvidence = {
    ...trip(),
    category: "care",
    metrics: {
      dueAt: "2026-10-20T10:00:00Z",
      completedAt: "2026-10-20T10:00:00Z",
      observedThrough: now.toISOString(),
      graceDays: 4,
    },
  };
  assert.equal(calculatePersonalScore([care], now).care.score, 55);
  care.metrics.completedAt = "2026-10-22T10:00:00Z";
  assert.equal(calculatePersonalScore([care], now).care.score, 50);
  care.metrics.completedAt = null;
  assert.equal(calculatePersonalScore([care], now).care.score, 45);
  care.metrics.dueAt = "2026-11-01T10:00:00Z";
  assert.equal(calculatePersonalScore([care], now).care.evidenceCount, 0);
  for (const metrics of [
    {},
    { distanceKm: NaN, observedMinutes: 60, harshEvents: 0 },
    { distanceKm: 50, observedMinutes: 60, harshEvents: -1 },
  ])
    assert.equal(
      calculatePersonalScore([{ ...trip(), metrics }], now).driving
        .evidenceCount,
      0,
    );
});
test("personal score follows account across vehicle and session; car assessment stays separate", async () => {
  const actorA = credentials[0]!;
  const actorB = credentials.find(
    (c) =>
      c.vehicle_ref !== actorA.vehicle_ref && c.environment === "simulation",
  )!;
  assert.ok(actorB);
  const first = await connect(actorA, "demo-a"),
    score = first.session.personalScore;
  assert.equal(score.driving.evidenceCount, 12);
  assert.equal(score.care.evidenceCount, 4);
  assert.equal(score.score, 69);
  assert.equal(score.source, "simulation");
  assert.deepEqual(first.session.preferences, {});
  assert.equal(
    (
      await call(
        actorA,
        "DELETE",
        `/v1/personal/sessions/${first.session.sessionId}`,
      )
    ).statusCode,
    204,
  );
  const next = await connect(actorB, "demo-a");
  assert.deepEqual(next.session.personalScore, score);
  assert.equal(
    (await call(actorB, "GET", "/v1/personal/session", undefined, first.token))
      .statusCode,
    401,
  );
  assert.equal(
    (await call(actorA, "GET", "/v1/personal/session", undefined, first.token))
      .statusCode,
    401,
  );
  const car = (await call(actorB, "GET", "/v1/care/assessment")).json();
  assert.equal(car.score, null);
  assert.equal(car.personalScore, undefined);
});
test("different account does not inherit car credit; unapproved clients cannot read score", async () => {
  const actor = credentials[0]!,
    a = await connect(actor, "demo-a"),
    b = await connect(actor, "demo-b");
  assert.notEqual(a.session.personalScore.score, b.session.personalScore.score);
  assert.equal(b.session.personalScore.score, 50);
  assert.equal(b.session.personalScore.state, "unassessed");
  assert.equal(
    (await call(actor, "GET", "/v1/personal/session")).statusCode,
    401,
  );
  const directory = (await call(actor, "GET", "/v1/demo/accounts")).json();
  assert.ok(
    directory.accounts.every(
      (a: any) => Object.keys(a).sort().join(",") === "id,name",
    ),
  );
  assert.equal(
    (await call(actor, "POST", "/v1/personal/score/reset", {}, a.token))
      .statusCode,
    404,
  );
});
test("seed replay cannot reset or duplicate corrections; revoked latest revision excludes evidence", async () => {
  const first = await connect(credentials[0]!, "demo-a");
  await owner.query(
    `INSERT INTO personal.score_revision SELECT observation_id,2,occurred_at,$1,source,attribution_confirmed,false,'{"distanceKm":50,"observedMinutes":60,"harshEvents":20}'::jsonb FROM personal.score_revision WHERE observation_id='demo-person-a-trip-02' AND revision=1`,
    [now],
  );
  await seedExperience(owner);
  let score = (
    await call(
      credentials[0]!,
      "GET",
      "/v1/personal/session",
      undefined,
      first.token,
    )
  ).json().personalScore;
  assert.equal(score.driving.evidenceCount, 12);
  assert.ok(score.score < first.session.personalScore.score);
  await owner.query(
    `INSERT INTO personal.score_revision SELECT observation_id,3,occurred_at,recorded_at,source,attribution_confirmed,true,metrics FROM personal.score_revision WHERE observation_id='demo-person-a-trip-02' AND revision=2`,
  );
  score = (
    await call(
      credentials[0]!,
      "GET",
      "/v1/personal/session",
      undefined,
      first.token,
    )
  ).json().personalScore;
  assert.equal(score.driving.evidenceCount, 11);
  assert.equal(score.excludedCount, 1);
  assert.equal(
    Number(
      (await owner.query("SELECT count(*) FROM personal.score_observation"))
        .rows[0].count,
    ),
    16,
  );
});
test("runtime cannot rewrite evidence or invent trips; responsibility category constrained", async () => {
  await assert.rejects(
    pool.query("UPDATE personal.score_revision SET revoked=true"),
    { code: "42501" },
  );
  await assert.rejects(pool.query("DELETE FROM personal.score_observation"), {
    code: "42501",
  });
  await assert.rejects(
    pool.query(
      "INSERT INTO personal.score_observation VALUES($1,'demo-b',$2,'driving','driver')",
      [randomUUID(), credentials[0]!.vehicle_ref],
    ),
    { code: "42501" },
  );
  await assert.rejects(
    owner.query(
      "INSERT INTO personal.score_observation VALUES($1,'demo-b',$2,'driving','care_responsible')",
      [randomUUID(), credentials[0]!.vehicle_ref],
    ),
    { code: "23514" },
  );
});
