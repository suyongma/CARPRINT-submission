import {
  comfortKeys,
  type ComfortCapability,
  type ComfortItem,
  type ComfortValues,
  type NumericRange,
} from "./contracts.js";

// 차량 지원 간격에 반올림하고 최소·최대 안으로 자름. 소수 둘째 자리 정리는 부동소수점 찌꺼기 때문. _ma
const quantize = (value: number, range: NumericRange) =>
  Number(
    Math.min(
      range.max,
      Math.max(
        range.min,
        range.min + Math.round((value - range.min) / range.step) * range.step,
      ),
    ).toFixed(2),
  );
/** 차종별 합성 범위에 맞추는 결정적 규칙. 인체공학/AI 최적값이나 실제 시트 이동 명령을 뜻하지 않는다. */
// 공통 선호랑 차량별 값을 지원 범위에 맞춰 계산만 함. DB 저장이나 SDK 쓰기는 여기서 안 함. _ma
export function planComfort(
  capability: ComfortCapability | null,
  seat: string | null,
  portable: ComfortValues,
  vehicle: ComfortValues,
): ComfortItem[] {
  return comfortKeys
    .filter((key) => portable[key] !== undefined || vehicle[key] !== undefined)
    .map((key) => {
      // 차량별 값 있으면 그거 우선. 0도 설정값이라 || 쓰면 안 됨. null/undefined만 ??로 대체. _ma
      const requested = vehicle[key] ?? portable[key]!;
      const base = {
        key,
        requested,
        source:
          vehicle[key] === undefined
            ? ("account" as const)
            : ("vehicle" as const),
      };
      const fail = (
        reason: string,
        disposition: "unsupported" | "blocked" = "unsupported",
      ): ComfortItem => ({
        ...base,
        target: null,
        unit: "",
        disposition,
        reason,
      });
      if (!capability)
        return fail("Pleos 차량의 지원 범위·쓰기 권한 미검증 · 적용하지 않음");
      if (!seat || !capability.seats.includes(seat))
        return fail("먼저 계정의 좌석을 배정하세요", "blocked");
      let target: number, unit: string, reason: string;
      if (key === "temperature") {
        if (!capability.climateSeats.includes(seat))
          return fail(
            "이 좌석의 독립 공조 미지원 · 공용 공조를 임의 변경하지 않음",
          );
        target = quantize(requested, capability.temperature);
        unit = "°C";
        reason = `${capability.temperature.min}~${capability.temperature.max}°C · ${capability.temperature.step}°C 간격에 맞춤`;
      } else if (key === "fanPercent") {
        if (!capability.climateSeats.includes(seat))
          return fail("이 좌석의 독립 풍량 미지원");
        target = quantize((requested / 100) * capability.fanLevels, {
          min: 0,
          max: capability.fanLevels,
          step: 1,
        });
        unit = "단계";
        reason = `선호 풍량 ${requested}% → 차량의 0~${capability.fanLevels}단계로 환산`;
      } else if (key === "seatPositionPercent") {
        if (!capability.poweredSeats.includes(seat))
          return fail("이 좌석은 수동 시트 · 위치 선호만 보존");
        // 합성 좌표일 뿐 SDK absolute setter가 아니다. 실차에는 별도 보정/정차/착좌/끼임 검증 필요.
        target = quantize(
          capability.seatTravel.min +
            (requested / 100) *
              (capability.seatTravel.max - capability.seatTravel.min),
          capability.seatTravel,
        );
        unit = "모의 mm";
        reason = `상대 위치 ${requested}% → 이 차량의 모의 이동 범위 ${capability.seatTravel.min}~${capability.seatTravel.max}mm로 변환 · 정차 모의 환경`;
      } else {
        const heating = key === "seatHeating";
        if (
          !(
            heating ? capability.heatedSeats : capability.ventilatedSeats
          ).includes(seat)
        )
          return fail(
            heating
              ? "해당 좌석 열선 미지원"
              : "해당 좌석 통풍 미지원 · 공조로 임의 대체하지 않음",
          );
        const max = heating
          ? capability.heatLevels
          : capability.ventilationLevels;
        target = Math.min(requested, max);
        unit = "단계";
        reason = `지원 단계 0~${max} 안에서 적용`;
      }
      return {
        ...base,
        target,
        unit,
        disposition:
          key === "fanPercent" ||
          key === "seatPositionPercent" ||
          target !== requested
            ? "adjusted"
            : "unchanged",
        reason,
      };
    });
}
