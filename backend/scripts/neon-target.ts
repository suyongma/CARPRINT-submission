/** 로컬 초기화/파괴적 테스트와 별도 진입점. 정확한 Neon endpoint를 명시해야 한다. */
export function neonTarget(env: NodeJS.ProcessEnv = process.env): URL {
  const url = new URL(env.OWNER_DATABASE_URL ?? "");
  if (
    !env.CARPRINT_NEON_HOST ||
    url.hostname !== env.CARPRINT_NEON_HOST ||
    !url.hostname.endsWith(".neon.tech") ||
    url.hostname.includes("-pooler.") ||
    url.pathname !== "/carprint_demo" ||
    url.searchParams.get("sslmode") !== "verify-full" ||
    !url.username ||
    !url.password
  )
    throw new Error(
      "Explicit CARPRINT Neon direct endpoint and verified TLS required",
    );
  return url;
}
