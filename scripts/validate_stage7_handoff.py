"""준비 파일끼리의 참조·범위·시각을 검사한다. HTTP/DB/JSON Schema 엔진 검증은 아니다."""

import csv
import json
from datetime import datetime
from pathlib import Path
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "fixtures/stages-5-7"
CONTRACTS = ROOT / "contracts/stages-5-7"
PLAN = ROOT / "docs/implementation/stages-5-7"


def load(path):
    return json.loads(path.read_text())


def ensure(condition, reason):
    if not condition:
        raise ValueError(reason)


def dt(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def validate_event_example(request, schema):
    """이 예제에 필요한 필드·단위만 확인한다. 범용 JSON Schema 판정기로 사용하지 않는다."""
    ensure(set(request) == set(schema["required"]), "event_request_fields")
    for field in ("event_id", "source_ref"):
        UUID(request[field])
    ensure(request["event_type"] in schema["properties"]["event_type"]["enum"], "event_type")
    ensure(request["environment"] in {"simulation", "pleos_emulator"}, "environment")
    ensure(request["payload_version"] == 1 and request["source_signature"] is None, "version_or_signature")
    dt(request["observed_at"])
    if request["occurred_at"] is not None:
        ensure(dt(request["occurred_at"]) <= dt(request["observed_at"]), "event_time")
    definitions = {item["if"]["properties"]["event_type"]["const"]: item["then"]["properties"]["payload"]
                   for item in schema["allOf"]}
    definition = definitions[request["event_type"]]
    ensure(set(request["payload"]) == set(definition["required"]), "payload_fields")
    if request["event_type"] == "odometer.observed":
        ensure(request["payload"]["unit"] == "km" and request["payload"]["value"] >= 0, "distance_unit")
    if "task_code" in request["payload"]:
        ensure(request["payload"]["task_code"] in definition["properties"]["task_code"]["enum"], "task_code")


def run():
    seed = load(FIXTURES / "seed-bundle.json")
    contract = load(CONTRACTS / "http-contract.json")
    schema = load(CONTRACTS / "event-request.schema.json")
    vehicles = {vehicle["vehicle_ref"]: vehicle for vehicle in seed["vehicles"]}
    sources = {source["source_ref"]: source for source in seed["sources"]}
    principals = {principal["principal_id"]: principal for principal in seed["principals"]}
    events = {event["event_id"]: event for event in seed["events"]}
    gaps = {gap["gap_id"]: gap for gap in seed["gaps"]}
    ensure(len(events) == len(seed["events"]), "duplicate_event")
    ensure(not seed["assessments"] and not seed["personal_profiles"], "stage8_or_9_data_in_stage7")
    for value in seed["alias_to_uuid"].values():
        UUID(value)
    ensure(len(set(seed["alias_to_uuid"].values())) == len(seed["alias_to_uuid"]), "uuid_collision")
    ensure([event["server_seq"] for event in seed["events"]] == list(range(1, len(events)+1)), "sequence")
    for event in events.values():
        vehicle = vehicles[event["vehicle_ref"]]
        source = sources[event["source_ref"]]
        ensure(event["environment"] == vehicle["environment"] == source["environment"], "environment_binding")
        ensure(source["vehicle_ref"] == event["vehicle_ref"], "source_binding")
        ensure(principals[source["principal_id"]]["vehicle_ref"] == event["vehicle_ref"], "source_principal_binding")
        ensure(dt(event["received_at"]) <= dt(seed["fixture_clock"]), "future_event")
        ensure("record_status" not in event, "mutable_status_in_original")
        request = {key: value for key, value in event.items()
                   if key not in {"vehicle_ref", "received_at", "server_seq", "correction_of"}}
        validate_event_example(request, schema)
        if event["correction_of"]:
            original = events[event["correction_of"]]
            ensure(original["vehicle_ref"] == event["vehicle_ref"], "correction_vehicle")
            ensure(original["server_seq"] < event["server_seq"], "correction_order")
        if "resolves_event_id" in event["payload"]:
            warning = events[event["payload"]["resolves_event_id"]]
            ensure(warning["vehicle_ref"] == event["vehicle_ref"], "issue_vehicle")
    for correction in seed["corrections"]:
        ensure(events[correction["new_event_id"]]["correction_of"] == correction["original_event_id"], "correction_link")
    ensure(all(principal["credential"] is None for principal in seed["principals"]), "credential_in_fixture")
    for principal in seed["principals"]:
        ensure(principal["vehicle_ref"] in vehicles, "principal_vehicle")
        if principal["role"] == "vehicle_collector":
            ensure(not any(scope.startswith("reports:") for scope in principal["scopes"]), "collector_report_authority")
    validate_event_example(load(FIXTURES / "ingest-request.json"), schema)
    validate_event_example(load(FIXTURES / "correction-request.json")["replacement"], schema)
    snapshots = load(FIXTURES / "report-snapshots.json")
    requests = load(FIXTURES / "report-requests.json")
    for kind, snapshot in snapshots.items():
        ensure(snapshot["assessment"] is None and snapshot["share_url"] is None, "unimplemented_assessment_or_live_share")
        ensure(snapshot["environment"] == "simulation", "report_environment")
        ensure(set(snapshot["gap_ids"]) == set(gaps), "report_gap_omission")
        ensure(set(snapshot["included_event_ids"]) <= set(events), "unknown_report_event")
        ensure(dt(snapshot["issued_at"]) < dt(snapshot["expires_at"]), "report_time")
        if kind == "full":
            ensure(set(snapshot["included_event_ids"]) == set(events), "full_report_omission")
            ensure(not requests[kind]["scope"]["selected_event_ids"], "full_selective_filter")
        else:
            ensure(snapshot["included_event_ids"] == requests[kind]["scope"]["selected_event_ids"], "partial_selection")
            ensure("일부 자료만" in snapshot["scope_notice"], "partial_notice")
    boundaries = load(FIXTURES / "share-boundaries.json")
    for case in boundaries["cases"]:
        expected = (404 if not case["secret_valid"] else
                    410 if case["revoked"] or dt(case["now"]) >= dt(boundaries["expires_at"]) else
                    409 if case["source_changed"] else 200)
        ensure(case["status"] == expected, "share_boundary")
    with (PLAN / "acceptance-matrix.csv").open(newline="") as stream:
        acceptance = list(csv.DictReader(stream))
    ensure(len({row["case_id"] for row in acceptance}) == len(acceptance), "duplicate_case_id")
    ensure(all(row["execution_status"] == "NOT_RUN" for row in acceptance), "unexecuted_checks_claimed_passed")
    ensure(len({route["id"] for route in contract["routes"]}) == len(contract["routes"]), "duplicate_route_id")
    for route in contract["routes"]:
        if "request_schema" in route:
            ensure((CONTRACTS / route["request_schema"]).is_file(), "missing_schema")
    return {"kind": "preparation_consistency_only", "status": "passed",
            "vehicle_count": len(vehicles), "principal_count": len(seed["principals"]),
            "event_count": len(events), "gap_count": len(gaps), "correction_count": len(seed["corrections"]),
            "route_count": len(contract["routes"]), "share_boundary_examples_checked": len(boundaries["cases"]),
            "implementation_acceptance_cases": len(acceptance), "implementation_cases_executed": 0,
            "not_tested": ["JSON Schema validator conformance", "HTTP", "PostgreSQL", "DB transactions",
                           "Android outbox", "real credentials", "share issuance", "browser behavior"]}


if __name__ == "__main__":
    result = run()
    (FIXTURES / "preparation-validation.json").write_text(json.dumps(result, ensure_ascii=False, indent=2)+"\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))
