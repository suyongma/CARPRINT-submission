import type { FastifyInstance } from "fastify";
import type { Authenticate } from "../shared/httpContracts.js";
import { equalHash, hash } from "../shared/crypto.js";
import { requireCondition } from "../shared/errors.js";

/** 시연 참여 코드는 합성 차량의 제한 자격만 전달한다. DB·정비사·개인 세션 자격은 포함하지 않는다. */
export interface DemoSetupConfig {
  codeHash: string;
  expiresAt: string;
  packs: Partial<
    Record<
      "demo" | "pleos",
      { contexts?: DemoConnection[] } & Partial<DemoConnection>
    >
  >;
}
export interface DemoConnection {
  base_url: string;
  vehicle_ref: string;
  source_ref: string;
  environment: string;
  collector_token: string;
  manager_token: string;
  context_id?: string;
}

// 참여 코드를 제한된 차량 연결 정보로 바꿔줌. 코드 만료만 볼 게 아니라 넘길 토큰의 권한·차량·환경도 다시 확인. _ma
export function registerDemoSetupRoutes(
  app: FastifyInstance,
  config: DemoSetupConfig | undefined,
  authenticate: Authenticate,
  clock: () => Date,
) {
  app.post<{ Body: { code: string; flavor: "demo" | "pleos" } }>(
    "/v1/demo/setup",
    {
      config: { rateLimit: { max: 8, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["code", "flavor"],
          properties: {
            code: { type: "string", minLength: 12, maxLength: 100 },
            flavor: { type: "string", enum: ["demo", "pleos"] },
          },
        },
      },
    },
    async (request) => {
      requireCondition(
        config && Date.parse(config.expiresAt) > clock().getTime(),
        403,
        "demo_setup_unavailable",
      );
      requireCondition(
        equalHash(hash(request.body.code), config!.codeHash),
        403,
        "demo_setup_unavailable",
      );
      const pack = config!.packs[request.body.flavor];
      requireCondition(pack, 403, "demo_setup_unavailable");
      const connections = pack!.contexts ?? [pack as DemoConnection];
      requireCondition(
        connections.length > 0 && connections.length <= 8,
        503,
        "demo_setup_unavailable",
      );
      const expected =
        request.body.flavor === "demo" ? "simulation" : "pleos_emulator";
      // 철회·만료된 자격을 배포하지 않으며 발급 설정 오류로 정비사 쓰기 권한이 유출되지 않게 한다.
      for (const connection of connections) {
        for (const [token, permitted] of [
          [
            connection.collector_token,
            ["events:append:odometer", "timeline:read"],
          ],
          [
            connection.manager_token,
            [
              "timeline:read",
              "reports:create",
              "reports:read",
              "reports:revoke",
            ],
          ],
        ] as const) {
          const principal = await authenticate(`Bearer ${token}`);
          requireCondition(
            principal.vehicleRef === connection.vehicle_ref &&
              principal.environment === expected &&
              principal.scopes.length > 0 &&
              principal.scopes.every((scope) =>
                (permitted as readonly string[]).includes(scope),
              ),
            503,
            "demo_setup_unavailable",
          );
        }
        requireCondition(
          connection.environment === expected &&
            new URL(connection.base_url).protocol === "https:",
          503,
          "demo_setup_unavailable",
        );
      }
      return pack;
    },
  );
}
