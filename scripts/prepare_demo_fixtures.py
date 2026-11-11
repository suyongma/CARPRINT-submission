"""시연용 JSON을 재현 가능하게 준비한다. 앱/DB/SDK/네트워크에는 접근하지 않는다."""

from __future__ import annotations

import copy
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "fixtures/demo"
NOW = datetime(2026, 10, 27, 3, tzinfo=timezone.utc)
VEHICLE = "demo-vehicle-a"


def stamp(value):
    return value.isoformat().replace("+00:00", "Z")


def at(day):
    return f"{day}T03:00:00Z"


def event(event_id, kind, day, payload, source="demo-source-workshop"):
    return {"event_id": event_id, "vehicle_ref": VEHICLE, "event_type": kind,
            "occurred_at": at(day), "received_at": at(day), "payload_version": 1,
            "payload": payload, "source_ref": source, "environment": "simulation",
            "source_signature": None, "correction_of": None, "record_status": "active"}


def opportunity(key, group, title, due, performed, event_id, q, grace=None):
    return {"opportunity_id": key, "group": group, "label": title,
            "due_at": at(due), "performed_at": at(performed), "q": q,
            "grace_days": grace, "grace_basis": "synthetic-rule-only" if grace else None,
            "evidence_event_id": event_id, "rule_ref": "demo-maintenance-rule-v1"}


def assessment(bundle, assessment_id="demo-assessment-95", score=95, reason="eligible_limited_scope"):
    return {"assessment_id": assessment_id, "vehicle_ref": VEHICLE, "environment": "simulation",
            "rule_version": "D0.1", "created_at": stamp(NOW),
            "window_start": stamp(NOW-timedelta(days=180)), "window_end": stamp(NOW),
            "score": score, "eligibility": reason, "evaluation_days": 180,
            "observation_day_count": len({e["occurred_at"][:10] for e in bundle["vehicle_events"]}),
            "opportunity_ids": [o["opportunity_id"] for o in bundle["opportunities"]],
            "evidence_event_ids": [o["evidence_event_id"] for o in bundle["opportunities"]],
            "coverage": {"scopes": ["maintenance_jobs", "odometer_endpoints", "corrective_observations"],
                         "continuous_vehicle_monitoring": False, "required_gap_count": len(bundle["collection_gaps"])},
            "input_snapshot": {"opportunities": copy.deepcopy(bundle["opportunities"]),
                               "eligibility_inputs": copy.deepcopy(bundle["eligibility_inputs"]),
                               "required_gap_count": len(bundle["collection_gaps"])},
            "validity": "current",
            "supersedes_assessment_id": None, "change_reason": None,
            "label": "합성 시연 · 확인된 관리 범위에 한정 · 차량 안전/가격 평가 아님"}


