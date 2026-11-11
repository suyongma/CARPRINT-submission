"""CARPRINT D0.1 synthetic policy reference. NOT Pleos, production security, or a server.
Run: python3 CARPRINT_reference_checks.py --output CARPRINT_실행검증.json
All fixtures are synthetic. No network or vehicle API calls.
"""
import argparse
import copy
import hashlib
import json
import platform
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP


class Reject(ValueError):
    pass


def digest(obj):
    # Stable for these JSON-only fixtures; production must select canonical JSON standard.
    return hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


class Ledger:
    def __init__(self):
        self.rows, self.keys, self.gaps = [], {}, []

    def append(self, principal_vehicle, key, payload, correction_of=None):
        if payload["vehicle"] != principal_vehicle:
            raise Reject("vehicle_binding")
        if set(payload) - {"vehicle", "type", "value", "unit", "source", "environment"}:
            raise Reject("unknown_or_private_field")
        if payload.get("environment") != "simulation":
            raise Reject("reference_is_simulation_only")
        body = {"payload": copy.deepcopy(payload), "correction_of": correction_of}
        key_scope = (principal_vehicle, key)
        if key_scope in self.keys:
            old = self.keys[key_scope]
            if old["request_digest"] != digest(body):
                raise Reject("idempotency_conflict")
            return copy.deepcopy(old)
        if correction_of is not None:
            target = next((r for r in self.rows if r["id"] == correction_of), None)
            if not target or target["payload"]["vehicle"] != principal_vehicle:
                raise Reject("correction_scope")
        seq = len(self.rows) + 1  # Single global demo ledger; production uses per-vehicle sequence.
        prev = self.rows[-1]["hash"] if self.rows else "0" * 64
        row = {"id": f"evt-{seq}", "seq": seq, "prev": prev,
               "payload": body["payload"], "correction_of": correction_of,
               "request_digest": digest(body)}
        row["hash"] = digest(row)
        self.rows.append(row)
        self.keys[key_scope] = copy.deepcopy(row)
        return copy.deepcopy(row)

    def verify(self):
        prev = "0" * 64
        for i, row in enumerate(self.rows, 1):
            raw = {k: v for k, v in row.items() if k != "hash"}
            if row["prev"] != prev or row["seq"] != i or row["hash"] != digest(raw):
                return False
            prev = row["hash"]
        return True

    def report(self, vehicle, kind="full", selected=None, score=None):
        events = [copy.deepcopy(r) for r in self.rows if r["payload"]["vehicle"] == vehicle]
        gaps = [copy.deepcopy(g) for g in self.gaps if g["vehicle"] == vehicle]
        if kind == "partial":
            events = [r for r in events if r["id"] in (selected or [])]
            score = None
        elif kind != "full":
            raise Reject("invalid_report_kind")
        # Full ignores requested selective filters. Both retain scope notice and gap context.
        return {"kind": kind, "events": events, "gaps": gaps, "score": score,
                "environment": "simulation", "limitation": "not_accident_or_safety_certification"}


