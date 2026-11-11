-- 실제 자격기관 인증과 구분되는 로컬 정비사 자격. 자기 등록/갱신 API는 없다.
CREATE TABLE identity.mechanic_credential (
 principal_id uuid PRIMARY KEY REFERENCES identity.principal,
 credential_ref text NOT NULL UNIQUE,
 verification_kind text NOT NULL CHECK(verification_kind='local_demo'),
 verified_by text NOT NULL,
 valid_from timestamptz NOT NULL,
 valid_until timestamptz NOT NULL CHECK(valid_until>valid_from),
 revoked_at timestamptz
);
GRANT SELECT ON identity.mechanic_credential TO carprint_api;
INSERT INTO identity.mechanic_credential
 SELECT principal_id,'demo-mechanic:'||principal_id,'local_demo','CARPRINT fixture authority',
 '2026-01-01Z'::timestamptz,'2027-01-01Z'::timestamptz,NULL
 FROM identity.principal WHERE role='maintenance_issuer';

-- API DB 자격이 직접 INSERT해도 7일/정비사 조건을 우회하지 못하게 한다.
-- DB 소유자의 오프라인 합성 fixture import는 별도 신뢰 경계다.
CREATE FUNCTION trust.guard_maintenance_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE anchor timestamptz;
BEGIN
 IF current_user <> 'carprint_api' THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='vehicle_event' THEN
  IF NEW.event_type NOT IN ('maintenance.completed','maintenance.corrected','issue.resolved') THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM identity.mechanic_credential c JOIN identity.principal p USING(principal_id)
    WHERE c.principal_id=NEW.principal_id AND p.role='maintenance_issuer' AND p.revoked_at IS NULL
    AND c.revoked_at IS NULL AND c.valid_from<=statement_timestamp() AND c.valid_until>statement_timestamp()) THEN
    RAISE EXCEPTION 'active_mechanic_credential_required' USING ERRCODE='42501';
  END IF;
  IF NEW.occurred_at IS NULL OR NEW.occurred_at<statement_timestamp()-interval '7 days'
    OR NEW.observed_at<NEW.occurred_at OR NEW.observed_at>statement_timestamp() THEN
    RAISE EXCEPTION 'maintenance_window_closed' USING ERRCODE='42501';
  END IF;
 ELSE
  WITH RECURSIVE ancestors AS (
   SELECT event_id,occurred_at,received_at FROM trust.vehicle_event WHERE event_id=NEW.original_event_id
   UNION SELECT e.event_id,e.occurred_at,e.received_at FROM ancestors a
   JOIN trust.correction c ON c.new_event_id=a.event_id JOIN trust.vehicle_event e ON e.event_id=c.original_event_id
  ) SELECT min(least(occurred_at,received_at)) INTO anchor FROM ancestors;
  IF anchor IS NULL OR anchor<statement_timestamp()-interval '7 days' THEN
    RAISE EXCEPTION 'maintenance_original_window_closed' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER maintenance_insert_guard BEFORE INSERT ON trust.vehicle_event
 FOR EACH ROW EXECUTE FUNCTION trust.guard_maintenance_insert();
CREATE TRIGGER maintenance_correction_guard BEFORE INSERT ON trust.correction
 FOR EACH ROW EXECUTE FUNCTION trust.guard_maintenance_insert();
REVOKE ALL ON FUNCTION trust.guard_maintenance_insert() FROM PUBLIC;
