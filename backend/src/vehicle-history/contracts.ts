import type { Principal } from "../identity/Authorization.js";
export interface EventRequest {
  event_id: string;
  event_type:
    | "odometer.observed"
    | "maintenance.completed"
    | "warning.observed"
    | "issue.resolved"
    | "maintenance.corrected";
  occurred_at: string | null;
  observed_at: string;
  payload_version: 1;
  payload: {
    value?: number;
    unit?: string;
    time_quality?: string;
    task_code?: string;
    code?: string;
    state?: string;
    resolves_event_id?: string;
  };
  source_ref: string;
  environment: string;
  collection_scope: string[];
  source_signature: null;
}
export interface Receipt {
  version: "carprint.receipt.v1";
  event_id: string;
  vehicle_ref: string;
  environment: string;
  server_seq: number;
  received_at: string;
  event_hash: string;
  previous_hash: string;
  chain_hash: string;
  key_id: string;
  signature: string;
}
export interface EventView extends EventRequest {
  vehicle_ref: string;
  server_seq: number;
  received_at: string;
  source_kind: string;
  source_status: string;
  review_flags: string[];
  corrected_by: string | null;
}
export interface Correction {
  original_event_id: string;
  new_event_id: string;
  reason_code: string;
}
export interface Gap {
  gap_id: string;
  start: string;
  end: string;
  scope: string[];
  reason: string;
}
export interface Timeline {
  vehicle_ref: string;
  environment: string;
  snapshot_seq: number;
  evidence_revision: number;
  events: EventView[];
  corrections: Correction[];
  gaps: Gap[];
  next_cursor: string | null;
}
export interface CorrectionInput {
  originalId: string;
  replacement: EventRequest;
  reason: string;
  expectedHead: string;
}
export interface AppendResult {
  receipt: Receipt;
  replay: boolean;
}
export interface VehicleEventStore {
  /** 원본・영수증・차량 순번・outbox를 하나의 트랜잭션으로 저장. 같은 키/본문 재시도 안전.
   * 다른 본문 409, 출처/권한 403, 정정 충돌 412. 실패 시 부분 저장 없음. */
  append(
    principal: Principal,
    request: EventRequest,
    key: string,
    now: Date,
    correction?: CorrectionInput,
  ): Promise<AppendResult>;
}
export interface VehicleHistoryReader {
  /** cursor는 조회 차량/근거 버전에 결속. 신규 관측은 페이지 스냅샷 밖에 둔다. */
  timeline(
    principal: Principal,
    cursor?: string,
    limit?: number,
  ): Promise<Timeline>;
}
export interface ReceiptSigner {
  readonly keyId: string;
  /** 서명 대상은 canonical JSON이며 I/O 없음. 영수증은 서버 수신 증명이지 OEM 원본 보증이 아니다. */
  sign(body: Omit<Receipt, "signature">): string;
}
