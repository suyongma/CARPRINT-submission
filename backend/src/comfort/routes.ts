import type { FastifyInstance } from "fastify";
import { authorize } from "../identity/Authorization.js";
import { params, type Authenticate } from "../shared/httpContracts.js";
import { requireCondition } from "../shared/errors.js";
import type { ComfortStore, ComfortValues } from "./contracts.js";
const object = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required, additionalProperties: false });
const values = {
  ...object(
    {
      temperature: { type: "number", minimum: 16, maximum: 30 },
      fanPercent: { type: "integer", minimum: 0, maximum: 100 },
      seatPositionPercent: { type: "integer", minimum: 0, maximum: 100 },
      seatHeating: { type: "integer", minimum: 0, maximum: 3 },
      seatVentilation: { type: "integer", minimum: 0, maximum: 3 },
    },
    [],
  ),
  minProperties: 1,
};
const revision = { type: "integer", minimum: 1 };
const confirmed = { type: "boolean", const: true };
export function registerComfortRoutes(
  app: FastifyInstance,
  store: ComfortStore,
  authenticate: Authenticate,
  clock: () => Date,
) {
  const context = async (headers: {
    authorization?: string;
    [key: string]: unknown;
  }) => {
    const actor = await authenticate(headers.authorization);
    authorize(actor, "timeline:read");
    const token = headers["x-personal-session"];
    requireCondition(
      typeof token === "string" && token.length >= 32,
      401,
      "personal_session_required",
    );
    return { actor, token };
  };
  app.get("/v1/personal/comfort", async (req) => {
    const c = await context(req.headers);
    return store.read(c.actor, c.token, clock());
  });
  app.put<{
    Body: {
      revision: number;
      target: "account" | "vehicle";
      values: ComfortValues;
    };
  }>(
    "/v1/personal/comfort",
    {
      schema: {
        body: object({
          revision,
          target: { enum: ["account", "vehicle"], type: "string" },
          values,
        }),
      },
    },
    async (req) => {
      const c = await context(req.headers);
      return store.save(
        c.actor,
        c.token,
        req.body.revision,
        req.body.target,
        req.body.values,
        clock(),
      );
    },
  );
  app.post<{ Body: { revision: number; confirmed: true } }>(
    "/v1/personal/comfort/reset-vehicle",
    { schema: { body: object({ revision, confirmed }) } },
    async (req) => {
      const c = await context(req.headers);
      return store.resetVehicle(c.actor, c.token, req.body.revision, clock());
    },
  );
  app.post(
    "/v1/personal/comfort/previews",
    { schema: { body: object({}) } },
    async (req) => {
      const c = await context(req.headers);
      return store.preview(c.actor, c.token, clock());
    },
  );
  app.post<{ Params: { id: string }; Body: { confirmed: true } }>(
    "/v1/personal/comfort/previews/:id/apply",
    { schema: { params: params("id"), body: object({ confirmed }) } },
    async (req) => {
      const c = await context(req.headers);
      return {
        items: await store.apply(c.actor, c.token, req.params.id, clock()),
      };
    },
  );
  app.get("/v1/personal/comfort/presets", async (req) => {
    const c = await context(req.headers);
    return { presets: await store.presets(c.actor, c.token, clock()) };
  });
  app.post<{ Body: { name: string; values: ComfortValues; confirmed: true } }>(
    "/v1/personal/comfort/presets",
    {
      schema: {
        body: object({
          name: { type: "string", minLength: 1, maxLength: 40 },
          values,
          confirmed,
        }),
      },
    },
    async (req) => {
      const c = await context(req.headers);
      return store.savePreset(
        c.actor,
        c.token,
        req.body.name,
        req.body.values,
        clock(),
      );
    },
  );
  app.post<{
    Params: { id: string };
    Body: { revision: number; confirmed: true };
  }>(
    "/v1/personal/comfort/presets/:id/load",
    { schema: { params: params("id"), body: object({ revision, confirmed }) } },
    async (req) => {
      const c = await context(req.headers);
      return store.loadPreset(
        c.actor,
        c.token,
        req.params.id,
        req.body.revision,
        clock(),
      );
    },
  );
}
