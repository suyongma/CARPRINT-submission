"""5~7단계 구현용 계약·합성 입력을 만든다. 서버·DB·Android는 실행하지 않는다."""

from __future__ import annotations

import copy
import csv
import json
from pathlib import Path
from uuid import UUID, uuid5

ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = ROOT / "contracts/stages-5-7"
FIXTURES = ROOT / "fixtures/stages-5-7"
PLAN = ROOT / "docs/implementation/stages-5-7"
NAMESPACE = UUID("a59e8050-fc10-4d31-813a-22dd91a5592b")
NOW = "2026-10-27T03:00:00Z"


def identifier(alias):
    """별칭을 안정적인 합성 UUID로 변환한다. 실차·계정 식별자에는 사용하지 않는다."""
    return str(uuid5(NAMESPACE, "carprint-stage7-demo/" + alias))


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def object_schema(properties, required=None):
    return {"type": "object", "properties": properties,
            "required": list(properties) if required is None else required,
            "additionalProperties": False}


def prepare_contracts():
    uuid = {"type": "string", "format": "uuid"}
    timestamp = {"type": "string", "format": "date-time"}
    task = {"type": "string", "enum": ["demo-tire-rotation", "demo-cabin-filter",
                                              "demo-brake-inspection", "demo-tire-repair"]}
    payloads = {
        "odometer.observed": object_schema({"value": {"type": "number", "minimum": 0},
            "unit": {"const": "km"}, "time_quality": {"enum": ["known", "client_observed", "unknown"]}}),
        "maintenance.completed": object_schema({"task_code": task}),
        "warning.observed": object_schema({"code": {"const": "demo-tpms"},
                                             "state": {"enum": ["observed", "cleared"]}}),
        "issue.resolved": object_schema({"task_code": task, "resolves_event_id": uuid}),
        "maintenance.corrected": object_schema({"task_code": task}),
    }
    event = object_schema({
        "event_id": uuid, "event_type": {"enum": list(payloads)},
        "occurred_at": {"type": ["string", "null"], "format": "date-time"},
        "observed_at": timestamp, "payload_version": {"const": 1}, "payload": {"type": "object"},
        "source_ref": uuid, "environment": {"enum": ["simulation", "pleos_emulator"]},
        "collection_scope": {"type": "array", "items": {"enum": ["odometer", "maintenance", "warnings"]},
                             "minItems": 1, "uniqueItems": True},
        "source_signature": {"type": "null"},
    })
    event.update({"$schema": "http://json-schema.org/draft-07/schema#",
                  "$id": "https://carprint.example.invalid/contracts/stages-5-7/event-request.schema.json",
                  "title": "시연 환경 이벤트 요청 초안; 차량·수신시각·순번은 서버가 결정",
                  "allOf": [{"if": {"properties": {"event_type": {"const": kind}}},
                             "then": {"properties": {"payload": payload}}} for kind, payload in payloads.items()]})
    save_json(CONTRACTS / "event-request.schema.json", event)

    report = object_schema({
        "vehicle_ref": uuid, "kind": {"enum": ["full", "partial"]},
        "scope": object_schema({"from": timestamp, "to": timestamp,
                                "selected_event_ids": {"type": "array", "items": uuid, "uniqueItems": True}}),
        "expires_in": {"enum": [3600, 86400, 604800]},
    })
    report.update({"$schema": "http://json-schema.org/draft-07/schema#",
                   "title": "전체 범위 또는 일부 자료 발행 요청; 점수·비밀은 서버가 결정",
                   "allOf": [{"if": {"properties": {"kind": {"const": "full"}}},
                              "then": {"properties": {"scope": {"properties": {"selected_event_ids": {"maxItems": 0}}}}}},
                             {"if": {"properties": {"kind": {"const": "partial"}}},
                              "then": {"properties": {"scope": {"properties": {"selected_event_ids": {"minItems": 1}}}}}}]})
    save_json(CONTRACTS / "report-request.schema.json", report)

    routes = [
        {"id": "ingest_event", "method": "POST", "path": "/v1/vehicle-events", "stage": 5,
         "actor": "vehicle_collector_or_authorized_issuer", "request_schema": "event-request.schema.json",
         "headers": ["Authorization", "Idempotency-Key"], "success": [201, 200],
         "rules": ["vehicle_ref/environment/source are bound to the authenticated principal",
                   "same principal/key/body returns original event and receipt", "same key different body returns 409",
                   "event, receipt, sequence and outbox commit atomically", "maintenance.corrected requires correction endpoint"]},
        {"id": "timeline", "method": "GET", "path": "/v1/vehicles/{vehicle_ref}/timeline", "stage": 6,
         "actor": "vehicle_reader", "headers": ["Authorization"], "success": [200],
         "rules": ["cursor binds vehicle, environment, filters, snapshot server_seq and last server_seq",
                   "events, gaps, corrections, verification, scope and next_cursor are returned",
                   "append-only originals are not hidden by corrections"]},
        {"id": "correct_event", "method": "POST", "path": "/v1/events/{event_id}/corrections", "stage": 6,
         "actor": "same_issuer_or_delegated_reviewer", "headers": ["Authorization", "Idempotency-Key", "If-Match"],
         "success": [201, 200], "rules": ["replacement uses event-request schema; reason_code is required",
                   "same vehicle/environment/source authority; no cycle; no original UPDATE",
                   "stale chain head returns 412; new event plus correction link commit atomically"]},
        {"id": "create_report", "method": "POST", "path": "/v1/reports", "stage": 7,
         "actor": "vehicle_report_manager", "request_schema": "report-request.schema.json",
         "headers": ["Authorization", "Idempotency-Key"], "success": [201, 200],
         "rules": ["scope validated before immutable snapshot", "full cannot selectively omit records/gaps/corrections",
                   "partial has no composite score or full-report badge", "stage 7 assessment is null",
                   "share secret generated by server; persist only hash and a short-lived encrypted idempotency response"]},
        {"id": "report_status", "method": "GET", "path": "/v1/reports/{report_id}", "stage": 7,
         "actor": "vehicle_report_manager", "headers": ["Authorization"], "success": [200],
         "rules": ["issued_at/data_cutoff/expires_at/revoked_at/current source state", "raw share secret is not returned"]},
        {"id": "revoke_report", "method": "DELETE", "path": "/v1/reports/{report_id}/share", "stage": 7,
         "actor": "vehicle_report_manager", "headers": ["Authorization", "Idempotency-Key"], "success": [204],
         "rules": ["repeat revocation remains 204", "vehicle events are not deleted", "all existing visitor sessions recheck revocation"]},
        {"id": "share_shell", "method": "GET", "path": "/r/{opaque_id}", "stage": 7,
         "actor": "public", "headers": [], "success": [200],
         "rules": ["generic shell only; no report content without validated share capability",
                   "fragment secret is removed from browser history after exchange; no analytics or third-party assets"]},
        {"id": "share_exchange", "method": "POST", "path": "/v1/report-views", "stage": 7,
         "actor": "share_secret_holder", "headers": ["Origin"], "success": [200],
         "rules": ["body has report_id and share_secret; redact body; rate limit",
                   "invalid id/secret uniformly 404; valid but expired/revoked 410; changed evidence 409",
                   "create short-lived report-only HttpOnly visitor session; HTTPS Secure outside local loopback"]},
        {"id": "view_report", "method": "GET", "path": "/v1/report-views/{report_id}", "stage": 7,
         "actor": "report_only_visitor_session", "headers": [], "success": [200],
         "rules": ["server time now >= expires_at denies; revocation checked on every read",
                   "source changed since snapshot: no cached old report, return 409 reissue required",
                   "masked DTO only, no-store/private/noindex/referrer-policy no-referrer"]},
    ]
    save_json(CONTRACTS / "http-contract.json", {
        "contract_version": "carprint.stage5-7.draft.v1", "status": "design_not_implemented",
        "source_contract": "CARPRINT_기술설계_DB_API_보안.md section 5", "routes": routes,
        "errors": {"401": "authentication_required", "403": "scope_or_vehicle_forbidden", "404": "not_found",
                   "409": "idempotency_conflict_or_report_changed", "410": "share_unavailable",
                   "412": "revision_changed", "422": "invalid_input", "429": "rate_limited", "503": "dependency_unavailable"},
        "stage7_assessment_policy": "null_until_stage8; never accept client-provided score",
        "wire_names": "snake_case; UUID identifiers; UTC RFC3339; payload_version integer 1",
        "clock": "injected server clock for tests; real server clock outside isolated demo",
    })


