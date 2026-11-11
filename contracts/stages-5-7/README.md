# 5~7단계 데이터·HTTP 계약

로컬 API가 사용하는 요청 schema와 경로 요약이다. `backend/src/app.ts`에서 schema를 등록하고 각 기능의 `routes.ts`가 실제 입력·응답을 구성한다. OpenAPI 전체 문서나 운영 API 보장은 아니다.

| 파일 | 역할 |
| --- | --- |
| [http-contract.json](http-contract.json) | 수신·이력·정정·리포트·공유 방문 경로와 주요 규칙 |
| [event-request.schema.json](event-request.schema.json) | 합성/에뮬레이터 관측 요청 Draft 7 JSON Schema |
| [report-request.schema.json](report-request.schema.json) | 전체/일부 리포트 발행 요청 Draft 7 JSON Schema |
| [data-model.csv](data-model.csv) | **구현 전** DB 설계 비교용 표 |
| [실제 SQL](../../backend/src/db/migrations/001_initial.sql) | 실제 15개 테이블·키·쓰기 권한·근거 버전 트리거 |
| [서버 안내](../../backend/README.md) | 처리 흐름과 로컬 실행 방법 |

CSV의 `trust.verification`은 별도 구현하지 않았다. 현재는 `trust.source.status`로 출처 상태를 표현한다. 대신 보고서 방문 세션용 `ops.report_session`을 추가했다. 컬럼명과 제약은 SQL이 기준이다.

## 변환과 결속

- `demo-vehicle-a` 같은 fixture 별칭은 재현 가능한 합성 UUID로 변환한다. 실제 VIN·개인 식별자가 아니다.
- `odometer_observed`는 `odometer.observed`, `payload.kilometers`는 `payload.value` + `unit: km`로 명시적으로 변환한다.
- `payload_version`은 정수 1이다. 수신 시각·순번·차량은 서버가 인증·직렬화에 따라 부여한다. 기존 fixture의 값은 현재 수신 증거로 복사하지 않는다.
- SDK 콜백 시각은 `observed_at`이다. 차량 측정 시각이 없으면 `occurred_at: null`로 유지한다.
- 정정은 새 이벤트와 연결을 추가한다. 원본 행에 superseded 상태를 덮어쓰지 않는다.
- 합성 점수는 가져오지 않는다. 7단계 리포트의 `assessment`는 `null`이다.
- `simulation`과 `pleos_emulator`는 차량·출처·수집 자격이 다르다. 실제 차량 환경은 현 schema에서 받지 않는다.
- 선택형 시연 사용자·선호는 개발 초기화 예제다. 실제 개인 로그인·소유권 검증과 별개다.

## 권한과 재시도

이벤트 본문은 차량 ID를 받지 않는다. 차량·환경은 인증 주체에 결속하고 출처·수집 항목도 대조한다. 누적 거리 수집자는 정비 기록이나 거래 리포트를 만들 수 없다. 현재 정비 정정은 원 발급자만 수행하며 최신 정정 head를 `If-Match`로 확인한다. 별도의 검토자 승인 흐름은 아직 없다.

같은 `Idempotency-Key`와 본문은 같은 기록/영수증을 반환한다. 같은 키의 다른 본문은 409다. 본문의 다른 주체·환경·차량, 추가 개인정보 필드는 거부한다. Fastify 검증은 `removeAdditional: false`, `coerceTypes: false`, `useDefaults: false`이며 입력 오류는 422로 변환한다. 요청 schema만으로 인증·트랜잭션·도메인 권한을 대신하지 않는다.

## 공유 방문

`GET /r/{opaque_id}`는 비밀 없는 화면 껍데기를 반환한다. fragment의 비밀을 같은 출처의 `POST /v1/report-views`로 교환하고 주소창에서 지운다. 이후 보고서 전용 HttpOnly 방문 쿠키로 읽는다. 관리자 bearer와 방문 세션은 서로 대체할 수 없다.

읽을 때마다 만료·취소·근거 버전을 검사한다. 만료/취소는 410, 근거 변경은 409, 잘못된 ID/비밀/세션은 404다. 서버 시각을 기준으로 하며 이전 방문 세션에도 적용된다. 로컬 브라우저에서 검증했으며 외부 HTTPS 배포는 후속 범위다.

초안 생성기 `scripts/prepare_stage7_handoff.py`는 구현 상태의 계약을 감지하면 중단한다. 실제 schema를 과거 초안으로 덮어쓰지 않도록 이 차단을 유지한다. 계약 변경은 서버·클라이언트·실제 DB 검사와 함께 명시적으로 진행한다.
