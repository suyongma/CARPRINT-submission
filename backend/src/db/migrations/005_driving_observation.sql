CREATE TABLE trust.driving_observation (
 observation_id uuid PRIMARY KEY,
 principal_id uuid NOT NULL REFERENCES identity.principal,
 vehicle_ref uuid NOT NULL REFERENCES identity.vehicle,
 source_ref uuid NOT NULL REFERENCES trust.source,
 issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 input_hash text, samples jsonb, assessment jsonb, completed_at timestamptz,
 CHECK((completed_at IS NULL AND input_hash IS NULL AND samples IS NULL AND assessment IS NULL) OR
       (completed_at IS NOT NULL AND input_hash IS NOT NULL AND samples IS NOT NULL AND assessment IS NOT NULL))
);
GRANT SELECT,INSERT,UPDATE ON trust.driving_observation TO carprint_api;
CREATE FUNCTION trust.freeze_driving_observation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.completed_at IS NOT NULL OR ROW(OLD.observation_id,OLD.principal_id,OLD.vehicle_ref,OLD.source_ref,OLD.issued_at,OLD.expires_at)
   IS DISTINCT FROM ROW(NEW.observation_id,NEW.principal_id,NEW.vehicle_ref,NEW.source_ref,NEW.issued_at,NEW.expires_at)
 THEN RAISE EXCEPTION 'immutable_driving_observation' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER driving_observation_immutable BEFORE UPDATE ON trust.driving_observation
 FOR EACH ROW EXECUTE FUNCTION trust.freeze_driving_observation();
REVOKE ALL ON FUNCTION trust.freeze_driving_observation() FROM PUBLIC;
