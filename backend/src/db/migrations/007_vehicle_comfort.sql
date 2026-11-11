-- 차종별 합성 capability만 저장. SDK 실측 지원 범위와 혼용하지 않는다.
CREATE TABLE personal.comfort_capability (
 vehicle_ref uuid PRIMARY KEY REFERENCES identity.vehicle,
 capability jsonb NOT NULL
);
CREATE TABLE personal.vehicle_comfort (
 account_id text NOT NULL REFERENCES personal.account,
 vehicle_ref uuid NOT NULL REFERENCES identity.vehicle,
 seat text NOT NULL,
 values jsonb NOT NULL DEFAULT '{}',
 applied jsonb NOT NULL DEFAULT '[]',
 PRIMARY KEY(account_id,vehicle_ref,seat)
);
CREATE TABLE personal.comfort_preview (
 preview_id uuid PRIMARY KEY,
 session_id uuid NOT NULL REFERENCES personal.session,
 session_revision integer NOT NULL,
 profile_revision integer NOT NULL,
 capability_version text NOT NULL,
 expires_at timestamptz NOT NULL,
 items jsonb NOT NULL,
 result jsonb,
 confirmed_at timestamptz
);
CREATE TABLE personal.passenger_preset (
 preset_id uuid PRIMARY KEY,
 owner_account_id text NOT NULL REFERENCES personal.account,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 40),
 values jsonb NOT NULL,
 UNIQUE(owner_account_id,name)
);
GRANT SELECT ON personal.comfort_capability TO carprint_api;
GRANT SELECT,INSERT,UPDATE,DELETE ON personal.vehicle_comfort,personal.comfort_preview,personal.passenger_preset TO carprint_api;
