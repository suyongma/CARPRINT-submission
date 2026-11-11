CREATE SCHEMA identity;
CREATE SCHEMA trust;
CREATE SCHEMA ops;
CREATE TABLE identity.vehicle (
 vehicle_ref uuid PRIMARY KEY, alias text NOT NULL,
 environment text NOT NULL CHECK(environment IN ('simulation','pleos_emulator')),
 UNIQUE(vehicle_ref,environment)
);
CREATE TABLE identity.principal (
 principal_id uuid PRIMARY KEY, vehicle_ref uuid NOT NULL REFERENCES identity.vehicle,
 role text NOT NULL, token_hash text NOT NULL UNIQUE, revoked_at timestamptz,
 UNIQUE(principal_id,vehicle_ref)
);
CREATE TABLE identity.authorization_grant (
 principal_id uuid PRIMARY KEY REFERENCES identity.principal,
 scopes text[] NOT NULL, valid_until timestamptz NOT NULL
);
CREATE TABLE trust.source (
 source_ref uuid PRIMARY KEY, vehicle_ref uuid NOT NULL, environment text NOT NULL,
 principal_id uuid NOT NULL, source_kind text NOT NULL,
 status text NOT NULL DEFAULT 'demo_unverified' CHECK(status IN ('demo_unverified','revoked')),
 FOREIGN KEY(vehicle_ref,environment) REFERENCES identity.vehicle(vehicle_ref,environment),
 FOREIGN KEY(principal_id,vehicle_ref) REFERENCES identity.principal(principal_id,vehicle_ref),
 UNIQUE(source_ref,vehicle_ref,environment)
);
CREATE TABLE ops.vehicle_stream (
 vehicle_ref uuid PRIMARY KEY REFERENCES identity.vehicle,
 last_seq bigint NOT NULL DEFAULT 0, head_hash text NOT NULL DEFAULT '',
 evidence_revision bigint NOT NULL DEFAULT 0
);
CREATE TABLE trust.vehicle_event (
 event_id uuid PRIMARY KEY, vehicle_ref uuid NOT NULL, environment text NOT NULL,
 source_ref uuid NOT NULL, principal_id uuid NOT NULL,
 event_type text NOT NULL, occurred_at timestamptz, observed_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL, server_seq bigint NOT NULL CHECK(server_seq>0),
 request jsonb NOT NULL, review_flags text[] NOT NULL DEFAULT '{}',
 FOREIGN KEY(source_ref,vehicle_ref,environment) REFERENCES trust.source(source_ref,vehicle_ref,environment),
 FOREIGN KEY(principal_id,vehicle_ref) REFERENCES identity.principal(principal_id,vehicle_ref),
 UNIQUE(vehicle_ref,server_seq), UNIQUE(event_id,vehicle_ref,environment)
);
CREATE TABLE trust.ingest_receipt (
 event_id uuid PRIMARY KEY REFERENCES trust.vehicle_event, principal_id uuid NOT NULL REFERENCES identity.principal,
 idempotency_key text NOT NULL, request_hash text NOT NULL, receipt jsonb NOT NULL,
 UNIQUE(principal_id,idempotency_key)
);
CREATE TABLE trust.correction (
 original_event_id uuid PRIMARY KEY, new_event_id uuid NOT NULL UNIQUE,
 vehicle_ref uuid NOT NULL, environment text NOT NULL, authority_ref uuid NOT NULL,
 reason_code text NOT NULL CHECK(reason_code='performed_date_corrected'),
 FOREIGN KEY(original_event_id,vehicle_ref,environment) REFERENCES trust.vehicle_event(event_id,vehicle_ref,environment),
 FOREIGN KEY(new_event_id,vehicle_ref,environment) REFERENCES trust.vehicle_event(event_id,vehicle_ref,environment),
 CHECK(original_event_id<>new_event_id)
);
CREATE TABLE trust.collection_gap (
 gap_id uuid PRIMARY KEY, vehicle_ref uuid NOT NULL, environment text NOT NULL,
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 scope text[] NOT NULL, reason text NOT NULL, CHECK(starts_at<=ends_at),
 FOREIGN KEY(vehicle_ref,environment) REFERENCES identity.vehicle(vehicle_ref,environment)
);
CREATE TABLE trust.report (
 report_id uuid PRIMARY KEY, vehicle_ref uuid NOT NULL REFERENCES identity.vehicle,
 principal_id uuid NOT NULL REFERENCES identity.principal,
 idempotency_key text NOT NULL, request_hash text NOT NULL,
 snapshot jsonb NOT NULL, snapshot_hash text NOT NULL,
 evidence_revision bigint NOT NULL, issued_at timestamptz NOT NULL,
 UNIQUE(principal_id,idempotency_key)
);
CREATE TABLE trust.report_share (
 report_id uuid PRIMARY KEY REFERENCES trust.report, secret_hash text NOT NULL,
 expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE TABLE ops.report_session (
 session_hash text PRIMARY KEY, report_id uuid NOT NULL REFERENCES trust.report,
 expires_at timestamptz NOT NULL
);
CREATE TABLE ops.idempotency_response (
 report_id uuid PRIMARY KEY REFERENCES trust.report,
 encrypted_response text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE ops.delivery_outbox (
 event_id uuid PRIMARY KEY REFERENCES trust.vehicle_event,
 topic text NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE ops.audit_event (
 audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 vehicle_ref uuid NOT NULL REFERENCES identity.vehicle, action text NOT NULL,
 object_id uuid NOT NULL, created_at timestamptz NOT NULL
);
CREATE INDEX timeline_sequence ON trust.vehicle_event(vehicle_ref,server_seq DESC);
CREATE INDEX session_expiry ON ops.report_session(expires_at);

-- 조회할 때 현재 근거 버전을 비교한다. 원본 수정 없이 정정/출처/공백 변경과 동기화한다.
CREATE FUNCTION ops.bump_evidence_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ops AS $$
BEGIN
 UPDATE ops.vehicle_stream SET evidence_revision=evidence_revision+1
 WHERE vehicle_ref=COALESCE(NEW.vehicle_ref,OLD.vehicle_ref);
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER correction_revision AFTER INSERT ON trust.correction FOR EACH ROW EXECUTE FUNCTION ops.bump_evidence_revision();
CREATE TRIGGER gap_revision AFTER INSERT OR UPDATE OR DELETE ON trust.collection_gap FOR EACH ROW EXECUTE FUNCTION ops.bump_evidence_revision();
CREATE TRIGGER source_revision AFTER UPDATE OF status ON trust.source FOR EACH ROW EXECUTE FUNCTION ops.bump_evidence_revision();
REVOKE ALL ON FUNCTION ops.bump_evidence_revision() FROM PUBLIC;
REVOKE ALL ON SCHEMA identity,trust,ops FROM PUBLIC;
GRANT USAGE ON SCHEMA identity,trust,ops TO carprint_api;
GRANT SELECT ON ALL TABLES IN SCHEMA identity,trust,ops TO carprint_api;
GRANT INSERT ON trust.vehicle_event,trust.ingest_receipt,trust.correction,trust.report,trust.report_share,
 ops.report_session,ops.idempotency_response,ops.delivery_outbox,ops.audit_event TO carprint_api;
GRANT UPDATE ON ops.vehicle_stream,trust.report_share TO carprint_api;
GRANT DELETE ON ops.report_session,ops.idempotency_response TO carprint_api;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA ops TO carprint_api;
