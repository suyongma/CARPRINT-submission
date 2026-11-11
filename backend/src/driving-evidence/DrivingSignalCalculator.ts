import type { DrivingAssessment, SpeedSample } from "./contracts.js";

/** AAOS 속도는 m/s, 표본 시각은 단조 시간의 상대 ms. GPS/폰 센서 추정치를 혼합하지 않는다.
 * 시연 임계값 ±3 m/s²가 0.4초 지속된 구간을 후보 한 건으로 묶는다. 위험/과실 판정 아님. */
// 시각은 상대 ms, 속도는 m/s. 옆 표본끼리 거리·가감속 후보 계산함. 자료 부족하거나 이상하면 점수 보류. _ma
export function assessDrivingSignals(
  samples: SpeedSample[],
): DrivingAssessment {
  const reasons: string[] = [];
  let meters = 0,
    deceleration = 0,
    acceleration = 0,
    run = 0,
    direction = 0,
    counted = false;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!,
      b = samples[i]!,
      dt = (b.elapsedMs - a.elapsedMs) / 1000;
    if (
      !Number.isFinite(dt) ||
      dt < 0.05 ||
      dt > 2 ||
      !Number.isFinite(a.metersPerSecond) ||
      !Number.isFinite(b.metersPerSecond) ||
      a.metersPerSecond < 0 ||
      b.metersPerSecond < 0 ||
      a.metersPerSecond > 90 ||
      b.metersPerSecond > 90
    ) {
      reasons.push("sampling_gap_or_invalid_value");
      direction = 0;
      run = 0;
      counted = false;
      continue;
    }
    const change = (b.metersPerSecond - a.metersPerSecond) / dt;
    if (Math.abs(change) > 15) {
      reasons.push("implausible_speed_jump");
      direction = 0;
      run = 0;
      counted = false;
      continue;
    }
    // 두 속도 평균 × 경과 초. 사다리꼴 적분임. 위에서 걸러진 공백이나 말 안 되는 속도 변화는 빼고 셈. _ma
    meters += ((a.metersPerSecond + b.metersPerSecond) / 2) * dt;
    const next =
      change <= -3 && a.metersPerSecond >= 5 ? -1 : change >= 3 ? 1 : 0;
    if (next === 0) {
      direction = 0;
      run = 0;
      counted = false;
      continue;
    }
    if (next !== direction) {
      direction = next;
      run = 0;
      counted = false;
    }
    run += dt;
    // 가감속 임계값 넘는 구간이 0.4초 이어지면 한 건. counted 없으면 긴 구간을 계속 중복으로 셈. _ma
    if (run >= 0.4 && !counted) {
      if (next < 0) deceleration++;
      else acceleration++;
      counted = true;
    }
  }
  const duration = (samples.at(-1)?.elapsedMs ?? 0) / 1000;
  if (samples.length < 2 || samples[0]?.elapsedMs !== 0)
    reasons.push("invalid_sample_window");
  if (duration < 300 || meters < 5000)
    reasons.push("insufficient_driving_exposure");
  const unique = [...new Set(reasons)];
  return {
    ruleVersion: "D-SIGNAL-0.1",
    source: "pleos_emulator_aaos",
    scoreEligible: false,
    candidateScore: unique.length
      ? null
      : Math.round(
          Math.max(
            0,
            100 - ((deceleration + acceleration) / (meters / 1000)) * 100 * 5,
          ),
        ),
    durationSeconds: duration,
    distanceKm: Math.round(meters) / 1000,
    harshDecelerationCandidates: deceleration,
    harshAccelerationCandidates: acceleration,
    reasons: unique,
    notice:
      "Pleos 에뮬레이터의 AAOS 속도 관측 · 서버 계산 미리보기. OEM 원본 인증·운전자 귀속·긴급 제동 맥락 미확인으로 개인 점수에는 반영하지 않습니다.",
  };
}
