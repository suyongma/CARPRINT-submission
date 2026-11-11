import { existsSync, writeFileSync } from "node:fs";
import { createPool, transaction } from "../src/db/connection.js";
import { seedData } from "./seed-data.js";
const url = new URL(process.env.OWNER_DATABASE_URL!);
if (url.hostname !== "127.0.0.1" || url.pathname !== "/carprint_demo")
  throw new Error("Seed only accepts local carprint_demo");
const pool = createPool(url.toString());
try {
  const count = Number(
    (await pool.query("SELECT count(*) FROM identity.principal")).rows[0].count,
  );
  if (count) {
    if (!existsSync(".local/credentials.json"))
      throw new Error(
        "Database already seeded; credentials missing. Do not overwrite existing records.",
      );
    console.log("Existing demo and credentials preserved.");
  } else {
    const credentials = await seedData(pool, process.env.RECEIPT_KEY_PATH!);
    writeFileSync(
      ".local/credentials.json",
      JSON.stringify(credentials, null, 2),
      { mode: 0o600 },
    );
    console.log(
      "Imported 12 synthetic events, correction and gap. Generated 6 scoped demo credentials (not printed).",
    );
  }
} finally {
  await pool.end();
}
