import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPool } from "../src/db/connection.js";
import { applyMigrations } from "./apply-migrations.js";
import { neonTarget } from "./neon-target.js";
import { seedData, type DemoCredential } from "./seed-data.js";
import { seedDemoContexts } from "./demo-contexts.js";
import { seedExperience } from "./seed-experience.js";

const url = neonTarget();
const credentialsPath = resolve(process.env.CARPRINT_CREDENTIALS_PATH ?? "");
if (!credentialsPath.startsWith(resolve(".local/neon") + "/"))
  throw new Error("Neon credentials must be kept under ignored .local/neon");
const password = process.env.API_DB_PASSWORD ?? "";
if (!/^[a-f0-9]{48}$/.test(password))
  throw new Error("Generated API password required");
const pool = createPool(url.toString());
try {
  const existingRole = (
    await pool.query("SELECT 1 FROM pg_roles WHERE rolname='carprint_api'")
  ).rowCount;
  if (!existingRole) {
    // 검증된 16진 문자열만 사용. Console 소유자 권한을 API에 상속하지 않는다.
    await pool.query(
      `CREATE ROLE carprint_api LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
  }
  // 기존 암호는 바꾸지 않는다. 저장된 자격으로 연결 검증 후 migration을 적용한다.
  const apiUrl = new URL(url);
  apiUrl.username = "carprint_api";
  apiUrl.password = password;
  const api = createPool(apiUrl.toString());
  try {
    const row = (
      await api.query(
        "SELECT current_user AS role,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      )
    ).rows[0];
    if (
      row.role !== "carprint_api" ||
      row.rolsuper ||
      row.rolcreaterole ||
      row.rolcreatedb ||
      row.rolbypassrls
    )
      throw new Error(
        "Runtime role must have only explicitly granted privileges",
      );
  } finally {
    await api.end();
  }
  await applyMigrations(pool);
  const count = Number(
    (await pool.query("SELECT count(*) FROM identity.principal")).rows[0].count,
  );
  if (count === 0) {
    if (existsSync(credentialsPath))
      throw new Error(
        "Credentials already exist for an empty DB; refusing replacement",
      );
    const credentials = await seedData(pool, process.env.RECEIPT_KEY_PATH!);
    writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
  } else {
    if (!existsSync(credentialsPath))
      throw new Error(
        "Seed incomplete or credentials missing; no automatic reset/rotation",
      );
    const credentials: DemoCredential[] = JSON.parse(
      readFileSync(credentialsPath, "utf8"),
    );
    if (credentials.length < 6) throw new Error("Incomplete credential file");
  }
  const credentials = await seedDemoContexts(
    pool,
    JSON.parse(readFileSync(credentialsPath, "utf8")),
  );
  writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2), {
    mode: 0o600,
  });
  await seedExperience(pool);
  console.log(
    "CARPRINT Neon migrations and synthetic accounts ready; secrets not printed.",
  );
} finally {
  await pool.end();
}
