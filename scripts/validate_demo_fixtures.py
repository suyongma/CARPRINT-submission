"""합성 시연 자료의 연결·산식·격리 정책을 검사한다. 앱/DB/SDK 검증은 아니다."""

import copy
import importlib.util
import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "fixtures/demo"
spec = importlib.util.spec_from_file_location("carprint_policy_reference", ROOT / "CARPRINT_reference_checks.py")
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


def ensure(condition, reason):
    if not condition:
        raise ValueError(reason)


def dt(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def validate(bundle):
    ensure(bundle["environment"] == "simulation", "environment")
    ensure(bundle["ui"]["show_simulation_label"], "missing_simulation_label")
    ensure(not bundle["maintenance_rule"]["production"], "production_rule")
    vehicle = bundle["vehicle"]["vehicle_ref"]
    events = {event["event_id"]: event for event in bundle["vehicle_events"]}
    sources = {source["source_ref"] for source in bundle["sources"]}
    ensure(len(events) == len(bundle["vehicle_events"]), "duplicate_event_id")
    banned = {"account_id", "email", "phone", "vin", "token", "home_address", "latitude", "longitude"}

    def check_private_fields(value):
        if isinstance(value, dict):
            ensure(not (set(value) & banned), "private_field_in_vehicle_event")
            for nested in value.values(): check_private_fields(nested)
        elif isinstance(value, list):
            for nested in value: check_private_fields(nested)

    for event in events.values():
        ensure(event["vehicle_ref"] == vehicle, "vehicle_binding")
        ensure(event["environment"] == "simulation", "event_environment")
        ensure(event["source_ref"] in sources, "unknown_source")
        ensure(event["source_signature"] is None, "pretend_signature")
        ensure(dt(event["occurred_at"]) <= dt(event["received_at"]) <= dt(bundle["demo_now"]), "event_time")
        check_private_fields(event)
        if event["correction_of"]:
            target = events.get(event["correction_of"])
            ensure(target is not None and target["vehicle_ref"] == vehicle, "correction_scope")
            ensure(target["record_status"] == "superseded", "correction_original_not_retained")

    for assessment in bundle["assessments"]:
        ensure(assessment["environment"] == "simulation" and assessment["vehicle_ref"] == vehicle, "assessment_environment")
        snapshot = assessment["input_snapshot"]
        opportunities = snapshot["opportunities"]
        ensure(len({o["opportunity_id"] for o in opportunities}) == len(opportunities), "duplicate_opportunity")
        ensure(len({o["evidence_event_id"] for o in opportunities}) == len(opportunities), "duplicate_evidence_opportunity")
        for item in opportunities:
            ensure(item["evidence_event_id"] in events, "unknown_evidence")
            late = max(0, (dt(item["performed_at"])-dt(item["due_at"])).total_seconds()/86400)
            q = 1 if late == 0 else max(0, 1-late/item["grace_days"]) if item["grace_days"] else 0
            ensure(abs(item["q"]-q) < .000001, "q_mismatch")
        inputs = snapshot["eligibility_inputs"]
        eligible = all(inputs[k] for k in ("spec_known", "rule_known", "window_endpoints_known", "all_required_inputs_known")) and not inputs["unresolved_anomaly"]
        preventive = [o["q"] for o in opportunities if o["group"] == "preventive"]
        corrective = [o["q"] for o in opportunities if o["group"] == "corrective"]
        expected = policy.assess(preventive, corrective, eligible=eligible,
                                 gap=snapshot["required_gap_count"] > 0, sources_valid=inputs["sources_valid"])
        ensure(assessment["score"] == expected, "score_mismatch")
        ensure((dt(assessment["window_end"])-dt(assessment["window_start"])).days == assessment["evaluation_days"], "evaluation_window")
        ensure(assessment["coverage"]["continuous_vehicle_monitoring"] is False, "continuous_monitoring_claim")
    for report in bundle["reports"]:
        ensure(report["environment"] == "simulation", "report_environment")
        ensure(set(report["included_event_ids"]) <= set(events), "unknown_report_event")
        if report["kind"] == "partial":
            ensure(report["score"] is None and report["assessment_id"] is None, "partial_composite_score")
        else:
            ensure(set(report["included_event_ids"]) == set(events), "full_report_omission")
        ensure(all(dt(events[i]["received_at"]) <= dt(report["data_cutoff_at"]) for i in report["included_event_ids"]), "report_future_evidence")
        if report.get("display_state") == "expired":
            ensure(dt(bundle["demo_now"]) >= dt(report["expires_at"]), "report_not_expired")
    personal = bundle["personal"]
    for grant in personal["grants"]:
        ensure(grant["vehicle_ref"] == vehicle, "grant_vehicle_binding")
        ensure(set(grant["scopes"]) == {"climate_preference.read", "volume_preference.read"}, "unselected_scope_granted")
    for result in personal["application_results"]:
        if result["result"] == "simulated_accepted_unconfirmed":
            ensure(result["observed"] is None, "accepted_misrepresented_as_observed")
    if personal["session"]["status"] == "local_cleaned_remote_pending":
        ensure(personal["profile"] is None and not personal["accounts"], "private_cache_not_cleared")
        ensure(len(events) > 0 and personal["session"]["cloud_original_profile_exists"], "vehicle_or_cloud_history_removed")


if __name__ == "__main__":
    catalog = json.loads((FIXTURES / "catalog.json").read_text())
    rows = []
    for item in catalog["scenarios"]:
        bundle = json.loads((FIXTURES / item["file"]).read_text())
        validate(bundle)
        rows.append({"scenario_id": item["id"], "passed": True, "score": bundle["assessments"][-1]["score"],
                     "vehicle_event_count": len(bundle["vehicle_events"])})
    original = json.loads((FIXTURES / "scenarios/care_95.json").read_text())
    mutations = [
        ("private_field_in_vehicle_event", lambda b: b["vehicle_events"][0]["payload"].update(account_id="demo-account-b")),
        ("vehicle_binding", lambda b: b["vehicle_events"][0].update(vehicle_ref="demo-vehicle-b")),
        ("score_mismatch", lambda b: b["assessments"][0].update(score=100)),
        ("partial_composite_score", lambda b: b["reports"][1].update(score=95)),
        ("environment", lambda b: b.update(environment="production"))]
    rejected = []
    for expected, mutate in mutations:
        changed = copy.deepcopy(original)
        mutate(changed)
        try:
            validate(changed)
        except ValueError as error:
            ensure(str(error) == expected, "unexpected_rejection")
            rejected.append({"case": expected, "rejected": True})
        else:
            raise ValueError("invalid_fixture_not_rejected")
    result = {"kind": "synthetic_fixture_consistency_only", "scenario_count": len(rows),
              "scenarios": rows, "invalid_fixture_checks": rejected,
              "not_tested": ["Android UI", "SDK", "Vehicle Virtual Console", "DB", "login provider", "real vehicle control"]}
    (FIXTURES / "validation-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2)+"\n")
    print(f"Validated {len(rows)} scenarios; rejected {len(rejected)} invalid fixtures. No Android/SDK/DB/login execution.")
