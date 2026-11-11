import type { FastifyInstance } from "fastify";
import { params, type Authenticate } from "../shared/httpContracts.js";
import type { DrivingObservationStore, SpeedSample } from "./contracts.js";
export function registerDrivingRoutes(
  app: FastifyInstance,
  store: DrivingObservationStore,
  authenticate: Authenticate,
  clock: () => Date,
) {
  app.post(
    "/v1/driving-observations",
    {
      schema: {
        body: { type: "object", properties: {}, additionalProperties: false },
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req) =>
      store.begin(await authenticate(req.headers.authorization), clock()),
  );
  app.put<{ Params: { id: string }; Body: { samples: SpeedSample[] } }>(
    "/v1/driving-observations/:id",
    {
      bodyLimit: 512000,
      schema: {
        params: params("id"),
        body: {
          type: "object",
          required: ["samples"],
          additionalProperties: false,
          properties: {
            samples: {
              type: "array",
              maxItems: 6001,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["elapsedMs", "metersPerSecond"],
                properties: {
                  elapsedMs: { type: "integer", minimum: 0, maximum: 600000 },
                  metersPerSecond: {
                    type: "number",
                    minimum: -90,
                    maximum: 90,
                  },
                },
              },
            },
          },
        },
      },
    },
    async (req) =>
      store.finish(
        await authenticate(req.headers.authorization),
        req.params.id,
        req.body.samples,
        clock(),
      ),
  );
}
