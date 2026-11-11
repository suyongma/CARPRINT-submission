# 8·9단계 로컬 계약

실제 JSON Schema는 서버 각 기능의 `routes.ts`, DTO/부작용 계약은 `contracts.ts`, DB 제약은 [migration 002](../../backend/src/db/migrations/002_care_and_personalization.sql)에 있다. 현재 구현은 합성 평가·임시 계정 시제품이며 OpenAPI 전체 명세나 운영 인증 계약은 아니다.

| 경로 | 동작·권한 |
| --- | --- |
| `GET /v1/reports` | 기존 차량 관리 `reports:read`, 최신 50건. 공유 비밀 반환 없음 |
| `GET /v1/care/examples` | 차량 `timeline:read`, 합성 예제 목록 |
| `GET /v1/care/assessment?example=...` | 차량별 저장 평가. example 생략은 현재 기록, 지정 시 현재 차량과 분리된 합성 입력 |
| `GET /v1/demo/accounts` | 차량 자격 확인 후 임시 계정 ID/이름만 조회. 개인 선호는 포함하지 않음 |
| `POST /v1/personal/connections` | scope 배열·temporary/trip. 5분 코드 발급, 아직 개인 정보 수신 없음 |
| `POST /v1/demo/personal/connections/:id/approve` | 요청 ID·코드·임시 계정·confirmed=true. 선택 범위의 개인 세션 발급 |
| `DELETE /v1/personal/connections/:id` | 취소 및 승인 응답 유실 시 생성된 세션 정리 |
| `GET /v1/personal/session` | 차량 bearer + `X-Personal-Session` 결속·현재 만료/종료 검증 |
| `PUT /v1/personal/session/seat` | 지원하는 합성 좌석에 독립 계정 배정, 중복 409 |
| `PUT /v1/personal/session/scopes` | 현재 scope의 부분집합만 허용, 증가 403 |
| `POST /v1/personal/session/preview` | 1분 유효한 세션/프로필 revision 고정, 실제 적용 없음 |
| `POST /v1/personal/session/previews/:id/apply` | confirmed=true, 오래된 상태 412, 합성 항목별 결과. 물리 명령 없음 |
| `PUT /v1/personal/profile` | 명시적 저장 + expected revision. 승인한 공조 16~30°C, 합성 음량 0~30만 변경. 충돌 412 |
| `DELETE /v1/personal/sessions/:id` | 차량에 결속된 ID로 반복 종료 가능. 개인 토큰을 보관할 필요 없음 |

`climate`, `volume`, `destination`, `seat`는 CARPRINT 합성 scope이며 Pleos 제공 scope가 아니다. 새 schema는 추가 필드를 거부한다. 개인 계정 승인만으로 차량 소유권·리포트 관리 권한을 부여하지 않는다. 미선택 필드는 요청·응답·앱 캐시에 포함하지 않는다. 종료 뒤 방문/개인 토큰을 다른 용도로 재사용할 수 없다.

합성 공조의 `simulated_confirmed`는 모의 적용 완료 상태다. 음량 `unconfirmed`는 요청 접수 상태이며, `unsupported`와 `blocked`에서는 적용을 건너뛴다. 개인 프로필 저장은 모의 적용과 별도로 수행한다.

## 개인 점수 확장 (2026-10-28)

승인된 개인 세션은 계정 요약 `personalScore`를 반환한다. 점수는 공조 등 선택한 설정 범위와 별도로 승인 화면에서 안내한다. [개인 점수 구현](../../backend/src/personal-score).

## 차량별 맞춤 개인화 확장

공통 선호, 차량·좌석별 설정, 동승자 템플릿의 요청 스키마는 [공조 API](../../backend/src/comfort/routes.ts)에 있다. 서버는 `ComfortStore`, 앱은 `ComfortGateway`를 통해 설정을 처리한다.
