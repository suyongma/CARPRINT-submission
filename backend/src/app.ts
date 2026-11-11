import { registerDrivingRoutes } from "./driving-evidence/routes.js";
import { registerComfortRoutes } from "./comfort/routes.js";
import { PostgresComfortStore } from "./comfort/PostgresComfortStore.js";
import { PostgresDrivingObservationStore } from "./driving-evidence/PostgresDrivingObservationStore.js";
import { PostgresPersonalScoreReader } from "./personal-score/PostgresPersonalScoreReader.js";
import { PostgresCareAssessmentStore } from "./care-assessment/PostgresCareAssessmentStore.js";
import { registerCareRoutes } from "./care-assessment/routes.js";
import { PostgresPersonalizationStore } from "./personalization/PostgresPersonalizationStore.js";
import { SimulatedPreferencePlanner } from "./personalization/SimulatedPreferencePlanner.js";
import { registerPersonalizationRoutes } from "./personalization/routes.js";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import type { AppConfig } from "./config.js";
import {
  PostgresAuthorization,
  type Principal,
} from "./identity/Authorization.js";
import { CursorCodec, ResponseCipher } from "./shared/crypto.js";
import { requireCondition } from "./shared/errors.js";
import { Ed25519ReceiptSigner } from "./vehicle-history/Ed25519ReceiptSigner.js";
import { PostgresVehicleEventStore } from "./vehicle-history/PostgresVehicleEventStore.js";
import { VehicleHistoryService } from "./vehicle-history/VehicleHistoryService.js";
import { PostgresReportStore } from "./reports/PostgresReportStore.js";
import { ReportService } from "./reports/ReportService.js";

import { registerHistoryRoutes } from "./vehicle-history/routes.js";
import { registerReportRoutes } from "./reports/routes.js";
import {
  registerReportWeb,
  type ReportWebAssets,
} from "./report-web/routes.js";
import { installHttpPolicies } from "./shared/httpPolicies.js";
import {
  registerDemoSetupRoutes,
  type DemoSetupConfig,
} from "./demo-setup/routes.js";
export interface AppResources {
  pluginTimeout?: number;
  receiptPrivateKey?: string;
  reportWeb?: ReportWebAssets;
  demoSetup?: DemoSetupConfig;
}
// 실제 구현체는 여기서 조립함. DB 풀하고 시계는 밖에서 받아야 고정 시각 테스트도 돌릴 수 있음. _ma
export async function buildApp(
  config: AppConfig,
  pool: Pool,
  clock: () => Date = () => new Date(),
  resources: AppResources = {},
) {
  const app = Fastify({
    pluginTimeout: resources.pluginTimeout ?? 10000,
    bodyLimit: 32768,
    logger: false,
    // TS 타입만 믿으면 안 됨. HTTP JSON은 schema로 따로 검사. 틀린 값을 알아서 바꾸거나 지우진 않음. _ma
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: false,
        useDefaults: false,
      },
    },
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
  });
  const auth = new PostgresAuthorization(pool);
  const signer = new Ed25519ReceiptSigner(
    resources.receiptPrivateKey ?? readFileSync(config.receiptKeyPath, "utf8"),
  );
  const eventStore = new PostgresVehicleEventStore(
    pool,
    signer,
    new CursorCodec(config.cursorKey),
  );
  const history = new VehicleHistoryService(eventStore, eventStore, clock);
  const reports = new ReportService(
    new PostgresReportStore(
      pool,
      new ResponseCipher(config.cacheKey),
      config.publicOrigin,
    ),
    clock,
  );
  // 이 Bearer 토큰은 차량 접근용임. 개인 계정 세션 토큰이랑 다른 거. _ma
  const principal = (header?: string): Promise<Principal> => {
    requireCondition(
      typeof header === "string" && header.startsWith("Bearer "),
      401,
      "authentication_required",
    );
    return auth.authenticate(header.slice(7), clock());
  };
  installHttpPolicies(app);
  registerDemoSetupRoutes(app, resources.demoSetup, principal, clock);
  app.get("/health", async () => {
    await pool.query("SELECT 1");
    return { status: "ok", environment: "local_demo" };
  });
  registerHistoryRoutes(app, history, principal);
  registerComfortRoutes(app, new PostgresComfortStore(pool), principal, clock);
  registerReportRoutes(app, reports, principal, config.publicOrigin);
  registerReportWeb(app, resources.reportWeb);
  registerCareRoutes(
    app,
    new PostgresCareAssessmentStore(pool),
    principal,
    clock,
  );
  registerPersonalizationRoutes(
    app,
    new PostgresPersonalizationStore(
      pool,
      new SimulatedPreferencePlanner(),
      (client) => new PostgresPersonalScoreReader(client),
    ),
    principal,
    clock,
  );
  registerDrivingRoutes(
    app,
    new PostgresDrivingObservationStore(pool),
    principal,
    clock,
  );
  return app;
}
