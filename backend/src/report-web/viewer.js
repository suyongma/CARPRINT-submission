"use strict";
const id = location.pathname.split("/").pop();
let shareSecret = location.hash.slice(1);
// fragment는 요청/Referer에 보내지 않고 교환 전에도 현재 기록에서 제거한다.
history.replaceState(null, "", location.pathname);
const body = document.getElementById("report"),
  status = document.getElementById("status"),
  heading = document.getElementById("heading");
let generation = 0;
const date = (value) =>
  value ? new Date(value).toLocaleString("ko-KR") : "측정 시각 미상";
// 서버 문자열은 textContent로 넣음. 제목 보여주려다 HTML 실행하면 안 되니까. _ma
function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
function clear() {
  generation++;
  body.hidden = true;
  body.replaceChildren();
  heading.textContent = "공유 상태 확인 중";
  status.textContent = "최신 열람 권한을 확인합니다.";
}
const taskNames = {
  "demo-tire-rotation": "타이어 위치 교환",
  "demo-cabin-filter": "실내 필터 교체",
  "demo-brake-inspection": "브레이크 점검",
  "demo-tire-repair": "타이어 조치",
};
const sourceNames = {
  simulated_device: "합성 기기 관측",
  simulated_workshop: "합성 정비 기록",
  pleos_emulator: "Pleos 에뮬레이터",
};
const flagNames = {
  measurement_time_unknown: "차량 측정 시각 미제공",
  odometer_decreased_review: "이전 수신 거리보다 작음 · 검토 필요",
  client_clock_ahead: "앱 시각이 서버보다 앞섬",
  delayed_observation: "발생 후 늦게 관측됨",
};
function render(report) {
  heading.textContent =
    report.kind === "partial" ? "일부 자료 리포트" : "차량 기록 리포트";
  status.textContent = report.notice;
  body.append(
    element("p", `${date(report.period.from)} — ${date(report.period.to)}`),
    element("div", `${report.events.length}개 기록`, "metric"),
    element(
      "p",
      `발행 ${date(report.issued_at)} · 공유 만료 ${date(report.expires_at)} · 기준 순번 ${report.data_cutoff_seq}`,
    ),
    element(
      "p",
      `${report.environment === "simulation" ? "합성 시연 데이터" : "Pleos 에뮬레이터 관측"} · 관리 점수 미산출`,
      "notice",
    ),
  );
  body.append(element("h2", "기록 및 출처"));
  for (const event of report.events) {
    const row = element("div", "", "row");
    row.append(
      element(
        "span",
        event.occurred_at
          ? new Date(event.occurred_at).toLocaleDateString("ko-KR")
          : "측정 시각 미상",
      ),
    );
    const detail = element("div", "");
    const title =
      event.event_type === "odometer.observed"
        ? `${Number(event.payload.value).toLocaleString("ko-KR")} km`
        : (taskNames[event.payload.task_code] ?? "타이어 공기압 경고");
    detail.append(
      element("strong", title),
      element(
        "p",
        `출처 ${sourceNames[event.source_kind] ?? event.source_kind} · ${event.source_status === "revoked" ? "출처 검증 취소" : "외부 검증 전 시연 자료"}`,
      ),
      element(
        "p",
        `앱 관측 ${date(event.observed_at)} / 서버 수신 ${date(event.received_at)}`,
      ),
    );
    if (event.corrected_by)
      detail.append(element("p", "정정 전 원본 · 아래 연결 기록과 함께 확인"));
    if (event.event_type === "maintenance.corrected")
      detail.append(element("p", "수행일 정정 · 원본 보존"));
    if (event.review_flags.length)
      detail.append(
        element(
          "p",
          "확인 필요: " +
            event.review_flags
              .map((flag) => flagNames[flag] ?? flag)
              .join(", "),
        ),
      );
    row.append(detail);
    body.append(row);
  }
  body.append(element("h2", "수집 공백"));
  for (const gap of report.gaps)
    body.append(
      element(
        "p",
        `${date(gap.start)} — ${date(gap.end)} · ${gap.scope.map((scope) => ({ warnings: "경고 관측", odometer: "주행거리", maintenance: "정비" })[scope] ?? scope).join(", ")} · 원인 미확인`,
        "notice",
      ),
    );
  if (!report.gaps.length)
    body.append(
      element(
        "p",
        "이 리포트에 등록된 공백 없음. 누락이 없다는 보증은 아닙니다.",
      ),
    );
  body.hidden = false;
}
// 공유 비밀로 쿠키 세션 받고 리포트 읽음. 요청 세대 바뀌었거나 탭 숨겨졌으면 늦게 온 결과는 안 보여줌. _ma
async function load() {
  clear();
  const current = generation;
  try {
    if (shareSecret) {
      const response = await fetch("/v1/report-views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_id: id, share_secret: shareSecret }),
        cache: "no-store",
      });
      if (!response.ok) throw await response.json();
      shareSecret = "";
    }
    const response = await fetch(`/v1/report-views/${id}`, {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) throw data;
    if (current === generation && !document.hidden) render(data);
  } catch (error) {
    if (current !== generation) return;
    heading.textContent = "리포트를 열 수 없습니다";
    status.textContent =
      {
        share_expired: "공유 기간이 만료되었습니다. 새 링크를 요청하세요.",
        share_revoked: "발급자가 공유를 취소했습니다.",
        report_changed_reissue: "근거가 변경되어 재발행이 필요합니다.",
        not_found: "유효한 공유 링크를 확인해 주세요.",
        session_unavailable:
          "세션이 종료되었습니다. 원래 공유 링크로 다시 열어 주세요.",
      }[error.error] ??
      "현재 상태를 확인할 수 없습니다. 연결을 확인한 뒤 다시 시도하세요.";
  }
}
document.getElementById("retry").onclick = load;
addEventListener("pagehide", clear);
addEventListener("pageshow", load);
addEventListener("offline", () => {
  clear();
  heading.textContent = "연결 확인 필요";
  status.textContent = "온라인에서 공유 상태를 확인해야 열람할 수 있습니다.";
});
document.addEventListener("visibilitychange", () =>
  document.hidden ? clear() : load(),
);
setInterval(() => {
  if (!document.hidden) void load();
}, 30000);
