import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import {
  registerDemoSetupRoutes,
  type DemoSetupConfig,
} from "../src/demo-setup/routes.js";
import { hash } from "../src/shared/crypto.js";
import { installHttpPolicies } from "../src/shared/httpPolicies.js";

const code = "synthetic-test-access-code";
function fixture(): DemoSetupConfig {
  return {
    codeHash: hash(code),
    expiresAt: "2026-11-24T14:59:59Z",
    packs: {
      demo: {
        contexts: [
          {
            base_url: "https://demo.example.test",
            vehicle_ref: "synthetic-vehicle",
            source_ref: "synthetic-source",
            environment: "simulation",
            collector_token: "test-collector",
            manager_token: "test-manager",
          },
        ],
      },
    },
  };
}
async function app(
  config: DemoSetupConfig | undefined,
  scopeOverride?: string[],
) {
  const server = Fastify();
  await server.register(rateLimit);
  installHttpPolicies(server);
  registerDemoSetupRoutes(
    server,
    config,
    async (header) => ({
      id: "test",
      vehicleRef: "synthetic-vehicle",
      environment: "simulation",
      scopes:
        scopeOverride ??
        (header === "Bearer test-collector"
          ? ["events:append:odometer", "timeline:read"]
          : ["timeline:read", "reports:create"]),
    }),
    () => new Date("2026-11-02T00:00:00Z"),
  );
  return server;
}
const request = (codeValue = code, flavor = "demo") => ({
  method: "POST" as const,
  url: "/v1/demo/setup",
  payload: { code: codeValue, flavor },
});
test("setup returns only a selected synthetic pack, without code/hash or DB credentials", async () => {
  const server = await app(fixture());
  try {
    const response = await server.inject(request());
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().contexts.length, 1);
    assert.equal(response.headers["cache-control"], "no-store, private");
    assert.ok(!response.body.includes(code));
    assert.ok(!response.body.includes("codeHash"));
  } finally {
    await server.close();
  }
});
test("setup fails closed for missing, expired, wrong code or unavailable flavor", async () => {
  for (const config of [
    undefined,
    { ...fixture(), expiresAt: "2026-11-01T00:00:00Z" },
    fixture(),
  ]) {
    const server = await app(config);
    try {
      assert.equal(
        (await server.inject(request("wrong-participation-code"))).statusCode,
        403,
      );
      assert.equal(
        (await server.inject(request(code, "pleos"))).statusCode,
        403,
      );
      if (config?.expiresAt === "2026-11-01T00:00:00Z")
        assert.equal((await server.inject(request())).statusCode, 403);
    } finally {
      await server.close();
    }
  }
});
test("setup refuses mechanic scopes, mixed environment and insecure origin", async () => {
  for (const mode of ["mechanic", "environment", "http"]) {
    const config = fixture();
    const connection = config.packs.demo!.contexts![0]!;
    if (mode === "environment") connection.environment = "pleos_emulator";
    if (mode === "http") connection.base_url = "http://demo.example.test";
    const server = await app(
      config,
      mode === "mechanic" ? ["events:append:maintenance"] : undefined,
    );
    try {
      assert.equal((await server.inject(request())).statusCode, 503);
    } finally {
      await server.close();
    }
  }
});
test("setup rate limit applies to repeated invalid codes", async () => {
  const server = await app(fixture());
  try {
    for (let i = 0; i < 8; i++)
      assert.equal(
        (await server.inject(request("wrong-participation-code"))).statusCode,
        403,
      );
    assert.equal((await server.inject(request())).statusCode, 429);
  } finally {
    await server.close();
  }
});
