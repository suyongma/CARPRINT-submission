import type { Principal } from "../identity/Authorization.js";
export interface CareEvidence {
  id: string;
  type: string;
  occurredAt: string | null;
  sourceValid: boolean;
  correctionOf: string | null;
  payload: Record<string, unknown>;
}
export interface CareOpportunity {
  id: string;
  group: "preventive" | "corrective";
  label: string;
  dueAt: string;
  graceDays: number | null;
  evidenceId: string | null;
}
export interface CareInput {
  period: { from: string; to: string };
  specificationKnown: boolean;
  ruleKnown: boolean;
  endpointsKnown: boolean;
  requiredInputsKnown: boolean;
  anomaly: boolean;
  gapCount: number;
  events: CareEvidence[];
  opportunities: CareOpportunity[];
}
export interface CareResult {
  ruleVersion: "D0.1";
  environment: "simulation";
  score: number | null;
  period: { from: string; to: string };
  reasons: string[];
  preventive: number | null;
  corrective: number | null;
  opportunityCount: number;
  items: {
    id: string;
    label: string;
    group: string;
    quality: number | null;
    evidenceId: string | null;
  }[];
  notice: string;
}
export interface AssessmentView extends CareResult {
  assessmentId: string;
  exampleId: string | null;
  evaluatedAt: string;
  departure: {
    state: "attention" | "normal" | "unknown";
    items: string[];
    notice: string;
  };
  previousAssessmentId: string | null;
  changeReason: string;
  comparable: boolean;
}
export interface CareAssessmentStore {
  /** 현재 차량의 불변 입력 해시로 평가를 저장/재사용. 예제는 별도 출처이며 차량 원본에 쓰지 않음. */
  assess(
    principal: Principal,
    exampleId: string | null,
    now: Date,
  ): Promise<AssessmentView>;
  examples(): Promise<{ id: string; label: string }[]>;
}
