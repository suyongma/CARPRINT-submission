export type ScoreCategory = "driving" | "care";
export interface PersonalScoreEvidence {
  observationId: string;
  category: ScoreCategory;
  occurredAt: string;
  attributionConfirmed: boolean;
  revoked: boolean;
  source: "simulation";
  metrics: Record<string, unknown>;
}
export interface ScoreDimension {
  score: number;
  evidenceCount: number;
  state: "unassessed" | "accumulating" | "sample_ready";
}
export interface PersonalScore {
  ruleVersion: "P0.1";
  source: "simulation";
  baseline: 50;
  score: number;
  state: ScoreDimension["state"];
  driving: ScoreDimension;
  care: ScoreDimension;
  excludedCount: number;
  firstEvidenceAt: string | null;
  lastEvidenceAt: string | null;
  notice: string;
}
export interface PersonalScoreReader {
  /** 계정 전체 차량의 최신 정정본을 읽는다. 호출자는 승인 세션에서 accountId를 얻어야 한다.
   * 읽기 전용/재시도 안전. DB 실패는 전파하며 50점으로 위장하지 않는다.
   * 세션/차량/앱 초기화와 독립. 실제 인증·실차 관측을 평가하는 계약이 아니다.
   */
  read(accountId: string, now: Date): Promise<PersonalScore>;
}
