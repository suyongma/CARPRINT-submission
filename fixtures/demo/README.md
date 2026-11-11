# 합성 시연 데이터

상태: **파일 준비 완료 / 앱 로딩 미구현**. 실제 차량·계정·정비소 데이터가 아니다. 모든 시나리오는 `environment: simulation`이며 가상 차량 `demo-vehicle-a`를 사용한다. 실제 VIN, 이름, 이메일, 주소, 토큰, 서명은 없다.

## 파일

| 파일 | 역할 |
| --- | --- |
| [catalog.json](catalog.json) | 기본 시나리오와 파일 목록, 테마·초기화 정책 |
| `scenarios/*.json` | 서로 독립적으로 읽을 수 있는 전체 상태 묶음 10개 |
| [connection-options.json](connection-options.json) | 선택 연동 항목, 초기 꺼짐, 예시 선택 상태 |
| [emulator-read-sequence.json](emulator-read-sequence.json) | 이후 Virtual Console에서 실행할 별도 수동 조회 계획 |
| [validation-result.json](validation-result.json) | 합성 자료 일관성 검사 결과; 앱 검증 결과 아님 |

## 시나리오

| ID | 예상 결과 | 주요 내용 |
| --- | --- | --- |
| `care_95` | 95점 | 주행거리 6건, 정비·경고·조치 5건, 관리 작업 4개 |
| `fresh_install` | 평가 보류 | 설치 직후 이력 없음, 0점·100점으로 표시하지 않음 |
| `coverage_gap` | 평가 보류 | 8월 1~10일 필수 관측 범위 공백, 원인 미확인 |
| `evidence_revoked` | 평가 보류 | 점수 근거 출처의 검증 상태 취소 |
| `corrected_record` | 95 → 100 | 점검 수행일 정정, 원본 기록과 이전 평가 보존 |
| `preventive_only` | 종합 보류 | 예방 관리 자료만 있고 문제 조치 범위가 없음 |
| `selective_link` | 두 항목 연결·결과 일부 확인 | 공조 22°C 확인, 볼륨 요청은 결과 미확인 |
| `session_end_offline` | 로컬 정리·원격 취소 대기 | 차량 이력과 기존 클라우드 원본 유지 |
| `profile_conflict` | 적용 보류·다시 미리보기 | 예상 프로필 버전 1과 현재 버전 2 충돌 |
| `expired_report` | 공유 만료 | 만료 시각에 도달하면 점수 화면 대신 만료 상태 |

## 묶음 구조

`schema_version`은 `carprint.demo.bundle.v1`이다. **시연 파일 형식**이며 아직 확정된 서버 API나 DB 스키마가 아니다.

| 키 | 의미 |
| --- | --- |
| `demo_now`, `clock_policy` | 실제 시스템 시간 대신 고정된 시연 시간 |
| `vehicle`, `sources` | 차량 식별과 합성 출처; 개인 계정과 분리 |
| `vehicle_events` | 발생일·수신일·환경·출처·payload·정정 연결을 가진 차량 이력 |
| `collection_gaps` | 수집이 확인되지 않은 구간과 범위·원인·평가 영향 |
| `maintenance_rule`, `opportunities` | 가상 규칙과 작업 기한·수행일·근거·평가값 |
| `eligibility_inputs` | 시연을 위한 평가 가능 조건의 명시적 가정 |
| `assessments` | 산식 버전·입력 스냅샷·점수 또는 보류 사유·정정 관계 |
| `personal` | 가상 계정·선택 범위·좌석·프로필·적용 결과·세션 정리 상태 |
| `reports` | 발행 범위·자료 기준 시각·평가 연결·만료·취소 상태 |
| `ui` | 테마 제안과 합성 시연 표시 |

기본 시계는 `2026-10-27T03:00:00Z`(한국 12시), 평가 구간은 180일이다. 자료가 있는 날짜는 7일이며 **180일 연속 차량 관측이 아니다**. `expired_report`만 7일 뒤로 시계를 이동한다. 날짜를 바꿀 때 이벤트·기한·평가·공유 만료를 함께 재생성한다.

95점은 기존 D0.1 참조 산식에 예방 관리 `[1, 1, 0.8]`, 문제 조치 `[1]`을 넣은 결과다. 브레이크 점검의 10일 유예는 가상 값이며 제조사 정비 기준이 아니다. `spec_known` 등은 합성 전제이고 실제 차종·기준 확인의 증거가 아니다. 서명은 `null`, 출처 검증 상태는 `simulated_*`로 표시한다.

정정 시 원본 이벤트를 삭제하지 않고 `record_status: superseded`, `correction_of`로 연결한다. 이전 평가도 `input_snapshot`을 보존한다. 개인 계정·목적지·프로필 값을 `vehicle_events`에 합치지 않는다. 임시 세션 종료 뒤 남는 원격 취소 항목은 취소 재시도에 필요한 메타데이터 예시이며 로그인 자격 증명이나 프로필 캐시가 아니다.

## 생성·검사

프로젝트 루트에서 Python 표준 라이브러리만 사용한다.

```sh
python3 -B scripts/prepare_demo_fixtures.py
python3 -B scripts/validate_demo_fixtures.py
```

생성기는 이 폴더의 지정된 JSON 파일만 덮어쓴다. 앱·DB·SDK·실계정에 접속하지 않는다. 파일을 손으로 바꾸면 다음 생성 때 사라지므로 영속 수정은 생성기의 해당 시나리오에 한다. 검사기는 차량·출처 연결, 시각, 정정 참조, 산식, 부분 리포트, 선택 범위, 종료 상태를 확인한다. 5가지 잘못된 변형도 거부되는지 확인한다.

이 검사는 시연용 자료의 일관성을 확인한다.
