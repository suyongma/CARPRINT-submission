import type { Principal } from "../identity/Authorization.js";
export const comfortKeys = [
  "temperature",
  "fanPercent",
  "seatPositionPercent",
  "seatHeating",
  "seatVentilation",
] as const;
export type ComfortKey = (typeof comfortKeys)[number];
export type ComfortValues = Partial<Record<ComfortKey, number>>;
export type ComfortScope = "climate" | "seat";
export const comfortScope = (key: ComfortKey): ComfortScope =>
  key === "temperature" || key === "fanPercent" ? "climate" : "seat";
export interface NumericRange {
  min: number;
  max: number;
  step: number;
}
export interface ComfortCapability {
  name: string;
  version: string;
  source: "simulation";
  seats: string[];
  climateSeats: string[];
  poweredSeats: string[];
  heatedSeats: string[];
  ventilatedSeats: string[];
  temperature: NumericRange;
  fanLevels: number;
  seatTravel: NumericRange;
  heatLevels: number;
  ventilationLevels: number;
}
export interface ComfortItem {
  key: ComfortKey;
  requested: number;
  target: number | null;
  unit: string;
  disposition: "unchanged" | "adjusted" | "unsupported" | "blocked";
  source: "account" | "vehicle";
  reason: string;
}
export interface ComfortView {
  revision: number;
  seat: string | null;
  capability: ComfortCapability | null;
  portable: ComfortValues;
  vehicleValues: ComfortValues;
  items: ComfortItem[];
  lastApplied: ComfortItem[];
  notice: string;
}
export interface ComfortPreview {
  id: string;
  expiresAt: string;
  vehicleName: string;
  items: ComfortItem[];
}
export interface PassengerPreset {
  id: string;
  name: string;
  ownerName: string;
  values: ComfortValues;
}
/** 개인 승인 세션으로만 접근. 저장은 계정 버전 CAS, 적용은 1분 미리보기 버전과 좌석 재검증.
 * 저장/적용은 DB 단일 트랜잭션이며 실제 SDK 제어를 하지 않는다. 적용 재전송은 같은 ID로 멱등.
 */
export interface ComfortStore {
  read(actor: Principal, token: string, now: Date): Promise<ComfortView>;
  save(
    actor: Principal,
    token: string,
    revision: number,
    target: "account" | "vehicle",
    values: ComfortValues,
    now: Date,
  ): Promise<ComfortView>;
  resetVehicle(
    actor: Principal,
    token: string,
    revision: number,
    now: Date,
  ): Promise<ComfortView>;
  preview(actor: Principal, token: string, now: Date): Promise<ComfortPreview>;
  apply(
    actor: Principal,
    token: string,
    id: string,
    now: Date,
  ): Promise<ComfortItem[]>;
  presets(
    actor: Principal,
    token: string,
    now: Date,
  ): Promise<PassengerPreset[]>;
  savePreset(
    actor: Principal,
    token: string,
    name: string,
    values: ComfortValues,
    now: Date,
  ): Promise<PassengerPreset>;
  loadPreset(
    actor: Principal,
    token: string,
    id: string,
    revision: number,
    now: Date,
  ): Promise<ComfortView>;
}
