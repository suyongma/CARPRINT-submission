# CARPRINT 로컬 API

TypeScript/Fastify + PostgreSQL. 로컬 시제품 범위의 차량 수집 권한과 리포트 관리 권한을 분리한다. 개인 로그인 서버는 아니다.

## 처음 실행

프로젝트 루트에서 `sh scripts/setup-local.sh`, 이후 `cd backend && npm run dev`.
수동으로는 `npm ci` → `node scripts/bootstrap-local.mjs` → `docker compose --env-file .env up -d --wait` → `npm run migrate` → `npm run seed` → `npm run demo:contexts` 순서다.

`.env.example`은 항목 설명이며 실제 비밀번호가 아니다. `.env`, `.local/receipt-private.pem`, `.local/credentials.json`은 새로 생성한다. seed는 12개 합성 이벤트·정정 1개·공백 1개를 가져오되 **서버 수신 시각과 서명은 import 때 실제 생성**한다. 기존 DB가 있으면 덮어쓰지 않는다. 부분 seed 실패나 로컬 자격 파일 손실은 명시적으로 중단하며 기존 자격을 조용히 교체하지 않는다.

- 관리용 DB 역할 `carprint_owner`: migration/합성 import에만 사용.
- 실행 역할 `carprint_api`: 원본 이벤트·영수증 UPDATE/DELETE 권한 없음.
- 시연 토큰: 30일, 차량별 scope. 갱신·운영 발급 자동화는 아직 없음.
- API/DB 포트가 겹치면 `.env`의 URL/PORT, Compose `DB_PORT`, 기기 provisioning `--api-url`을 함께 바꾼다. 다른 프로세스를 종료하지 않는다.
- 일시 중지: API 터미널 Ctrl+C; DB는 `docker compose --env-file .env stop`. `down -v`는 데이터 삭제이므로 일상 종료에 쓰지 않는다.

## 처리 흐름

`app.ts`가 `PostgresAuthorization`, `PostgresVehicleEventStore`, `Ed25519ReceiptSigner`, `PostgresReportStore`를 조립한다. `routes.ts`는 입력/응답, Service는 scope·기능 규칙, Store는 잠금과 원자성을 소유한다. SQL 클라이언트를 업무 인터페이스에 전달하지 않는다.

수신은 차량 스트림 잠금 → 멱등 비교 → 출처/정정 검증 → 이벤트·서명 영수증·순번·outbox·감사 기록을 한 트랜잭션으로 커밋한다. SDK 실패 값 0 대체를 하지 않는다. 0 자체는 유효한 관측이다. 재시도 가능한 네트워크/서버 오류와 영구 입력/권한 오류를 구분한다. DB deadlock/serialization 충돌은 409로 반환하며 자동 반복하지 않는다.

서명은 RFC 8785 canonical JSON + SHA-256 체인 + Ed25519다. API 테스트에서 실제 공개키로 검증한다. Android는 응답의 이벤트/차량/환경 결속만 확인하며 별도 Ed25519 검증 클라이언트는 아직 없다. 개발 키는 소스와 분리되며 운영 키 회전·외부 체크포인트는 후속 범위다.

리포트는 기간 내 전체/선택 범위와 연결 정정·공백을 고정한다. 일부 리포트에도 맥락에 필요한 정정 원본/후속 기록을 포함할 수 있다. 모든 리포트의 관리 점수는 `null`. 공유 비밀은 해시, 응답 재전송용 링크는 AES-GCM 암호문으로 10분 동안 재사용할 수 있다. 만료 캐시·방문 세션의 물리 삭제는 후속 발행 때 수행하며 주기적 정리 worker는 아직 없다. 방문 세션은 15분 이내이며 매 조회 시 만료·취소·근거 버전을 재검사한다. 만료/취소는 410, 근거 변경은 409, 잘못된 비밀/세션은 404다.

공유 웹은 외부 자산 없이 제공하며 fragment를 교환 후 URL에서 지운다. HttpOnly/SameSite 쿠키·no-store·no-referrer·CSP를 적용한다. 보이는 동안 30초마다 상태를 확인하고, 페이지를 떠나거나 재검증에 실패하면 본문을 비운다. 이미 촬영/저장된 사본 회수는 지원하지 않는다.

## 검사와 한계

- `npm run check`, `npm run format:check`, `npm test`.
- 테스트는 `carprint_test`를 초기화한다. 환경 변수에 다른 DB가 들어오면 거부한다.
- `npm run browser:review`: 별도 18180 포트·테스트 DB·주입 시계. 터미널 `expire/new/revoke/change/stop`으로 브라우저 상태를 검토한다. Mac 시각은 바꾸지 않는다.
- 로컬 정책·단일 DB 통합 검증이다. 실차/OEM 진위, 운영 권한 운영, 인터넷 배포, 부하/장기 보존, DB 관리자 변조 방지는 별도다.
- durable outbox는 저장하지만 비동기 소비 worker는 아직 없다. 현재 리포트 무효화는 동기 근거 버전으로 처리한다.
- `trust.verification` 별도 테이블은 만들지 않고 현 단계의 출처 상태를 `trust.source.status`로 표현한다. 방문 세션용 `ops.report_session`을 추가했다. 준비 단계 CSV보다 SQL migration이 실제 구조의 기준이다.

## 8·9단계 추가

`002_care_and_personalization.sql`과 `npm run seed:experience`가 불변 평가, 합성 예제, 임시 계정/프로필, 차량 좌석 구성, 연결 요청, 개인 세션, 적용 미리보기를 준비한다. 새 초기화 스크립트에도 포함돼 있다.

- `/v1/reports` GET: 차량 관리 권한의 최신 50건. 공유 비밀 재발급/복구 목록이 아니다.
- `/v1/care/assessment`: 현재 차량 평가 보류·출발 체크. `?example=care_95` 등은 명시적 합성 계산 예제다.
- `/v1/demo/accounts`, `/v1/demo/personal/connections/:id/approve`: 임시 계정 승인. 실제 본인 인증이 아니다.
- `/v1/personal/*`: 선택 scope·좌석·미리보기·프로필 revision·만료·종료. 차량 bearer와 별도 개인 세션 헤더를 결속한다. 개인 세션은 리포트 발급 권한을 부여하지 않는다.

거래 리포트의 점수는 `null`로 표시한다. 개인 세션과 종료 규칙은 [개인화 API 계약](../contracts/stages-8-9/README.md)을 참고한다.

## 정비 보안·Pleos 속도 관측

004~006 마이그레이션은 로컬 정비사 자격·168시간 제한·정정 원본 기한·불변 주행 관측을 추가한다. `POST /v1/driving-observations`와 `PUT /v1/driving-observations/:id`는 Pleos 차량 자격과 서버 발급 ID로 속도 표본을 받는다. 실제 출처/운전자 인증 전이므로 개인 점수 가산은 보류한다. [정비 보안·주행 신호 API 계약](../contracts/security-pleos/README.md).
