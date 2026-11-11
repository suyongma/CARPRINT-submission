import assert from "node:assert/strict";
import { test } from "node:test";
import { neonTarget } from "../scripts/neon-target.js";

test("Neon migration refuses another host, pooled connection, local DB and unverified TLS", () => {
  const host = "ep-example.c-3.ap-southeast-1.aws.neon.tech";
  const url = `postgresql://owner:synthetic@${host}/carprint_demo?sslmode=verify-full`;
  assert.equal(
    neonTarget({ CARPRINT_NEON_HOST: host, OWNER_DATABASE_URL: url }).hostname,
    host,
  );
  for (const bad of [
    url.replace(host, "other.neon.tech"),
    url.replace(host, host.replace(".c-", "-pooler.c-")),
    url.replace("carprint_demo", "other_service"),
    url.replace("verify-full", "require"),
    "postgresql://owner:synthetic@127.0.0.1/carprint_demo",
  ]) {
    assert.throws(() =>
      neonTarget({ CARPRINT_NEON_HOST: host, OWNER_DATABASE_URL: bad }),
    );
  }
});
