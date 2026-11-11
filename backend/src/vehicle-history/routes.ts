import type { FastifyInstance } from "fastify";
import eventSchema from "../../../contracts/stages-5-7/event-request.schema.json" with { type: "json" };
import { requireCondition } from "../shared/errors.js";
import {
  idempotency,
  params,
  uuid,
  type Authenticate,
} from "../shared/httpContracts.js";
import { VehicleHistoryService } from "./VehicleHistoryService.js";
import type { EventRequest } from "./contracts.js";
// 입력 검사랑 인증, HTTP 응답은 여기서. 기록별 권한이나 저장 순서는 service/store 쪽 보면 됨. _ma
export function registerHistoryRoutes(
  app: FastifyInstance,
  history: VehicleHistoryService,
  principal: Authenticate,
) {
  app.post<{ Body: EventRequest }>(
    "/v1/vehicle-events",
    { schema: { body: eventSchema } },
    async (req, reply) => {
      const result = await history.ingest(
        await principal(req.headers.authorization),
        req.body,
        idempotency(req.headers["idempotency-key"]),
      );
      return reply
        .code(result.replay ? 200 : 201)
        .send({ receipt: result.receipt });
    },
  );
  app.get<{
    Params: { vehicle: string };
    Querystring: { cursor?: string; limit?: string };
  }>(
    "/v1/vehicles/:vehicle/timeline",
    {
      schema: {
        params: params("vehicle"),
        querystring: {
          type: "object",
          properties: {
            cursor: { type: "string", maxLength: 2048 },
            limit: { type: "string", pattern: "^([1-9]|[1-4][0-9]|50)$" },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) =>
      history.timeline(
        await principal(req.headers.authorization),
        req.params.vehicle,
        req.query.cursor,
        Number(req.query.limit ?? 30),
      ),
  );
  app.post<{
    Params: { event: string };
    Body: { replacement: EventRequest; reason_code: string };
  }>(
    "/v1/events/:event/corrections",
    {
      schema: {
        params: params("event"),
        body: {
          type: "object",
          properties: {
            replacement: eventSchema,
            reason_code: { const: "performed_date_corrected" },
          },
          required: ["replacement", "reason_code"],
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      // If-Match에 수정할 최신 기록 ID 받음. 이미 정정된 건이면 저장소에서 막음. 서로 덮어쓰면 곤란함. _ma
      const expected = req.headers["if-match"];
      requireCondition(typeof expected === "string", 422, "if_match_required");
      const result = await history.correct(
        await principal(req.headers.authorization),
        {
          originalId: req.params.event,
          replacement: req.body.replacement,
          reason: req.body.reason_code,
          expectedHead: expected.replace(/^"|"$/g, ""),
        },
        idempotency(req.headers["idempotency-key"]),
      );
      return reply
        .code(result.replay ? 200 : 201)
        .send({ receipt: result.receipt });
    },
  );
}
