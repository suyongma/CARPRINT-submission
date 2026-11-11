import type { FastifyInstance } from "fastify";
import { authorize } from "../identity/Authorization.js";
import { requireCondition } from "../shared/errors.js";
import { params, type Authenticate } from "../shared/httpContracts.js";
import {
  personalScopes,
  type PersonalizationStore,
  type ConnectionRequest,
  type PersonalScope,
} from "./contracts.js";
const object = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required, additionalProperties: false });
const scopes = {
  type: "array",
  items: { type: "string", enum: personalScopes },
  uniqueItems: true,
  maxItems: 4,
};
export function registerPersonalizationRoutes(
  app: FastifyInstance,
  store: PersonalizationStore,
  authenticate: Authenticate,
  clock: () => Date,
) {
  const actor = async (header?: string) => {
    const p = await authenticate(header);
    authorize(p, "timeline:read");
    return p;
  };
  const token = (header: unknown) => {
    requireCondition(
      typeof header === "string" && header.length >= 32,
      401,
      "personal_session_required",
    );
    return header;
  };
  app.get("/v1/demo/accounts", async (req) => {
    await actor(req.headers.authorization);
    return {
      accounts: await store.accounts(),
      environment: "simulation",
      notice: "임시 계정 선택 · 외부 로그인 아님",
    };
  });
  app.post<{ Body: ConnectionRequest }>(
    "/v1/personal/connections",
    {
      schema: {
        body: object({
          scopes,
          mode: { type: "string", enum: ["temporary", "trip"] },
        }),
      },
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (req) =>
      store.request(await actor(req.headers.authorization), req.body, clock()),
  );
  app.post<{
    Params: { id: string };
    Body: { accountId: string; code: string; confirmed: boolean };
  }>(
    "/v1/demo/personal/connections/:id/approve",
    {
      schema: {
        params: params("id"),
        body: object({
          accountId: { type: "string", enum: ["demo-a", "demo-b"] },
          code: { type: "string", pattern: "^[0-9]{6}$" },
          confirmed: { const: true, type: "boolean" },
        }),
      },
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (req) =>
      store.approve(
        await actor(req.headers.authorization),
        req.params.id,
        req.body.accountId,
        req.body.code,
        clock(),
      ),
  );
  app.delete<{ Params: { id: string } }>(
    "/v1/personal/connections/:id",
    { schema: { params: params("id") } },
    async (req, reply) => {
      await store.cancelRequest(
        await actor(req.headers.authorization),
        req.params.id,
        clock(),
      );
      return reply.code(204).send();
    },
  );
  app.get("/v1/personal/session", async (req) =>
    store.session(
      await actor(req.headers.authorization),
      token(req.headers["x-personal-session"]),
      clock(),
    ),
  );
  app.put<{ Body: { seat: string } }>(
    "/v1/personal/session/seat",
    {
      schema: {
        body: object({
          seat: {
            type: "string",
            enum: [
              "driver",
              "front_passenger",
              "second_left",
              "second_center",
              "second_right",
              "third_left",
              "third_right",
            ],
          },
        }),
      },
    },
    async (req) =>
      store.assignSeat(
        await actor(req.headers.authorization),
        token(req.headers["x-personal-session"]),
        req.body.seat,
        clock(),
      ),
  );
  app.put<{ Body: { scopes: PersonalScope[] } }>(
    "/v1/personal/session/scopes",
    { schema: { body: object({ scopes }) } },
    async (req) =>
      store.narrowScopes(
        await actor(req.headers.authorization),
        token(req.headers["x-personal-session"]),
        req.body.scopes,
        clock(),
      ),
  );
  app.post("/v1/personal/session/preview", async (req) =>
    store.preview(
      await actor(req.headers.authorization),
      token(req.headers["x-personal-session"]),
      clock(),
    ),
  );
  app.post<{ Params: { id: string }; Body: { confirmed: boolean } }>(
    "/v1/personal/session/previews/:id/apply",
    {
      schema: {
        params: params("id"),
        body: object({ confirmed: { type: "boolean", const: true } }),
      },
    },
    async (req) => ({
      items: await store.apply(
        await actor(req.headers.authorization),
        token(req.headers["x-personal-session"]),
        req.params.id,
        clock(),
      ),
    }),
  );
  app.put<{
    Body: { revision: number; values: { climate?: number; volume?: number } };
  }>(
    "/v1/personal/profile",
    {
      schema: {
        body: object({
          revision: { type: "integer", minimum: 1 },
          values: {
            ...object(
              {
                climate: { type: "number", minimum: 16, maximum: 30 },
                volume: { type: "integer", minimum: 0, maximum: 30 },
              },
              [],
            ),
            minProperties: 1,
          },
        }),
      },
    },
    async (req) =>
      store.savePreferences(
        await actor(req.headers.authorization),
        token(req.headers["x-personal-session"]),
        req.body.revision,
        req.body.values,
        clock(),
      ),
  );
  app.delete<{ Params: { id: string } }>(
    "/v1/personal/sessions/:id",
    { schema: { params: params("id") } },
    async (req, reply) => {
      await store.end(
        await actor(req.headers.authorization),
        req.params.id,
        clock(),
      );
      return reply.code(204).send();
    },
  );
}
