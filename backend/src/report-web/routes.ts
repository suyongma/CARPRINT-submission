import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { params } from "../shared/httpContracts.js";
export interface ReportWebAssets {
  html: string;
  script: string;
  style: string;
}
export function registerReportWeb(
  app: FastifyInstance,
  assets?: ReportWebAssets,
) {
  app.get<{ Params: { id: string } }>(
    "/r/:id",
    { schema: { params: params("id") } },
    async (_req, reply) =>
      reply
        .type("text/html; charset=utf-8")
        .send(
          assets?.html ??
            readFileSync(new URL("./index.html", import.meta.url), "utf8"),
        ),
  );
  for (const [name, type] of [
    ["viewer.js", "application/javascript"],
    ["viewer.css", "text/css"],
  ] as const)
    app.get(`/assets/${name}`, async (_req, reply) =>
      reply
        .type(type)
        .send(
          (name === "viewer.js" ? assets?.script : assets?.style) ??
            readFileSync(new URL(`./${name}`, import.meta.url), "utf8"),
        ),
    );
}
