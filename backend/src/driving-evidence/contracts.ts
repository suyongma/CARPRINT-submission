import type { Principal } from "../identity/Authorization.js";
export interface SpeedSample {
  elapsedMs: number;
  metersPerSecond: number;
}
export interface DrivingAssessment {
  ruleVersion: "D-SIGNAL-0.1";
  source: "pleos_emulator_aaos";
  scoreEligible: false;
  candidateScore: number | null;
  durationSeconds: number;
  distanceKm: number;
  harshDecelerationCandidates: number;
  harshAccelerationCandidates: number;
  reasons: string[];
  notice: string;
}
export interface DrivingObservationStore {
  /** 차량에 결속된 Pleos 관측만. 서버 발급 ID/15분 만료; 개인 계정 귀속은 아직 미검증. */
  begin(
    actor: Principal,
    now: Date,
  ): Promise<{ observationId: string; expiresAt: string }>;
  /** 한 번만 확정. 같은 ID/본문 재전송 안전, 다른 본문 409. 원시 표본·해시·산출 근거 원자 저장.
   * 앱 점수/급감속 횟수를 입력으로 받지 않는다. 출처/운전자 검증 전이므로 개인 점수에 가산 안 함. */
  finish(
    actor: Principal,
    id: string,
    samples: SpeedSample[],
    now: Date,
  ): Promise<DrivingAssessment>;
}
