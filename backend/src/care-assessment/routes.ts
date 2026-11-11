import type { FastifyInstance } from "fastify";
import { authorize } from "../identity/Authorization.js";
import type { Authenticate } from "../shared/httpContracts.js";
import type { CareAssessmentStore } from "./contracts.js";
export function registerCareRoutes(
  app: FastifyInstance,
  store: CareAssessmentStore,
  principal: Authenticate,
  clock: () => Date,
) {
  app.get("/v1/care/examples", async (req) => {
    authorize(await principal(req.headers.authorization), "timeline:read");
    return { examples: await store.examples() };
  });
  app.get<{ Querystring: { example?: string } }>(
    "/v1/care/assessment",
    {
      schema: {
        querystring: {
          type: "object",
          properties: { example: { type: "string", maxLength: 80 } },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      const actor = await principal(req.headers.authorization);
      authorize(actor, "timeline:read");
      return store.assess(actor, req.query.example ?? null, clock());
    },
  );
}
