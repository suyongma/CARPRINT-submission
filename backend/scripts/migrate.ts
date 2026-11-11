import { createPool } from "../src/db/connection.js";
import { applyMigrations } from "./apply-migrations.js";
const url = process.env.OWNER_DATABASE_URL!;
const target = new URL(url);
if (target.pathname !== "/carprint_demo" || target.hostname !== "127.0.0.1")
  throw new Error("Local CARPRINT database required");
const pool = createPool(url);
try {
  const role = await pool.query(
    "SELECT 1 FROM pg_roles WHERE rolname='carprint_api'",
  );
  if (!role.rowCount) {
    const password = process.env.API_DB_PASSWORD!;
    if (!/^[a-f0-9]{48}$/.test(password))
      throw new Error("Invalid generated password");
    await pool.query(`CREATE ROLE carprint_api LOGIN PASSWORD '${password}'`);
  }
  const db = await pool.query(
    "SELECT 1 FROM pg_database WHERE datname='carprint_test'",
  );
  if (!db.rowCount)
    await pool.query("CREATE DATABASE carprint_test OWNER carprint_owner");
  for (const database of ["carprint_demo", "carprint_test"]) {
    const localUrl = new URL(url);
    localUrl.pathname = `/${database}`;
    const targetPool = createPool(localUrl.toString());
    try {
      await applyMigrations(targetPool);
      console.log(`${database}: migrations ready`);
    } finally {
      await targetPool.end();
    }
  }
} finally {
  await pool.end();
}
