import type { FastifyInstance } from "fastify";
import reportSchema from "../../../contracts/stages-5-7/report-request.schema.json" with { type: "json" };
import { requireCondition } from "../shared/errors.js";
import {
  idempotency,
  params,
  uuid,
  type Authenticate,
} from "../shared/httpContracts.js";
import { ReportService } from "./ReportService.js";
import type { ReportRequest } from "./contracts.js";
export function registerReportRoutes(
  app: FastifyInstance,
  reports: ReportService,
  principal: Authenticate,
  publicOrigin: string,
) {
  app.get("/v1/reports", async (req) => ({
    reports: await reports.list(await principal(req.headers.authorization)),
  }));
  app.post<{ Body: ReportRequest }>(
    "/v1/reports",
    { schema: { body: reportSchema } },
    async (req, reply) => {
      const result = await reports.create(
        await principal(req.headers.authorization),
        req.body,
        idempotency(req.headers["idempotency-key"]),
      );
      return reply.code(result.replay ? 200 : 201).send(result.result);
    },
  );
  app.get<{ Params: { id: string } }>(
    "/v1/reports/:id",
    { schema: { params: params("id") } },
    async (req) =>
      reports.status(await principal(req.headers.authorization), req.params.id),
  );
  app.delete<{ Params: { id: string } }>(
    "/v1/reports/:id/share",
    { schema: { params: params("id") } },
    async (req, reply) => {
      idempotency(req.headers["idempotency-key"]);
      await reports.revoke(
        await principal(req.headers.authorization),
        req.params.id,
      );
      return reply.code(204).send();
    },
  );
  app.post<{ Body: { report_id: string; share_secret: string } }>(
    "/v1/report-views",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          properties: {
            report_id: uuid,
            share_secret: { type: "string", minLength: 1, maxLength: 128 },
          },
          required: ["report_id", "share_secret"],
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      requireCondition(
        req.headers.origin === publicOrigin,
        403,
        "origin_forbidden",
      );
      const session = await reports.exchange(
        req.body.report_id,
        req.body.share_secret,
      );
      reply.setCookie(`carprint_view_${req.body.report_id}`, session, {
        httpOnly: true,
        secure: publicOrigin.startsWith("https:"),
        sameSite: "strict",
        path: `/v1/report-views/${req.body.report_id}`,
        maxAge: 900,
      });
      return { report_id: req.body.report_id };
    },
  );
  app.get<{ Params: { id: string } }>(
    "/v1/report-views/:id",
    { schema: { params: params("id") } },
    async (req) => {
      if (req.headers.origin)
        requireCondition(
          req.headers.origin === publicOrigin,
          403,
          "origin_forbidden",
        );
      return reports.view(
        req.params.id,
        req.cookies[`carprint_view_${req.params.id}`] ?? "",
      );
    },
  );
}