def prepare_seed():
    source = json.loads((ROOT / "fixtures/demo/scenarios/corrected_record.json").read_text())
    gap_source = json.loads((ROOT / "fixtures/demo/scenarios/coverage_gap.json").read_text())
    aliases = {"demo-vehicle-a", "demo-vehicle-b", "demo-emulator-vehicle", "demo-collector-a",
               "demo-manager-a", "demo-issuer-a", "demo-collector-b", "demo-emulator-collector",
               "demo-source-app", "demo-source-workshop", "demo-source-b", "demo-emulator-source"}
    aliases |= {event["event_id"] for event in source["vehicle_events"]}
    aliases |= {gap["gap_id"] for gap in gap_source["collection_gaps"]}
    ids = {alias: identifier(alias) for alias in sorted(aliases)}
    vehicles = [{"vehicle_ref": ids[alias], "alias": label, "environment": environment,
                 "identity_level": "demo_vehicle_binding"}
                for alias, label, environment in [("demo-vehicle-a", "데모 차량 A", "simulation"),
                    ("demo-vehicle-b", "격리 확인용 차량 B", "simulation"),
                    ("demo-emulator-vehicle", "Pleos 에뮬레이터 전용", "pleos_emulator")]]
    principals = []
    for alias, vehicle, role, scopes in [
        ("demo-collector-a", "demo-vehicle-a", "vehicle_collector", ["events:append:odometer", "timeline:read"]),
        ("demo-manager-a", "demo-vehicle-a", "report_manager", ["timeline:read", "reports:create", "reports:read", "reports:revoke"]),
        ("demo-issuer-a", "demo-vehicle-a", "maintenance_issuer", ["events:append:maintenance", "events:correct:own"]),
        ("demo-collector-b", "demo-vehicle-b", "vehicle_collector", ["events:append:odometer", "timeline:read"]),
        ("demo-emulator-collector", "demo-emulator-vehicle", "vehicle_collector", ["events:append:odometer", "timeline:read"]),
    ]:
        principals.append({"principal_id": ids[alias], "vehicle_ref": ids[vehicle], "role": role, "scopes": scopes,
                           "binding_method": "demo_vehicle_binding", "credential": None})
    sources = [{"source_ref": ids[alias], "vehicle_ref": ids[vehicle], "principal_id": ids[principal], "source_kind": kind,
                "environment": environment, "source_signed": False}
               for alias, vehicle, principal, kind, environment in [
                   ("demo-source-app", "demo-vehicle-a", "demo-collector-a", "simulated_device", "simulation"),
                   ("demo-source-workshop", "demo-vehicle-a", "demo-issuer-a", "simulated_workshop", "simulation"),
                   ("demo-source-b", "demo-vehicle-b", "demo-collector-b", "simulated_device", "simulation"),
                   ("demo-emulator-source", "demo-emulator-vehicle", "demo-emulator-collector", "pleos_emulator", "pleos_emulator")]]
    events = []
    scope_by_type = {"odometer_observed": "odometer", "warning_observed": "warnings",
                     "maintenance_completed": "maintenance", "issue_resolved": "maintenance",
                     "maintenance_corrected": "maintenance"}
    for sequence, original in enumerate(sorted(source["vehicle_events"], key=lambda event: (event["received_at"], event["event_id"])), 1):
        kind = original["event_type"]
        if kind == "odometer_observed":
            payload = {"value": original["payload"]["kilometers"], "unit": "km", "time_quality": "known"}
        elif kind == "warning_observed":
            payload = copy.deepcopy(original["payload"])
        else:
            payload = {"task_code": original["payload"]["task_code"]}
            if kind == "issue_resolved":
                payload["resolves_event_id"] = ids[original["payload"]["resolves_event_id"]]
        events.append({"event_id": ids[original["event_id"]], "vehicle_ref": ids["demo-vehicle-a"],
                       "event_type": kind.replace("_", ".", 1), "occurred_at": original["occurred_at"],
                       "observed_at": original["received_at"], "received_at": original["received_at"],
                       "server_seq": sequence, "payload_version": 1, "payload": payload,
                       "source_ref": ids[original["source_ref"]], "environment": "simulation",
                       "collection_scope": [scope_by_type[kind]], "source_signature": None,
                       "correction_of": ids[original["correction_of"]] if original["correction_of"] else None})
    gaps = [{"gap_id": ids[gap["gap_id"]], "vehicle_ref": ids["demo-vehicle-a"],
             "environment": "simulation", "start": gap["start"], "end": gap["end"],
             "scope": ["warnings" if value == "corrective_observations" else value for value in gap["scope"]],
             "reason": gap["reason"]} for gap in gap_source["collection_gaps"]]
    corrections = [{"original_event_id": event["correction_of"], "new_event_id": event["event_id"],
                    "reason_code": "performed_date_corrected", "authority_ref": ids["demo-issuer-a"]}
                   for event in events if event["correction_of"]]
    seed = {"status": "prepared_not_loaded", "fixture_clock": NOW, "vehicles": vehicles,
            "principals": principals, "sources": sources, "events": events, "gaps": gaps,
            "corrections": corrections, "assessments": [], "personal_profiles": [],
            "server_receipt_signatures": "not_generated", "alias_to_uuid": ids,
            "import_rule": "seed-only; never submit received_at/server_seq/vehicle_ref through client event endpoint"}
    save_json(FIXTURES / "seed-bundle.json", seed)
    event_request = {key: copy.deepcopy(value) for key, value in events[0].items()
                     if key not in {"vehicle_ref", "received_at", "server_seq", "correction_of"}}
    event_request.update(event_id=identifier("new-app-observation"), occurred_at=None, observed_at=NOW)
    event_request["payload"].update(value=42510, time_quality="client_observed")
    save_json(FIXTURES / "ingest-request.json", event_request)
    correction_request = {"replacement": {key: value for key, value in next(event for event in events if event["correction_of"]).items()
                                           if key not in {"vehicle_ref", "received_at", "server_seq", "correction_of"}},
                          "reason_code": "performed_date_corrected"}
    save_json(FIXTURES / "correction-request.json", correction_request)

    report_requests, report_snapshots = {}, {}
    for kind in ["full", "partial"]:
        selected = [] if kind == "full" else [ids["demo-job-tires"]]
        report_requests[kind] = {"vehicle_ref": ids["demo-vehicle-a"], "kind": kind,
            "scope": {"from": "2026-04-30T03:00:00Z", "to": NOW, "selected_event_ids": selected}, "expires_in": 3600}
        report_snapshots[kind] = {"report_id": identifier("report-" + kind), "environment": "simulation",
            "kind": kind, "vehicle_alias": "데모 차량 A", "issued_at": "2026-10-27T03:01:00Z",
            "data_cutoff_at": NOW, "data_cutoff_seq": len(events), "expires_at": "2026-10-27T04:01:00Z",
            "revoked_at": None, "assessment": None,
            "included_event_ids": [event["event_id"] for event in events] if kind == "full" else selected,
            "gap_ids": [gap["gap_id"] for gap in gaps],
            "correction_event_ids": [item["new_event_id"] for item in corrections] if kind == "full" else [],
            "scope_notice": "설정된 기간의 전체 기록 · 합성 시연" if kind == "full" else "일부 자료만 공개됨 · 종합 점수 없음",
            "share_url": None, "publication_state": "not_issued_design_only"}
    save_json(FIXTURES / "report-requests.json", report_requests)
    save_json(FIXTURES / "report-snapshots.json", report_snapshots)
    share_cases = [
        {"case": "before_expiry", "now": "2026-10-27T04:00:59Z", "secret_valid": True, "revoked": False, "source_changed": False, "status": 200},
        {"case": "at_expiry", "now": "2026-10-27T04:01:00Z", "secret_valid": True, "revoked": False, "source_changed": False, "status": 410},
        {"case": "after_expiry", "now": "2026-10-27T04:01:01Z", "secret_valid": True, "revoked": False, "source_changed": False, "status": 410},
        {"case": "revoked", "now": "2026-10-27T03:30:00Z", "secret_valid": True, "revoked": True, "source_changed": False, "status": 410},
        {"case": "wrong_secret", "now": "2026-10-27T03:30:00Z", "secret_valid": False, "revoked": False, "source_changed": False, "status": 404},
        {"case": "changed_evidence", "now": "2026-10-27T03:30:00Z", "secret_valid": True, "revoked": False, "source_changed": True, "status": 409},
    ]
    save_json(FIXTURES / "share-boundaries.json", {"expires_at": "2026-10-27T04:01:00Z", "cases": share_cases})