def base():
    observations = [event(f"demo-odo-{i+1}", "odometer_observed", day,
                          {"kilometers": km, "unit": "km"}, "demo-source-app")
                    for i, (day, km) in enumerate([
                        ("2026-04-30", 28000), ("2026-05-19", 30100),
                        ("2026-07-19", 35200), ("2026-09-12", 39800),
                        ("2026-09-20", 40500), ("2026-10-27", 42500)])]
    jobs = [event("demo-job-tires", "maintenance_completed", "2026-05-19", {"task_code": "demo-tire-rotation", "label": "타이어 위치 교환"}),
            event("demo-job-filter", "maintenance_completed", "2026-07-19", {"task_code": "demo-cabin-filter", "label": "실내 필터 교환"}),
            event("demo-job-brakes", "maintenance_completed", "2026-09-12", {"task_code": "demo-brake-inspection", "label": "브레이크 점검"}),
            event("demo-warning-tire", "warning_observed", "2026-09-20", {"code": "demo-tpms", "state": "observed"}, "demo-source-app"),
            event("demo-job-tire-repair", "issue_resolved", "2026-09-21", {"task_code": "demo-tire-repair", "label": "타이어 경고 원인 점검·조치", "resolves_event_id": "demo-warning-tire"})]
    bundle = {"schema_version": "carprint.demo.bundle.v1", "environment": "simulation",
              "scenario_id": "care_95", "label": "관리 점수 95점", "demo_now": stamp(NOW),
              "clock_policy": "fixed_manual_steps", "runtime_status": "fixture_only_not_loaded_into_app",
              "vehicle": {"vehicle_ref": VEHICLE, "alias": "데모 차량 A", "brand": None,
                          "model_spec_key": "demo-spec-a", "identity_level": "simulation"},
              "sources": [
                  {"source_ref": "demo-source-app", "source_kind": "vehicle_app_observation", "source_signed": False, "verification_status": "simulated_approved_observation"},
                  {"source_ref": "demo-source-workshop", "source_kind": "verified_shop", "source_signed": False, "verification_status": "simulated_verified"}],
              "vehicle_events": sorted(observations+jobs, key=lambda e: (e["occurred_at"], e["event_id"])),
              "collection_gaps": [],
              "eligibility_inputs": {"spec_known": True, "rule_known": True, "window_endpoints_known": True,
                                     "all_required_inputs_known": True, "sources_valid": True, "unresolved_anomaly": False},
              "maintenance_rule": {"rule_ref": "demo-maintenance-rule-v1", "production": False,
                                   "manufacturer_reference": None, "basis": "가상 정비 기준: 제조사 기준 아님"},
              "opportunities": [
                  opportunity("demo-opp-tires", "preventive", "타이어 위치 교환", "2026-05-20", "2026-05-19", "demo-job-tires", 1),
                  opportunity("demo-opp-filter", "preventive", "실내 필터 교환", "2026-07-20", "2026-07-19", "demo-job-filter", 1),
                  opportunity("demo-opp-brakes", "preventive", "브레이크 점검", "2026-09-10", "2026-09-12", "demo-job-brakes", .8, 10),
                  opportunity("demo-opp-repair", "corrective", "타이어 경고 원인 조치", "2026-09-25", "2026-09-21", "demo-job-tire-repair", 1)],
              "assessments": [],
              "personal": {"accounts": [], "grants": [], "seat_assignment": None, "profile": None,
                           "application_results": [], "session": {"session_id": "demo-session-a", "mode": "temporary", "status": "not_linked", "cleanup_state": "not_started"}},
              "reports": [], "ui": {"theme": "system", "system_theme_for_preview": "light", "show_simulation_label": True}}
    bundle["assessments"] = [assessment(bundle)]
    bundle["reports"] = [
        {"report_id": "demo-report-full", "kind": "full", "environment": "simulation",
         "assessment_id": "demo-assessment-95", "score": 95, "issued_at": stamp(NOW),
         "data_cutoff_at": stamp(NOW), "expires_at": stamp(NOW+timedelta(days=7)), "revoked_at": None,
         "included_event_ids": [e["event_id"] for e in bundle["vehicle_events"]], "mandatory_gap_ids": []},
        {"report_id": "demo-report-partial", "kind": "partial", "environment": "simulation",
         "assessment_id": None, "score": None, "issued_at": stamp(NOW),
         "data_cutoff_at": stamp(NOW), "expires_at": stamp(NOW+timedelta(days=7)), "revoked_at": None,
         "included_event_ids": ["demo-job-tires"], "mandatory_gap_ids": [], "notice": "일부 자료만 공개됨"}]
    return bundle


