import { requireCondition } from "../shared/errors.js";
import type { EventRequest } from "../vehicle-history/contracts.js";

export const isMaintenance = (type: string) =>
  ["maintenance.completed", "maintenance.corrected", "issue.resolved"].includes(
    type,
  );
const weekMs = 7 * 24 * 60 * 60 * 1000;

/** 서버 수신 시각 기준 168시간(경계 포함). 정정 체인의 가장 이른 기한을 연장하지 않는다.
 * 서버가 검증한 원본 시각만 anchors로 전달. 알 수 없는 작업일/미래 날짜는 허용하지 않는다.
 */
// 발생·관측 순서랑 수신까지 168시간 확인. anchors의 원본/조상 시각도 봐야 정정으로 기한 못 늘림. _ma
export function checkMaintenanceWindow(
  request: EventRequest,
  now: Date,
  anchors: Date[] = [],
) {
  const occurred =
    request.occurred_at === null ? NaN : Date.parse(request.occurred_at);
  const observed = Date.parse(request.observed_at),
    server = now.getTime();
  requireCondition(
    Number.isFinite(occurred) &&
      Number.isFinite(observed) &&
      occurred <= observed &&
      observed <= server,
    422,
    "maintenance_time_invalid",
  );
  requireCondition(
    server - occurred <= weekMs &&
      server - observed <= weekMs &&
      anchors.every(
        (date) =>
          Number.isFinite(date.getTime()) && server - date.getTime() <= weekMs,
      ),
    403,
    "maintenance_window_closed",
  );
}
