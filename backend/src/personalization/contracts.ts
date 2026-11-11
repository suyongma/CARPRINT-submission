import type { PersonalScore } from "../personal-score/contracts.js";
import type { Principal } from "../identity/Authorization.js";
export const personalScopes = [
  "climate",
  "volume",
  "destination",
  "seat",
] as const;
export type PersonalScope = (typeof personalScopes)[number];
export type SessionMode = "temporary" | "trip";
export interface ConnectionRequest {
  scopes: PersonalScope[];
  mode: SessionMode;
}
export interface PersonalSession {
  sessionId: string;
  accountId: string;
  displayName: string;
  scopes: PersonalScope[];
  seat: string | null;
  availableSeats: string[];
  expiresAt: string;
  revision: number;
  profileRevision: number;
  preferences: Partial<Record<PersonalScope, unknown>>;
  personalScore: PersonalScore;
}
export interface ApplicationItem {
  scope: PersonalScope;
  value: unknown;
  status: string;
  reason: string;
}
export interface ApplicationPreview {
  previewId: string;
  expiresAt: string;
  items: ApplicationItem[];
  profileRevision: number;
}
export interface PersonalizationStore {
  /** 모두 임시 합성 계정. 비밀번호/외부 사용자 인증 없이 선택 승인하며 실서비스용으로 사용하지 않는다. */
  accounts(): Promise<{ id: string; name: string }[]>;
  request(
    actor: Principal,
    input: ConnectionRequest,
    now: Date,
  ): Promise<{ requestId: string; code: string; expiresAt: string }>;
  approve(
    actor: Principal,
    id: string,
    accountId: string,
    code: string,
    now: Date,
  ): Promise<{ token: string; session: PersonalSession }>;
  cancelRequest(actor: Principal, id: string, now: Date): Promise<void>;
  session(actor: Principal, token: string, now: Date): Promise<PersonalSession>;
  assignSeat(
    actor: Principal,
    token: string,
    seat: string,
    now: Date,
  ): Promise<PersonalSession>;
  narrowScopes(
    actor: Principal,
    token: string,
    scopes: PersonalScope[],
    now: Date,
  ): Promise<PersonalSession>;
  preview(
    actor: Principal,
    token: string,
    now: Date,
  ): Promise<ApplicationPreview>;
  apply(
    actor: Principal,
    token: string,
    previewId: string,
    now: Date,
  ): Promise<ApplicationItem[]>;
  savePreferences(
    actor: Principal,
    token: string,
    revision: number,
    values: Partial<Record<PersonalScope, unknown>>,
    now: Date,
  ): Promise<PersonalSession>;
  /** 즉시 종료. 중복 호출 안전. 차량 결속 자격으로 재전송할 수 있어 종료용 개인 토큰을 남길 필요 없음. */
  end(actor: Principal, id: string, now: Date): Promise<void>;
}
