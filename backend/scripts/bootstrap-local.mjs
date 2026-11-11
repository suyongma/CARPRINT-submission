import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes, generateKeyPairSync } from "node:crypto";
if (existsSync(".env")) {
  console.log("Existing .env preserved.");
} else {
  mkdirSync(".local", { recursive: true, mode: 0o700 });
  const owner = randomBytes(24).toString("hex");
  const api = randomBytes(24).toString("hex");
  const key = generateKeyPairSync("ed25519");
  writeFileSync(
    ".local/receipt-private.pem",
    key.privateKey.export({ type: "pkcs8", format: "pem" }),
    { mode: 0o600 },
  );
  writeFileSync(
    ".local/receipt-public.pem",
    key.publicKey.export({ type: "spki", format: "pem" }),
    { mode: 0o644 },
  );
  writeFileSync(
    ".env",
    `DATABASE_URL=postgresql://carprint_api:${api}@127.0.0.1:15432/carprint_demo
OWNER_DATABASE_URL=postgresql://carprint_owner:${owner}@127.0.0.1:15432/carprint_demo
TEST_DATABASE_URL=postgresql://carprint_api:${api}@127.0.0.1:15432/carprint_test
POSTGRES_USER=carprint_owner
POSTGRES_PASSWORD=${owner}
POSTGRES_DB=carprint_demo
API_DB_PASSWORD=${api}
PORT=18080
PUBLIC_ORIGIN=http://127.0.0.1:18080
CACHE_KEY_HEX=${randomBytes(32).toString("hex")}
CURSOR_KEY_HEX=${randomBytes(32).toString("hex")}
RECEIPT_KEY_PATH=.local/receipt-private.pem
`,
    { mode: 0o600 },
  );
  console.log("Generated CARPRINT-only local configuration and Ed25519 key.");
}
