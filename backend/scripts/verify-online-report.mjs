/** HTTPS 리포트 발급·보안 쿠키·공유 취소를 검사하고 새로 만든 리포트는 종료한다. 비밀 링크는 출력하지 않는다. */
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const [origin, codeFile, evidenceFile] = process.argv.slice(2);
if (
  !origin ||
  !codeFile ||
  !evidenceFile ||
  new URL(origin).protocol !== "https:"
)
  throw new Error(
    "Usage: verify-online-report.mjs HTTPS_ORIGIN CODE_FILE EVIDENCE_JSON",
  );
async function request(
  path,
  method = "GET",
  body,
  headers = {},
  expected = 200,
) {
  const r = await fetch(origin + path, {
    method,
    headers: {
      ...headers,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(r.status, expected, `${method} response`);
  return r;
}
const code = readFileSync(codeFile, "utf8").trim();
const p = await (
  await request("/v1/demo/setup", "POST", { code, flavor: "demo" })
).json();
const c = p.contexts.find((c) => c.context_id === "a:a");
const auth = {
  Authorization: `Bearer ${c.manager_token}`,
  "Idempotency-Key": randomUUID(),
};
const report = await (
  await request(
    "/v1/reports",
    "POST",
    {
      vehicle_ref: c.vehicle_ref,
      kind: "full",
      scope: {
        from: "2026-01-01T00:00:00Z",
        to: "2026-12-31T23:59:59Z",
        selected_event_ids: [],
      },
      expires_in: 3600,
    },
    { ...auth, "Idempotency-Key": randomUUID() },
    201,
  )
).json();
try {
  for (const path of [
    "/r/" + report.report_id,
    "/assets/viewer.js",
    "/assets/viewer.css",
  ])
    assert.ok((await (await request(path)).text()).length > 100);
  const exchange = await request(
    "/v1/report-views",
    "POST",
    {
      report_id: report.report_id,
      share_secret: report.share_url.split("#")[1],
    },
    { Origin: origin },
  );
  const cookies = exchange.headers.getSetCookie();
  assert.ok(cookies.some((x) => /Secure/i.test(x) && /HttpOnly/i.test(x)));
  const cookie = cookies.map((x) => x.split(";")[0]).join("; ");
  const view = await (
    await request("/v1/report-views/" + report.report_id, "GET", undefined, {
      Cookie: cookie,
    })
  ).json();
  assert.ok(view.events.length > 0);
  assert.ok(view.corrections.length > 0);
  await request(
    "/v1/reports/" + report.report_id + "/share",
    "DELETE",
    {},
    auth,
    204,
  );
  await request(
    "/v1/report-views/" + report.report_id,
    "GET",
    undefined,
    { Cookie: cookie },
    410,
  );
  writeFileSync(
    evidenceFile,
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        origin,
        checks: [
          "HTML/JS/CSS served",
          "HTTPS secure visitor cookie exchange",
          "Vehicle evidence and corrections visible",
          "Revocation invalidates existing visitor session",
        ],
        events: view.events.length,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Public report checks passed. No report secrets printed.");
} finally {
  await request(
    "/v1/reports/" + report.report_id + "/share",
    "DELETE",
    {},
    auth,
    204,
  );
}
