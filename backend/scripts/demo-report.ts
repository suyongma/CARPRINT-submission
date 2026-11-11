import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const credentials = JSON.parse(readFileSync(".local/credentials.json", "utf8"));
const manager = credentials.find(
  (c: { environment: string; role: string }) =>
    c.environment === "simulation" && c.role === "report_manager",
);
const response = await fetch(`${process.env.PUBLIC_ORIGIN}/v1/reports`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${manager.token}`,
    "content-type": "application/json",
    "idempotency-key": randomUUID(),
  },
  body: JSON.stringify({
    vehicle_ref: manager.vehicle_ref,
    kind: "full",
    scope: {
      from: "2026-01-01T00:00:00Z",
      to: new Date().toISOString(),
      selected_event_ids: [],
    },
    expires_in: 86400,
  }),
});
if (!response.ok) throw new Error(`Report failed: ${response.status}`);
const report = (await response.json()) as { share_url: string };
writeFileSync(".local/latest-demo-report.json", JSON.stringify(report), {
  mode: 0o600,
});
console.log(report.share_url);
