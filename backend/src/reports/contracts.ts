import type { Principal } from "../identity/Authorization.js";
import type {
  Correction,
  EventView,
  Gap,
} from "../vehicle-history/contracts.js";
export interface ReportRequest {
  vehicle_ref: string;
  kind: "full" | "partial";
  scope: { from: string; to: string; selected_event_ids: string[] };
  expires_in: 3600 | 86400 | 604800;
}
export interface ReportSnapshot {
  report_id: string;
  kind: "full" | "partial";
  environment: string;
  issued_at: string;
  expires_at: string;
  data_cutoff_seq: number;
  period: { from: string; to: string };
  events: EventView[];
  corrections: Correction[];
  gaps: Gap[];
  assessment: null;
  notice: string;
}
export interface ReportCreated {
  report_id: string;
  share_url?: string;
  issued_at: string;
  expires_at: string;
  reissue_required?: boolean;
}
export interface ReportStatus {
  report_id: string;
  issued_at: string;
  expires_at: string;
  state: "active" | "expired" | "revoked" | "changed";
  snapshot_hash: string;
}
export interface ReportStore {
  /** 발행/멱등 캐시를 원자 저장. 스냅샷 불변. 10분 이내 같은 키 재시도는 같은 링크. */
  create(
    principal: Principal,
    request: ReportRequest,
    key: string,
    now: Date,
  ): Promise<{ result: ReportCreated; replay: boolean }>;
  /** 최신 발급 50건. 같은 차량 관리 권한 내 상태만 반환하며 공유 비밀은 반환하지 않는다. */
  list(principal: Principal, now: Date): Promise<ReportStatus[]>;
  status(principal: Principal, id: string, now: Date): Promise<ReportStatus>;
  revoke(principal: Principal, id: string, now: Date): Promise<void>;
  /** 비밀 교환. 404로 잘못된 ID/비밀을 통일. 성공은 보고서 전용 15분 세션. */
  exchange(id: string, shareSecret: string, now: Date): Promise<string>;
  /** 매 조회마다 공유 만료/취소/근거 변경을 확인. 이전 세션도 동일 조건 적용. */
  view(id: string, session: string, now: Date): Promise<ReportSnapshot>;
}
