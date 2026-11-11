/** 예상 실패만 외부 코드로 변환한다. SQL·토큰·요청 본문은 응답/로그에 싣지 않는다. */
export class DomainError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}
export function requireCondition(
  condition: unknown,
  status: number,
  code: string,
): asserts condition {
  if (!condition) throw new DomainError(status, code);
}
