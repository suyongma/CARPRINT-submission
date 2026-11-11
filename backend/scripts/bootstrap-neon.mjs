/** 로그인된 Neon CLI에서 CARPRINT 자격만 읽는다. 기존 로컬 .env와 다른 프로젝트는 변경하지 않는다. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { resolve } from "node:path";

const [projectId, branch] = process.argv.slice(2);
if (!projectId || !["production", "codex-cloud-validation"].includes(branch))
  throw new Error(
    "Usage: node scripts/bootstrap-neon.mjs PROJECT_ID production|codex-cloud-validation",
  );
const directory = `.local/neon/${branch}`;
if (existsSync(`${directory}/connection.env`))
  throw new Error(
    "Existing Neon configuration preserved; refusing replacement",
  );
const run = (args) =>
  execFileSync("neon", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
try {
  const project = JSON.parse(
    run(["projects", "get", projectId, "--output", "json"]),
  );
  if (
    project.name !== "carprint-demo" ||
    !project.owner.subscription_type.startsWith("free")
  )
    throw new Error("Only the free carprint-demo project is supported");
  const owner = new URL(
    run([
      "connection-string",
      branch,
      "--project-id",
      projectId,
      "--database-name",
      "carprint_demo",
      "--ssl",
      "verify-full",
    ]),
  );
  if (
    !owner.hostname.endsWith(".neon.tech") ||
    owner.hostname.includes("-pooler.") ||
    owner.pathname !== "/carprint_demo"
  )
    throw new Error("Unexpected CARPRINT database endpoint");
  const password = randomBytes(24).toString("hex");
  const runtime = new URL(owner);
  runtime.hostname = runtime.hostname.replace(".c-", "-pooler.c-");
  if (!runtime.hostname.includes("-pooler."))
    throw new Error("Unexpected Neon endpoint hostname");
  runtime.username = "carprint_api";
  runtime.password = password;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const pair = generateKeyPairSync("ed25519");
  writeFileSync(
    `${directory}/receipt-private.pem`,
    pair.privateKey.export({ type: "pkcs8", format: "pem" }),
    { mode: 0o600, flag: "wx" },
  );
  writeFileSync(
    `${directory}/receipt-public.pem`,
    pair.publicKey.export({ type: "spki", format: "pem" }),
    { mode: 0o644, flag: "wx" },
  );
  const values = {
    CARPRINT_NEON_PROJECT_ID: projectId,
    CARPRINT_NEON_BRANCH: branch,
    CARPRINT_NEON_HOST: owner.hostname,
    OWNER_DATABASE_URL: owner.toString(),
    DATABASE_URL: runtime.toString(),
    API_DB_PASSWORD: password,
    CACHE_KEY_HEX: randomBytes(32).toString("hex"),
    CURSOR_KEY_HEX: randomBytes(32).toString("hex"),
    RECEIPT_KEY_PATH: resolve(`${directory}/receipt-private.pem`),
    CARPRINT_CREDENTIALS_PATH: resolve(`${directory}/credentials.json`),
    PORT: "18081",
    PUBLIC_ORIGIN: "http://127.0.0.1:18081",
  };
  writeFileSync(
    `${directory}/connection.env`,
    Object.entries(values)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("\n") + "\n",
    { mode: 0o600, flag: "wx" },
  );
  // API 프로세스에는 소유자 접속 정보와 역할 생성 암호를 넘기지 않는다.
  const runtimeKeys = [
    "DATABASE_URL",
    "CACHE_KEY_HEX",
    "CURSOR_KEY_HEX",
    "RECEIPT_KEY_PATH",
    "PORT",
    "PUBLIC_ORIGIN",
  ];
  writeFileSync(
    `${directory}/runtime.env`,
    runtimeKeys
      .map((key) => `${key}=${JSON.stringify(values[key])}`)
      .join("\n") + "\n",
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    `Saved private CARPRINT configuration: ${directory}/connection.env (no secrets printed)`,
  );
} catch (error) {
  // CLI 예외에 포함될 수 있는 접속 문자열과 stderr는 출력하지 않는다.
  if (error && typeof error === "object" && "status" in error)
    throw new Error(
      "Neon CLI failed; check login and selected CARPRINT project",
    );
  throw error;
}
