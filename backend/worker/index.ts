import { AsyncLocalStorage } from "node:async_hooks";
import { env as bindings } from "cloudflare:workers";
import { handleAsNodeRequest } from "cloudflare:node";
import type { Pool } from "pg";
import { buildApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { createPool } from "../src/db/connection.js";
import type { DemoSetupConfig } from "../src/demo-setup/routes.js";
import html from "../src/report-web/index.html";
import script from "../src/report-web/viewer.js";
import style from "../src/report-web/viewer.css";

interface Env {
  DATABASE_URL: string;
  PUBLIC_ORIGIN: string;
  CACHE_KEY_HEX: string;
  CURSOR_KEY_HEX: string;
  RECEIPT_PRIVATE_KEY: string;
  DEMO_SETUP_JSON: string;
}

// Workers의 TCP 연결은 요청 수명을 넘겨 재사용하지 않는다. 업무 저장소는 같은 Pool 계약을 유지한다.
const requests = new AsyncLocalStorage<Pool>();
// query/connect만 전달한다. 새 저장소가 Pool의 다른 기능을 쓰면 요청 수명과 트랜잭션 해제를 먼저 검토한다.
// 겉으론 Pool인데 query/connect 할 때 현재 요청 풀 찾아감. 동시 요청끼리 DB 연결 수명 섞이지 않게 한 거. _ma
const scopedPool = new Proxy({} as Pool, {
  get(_target, property) {
    if (property !== "query" && property !== "connect")
      throw new Error("Unsupported request pool operation");
    return (...args: unknown[]) => {
      const pool = requests.getStore();
      if (!pool) throw new Error("Database access outside request");
      return Reflect.apply(pool[property], pool, args);
    };
  },
});
// 스키마와 라우터의 코드 생성은 Workers가 허용하는 시작 단계에서 완료한다.
// 요청 중에는 동적 코드 생성이나 서버별 재초기화를 수행하지 않는다.
const configuration = bindings as unknown as Env;
const app = await buildApp(
  readConfig({
    DATABASE_URL: configuration.DATABASE_URL,
    PUBLIC_ORIGIN: configuration.PUBLIC_ORIGIN,
    CACHE_KEY_HEX: configuration.CACHE_KEY_HEX,
    CURSOR_KEY_HEX: configuration.CURSOR_KEY_HEX,
    RECEIPT_KEY_PATH: "worker-secret",
  }),
  scopedPool,
  () => new Date(),
  {
    pluginTimeout: 0,
    receiptPrivateKey: configuration.RECEIPT_PRIVATE_KEY,
    reportWeb: { html, script, style },
    demoSetup: JSON.parse(configuration.DEMO_SETUP_JSON) as DemoSetupConfig,
  },
);
await app.ready();
app.server.listen(18080);

/** Fetch와 Fastify 사이에서만 변환한다. 인증·스키마·정비/점수 규칙은 기존 route/service를 실행한다. */
export default {
  // 이 요청 풀은 fetch가 책임짐. 응답 본문까지 읽고 finally에서 닫음. 요청 끝났는데 연결 남기지 말 것. _ma
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.origin !== env.PUBLIC_ORIGIN)
      return new Response("Invalid origin", { status: 421 });
    if (
      !["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"].includes(
        request.method,
      )
    )
      return new Response("Method not allowed", { status: 405 });
    const pool = createPool(env.DATABASE_URL);
    try {
      return await requests.run(pool, async () => {
        // 공식 Node HTTP 어댑터가 요청 본문·상태·쿠키를 전달한다. 본문 제한은 Fastify의 32 KiB 규칙을 따른다.
        const response = await handleAsNodeRequest(18080, request);
        const payload = await response.arrayBuffer();
        return new Response(
          request.method === "HEAD" || response.status === 204 ? null : payload,
          response,
        );
      });
    } catch (error) {
      // 접속 문자열·SQL·서명 키를 예외 응답이나 실행 로그에 노출하지 않는다.
      const failure = error as Error & { code?: string };
      console.error(
        JSON.stringify({
          name: failure.name,
          code: failure.code,
          frames: failure.stack?.split("\n").slice(1, 4),
          dynamicCodeDenied: failure.message.includes("Code generation"),
        }),
      );
      return Response.json(
        { error: "dependency_unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    } finally {
      await pool.end();
    }
  },
};