def scenarios():
    original = base()
    result = [original]
    fresh = copy.deepcopy(original)
    fresh.update(scenario_id="fresh_install", label="설치 직후 · 자료 부족", vehicle_events=[], opportunities=[], reports=[])
    fresh["eligibility_inputs"].update(window_endpoints_known=False, all_required_inputs_known=False)
    fresh["assessments"] = [assessment(fresh, "demo-assessment-empty", None, "insufficient_history")]
    result.append(fresh)

    gap = copy.deepcopy(original)
    gap.update(scenario_id="coverage_gap", label="필수 범위 공백 · 점수 보류", reports=[])
    gap["collection_gaps"] = [{"gap_id": "demo-gap-1", "vehicle_ref": VEHICLE,
                               "start": at("2026-08-01"), "end": at("2026-08-10"),
                               "scope": ["corrective_observations"], "reason": "unknown", "required_for_assessment": True}]
    gap["assessments"] = [assessment(gap, "demo-assessment-gap", None, "required_coverage_gap")]
    result.append(gap)

    revoked = copy.deepcopy(original)
    revoked.update(scenario_id="evidence_revoked", label="평가 근거 검증 취소", reports=[])
    revoked["eligibility_inputs"]["sources_valid"] = False
    revoked["sources"][1]["verification_status"] = "simulated_revoked"
    revoked["assessments"] = [assessment(revoked, "demo-assessment-revoked", None, "evidence_revoked")]
    result.append(revoked)

    correction = copy.deepcopy(original)
    correction.update(scenario_id="corrected_record", label="수행일 정정 · 95→100", reports=[])
    old = next(e for e in correction["vehicle_events"] if e["event_id"] == "demo-job-brakes")
    old["record_status"] = "superseded"
    new = event("demo-job-brakes-corrected", "maintenance_corrected", "2026-09-10", copy.deepcopy(old["payload"]))
    new.update(received_at=stamp(NOW), correction_of=old["event_id"])
    new["payload"]["correction_reason"] = "합성 예시: 증빙의 수행일 정정"
    correction["vehicle_events"].append(new)
    correction["opportunities"][2].update(performed_at=at("2026-09-10"), q=1, evidence_event_id=new["event_id"])
    changed = assessment(correction, "demo-assessment-corrected", 100)
    changed.update(supersedes_assessment_id="demo-assessment-95", change_reason="performed_date_corrected")
    correction["assessments"][0]["validity"] = "superseded"
    correction["assessments"].append(changed)
    result.append(correction)

    preventive = copy.deepcopy(original)
    preventive.update(scenario_id="preventive_only", label="예방 관리만 있음 · 종합 보류", reports=[])
    preventive["vehicle_events"] = [e for e in preventive["vehicle_events"] if e["event_type"] not in ("warning_observed", "issue_resolved")]
    preventive["opportunities"] = [o for o in preventive["opportunities"] if o["group"] == "preventive"]
    preventive["assessments"] = [assessment(preventive, "demo-assessment-preventive", None, "missing_corrective_group")]
    result.append(preventive)

    linked = copy.deepcopy(original)
    linked.update(scenario_id="selective_link", label="공조·볼륨만 연결 · 일부 결과 확인")
    linked["personal"] = {
        "accounts": [{"account_id": "demo-account-a", "alias": "데모 운전자 A"}],
        "grants": [{"grant_id": "demo-grant-a", "account_id": "demo-account-a", "vehicle_ref": VEHICLE,
                    "scopes": ["climate_preference.read", "volume_preference.read"], "consent_kind": "simulated_explicit_selection",
                    "expires_at": stamp(NOW+timedelta(hours=2)), "revoked_at": None}],
        "seat_assignment": {"account_id": "demo-account-a", "seat_id": "driver", "role": "driver", "approval": "simulated_explicit"},
        "profile": {"profile_id": "demo-profile-a", "revision": 2, "logical_prefs": {"temperature_celsius": 22, "volume_level": 8},
                    "physical_prefs": {}, "current_values": {"temperature_celsius": 24, "volume_level": 12},
                    "field_basis": {"temperature_celsius": "logical_common", "volume_level": "confirmed_vehicle"}, "vehicle_ref": VEHICLE},
        "capability_snapshot": {"environment": "simulation", "cap_id": "demo-cap-a", "observed_at": stamp(NOW),
                                "expires_at": stamp(NOW+timedelta(minutes=5)), "parked": True,
                                "features": {"temperature_celsius": {"supported": True, "permission": True, "min": 16, "max": 30, "step": .5},
                                             "volume_level": {"supported": True, "permission": True, "min": 0, "max": 30, "step": 1},
                                             "seat_position": {"supported": None, "permission": False}}},
        "application_results": [
            {"item": "temperature_celsius", "requested": 22, "observed": 22, "result": "simulated_observed_success"},
            {"item": "volume_level", "requested": 8, "observed": None, "result": "simulated_accepted_unconfirmed"}],
        "session": {"session_id": "demo-session-a", "mode": "temporary", "status": "active", "cleanup_state": "not_started",
                    "cloud_original_profile_exists": True, "new_profile_save_requested": False}}
    result.append(linked)

    offline = copy.deepcopy(linked)
    offline.update(scenario_id="session_end_offline", label="하차 정리 · 원격 취소 대기")
    offline["personal"].update(accounts=[], seat_assignment=None, profile=None, application_results=[])
    offline["personal"]["grants"][0]["revocation_state"] = "pending_remote"
    offline["personal"]["session"].update(status="local_cleaned_remote_pending", cleanup_state="local_done", local_credentials_present=False)
    result.append(offline)

    conflict = copy.deepcopy(linked)
    conflict.update(scenario_id="profile_conflict", label="프로필 동시 수정 · 다시 미리보기")
    conflict["personal"]["application_results"] = []
    conflict["personal"]["sync_request"] = {"expected_revision": 1, "actual_revision": 2, "result": "revision_conflict", "apply_allowed": False}
    result.append(conflict)

    expired = copy.deepcopy(original)
    expired.update(scenario_id="expired_report", label="공유 리포트 만료", demo_now=stamp(NOW+timedelta(days=7)))
    for report in expired["reports"]:
        report["display_state"] = "expired"
    result.append(expired)
    return result


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2)+"\n")


