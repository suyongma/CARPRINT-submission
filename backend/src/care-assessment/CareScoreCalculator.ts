import type { CareInput, CareResult } from "./contracts.js";
/** D0.1 합성 규칙. q 입력을 믿지 않고 원본/정정의 실제 수행일로 다시 계산한다. */
// 차량 관리 점수 계산. 자료 모자라면 reasons 남기고 score=null. 모른다고 0점 주는 거 아님. _ma
export function calculateCare(input: CareInput): CareResult {
  const reasons: string[] = [];
  if (!input.specificationKnown || !input.ruleKnown)
    reasons.push("차량 사양·평가 기준 미확인");
  if (!input.endpointsKnown) reasons.push("평가 기간 양끝의 관측 자료 부족");
  if (!input.requiredInputsKnown) reasons.push("필수 판단 자료 부족");
  if (input.anomaly) reasons.push("해결되지 않은 거리·시각 이상");
  if (input.gapCount) reasons.push(`필수 관측 범위 공백 ${input.gapCount}개`);
  const seen = new Set<string>();
  const items = input.opportunities
    .filter((o) => {
      // 정정본 조상 찾아서 같은 작업인지 봄. 원본이랑 정정본 따로 실적 잡으면 점수 뻥튀기됨. _ma
      let key = o.evidenceId ?? o.id;
      const ancestors = new Set<string>();
      while (!ancestors.has(key)) {
        ancestors.add(key);
        const predecessor = input.events.find(
          (e) => e.id === key,
        )?.correctionOf;
        if (!predecessor) break;
        key = predecessor;
      }
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((o) => {
      // 후속 정정까지 가서 최신 수행일 씀. 방문한 건 기억해둬야 순환 참조 와도 무한 루프 안 돎. _ma
      let event = input.events.find((e) => e.id === o.evidenceId);
      const chain = new Set<string>();
      while (event && !chain.has(event.id)) {
        chain.add(event.id);
        const next = input.events.find((e) => e.correctionOf === event!.id);
        if (!next) break;
        event = next;
      }
      let quality: number | null = null;
      if (event?.sourceValid && event.occurredAt) {
        const overdue = Math.max(
          0,
          (Date.parse(event.occurredAt) - Date.parse(o.dueAt)) / 86400000,
        );
        quality =
          overdue === 0
            ? 1
            : o.graceDays && o.graceDays > 0
              ? Math.max(0, 1 - overdue / o.graceDays)
              : 0;
        if (!Number.isFinite(quality)) quality = null;
      }
      if (quality === null) reasons.push(`${o.label}: 수행·출처 확인 필요`);
      return {
        id: o.id,
        label: o.label,
        group: o.group,
        quality,
        evidenceId: event?.id ?? null,
      };
    });
  const groups = new Set(items.map((i) => i.group));
  if (items.length < 3) reasons.push("서로 다른 작업 기회가 3개 미만");
  if (groups.size < 2) reasons.push("예방 관리와 문제 조치 양쪽 근거 필요");
  const average = (group: string) => {
    const values = items.filter((i) => i.group === group);
    return values.length && values.every((i) => i.quality !== null)
      ? values.reduce((s, i) => s + i.quality!, 0) / values.length
      : null;
  };
  const preventive = average("preventive"),
    corrective = average("corrective");
  const score =
    reasons.length === 0 && preventive !== null && corrective !== null
      ? Math.floor(100 * (0.75 * preventive + 0.25 * corrective) + 0.5)
      : null;
  return {
    ruleVersion: "D0.1",
    environment: "simulation",
    period: input.period,
    score,
    reasons: [...new Set(reasons)],
    preventive,
    corrective,
    opportunityCount: items.length,
    items,
    notice:
      "합성 평가 기준 · 확인된 관리 범위에 한정 · 차량 안전·가격 평가나 제조사 기준이 아님",
  };
}
// 경고 ID랑 해결 기록 연결해서 미해결 건 찾음. normal 떠도 실시간으로 차가 안전하다는 뜻은 아님. _ma
export function departureCheck(input: CareInput) {
  const resolved = new Set(
    input.events
      .filter((e) => e.type === "issue_resolved" || e.type === "issue.resolved")
      .map((e) => e.payload.resolves_event_id),
  );
  const unresolved = input.events.filter(
    (e) =>
      (e.type === "warning_observed" || e.type === "warning.observed") &&
      !resolved.has(e.id),
  );
  const items = unresolved
    .slice(0, 1)
    .map(
      () =>
        "해결 확인이 없는 경고 기록이 있습니다. 차량 안내와 점검 필요 여부를 확인하세요.",
    );
  return {
    state: items.length
      ? "attention"
      : input.events.length
        ? "normal"
        : "unknown",
    items,
    notice:
      "기록 기반 출발 체크 · 실시간 안전 판단이나 차량 계기판을 대신하지 않음",
  } as const;
}
