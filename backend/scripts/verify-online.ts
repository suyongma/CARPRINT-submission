/** 실제 HTTPS/로컬 Worker를 통해 검사한다. 토큰·참여 코드·리포트 비밀 링크를 출력하지 않는다. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
const [origin, codeFile, evidenceFile] = process.argv.slice(2);
if (!origin || !codeFile || !evidenceFile)
  throw new Error(
    "Usage: verify-online.ts ORIGIN CODE_FILE EVIDENCE_JSON [--exercise]",
  );
const target = new URL(origin);
if (target.protocol !== "https:" && target.hostname !== "127.0.0.1")
  throw new Error("HTTPS required");
const exercise = process.argv.includes("--exercise");
const code = readFileSync(codeFile, "utf8").trim();
const checks: string[] = [];
async function call(
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
  expected = 200,
): Promise<any> {
  const response = await fetch(origin + path, {
    method,
    headers: {
      ...headers,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: unexpected HTTP ${response.status}`,
  );
  return expected === 204 ? null : response.json();
}
assert.equal((await call("/health")).status, "ok");
await call("/v1/demo/accounts", "GET", undefined, {}, 401);
await call(
  "/v1/demo/setup",
  "POST",
  { code: "invalid-demo-access-code", flavor: "demo" },
  {},
  403,
);
const pack = await call("/v1/demo/setup", "POST", { code, flavor: "demo" });
assert.equal(pack.contexts.length, 4);
const pleos = await call("/v1/demo/setup", "POST", { code, flavor: "pleos" });
assert.equal(pleos.environment, "pleos_emulator");
checks.push(
  "Health; unauthenticated request and invalid setup rejected; both flavor setup accepted",
);
const managerA = pack.contexts.find((c: any) => c.context_id === "a:a");
const managerB = pack.contexts.find((c: any) => c.context_id === "b:a");
for (const c of [managerA, managerB, pleos]) {
  assert.equal(
    c.base_url,
    target.hostname === "127.0.0.1"
      ? "https://carprint-demo-api.kingteer2.workers.dev"
      : origin,
  );
  await call(`/v1/vehicles/${c.vehicle_ref}/timeline`, "GET", undefined, {
    Authorization: `Bearer ${c.manager_token}`,
  });
}
checks.push(
  "Three vehicle timelines reachable through HTTP adapter with scoped credentials",
);
const sessions: {
  context: any;
  value: any;
  headers: Record<string, string>;
}[] = [];
const originals: {
  session: (typeof sessions)[number];
  portable: any;
  vehicle: any;
}[] = [];
async function connect(context: any, account: string, seat: string) {
  const auth = { Authorization: `Bearer ${context.manager_token}` };
  const challenge = await call(
    "/v1/personal/connections",
    "POST",
    { scopes: ["climate", "seat"], mode: "temporary" },
    auth,
  );
  const value = await call(
    `/v1/demo/personal/connections/${challenge.requestId}/approve`,
    "POST",
    {
      accountId: account,
      code: challenge.code,
      confirmed: true,
    },
    auth,
  );
  const session = {
    context,
    value,
    headers: { ...auth, "X-Personal-Session": value.token },
  };
  sessions.push(session);
  if (exercise)
    await call("/v1/personal/session/seat", "PUT", { seat }, session.headers);
  return session;
}
try {
  const a = await connect(managerA, "demo-a", "driver");
  const b = await connect(managerB, "demo-a", "driver");
  const passenger = await connect(managerB, "demo-b", "front_passenger");
  assert.equal(a.value.session.personalScore.score, 69);
  assert.equal(b.value.session.personalScore.score, 69);
  assert.equal(passenger.value.session.personalScore.score, 50);
  checks.push(
    "Same account stays 69 across vehicles; independent new account starts at 50",
  );
  if (exercise) {
    for (const session of [a, b, passenger]) {
      const view = await call(
        "/v1/personal/comfort",
        "GET",
        undefined,
        session.headers,
      );
      originals.push({
        session,
        portable: view.portable,
        vehicle: view.vehicleValues,
      });
      await call(
        "/v1/personal/comfort/reset-vehicle",
        "POST",
        { revision: view.revision, confirmed: true },
        session.headers,
      );
    }
    const values = {
      temperature: 29.5,
      fanPercent: 60,
      seatPositionPercent: 60,
      seatHeating: 3,
      seatVentilation: 2,
    };
    let view = await call("/v1/personal/comfort", "GET", undefined, a.headers);
    await call(
      "/v1/personal/comfort",
      "PUT",
      { revision: view.revision, target: "account", values },
      a.headers,
    );
    const va = await call("/v1/personal/comfort", "GET", undefined, a.headers);
    const vb = await call("/v1/personal/comfort", "GET", undefined, b.headers);
    assert.equal(
      va.items.find((i: any) => i.key === "temperature").target,
      29.5,
    );
    assert.equal(vb.items.find((i: any) => i.key === "temperature").target, 28);
    assert.equal(
      vb.items.find((i: any) => i.key === "seatPositionPercent").target,
      120,
    );
    assert.equal(
      vb.items.find((i: any) => i.key === "seatVentilation").target,
      null,
    );
    const preview = await call(
      "/v1/personal/comfort/previews",
      "POST",
      {},
      b.headers,
    );
    await call(
      `/v1/personal/comfort/previews/${preview.id}/apply`,
      "POST",
      { confirmed: true },
      b.headers,
    );
    await call(
      "/v1/personal/comfort",
      "PUT",
      { revision: vb.revision, target: "vehicle", values: { temperature: 23 } },
      b.headers,
    );
    assert.equal(
      (
        await call("/v1/personal/comfort", "GET", undefined, a.headers)
      ).items.find((i: any) => i.key === "temperature").target,
      29.5,
    );
    assert.equal(
      (
        await call("/v1/personal/comfort", "GET", undefined, b.headers)
      ).items.find((i: any) => i.key === "temperature").target,
      23,
    );
    checks.push(
      "A/B capability adaptation, preview/mock apply and vehicle-specific save isolation",
    );
    const preset = await call(
      "/v1/personal/comfort/presets",
      "POST",
      { name: "시연 동승자", values, confirmed: true },
      b.headers,
    );
    view = await call(
      "/v1/personal/comfort",
      "GET",
      undefined,
      passenger.headers,
    );
    await call(
      `/v1/personal/comfort/presets/${preset.id}/load`,
      "POST",
      { revision: view.revision, confirmed: true },
      passenger.headers,
    );
    const passengerView = await call(
      "/v1/personal/comfort",
      "GET",
      undefined,
      passenger.headers,
    );
    assert.equal(
      passengerView.items.find((i: any) => i.key === "seatPositionPercent")
        .target,
      null,
    );
    assert.deepEqual(passengerView.portable, originals[2]!.portable);
    checks.push(
      "Driver preset loaded with passenger consent; manual passenger seat skipped; passenger common profile preserved",
    );
  }
} finally {
  try {
    if (exercise)
      for (const saved of originals) {
        const headers = saved.session.headers;
        let view = await call(
          "/v1/personal/comfort",
          "GET",
          undefined,
          headers,
        );
        await call(
          "/v1/personal/comfort",
          "PUT",
          {
            revision: view.revision,
            target: "account",
            values: saved.portable,
          },
          headers,
        );
        view = await call("/v1/personal/comfort", "GET", undefined, headers);
        await call(
          "/v1/personal/comfort/reset-vehicle",
          "POST",
          { revision: view.revision, confirmed: true },
          headers,
        );
        if (Object.keys(saved.vehicle).length) {
          view = await call("/v1/personal/comfort", "GET", undefined, headers);
          await call(
            "/v1/personal/comfort",
            "PUT",
            {
              revision: view.revision,
              target: "vehicle",
              values: saved.vehicle,
            },
            headers,
          );
        }
      }
  } finally {
    for (const session of sessions)
      await call(
        `/v1/personal/sessions/${session.value.session.sessionId}`,
        "DELETE",
        undefined,
        session.headers,
        204,
      );
  }
}
checks.push(
  exercise
    ? "All temporary sessions ended; edited preferences restored (mock apply/preset evidence retained)"
    : "All temporary sessions ended; no preference edits requested",
);
writeFileSync(
  evidenceFile,
  JSON.stringify(
    { verifiedAt: new Date().toISOString(), origin, exercise, checks },
    null,
    2,
  ) + "\n",
);
console.log(
  `Online checks passed: ${checks.length}. Secret values not printed.`,
);