if __name__ == "__main__":
    bundles = scenarios()
    for bundle in bundles:
        save(OUT / "scenarios" / f'{bundle["scenario_id"]}.json', bundle)
    save(OUT / "catalog.json", {"schema_version": "carprint.demo.catalog.v1", "environment": "simulation",
                               "default_scenario": "care_95", "default_theme": "system", "preview_system_theme": "light",
                               "runtime_integration": "not_implemented", "reset_policy": "replace_demo_namespace_only",
                               "scenarios": [{"id": b["scenario_id"], "label": b["label"], "file": f'scenarios/{b["scenario_id"]}.json'} for b in bundles]})
    save(OUT / "connection-options.json", {"environment": "simulation", "defaults": "all_optional_scopes_off",
        "options": [
            {"id": "climate", "label": "공조 선호", "scope": "climate_preference.read", "default_selected": False, "available_in_fixture": True},
            {"id": "volume", "label": "공용 볼륨", "scope": "volume_preference.read", "default_selected": False, "available_in_fixture": True},
            {"id": "places", "label": "목적지 별칭", "scope": "destination_alias.read", "default_selected": False, "available_in_fixture": True, "real_address_in_fixture": False},
            {"id": "seat", "label": "좌석 보정값", "scope": "confirmed_seat_profile.read", "default_selected": False, "available_in_fixture": False, "reason": "현재 차량에서 확인된 보정값 없음"}],
        "selection_example": {"scenario_id": "selective_link", "user_selected": ["climate", "volume"], "automatic_vehicle_control": False}})
    save(OUT / "emulator-read-sequence.json", {"environment": "pleos_emulator", "status": "plan_only_not_executed",
        "minimum_emulator_version": "2.1.0", "tool": "Pleos Connect Virtual Console", "mode": "manual_only",
        "documentation": "https://document.pleos.ai/en/docs/pleos-only/app-test-guide/virtual-console-guide",
        "steps": [{"domain": "Motion", "control": "Odometer", "kilometers": km, "app_action": "다시 읽기", "expected": expected}
                  for km, expected in [(42500, "수신 42500km · Pleos 에뮬레이터 출처"), (42510, "새 수신 42510km"), (42500, "감소 관측 · 향후 이상 검토용, 조작 확정 금지")]],
        "history_rule": "합성 이력 또는 합성 점수와 결합하지 않는다. 4단계 앱은 일회성 읽기이며 이상 탐지·저장은 아직 없다."})
    print(f"Prepared {len(bundles)} synthetic scenarios and 3 supporting JSON files; no app/SDK/DB calls.")