def assess(p, c, *, eligible=True, gap=False, sources_valid=True):
    if not eligible or gap or not sources_valid or not p or not c or len(p) + len(c) < 3:
        return None
    all_values = p + c
    if any(x is None or not 0 <= x <= 1 for x in all_values):
        return None
    P = sum(Decimal(str(x)) for x in p) / len(p)
    C = sum(Decimal(str(x)) for x in c) / len(c)
    return int((100 * (Decimal(".75") * P + Decimal(".25") * C)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def choose_profile(actual=None, compatible=None, common=None, other=None):
    if actual is not None:
        return "confirmed_vehicle", actual
    if compatible is not None:
        return "confirmed_compatible", compatible
    if common is not None:
        return "logical_common", common
    if other is not None:
        return "manual_fit_required", None
    return "keep_current", None


def command_gate(*, supported, permission, parked, fresh, consent, safety_known, readback=False):
    for ok, reason in [(supported, "unsupported"), (permission, "permission_denied"),
                       (parked, "driving_restricted"), (fresh, "stale_capability"),
                       (consent, "consent_required"), (safety_known, "safety_unknown")]:
        if not ok:
            return reason
    return "observed_success" if readback else "accepted_unconfirmed"


def sync(profile, expected_revision, change, explicit_save):
    if profile["revision"] != expected_revision:
        raise Reject("revision_conflict")
    if not explicit_save:
        return copy.deepcopy(profile)
    return {"revision": profile["revision"] + 1, "value": change}


def read_private(owner, actor, value):
    if owner != actor:
        raise Reject("not_found")
    return value


def end_session(state, online):
    state["token"] = None
    state["private_cache"].clear()
    state["pending_profile_write"] = None
    state["status"] = "ended" if online else "local_cleaned_remote_pending"
    return state


def visible_report(now, expiry, revoked):
    return not revoked and now < expiry


def payload(vehicle="demo-A", value=42500):
    return {"vehicle": vehicle, "type": "odometer", "value": value, "unit": "km",
            "source": "demo-device", "environment": "simulation"}


def rejects(fn, expected):
    try:
        fn()
    except Reject as ex:
        assert str(ex) == expected
    else:
        raise AssertionError("expected rejection: " + expected)


def run():
    results = []

    def check(test_id, name, fn):
        try:
            fn()
            results.append({"id": test_id, "name": name, "passed": True})
        except Exception as ex:
            results.append({"id": test_id, "name": name, "passed": False, "error": repr(ex)})

    def eq(a, b):
        assert a == b, (a, b)

    l = Ledger()
    check("L01", "reject another vehicle claim", lambda: rejects(lambda: l.append("demo-A", "1", payload("demo-B")), "vehicle_binding"))
    first = l.append("demo-A", "ok", payload())
    check("L02", "idempotent exact retransmission", lambda: eq(l.append("demo-A", "ok", payload()), first))
    check("L03", "no duplicate count after retry", lambda: eq(len(l.rows), 1))
    check("L04", "same key changed body rejected", lambda: rejects(lambda: l.append("demo-A", "ok", payload(value=10)), "idempotency_conflict"))
    check("L05", "personal address cannot enter trust payload", lambda: rejects(lambda: l.append("demo-A", "p", dict(payload(), home="synthetic address")), "unknown_or_private_field"))
    corrected = l.append("demo-A", "correct", payload(value=42510), first["id"])
    check("L06", "correction retains original", lambda: eq((len(l.rows), l.rows[0]["payload"]["value"], corrected["correction_of"]), (2, 42500, first["id"])))
    check("L07", "cross vehicle correction denied", lambda: rejects(lambda: l.append("demo-B", "x", payload("demo-B"), first["id"]), "correction_scope"))
    check("L08", "chain valid before tamper", lambda: eq(l.verify(), True))
    bad = copy.deepcopy(l); bad.rows[0]["payload"]["value"] = 1
    check("L09", "silent record edit detected", lambda: eq(bad.verify(), False))
    bad2 = copy.deepcopy(l); bad2.rows.pop(0)
    check("L10", "missing preceding event detected", lambda: eq(bad2.verify(), False))
    l.gaps.append({"vehicle": "demo-A", "reason": "unknown", "scope": ["odometer"]})
    check("L11", "full report retains gap and correction despite selected filter", lambda: eq((len(l.report("demo-A", selected=[first["id"]])["events"]), len(l.report("demo-A")["gaps"])), (2, 1)))
    check("L12", "partial report cannot show composite score", lambda: eq(l.report("demo-A", "partial", [first["id"]], 95)["score"], None))
    check("L13", "synthetic 95 formula", lambda: eq(assess([1, 1, .8], [1]), 95))
    check("L14", "empty history not 100", lambda: eq(assess([], []), None))
    check("L15", "unknown item withholds total", lambda: eq(assess([1, None], [1]), None))
    check("L16", "no corrective observation withholds total", lambda: eq(assess([1, 1, 1], []), None))
    check("L17", "essential gap withholds score", lambda: eq(assess([1, 1], [1], gap=True), None))
    check("L18", "revoked evidence withholds score", lambda: eq(assess([1, 1], [1], sources_valid=False), None))
    check("L19", "target confirmed seat preserved", lambda: eq(choose_profile(actual=40, other=80), ("confirmed_vehicle", 40)))
    check("L20", "unfamiliar seat requires manual fit", lambda: eq(choose_profile(other=80), ("manual_fit_required", None)))
    base = dict(supported=True, permission=True, parked=True, fresh=True, consent=True, safety_known=True)
    check("L21", "driving blocks seat", lambda: eq(command_gate(**dict(base, parked=False)), "driving_restricted"))
    check("L22", "permission denial not success", lambda: eq(command_gate(**dict(base, permission=False)), "permission_denied"))
    check("L23", "unsupported not success", lambda: eq(command_gate(**dict(base, supported=False)), "unsupported"))
    check("L24", "stale capability blocks apply", lambda: eq(command_gate(**dict(base, fresh=False)), "stale_capability"))
    check("L25", "accepted command not observed success", lambda: eq(command_gate(**base), "accepted_unconfirmed"))
    check("L26", "profile revision collision", lambda: rejects(lambda: sync({"revision": 2, "value": 40}, 1, 80, True), "revision_conflict"))
    check("L27", "temporary change not auto saved", lambda: eq(sync({"revision": 2, "value": 40}, 2, 80, False), {"revision": 2, "value": 40}))
    check("L28", "private profile cross account denied", lambda: rejects(lambda: read_private("A", "B", "secret"), "not_found"))
    state = {"token": "synthetic-token", "private_cache": ["synthetic-place"], "pending_profile_write": "change", "trust_events": l.rows[:]}
    end_session(state, False)
    check("L29", "offline end purges local personal data and keeps trust", lambda: eq((state["token"], state["private_cache"], len(state["trust_events"]), state["status"]), (None, [], 2, "local_cleaned_remote_pending")))
    check("L30", "repeat session end idempotent", lambda: eq(end_session(state, True)["status"], "ended"))
    check("L31", "expired report inaccessible at boundary", lambda: eq(visible_report(10, 10, False), False))
    check("L32", "revoked report inaccessible", lambda: eq(visible_report(1, 10, True), False))
    check("L33", "synthetic origin retained in report", lambda: eq(l.report("demo-A")["environment"], "simulation"))
    check("L34", "reference refuses production origin", lambda: rejects(lambda: l.append("demo-A", "real", dict(payload(), environment="production")), "reference_is_simulation_only"))
    return {"executed_at": datetime.now(timezone.utc).isoformat(), "environment": platform.platform(),
            "python": platform.python_version(), "kind": "synthetic_local_policy_reference",
            "not_tested": ["Pleos SDK", "Apple Silicon AVD", "vehicle control", "PostgreSQL", "production auth", "KMS signatures", "OS data deletion", "app build"],
            "passed": sum(x["passed"] for x in results), "total": len(results), "results": results}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(); parser.add_argument("--output", default="CARPRINT_실행검증.json")
    args = parser.parse_args(); result = run()
    with open(args.output, "w", encoding="utf8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(json.dumps({k: result[k] for k in ("kind", "passed", "total")}, ensure_ascii=False))
    raise SystemExit(0 if result["passed"] == result["total"] else 1)
