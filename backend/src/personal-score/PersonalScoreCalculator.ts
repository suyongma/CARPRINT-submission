import type {
  PersonalScore,
  PersonalScoreEvidence,
  ScoreDimension,
} from "./contracts.js";

const dayMs = 86_400_000;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const timestamp = (value: unknown) =>
  typeof value === "string" ? Date.parse(value) : NaN;

/** 합성 시연 규칙 P0.1. 운전 안전성의 검증된 통계 모델이 아니다.
 * 주행: 5km/5분 이상 한 운행을 한 단위로, 급가감속 100km당 횟수에 5점을 차감한다.
 * 관리: 담당이 확인된 완료/기한 경과 기회만 반영, 유예 기간까지 선형 감점한다.
 * 결측/미귀속/취소는 0점 벌점이 아니라 제외. 단순 로그인/거리 읽기는 증거가 아니다.
 */
// 근거 한 건을 0~100으로 계산함. 못 쓰는 건 null. 취소·운전자 미확인·비합성 자료는 P0.1에서 제외. _ma
function quality(e: PersonalScoreEvidence, now: Date): number | null {
  if (
    e.revoked ||
    !e.attributionConfirmed ||
    e.source !== "simulation" ||
    !Number.isFinite(Date.parse(e.occurredAt)) ||
    Date.parse(e.occurredAt) > now.getTime()
  )
    return null;
  const m = e.metrics;
  if (e.category === "driving") {
    if (
      !finite(m.distanceKm) ||
      m.distanceKm < 5 ||
      !finite(m.observedMinutes) ||
      m.observedMinutes < 5 ||
      !finite(m.harshEvents) ||
      !Number.isInteger(m.harshEvents) ||
      m.harshEvents < 0
    )
      return null;
    return Math.max(0, 100 - (m.harshEvents / m.distanceKm) * 100 * 5);
  }
  if (e.category !== "care") return null;
  const due = timestamp(m.dueAt),
    through = timestamp(m.observedThrough);
  if (
    !Number.isFinite(due) ||
    !Number.isFinite(through) ||
    through > now.getTime() ||
    !finite(m.graceDays) ||
    m.graceDays <= 0
  )
    return null;
  // 미완료는 관측 종료까지 기한이 지난 경우만 평가한다. 알 수 없음은 null과 구별한다.
  const completed = m.completedAt === null ? null : timestamp(m.completedAt);
  if (
    completed !== null &&
    (!Number.isFinite(completed) || completed > through)
  )
    return null;
  if (completed === null && through <= due) return null;
  const lateDays = Math.max(0, ((completed ?? through) - due) / dayMs);
  return 100 * (1 - Math.min(1, lateDays / m.graceDays));
}
// 50점짜리 가상 10건 깔고 평균 냄. evidenceCount는 실제 건수만 셈. 점수만 보고 다 평가됐다고 보면 안 됨. _ma
function dimension(values: number[]): ScoreDimension {
  // 50점 기준에 10건 분량의 가중치를 둬 적은 기록으로 점수가 급등하지 않게 한다.
  // 실제 누적 건수는 별도로 표시한다. 이 완충 규칙만으로 동일인의 재가입 우회를 막지는 못한다.
  return {
    score: Math.round(
      (50 * 10 + values.reduce((sum, q) => sum + q, 0)) / (10 + values.length),
    ),
    evidenceCount: values.length,
    state:
      values.length === 0
        ? "unassessed"
        : values.length < 10
          ? "accumulating"
          : "sample_ready",
  };
}
// 계정 근거를 주행·관리로 나눠 계산하고 반반 합침. 차량 관리 D0.1이랑 다른 산식임. _ma
export function calculatePersonalScore(
  evidence: PersonalScoreEvidence[],
  now: Date,
): PersonalScore {
  const values = { driving: [] as number[], care: [] as number[] };
  const times: string[] = [],
    seen = new Set<string>();
  let excludedCount = 0;
  for (const e of evidence) {
    // 저장 경계가 최신 정정본 하나만 제공. 같은 관측의 재전송은 중복 득점하지 않는다.
    if (seen.has(e.observationId)) continue;
    seen.add(e.observationId);
    const q = quality(e, now);
    if (q === null) {
      excludedCount++;
      continue;
    }
    values[e.category].push(q);
    times.push(new Date(e.occurredAt).toISOString());
  }
  times.sort();
  const driving = dimension(values.driving),
    care = dimension(values.care);
  const count = driving.evidenceCount + care.evidenceCount;
  return {
    ruleVersion: "P0.1",
    source: "simulation",
    baseline: 50,
    score: Math.round((driving.score + care.score) / 2),
    state: !count
      ? "unassessed"
      : driving.state === "sample_ready" && care.state === "sample_ready"
        ? "sample_ready"
        : "accumulating",
    driving,
    care,
    excludedCount,
    firstEvidenceAt: times[0] ?? null,
    lastEvidenceAt: times.at(-1) ?? null,
    notice:
      "합성 시연 평가 · 시작 50점은 평가 전 기준값입니다. 차량을 바꿔도 계정 이력이 이어집니다. 실차 주행 능력·안전성을 인증하지 않습니다.",
  };
}
