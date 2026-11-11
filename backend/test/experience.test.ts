import { beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { createPool } from "../src/db/connection.js";
import { seedData, type DemoCredential } from "../scripts/seed-data.js";
import { seedExperience } from "../scripts/seed-experience.js";
import { inputFromExample } from "../src/care-assessment/PostgresCareAssessmentStore.js";
import {
  calculateCare,
  departureCheck,
} from "../src/care-assessment/CareScoreCalculator.js";
const config = readConfig(),
  url = new URL(process.env.TEST_DATABASE_URL!);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/carprint_test");
const ownerUrl = new URL(process.env.OWNER_DATABASE_URL!);
ownerUrl.pathname = "/carprint_test";
const owner = createPool(ownerUrl.toString()),
  pool = createPool(url.toString());
let now = new Date("2026-10-28T10:00:00Z"),
  credentials: DemoCredential[];
const app = await buildApp(config, pool, () => now);
const load = (name: string) =>
  inputFromExample(
    JSON.parse(readFileSync(`../fixtures/demo/scenarios/${name}.json`, "utf8")),
  );
let testClient = 0;
beforeEach(async () => {
  testClient++;
  now = new Date("2026-10-28T10:00:00Z");
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
  method: any,
  path: string,
  body?: any,
  token?: string,
  actor = credentials[0]!,
) =>
  app.inject({
    method,
    remoteAddress: `127.0.0.${testClient}`,
    url: path,
    headers: {
      authorization: `Bearer ${actor.token}`,
      ...(token ? { "x-personal-session": token } : {}),
      "idempotency-key": randomUUID(),
    },
    ...(body === undefined ? {} : { payload: body }),
  });
async function connected(
  accountId = "demo-a",
  scopes = ["climate", "volume"],
  actor = credentials[0]!,
) {
  const request = await call(
    "POST",
    "/v1/personal/connections",
    { scopes, mode: "temporary" },
    undefined,
    actor,
  );
  assert.equal(request.statusCode, 200, request.body);
  const challenge = request.json();
  const approval = await call(
    "POST",
    `/v1/demo/personal/connections/${challenge.requestId}/approve`,
    { accountId, code: challenge.code, confirmed: true },
    undefined,
    actor,
  );
  assert.equal(approval.statusCode, 200, approval.body);
  return approval.json();
}
test("S8: recompute 95/100 from evidence; missing/gap/revoked/preventive-only withhold", () => {
  assert.equal(calculateCare(load("care_95")).score, 95);
  assert.equal(calculateCare(load("corrected_record")).score, 100);
  for (const id of [
    "fresh_install",
    "coverage_gap",
    "evidence_revoked",
    "preventive_only",
  ])
    assert.equal(calculateCare(load(id)).score, null, id);
  const input = load("care_95");
  input.opportunities.push({ ...input.opportunities[0]! });
  assert.equal(calculateCare(input).score, 95);
  assert.equal(calculateCare(input).opportunityCount, 4);
});
test("S8: normal departure has no popup items; unresolved warning only one important item", () => {
  const input = load("care_95");
  assert.equal(departureCheck(input).items.length, 0);
  input.events = input.events.filter((e) => e.type !== "issue_resolved");
  assert.equal(departureCheck(input).items.length, 1);
  assert.equal(departureCheck({ ...input, events: [] }).state, "unknown");
});
test("S8: current vehicle withheld; examples explicit, stable persisted identity, isolated vehicles", async () => {
  const current = await call("GET", "/v1/care/assessment");
  assert.equal(current.statusCode, 200, current.body);
  assert.equal(current.json().score, null);
  assert.equal(current.json().exampleId, null);
  const a = (await call("GET", "/v1/care/assessment?example=care_95")).json();
  assert.equal(a.score, 95);
  assert.equal(a.exampleId, "care_95");
  assert.equal(
    (await call("GET", "/v1/care/assessment?example=care_95")).json()
      .assessmentId,
    a.assessmentId,
  );
  const b = (
    await call(
      "GET",
      "/v1/care/assessment?example=care_95",
      undefined,
      undefined,
      credentials[3]!,
    )
  ).json();
  assert.notEqual(a.assessmentId, b.assessmentId);
  await assert.rejects(
    pool.query("UPDATE trust.care_assessment SET input_digest=$1", ["mutate"]),
    (e: any) => e.code === "42501",
  );
});
test("S7 remediation: report list excludes secrets and other vehicles; collector cannot list", async () => {
  const manager = credentials[1]!;
  const r = await call(
    "POST",
    "/v1/reports",
    {
      vehicle_ref: manager.vehicle_ref,
      kind: "full",
      scope: {
        from: "2026-01-01T00:00:00Z",
        to: "2026-12-31T00:00:00Z",
        selected_event_ids: [],
      },
      expires_in: 3600,
    },
    undefined,
    manager,
  );
  assert.equal(r.statusCode, 201, r.body);
  const list = await call("GET", "/v1/reports", undefined, undefined, manager);
  assert.equal(list.json().reports.length, 1);
  assert.ok(!list.body.includes("share_url"));
  assert.equal((await call("GET", "/v1/reports")).statusCode, 403);
});
test("S9: one-time request confirms exact scope; wrong code, consumed request, vehicle mismatch rejected", async () => {
  const challenge = (
    await call("POST", "/v1/personal/connections", {
      scopes: ["climate"],
      mode: "temporary",
    })
  ).json();
  const path = `/v1/demo/personal/connections/${challenge.requestId}/approve`;
  assert.equal(
    (
      await call("POST", path, {
        accountId: "demo-a",
        code: "000000",
        confirmed: true,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "POST",
        path,
        { accountId: "demo-a", code: challenge.code, confirmed: true },
        undefined,
        credentials[3]!,
      )
    ).statusCode,
    404,
  );
  const r = await call("POST", path, {
    accountId: "demo-a",
    code: challenge.code,
    confirmed: true,
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(Object.keys(r.json().session.preferences), ["climate"]);
  assert.equal(r.json().session.seat, null);
  assert.equal(
    (
      await call("POST", path, {
        accountId: "demo-a",
        code: challenge.code,
        confirmed: true,
      })
    ).statusCode,
    410,
  );
});
test("S9: expiry boundary and cancellation deny approval", async () => {
  const request = (
    await call("POST", "/v1/personal/connections", {
      scopes: [],
      mode: "temporary",
    })
  ).json();
  now = new Date(request.expiresAt);
  assert.equal(
    (
      await call(
        "POST",
        `/v1/demo/personal/connections/${request.requestId}/approve`,
        { accountId: "demo-a", code: request.code, confirmed: true },
      )
    ).statusCode,
    410,
  );
  const next = (
    await call("POST", "/v1/personal/connections", {
      scopes: [],
      mode: "temporary",
    })
  ).json();
  await call("DELETE", `/v1/personal/connections/${next.requestId}`);
  assert.equal(
    (
      await call(
        "POST",
        `/v1/demo/personal/connections/${next.requestId}/approve`,
        { accountId: "demo-a", code: next.code, confirmed: true },
      )
    ).statusCode,
    410,
  );
});
test("S9: two accounts isolated, seat conflict rejected, one session end leaves the other and ledger intact", async () => {
  const a = await connected(),
    b = await connected("demo-b");
  assert.equal(a.session.preferences.climate, 22);
  assert.equal(b.session.preferences.climate, 24);
  assert.equal(
    (
      await call(
        "PUT",
        "/v1/personal/session/seat",
        { seat: "driver" },
        a.token,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await call(
        "PUT",
        "/v1/personal/session/seat",
        { seat: "driver" },
        b.token,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call(
        "PUT",
        "/v1/personal/session/seat",
        { seat: "front_passenger" },
        b.token,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await call(
        "GET",
        "/v1/personal/session",
        undefined,
        a.token,
        credentials[3]!,
      )
    ).statusCode,
    401,
  );
  const before = Number(
    (await owner.query("SELECT count(*) FROM trust.vehicle_event")).rows[0]
      .count,
  );
  assert.equal(
    (await call("DELETE", `/v1/personal/sessions/${a.session.sessionId}`))
      .statusCode,
    204,
  );
  assert.equal(
    (await call("DELETE", `/v1/personal/sessions/${a.session.sessionId}`))
      .statusCode,
    204,
  );
  assert.equal(
    (await call("GET", "/v1/personal/session", undefined, a.token)).statusCode,
    401,
  );
  assert.equal(
    (await call("GET", "/v1/personal/session", undefined, b.token)).statusCode,
    200,
  );
  assert.equal(
    Number(
      (await owner.query("SELECT count(*) FROM trust.vehicle_event")).rows[0]
        .count,
    ),
    before,
  );
});
test("S9: narrowing immediately excludes data and stale preview; adding scope needs new approval", async () => {
  const a = await connected();
  await call("PUT", "/v1/personal/session/seat", { seat: "driver" }, a.token);
  const preview = (
    await call("POST", "/v1/personal/session/preview", {}, a.token)
  ).json();
  const reduced = await call(
    "PUT",
    "/v1/personal/session/scopes",
    { scopes: ["climate"] },
    a.token,
  );
  assert.deepEqual(Object.keys(reduced.json().preferences), ["climate"]);
  assert.equal(
    (
      await call(
        "PUT",
        "/v1/personal/session/scopes",
        { scopes: ["climate", "volume"] },
        a.token,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        "POST",
        `/v1/personal/session/previews/${preview.previewId}/apply`,
        { confirmed: true },
        a.token,
      )
    ).statusCode,
    412,
  );
});
test("S9: explicit apply separates simulated confirmation from request-only, no physical seat/nav writes", async () => {
  const a = await connected("demo-a", [
    "climate",
    "volume",
    "destination",
    "seat",
  ]);
  await call("PUT", "/v1/personal/session/seat", { seat: "driver" }, a.token);
  const preview = (
    await call("POST", "/v1/personal/session/preview", {}, a.token)
  ).json();
  assert.equal(
    (
      await call(
        "POST",
        `/v1/personal/session/previews/${preview.previewId}/apply`,
        { confirmed: false },
        a.token,
      )
    ).statusCode,
    422,
  );
  const result = await call(
    "POST",
    `/v1/personal/session/previews/${preview.previewId}/apply`,
    { confirmed: true },
    a.token,
  );
  assert.equal(result.statusCode, 200, result.body);
  assert.deepEqual(
    result.json().items.map((i: any) => i.status),
    ["simulated_confirmed", "unconfirmed", "unsupported", "blocked"],
  );
  assert.deepEqual(
    (
      await call(
        "POST",
        `/v1/personal/session/previews/${preview.previewId}/apply`,
        { confirmed: true },
        a.token,
      )
    ).json(),
    result.json(),
  );
});
test("S9: expired preview/session and profile CAS fail closed; explicit save does not alter other account", async () => {
  const a = await connected();
  await call("PUT", "/v1/personal/session/seat", { seat: "driver" }, a.token);
  const preview = (
    await call("POST", "/v1/personal/session/preview", {}, a.token)
  ).json();
  const saved = await call(
    "PUT",
    "/v1/personal/profile",
    { revision: a.session.profileRevision, values: { climate: 23 } },
    a.token,
  );
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(
    (
      await call(
        "PUT",
        "/v1/personal/profile",
        { revision: a.session.profileRevision, values: { climate: 25 } },
        a.token,
      )
    ).statusCode,
    412,
  );
  assert.equal(
    (
      await call(
        "POST",
        `/v1/personal/session/previews/${preview.previewId}/apply`,
        { confirmed: true },
        a.token,
      )
    ).statusCode,
    412,
  );
  const next = (
    await call("POST", "/v1/personal/session/preview", {}, a.token)
  ).json();
  now = new Date(next.expiresAt);
  assert.equal(
    (
      await call(
        "POST",
        `/v1/personal/session/previews/${next.previewId}/apply`,
        { confirmed: true },
        a.token,
      )
    ).statusCode,
    412,
  );
  now = new Date(a.session.expiresAt);
  assert.equal(
    (await call("GET", "/v1/personal/session", undefined, a.token)).statusCode,
    401,
  );
  assert.equal(
    (
      await owner.query(
        "SELECT profile->>'climate' AS value FROM personal.account WHERE account_id='demo-b'",
      )
    ).rows[0].value,
    "24",
  );
});
test("S9: vehicle-specific seat calibration and five/six-seat layouts are kept; Pleos has no approved layout", async () => {
  const a = await connected("demo-a", ["seat"]);
  const b = await connected("demo-a", ["seat"], credentials[3]!);
  assert.equal(a.session.availableSeats.length, 5);
  assert.equal(b.session.availableSeats.length, 6);
  assert.equal(a.session.preferences.seat, 35);
  assert.equal(b.session.preferences.seat, 60);
  const pleos = credentials.find(
    (c) => c.environment === "pleos_emulator" && c.role === "vehicle_collector",
  )!;
  const p = await connected("demo-a", ["climate"], pleos);
  assert.deepEqual(p.session.availableSeats, []);
  assert.equal(
    (
      await call("POST", "/v1/personal/session/preview", {}, p.token, pleos)
    ).json().items[0].status,
    "unsupported",
  );
});

test("S9: lost approval response can be compensated by request ID without retaining personal token", async () => {
  const request = (
    await call("POST", "/v1/personal/connections", {
      scopes: ["climate"],
      mode: "temporary",
    })
  ).json();
  const approved = (
    await call(
      "POST",
      `/v1/demo/personal/connections/${request.requestId}/approve`,
      { accountId: "demo-a", code: request.code, confirmed: true },
    )
  ).json();
  assert.equal(
    (await call("DELETE", `/v1/personal/connections/${request.requestId}`))
      .statusCode,
    204,
  );
  assert.equal(
    (await call("GET", "/v1/personal/session", undefined, approved.token))
      .statusCode,
    401,
  );
});
test("S8: duplicated evidence cannot inflate opportunities; source revision creates a new immutable assessment", async () => {
  const input = load("care_95");
  input.opportunities.push({ ...input.opportunities[0]!, id: "split-receipt" });
  assert.equal(calculateCare(input).opportunityCount, 4);
  const a = (await call("GET", "/v1/care/assessment")).json();
  await owner.query(
    "UPDATE trust.source SET status='revoked' WHERE vehicle_ref=$1",
    [credentials[0]!.vehicle_ref],
  );
  const b = (await call("GET", "/v1/care/assessment")).json();
  assert.notEqual(a.assessmentId, b.assessmentId);
  assert.equal(b.previousAssessmentId, a.assessmentId);
  assert.equal(b.score, null);
});

test("S8: original and corrected evidence are one opportunity", () => {
  const input = load("corrected_record");
  const item = input.opportunities[2]!;
  const original = input.events.find(
    (e) => e.id === item.evidenceId,
  )!.correctionOf;
  input.opportunities.push({
    ...item,
    id: "split-original",
    evidenceId: original,
  });
  assert.equal(calculateCare(input).opportunityCount, 4);
  assert.equal(calculateCare(input).score, 100);
});

test("comfort: A/B migration isolates overrides, filters unsupported items and preserves personal score", async () => {
  const a = await connected("demo-a", ["climate", "seat"]),
    actorB = credentials[3]!;
  const b = await connected("demo-a", ["climate", "seat"], actorB),
    root = "/v1/personal/comfort";
  for (const [p, actor] of [
    [a, credentials[0]!],
    [b, actorB],
  ] as const)
    await call(
      "PUT",
      "/v1/personal/session/seat",
      { seat: "driver" },
      p.token,
      actor,
    );
  let av = (await call("GET", root, undefined, a.token)).json();
  const save = await call(
    "PUT",
    root,
    {
      revision: av.revision,
      target: "account",
      values: {
        temperature: 29.5,
        fanPercent: 60,
        seatPositionPercent: 60,
        seatHeating: 3,
        seatVentilation: 2,
      },
    },
    a.token,
  );
  assert.equal(save.statusCode, 200, save.body);
  av = save.json();
  const target = (v: any, key: string) =>
    v.items.find((i: any) => i.key === key).target;
  assert.equal(target(av, "temperature"), 29.5);
  assert.equal(target(av, "seatPositionPercent"), 145);
  let bv = (await call("GET", root, undefined, b.token, actorB)).json();
  assert.deepEqual(
    [
      "temperature",
      "fanPercent",
      "seatPositionPercent",
      "seatHeating",
      "seatVentilation",
    ].map((k) => target(bv, k)),
    [28, 2, 120, 2, null],
  );
  const preview = (
    await call("POST", root + "/previews", {}, b.token, actorB)
  ).json();
  const apply = () =>
    call(
      "POST",
      root + `/previews/${preview.id}/apply`,
      { confirmed: true },
      b.token,
      actorB,
    );
  const result = await apply();
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().items.length, 4);
  assert.deepEqual((await apply()).json(), result.json());
  const override = await call(
    "PUT",
    root,
    { revision: bv.revision, target: "vehicle", values: { temperature: 23 } },
    b.token,
    actorB,
  );
  assert.equal(override.statusCode, 200, override.body);
  bv = override.json();
  assert.equal(target(bv, "temperature"), 23);
  assert.equal(bv.portable.temperature, 29.5);
  assert.equal((await apply()).statusCode, 412);
  assert.equal(
    target((await call("GET", root, undefined, a.token)).json(), "temperature"),
    29.5,
  );
  assert.equal(
    (await call("GET", "/v1/personal/session", undefined, a.token)).json()
      .personalScore.score,
    69,
  );
  assert.equal(
    (
      await call(
        "PUT",
        root,
        {
          revision: av.revision,
          target: "account",
          values: { temperature: 20 },
        },
        a.token,
      )
    ).statusCode,
    412,
  );
  const reset = await call(
    "POST",
    root + "/reset-vehicle",
    { revision: bv.revision, confirmed: true },
    b.token,
    actorB,
  );
  assert.equal(reset.statusCode, 200, reset.body);
  assert.equal(target(reset.json(), "temperature"), 28);
  assert.equal(
    (await call("GET", root, undefined, a.token, actorB)).statusCode,
    401,
  );
});
test("comfort: revocation, seat change, expiry invalidate preview; Pleos never enables simulated control", async () => {
  const a = await connected("demo-a", ["climate", "seat"]),
    root = "/v1/personal/comfort";
  await call("PUT", "/v1/personal/session/seat", { seat: "driver" }, a.token);
  const preview = async () =>
    (await call("POST", root + "/previews", {}, a.token)).json();
  const apply = (id: string) =>
    call("POST", root + `/previews/${id}/apply`, { confirmed: true }, a.token);
  let p = await preview();
  await call(
    "PUT",
    "/v1/personal/session/seat",
    { seat: "front_passenger" },
    a.token,
  );
  assert.equal((await apply(p.id)).statusCode, 412);
  p = await preview();
  await call(
    "PUT",
    "/v1/personal/session/scopes",
    { scopes: ["climate"] },
    a.token,
  );
  assert.equal((await apply(p.id)).statusCode, 412);
  const v = (await call("GET", root, undefined, a.token)).json();
  assert.deepEqual(Object.keys(v.portable), ["temperature", "fanPercent"]);
  assert.equal(
    (
      await call(
        "PUT",
        root,
        { revision: v.revision, target: "account", values: { seatHeating: 2 } },
        a.token,
      )
    ).statusCode,
    403,
  );
  p = await preview();
  now = new Date(p.expiresAt);
  assert.equal((await apply(p.id)).statusCode, 412);
  const actor = credentials.find(
    (c) => c.environment === "pleos_emulator" && c.role === "vehicle_collector",
  )!;
  const other = await connected("demo-b", ["climate"], actor);
  const pv = (await call("GET", root, undefined, other.token, actor)).json();
  assert.equal(pv.capability, null);
  assert.ok(pv.items.every((i: any) => i.target === null));
});
test("comfort: driver preset requires passenger consent, scope filtering and current driver presence", async () => {
  const root = "/v1/personal/comfort",
    a = await connected("demo-a", ["climate", "seat"]),
    b = await connected("demo-b", ["climate"]);
  await call("PUT", "/v1/personal/session/seat", { seat: "driver" }, a.token);
  await call(
    "PUT",
    "/v1/personal/session/seat",
    { seat: "front_passenger" },
    b.token,
  );
  const input = {
    name: "동승자 기본",
    values: { temperature: 21.5, seatVentilation: 3 },
    confirmed: true,
  };
  assert.equal(
    (await call("POST", root + "/presets", input, b.token)).statusCode,
    403,
  );
  const created = await call("POST", root + "/presets", input, a.token);
  assert.equal(created.statusCode, 200, created.body);
  const p = created.json();
  assert.deepEqual(
    (await call("GET", root + "/presets", undefined, b.token)).json().presets[0]
      .values,
    { temperature: 21.5 },
  );
  const bv = (await call("GET", root, undefined, b.token)).json();
  const loaded = await call(
    "POST",
    root + `/presets/${p.id}/load`,
    { revision: bv.revision, confirmed: true },
    b.token,
  );
  assert.equal(loaded.statusCode, 200, loaded.body);
  assert.deepEqual(loaded.json().vehicleValues, { temperature: 21.5 });
  assert.equal(loaded.json().portable.temperature, 24);
  assert.equal(
    (
      await call(
        "POST",
        root + `/presets/${p.id}/load`,
        { revision: 1, confirmed: true },
        a.token,
      )
    ).statusCode,
    403,
  );
  await call("DELETE", `/v1/personal/sessions/${a.session.sessionId}`);
  assert.deepEqual(
    (await call("GET", root + "/presets", undefined, b.token)).json().presets,
    [],
  );
  assert.equal(
    (
      await call(
        "POST",
        root + `/presets/${p.id}/load`,
        { revision: loaded.json().revision, confirmed: true },
        b.token,
      )
    ).statusCode,
    404,
  );
});
