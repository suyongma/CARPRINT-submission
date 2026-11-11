-- 합성 계정/선택 연동은 차량 수집 주체와 독립이다. 외부 인증 제공자가 아니다.
CREATE SCHEMA personal;
CREATE TABLE personal.account (
 account_id text PRIMARY KEY, display_name text NOT NULL, profile jsonb NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0)
);
CREATE TABLE personal.vehicle_layout (
 vehicle_ref uuid PRIMARY KEY REFERENCES identity.vehicle ON DELETE CASCADE,
 seats text[] NOT NULL
);
CREATE TABLE personal.connection_request (
 request_id uuid PRIMARY KEY, principal_id uuid NOT NULL REFERENCES identity.principal ON DELETE CASCADE,
 vehicle_ref uuid NOT NULL REFERENCES identity.vehicle ON DELETE CASCADE,
 scopes text[] NOT NULL, code text NOT NULL, expires_at timestamptz NOT NULL,
 consumed_at timestamptz, mode text NOT NULL CHECK(mode IN ('temporary','trip'))
);
CREATE TABLE personal.session (
 session_id uuid PRIMARY KEY, request_id uuid NOT NULL UNIQUE REFERENCES personal.connection_request ON DELETE CASCADE,
 principal_id uuid NOT NULL REFERENCES identity.principal ON DELETE CASCADE,
 vehicle_ref uuid NOT NULL REFERENCES identity.vehicle ON DELETE CASCADE,
 account_id text NOT NULL REFERENCES personal.account,
 token_hash text NOT NULL UNIQUE, scopes text[] NOT NULL,
 seat text, expires_at timestamptz NOT NULL, ended_at timestamptz,
 revision integer NOT NULL DEFAULT 1
);
CREATE TABLE personal.application_preview (
 preview_id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES personal.session ON DELETE CASCADE,
 session_revision integer NOT NULL, profile_revision integer NOT NULL,
 expires_at timestamptz NOT NULL, items jsonb NOT NULL, result jsonb,
 confirmed_at timestamptz
);
CREATE TABLE trust.care_example (
 example_id text PRIMARY KEY, label text NOT NULL, input jsonb NOT NULL
);
CREATE TABLE trust.care_assessment (
 assessment_id uuid PRIMARY KEY, vehicle_ref uuid NOT NULL REFERENCES identity.vehicle ON DELETE CASCADE,
 input_digest text NOT NULL, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL,
 UNIQUE(vehicle_ref,input_digest)
);
REVOKE ALL ON SCHEMA personal FROM PUBLIC;
GRANT USAGE ON SCHEMA personal TO carprint_api;
GRANT SELECT ON ALL TABLES IN SCHEMA personal TO carprint_api;
GRANT INSERT,UPDATE ON personal.connection_request,personal.session,personal.application_preview TO carprint_api;
GRANT SELECT ON trust.care_example,trust.care_assessment TO carprint_api;
GRANT INSERT ON trust.care_assessment TO carprint_api;

GRANT UPDATE ON personal.account TO carprint_api;
GRANT DELETE ON personal.application_preview TO carprint_api;