def prepare_acceptance():
    rows = [
        ("S5-01",5,"신규 관측 수신","이벤트·영수증·차량별 순번·outbox가 한 트랜잭션에 저장", "앱+API+DB"),
        ("S5-02",5,"같은 키·본문 10회 재전송","같은 event_id/receipt; DB 이벤트 1개", "API+DB"),
        ("S5-03",5,"같은 키 다른 본문","409; 기존 이벤트 불변", "API+DB"),
        ("S5-04",5,"다른 차량·출처·환경 주장","403 또는 입력 422; 다른 차량에 기록 없음", "API+DB"),
        ("S5-05",5,"인증 없음·만료","401; 자동 재시도 중단·연결 필요 표시", "앱+API"),
        ("S5-06",5,"개인정보 필드 추가","422; 조용히 제거하고 성공시키지 않음", "API"),
        ("S5-07",5,"오프라인 후 앱 재시작","암호화 outbox 유지; 아직 서버에 저장되지 않음 표시", "앱"),
        ("S5-08",5,"응답 유실 뒤 재전송","같은 키 재사용; 이벤트 1개", "앱+API+DB"),
        ("S5-09",5,"동시 수신·중간 DB 실패","순번 충돌·반쪽 저장 없음; rollback 후 재시도", "API+DB"),
        ("S5-10",5,"서버 재시작","기존 기록 재조회; 메모리 목록만으로 저장 완료 처리하지 않음", "API+DB"),
        ("S5-11",5,"DB 일반 역할 원본 UPDATE/DELETE","권한 거부; migration owner와 런타임 역할 분리", "DB"),
        ("S5-12",5,"SDK 실패·자료 없음","실패 상태 유지; 숫자 0·합성값 업로드 없음", "앱"),
        ("S5-13",5,"outbox 한도 초과","명시적 누락 기록·미전송 경고; 조용한 폐기 없음", "앱+API"),
        ("S6-01",6,"출처·발생일·수신일 표시","세 개 정보를 구분; 에뮬레이터/합성 표시 유지", "앱+API"),
        ("S6-02",6,"정정 생성","원본 불변·새 이벤트·사유·연결 보존", "앱+API+DB"),
        ("S6-03",6,"다른 차량/발급자의 정정","403 또는 은닉 404; 원본·새 기록 모두 불변", "API+DB"),
        ("S6-04",6,"오래된 정정 버전","412; 최신 관계 조회 후 재확인", "앱+API"),
        ("S6-05",6,"기록 공백","기간·범위·사유 미확인 표시; 0점/조작 확정 금지", "앱+API"),
        ("S6-06",6,"거리 감소·지연 수신·발생시각 미상","검토 또는 비교 불가; 타임라인 날짜와 수신 순번 분리", "API+앱"),
        ("S6-07",6,"페이지 사이 새 기록 수신","cursor 스냅샷 기준 유지; 중복·누락 없음", "API+DB"),
        ("S6-08",6,"타 차량 cursor 재사용","403 또는 은닉 404; 다른 차량 내용 노출 없음", "API"),
        ("S6-09",6,"빈 기록·통신 실패·캐시","서로 다른 상태; 마지막 동기화 시각 표시", "앱"),
        ("S7-01",7,"전체 리포트 발행","범위 내 원본·정정·공백 포함; assessment null", "API+DB+웹"),
        ("S7-02",7,"전체 발행에 선택 필터 삽입","422; 필터로 불리한 기록 숨기기 불가", "API"),
        ("S7-03",7,"일부 자료 발행","일부 공개 고지; 종합 점수·전체 표장 없음", "API+웹"),
        ("S7-04",7,"차량 수집자·일반 계정의 발행/취소","관리 위임 없으면 403", "API"),
        ("S7-05",7,"만료 직전/동시/직후","200/410/410; 서버 시각 기준", "API+웹"),
        ("S7-06",7,"공유 취소·반복 취소","204; 기존 방문 세션도 읽기 차단; 차량 기록 유지", "API+DB+웹"),
        ("S7-07",7,"틀린 비밀·ID 대입","동일한 404; rate limit; 원문 비밀 로그 없음", "API+웹"),
        ("S7-08",7,"발행 뒤 정정·출처 취소","스냅샷 불변; 현재 상태 409/재발행 안내; 오래된 본문 미노출", "API+DB+웹"),
        ("S7-09",7,"브라우저 새로고침·뒤로가기·오프라인","no-store; 현재 검증 실패 시 이전 본문 대신 확인 불가", "웹"),
        ("S7-10",7,"발행 응답 유실·재시도","같은 report_id; 제한 기간 암호화 응답 재사용; 만료 후 새 키 발행 안내", "API+DB+앱"),
        ("S7-11",7,"리포트 마스킹","계정·VIN·주소·원본 증빙·인증 헤더 미포함", "API+웹"),
        ("UI-01",7,"화이트/다크 전환·작은 Pleos 창","화면·선택 상태 유지; 잘림·가림 없음", "앱"),
    ]
    PLAN.mkdir(parents=True, exist_ok=True)
    with (PLAN / "acceptance-matrix.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["case_id", "stage", "trigger", "expected", "verification_surface", "execution_status"])
        writer.writerows([list(row)+["NOT_RUN"] for row in rows])


if __name__ == "__main__":
    # 초안 생성기로 실제 런타임 schema를 되돌리지 않는다. 준비 자료는 당시 기록으로 보존한다.
    manifest = CONTRACTS / "http-contract.json"
    if manifest.exists() and json.loads(manifest.read_text())["status"] != "design_not_implemented":
        raise SystemExit("Runtime contracts exist. Preparation regeneration is disabled; edit runtime files explicitly.")
    prepare_contracts()
    prepare_seed()
    prepare_acceptance()
    print("Prepared 3 contract JSON files, 6 fixture JSON files and 34 unexecuted acceptance cases. No services started.")
