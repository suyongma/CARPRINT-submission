-- 개인 평가 원장은 차량 이력/프로필과 별개다. 로그인/설정 저장/세션 종료로 수정되지 않는다.
CREATE TABLE personal.score_observation (
 observation_id text PRIMARY KEY,
 account_id text NOT NULL REFERENCES personal.account,
 vehicle_ref uuid NOT NULL REFERENCES identity.vehicle,
 category text NOT NULL CHECK(category IN ('driving','care')),
 responsibility text NOT NULL,
 CHECK ((category='driving' AND responsibility='driver') OR
        (category='care' AND responsibility='care_responsible'))
);
CREATE INDEX score_observation_account ON personal.score_observation(account_id);
CREATE TABLE personal.score_revision (
 observation_id text NOT NULL REFERENCES personal.score_observation,
 revision integer NOT NULL CHECK(revision>0),
 occurred_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 source text NOT NULL CHECK(source='simulation'),
 attribution_confirmed boolean NOT NULL,
 revoked boolean NOT NULL DEFAULT false,
 metrics jsonb NOT NULL,
 PRIMARY KEY(observation_id,revision)
);
-- 수집 검증 경계가 없는 시제품: 런타임 API는 읽기만. 합성 자료는 소유자 seed가 준비한다.
GRANT SELECT ON personal.score_observation,personal.score_revision TO carprint_api;
