/** 전용 Neon 설정에서 Worker에 필요한 런타임 비밀만 추출한다. 관리자 DB 자격은 배포하지 않는다. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { hash } from "../src/shared/crypto.js";
import { neonTarget } from "./neon-target.js";
import type { DemoCredential } from "./seed-data.js";
import type { DemoSetupConfig } from "../src/demo-setup/routes.js";

neonTarget();
const origin = new URL(process.argv[2] ?? "");
if (
  origin.protocol !== "https:" ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash ||
  origin.username ||
  origin.password
)
  throw new Error("A plain HTTPS API origin is required");
const branch = process.env.CARPRINT_NEON_BRANCH;
if (!["production", "codex-cloud-validation"].includes(branch ?? ""))
  throw new Error("Unexpected CARPRINT branch");
const output = resolve(`.local/submission/${branch}`);
mkdirSync(output, { recursive: true, mode: 0o700 });
const codePath = `${output}/participation-code.txt`;
const code = existsSync(codePath)
  ? readFileSync(codePath, "utf8").trim()
  : randomBytes(15).toString("base64url");
const credentials: DemoCredential[] = JSON.parse(
  readFileSync(process.env.CARPRINT_CREDENTIALS_PATH!, "utf8"),
);
const fixture = JSON.parse(
  readFileSync("../fixtures/stages-5-7/seed-bundle.json", "utf8"),
);
function credential(vehicle: string, role: string) {
  const values = credentials.filter(
    (c) => c.vehicle_ref === vehicle && c.role === role,
  );
  if (values.length !== 1)
    throw new Error("Missing or ambiguous scoped credential");
  return values[0]!;
}
function connection(vehicle: string, role: string) {
  const collector = credential(vehicle, "vehicle_collector"),
    manager = credential(vehicle, role);
  if (collector.environment !== manager.environment)
    throw new Error("Mixed environment");
  return {
    base_url: origin.origin,
    vehicle_ref: vehicle,
    source_ref: collector.source_ref!,
    environment: collector.environment,
    collector_token: collector.token,
    manager_token: manager.token,
  };
}
const contexts = ["a", "b"].flatMap((vehicle) =>
  ["a", "b"].map((user) => ({
    ...connection(
      fixture.alias_to_uuid[`demo-vehicle-${vehicle}`],
      user === "a" ? "report_manager" : "demo_user_b",
    ),
    context_id: `${vehicle}:${user}`,
    vehicle_key: vehicle,
    vehicle_label: `합성 차량 ${vehicle.toUpperCase()}`,
    user_key: user,
    user_label: `사용자 ${user.toUpperCase()}`,
    climate_celsius: user === "a" ? 22 : 24,
    media_volume: user === "a" ? 8 : 12,
    can_manage_reports: user === "a",
  })),
);
const pleos = fixture.vehicles.filter(
  (v: { environment: string }) => v.environment === "pleos_emulator",
);
if (pleos.length !== 1) throw new Error("Missing Pleos binding");
const setup: DemoSetupConfig = {
  codeHash: hash(code),
  expiresAt: "2026-11-24T14:59:59Z",
  packs: {
    demo: { contexts },
    pleos: connection(pleos[0].vehicle_ref, "report_manager"),
  },
};
const secrets = {
  DATABASE_URL: process.env.DATABASE_URL,
  PUBLIC_ORIGIN: origin.origin,
  CACHE_KEY_HEX: process.env.CACHE_KEY_HEX,
  CURSOR_KEY_HEX: process.env.CURSOR_KEY_HEX,
  RECEIPT_PRIVATE_KEY: readFileSync(process.env.RECEIPT_KEY_PATH!, "utf8"),
  DEMO_SETUP_JSON: JSON.stringify(setup),
};
if (new URL(secrets.DATABASE_URL!).username !== "carprint_api")
  throw new Error("Worker must use restricted DB role");
writeFileSync(codePath, code + "\n", { mode: 0o600 });
writeFileSync(`${output}/worker-secrets.json`, JSON.stringify(secrets), {
  mode: 0o600,
});
writeFileSync(`${output}/setup.json`, JSON.stringify(setup), { mode: 0o600 });
console.log(
  `Prepared ${branch} Worker secrets and private participation code; no secret values printed.`,
);
