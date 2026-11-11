import type { ApplicationItem, PersonalScope } from "./contracts.js";
/** 실제 SDK capability/command를 가장하지 않는 합성 적용 계획. 값 확인 가능 여부를 항목별로 유지한다. */
export class SimulatedPreferencePlanner {
  plan(
    environment: string,
    seat: string | null,
    preferences: Partial<Record<PersonalScope, unknown>>,
  ): ApplicationItem[] {
    return Object.entries(preferences).map(([key, value]) => {
      const scope = key as PersonalScope;
      if (environment !== "simulation")
        return {
          scope,
          value,
          status: "unsupported",
          reason: "Pleos 실제 쓰기 권한·capability 미확인",
        };
      if (!seat)
        return {
          scope,
          value,
          status: "blocked",
          reason: "계정별 좌석 배정 확인 필요",
        };
      if ((scope === "volume" || scope === "destination") && seat !== "driver")
        return {
          scope,
          value,
          status: "blocked",
          reason: "공용 항목은 운전석 계정의 확인 필요",
        };
      if (scope === "seat")
        return {
          scope,
          value,
          status: "blocked",
          reason: "대상 차량 보정값만 표시 · 물리 시트 안전 조건 미확인",
        };
      if (scope === "destination")
        return {
          scope,
          value,
          status: "unsupported",
          reason: "외부 내비 기록 삭제 지원 미확인 · 목적지 전송 안 함",
        };
      return {
        scope,
        value,
        status: scope === "volume" ? "request_only" : "ready",
        reason:
          scope === "volume"
            ? "모의 요청 접수만 확인 가능"
            : "모의 값 읽기 확인 가능",
      };
    });
  }
  confirm(items: ApplicationItem[]): ApplicationItem[] {
    return items.map((item) =>
      item.status === "ready"
        ? {
            ...item,
            status: "simulated_confirmed",
            reason: "합성 상태에서 값 확인 · 실제 차량 적용 아님",
          }
        : item.status === "request_only"
          ? {
              ...item,
              status: "unconfirmed",
              reason: "모의 요청 접수 · 적용 값 확인 안 됨",
            }
          : item,
    );
  }
}
