import type { FastifyInstance } from "fastify";
import { DomainError } from "./errors.js";
export function installHttpPolicies(app: FastifyInstance) {
  app.addHook("onSend", async (req, reply, payload) => {
    reply
      .header("Cache-Control", "no-store, private")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Robots-Tag", "noindex, nofollow")
      .header("X-Content-Type-Options", "nosniff")
      .header("X-Request-Id", req.id)
      .header(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      );
    return payload;
  });
  // 업무·입력·DB·통신 오류를 같은 응답 형식으로 정리함. 예외 원문 뿌리지 말고 코드랑 요청 ID만 줌. _ma
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof DomainError)
      return reply
        .code(error.status)
        .send({ error: error.code, request_id: req.id });
    const err = error as {
      validation?: unknown;
      statusCode?: number;
      code?: string;
    };
    if (err.validation || err.statusCode === 400)
      return reply
        .code(422)
        .send({ error: "invalid_input", request_id: req.id });
    if (err.statusCode === 415 || err.statusCode === 413)
      return reply
        .code(err.statusCode)
        .send({ error: "invalid_content", request_id: req.id });
    if (err.statusCode === 429)
      return reply
        .code(429)
        .send({ error: "rate_limited", request_id: req.id });
    if (["23505", "40001", "40P01"].includes(err.code ?? ""))
      return reply
        .code(409)
        .send({ error: "conflict_retry_same_key", request_id: req.id });
    // 예상 외 오류에도 원문 에러/SQL/본문/인증 정보를 기록하지 않는다.
    process.stderr.write(
      JSON.stringify({
        level: "error",
        request_id: req.id,
        code: err.code ?? "internal",
      }) + "\n",
    );
    // PostgreSQL SQLSTATE(5자리)·Node 네트워크 errno(E로 시작)는 DB/연결 장애로 보고 503(재시도 대상).
    // 그 외 TypeError 등 서버 코드 결함은 500으로 구분해 앱이 같은 요청을 무한 재전송하지 않게 한다.
    if (/^([0-9A-Z]{5}|E[A-Z]+)$/.test(err.code ?? ""))
      return reply
        .code(503)
        .send({ error: "dependency_unavailable", request_id: req.id });
    return reply
      .code(500)
      .send({ error: "internal_error", request_id: req.id });
  });
}
