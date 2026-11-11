# 5~7단계 합성 seed와 요청 예제

상태: **준비 완료 / DB 적재·API 호출 미실행**. 기존 [시연 자료](../demo/README.md)의 정정 사례와 공백 사례를 합성해 서버 구현에 사용할 UUID·요청 형식으로 변환했다. 관리 점수와 개인 프로필은 제외했다.

| 파일 | 내용 |
| --- | --- |
| [seed-bundle.json](seed-bundle.json) | 차량 3개, 권한별 주체 5개, 출처 4개, 차량 A 이벤트 12개·정정 관계 1개·공백 1개 |
| [ingest-request.json](ingest-request.json) | 새 주행거리 관측 요청. 원본 측정 시각 미상, 앱 관측 시각만 있음 |
| [correction-request.json](correction-request.json) | 브레이크 수행일 정정 요청. 원본 이벤트는 경로에서 지정 |
| [report-requests.json](report-requests.json) | 전체/일부 리포트 발행 요청; 유효기간 1시간 예시 |
| [report-snapshots.json](report-snapshots.json) | 전체 12건/일부 1건, 공백 고지, 평가 없음, 발행 URL 없음 |
| [share-boundaries.json](share-boundaries.json) | 만료 직전·동시·직후, 취소, 비밀 오류, 근거 변경의 기대 상태 6개 |
| [preparation-validation.json](preparation-validation.json) | 준비 파일 일관성 검사 결과. API·DB 테스트 통과가 아님 |

고정 시연 시각은 2026-10-27 12:00 KST다. 전체 리포트 예시는 12:01 발행, 13:01 만료이며 실제 현재 시각으로 발표하지 않는다. 자동 만료를 실제 서버에서 검증할 때는 테스트용 주입 시계를 사용하고 Mac 시스템 시계를 바꾸지 않는다.

차량 A는 본 시연, 차량 B는 다른 차량의 접근 차단 검증, 에뮬레이터 차량은 Pleos 출처 격리용이다. 후자 두 차량에는 과거 기록을 넣지 않았다. 모든 주체의 `credential`은 `null`이며 실제 로그인·차주 증명을 제공하지 않는다. 실제 구현 시 로컬 시연 자격 증명을 따로 생성하고 Git에 넣지 않는다.

`seed-bundle.json`에는 이미 정정된 상태가 들어 있다. 정정 API 검증의 사전 상태는 seed에서 `maintenance.corrected` 이벤트와 `corrections` 관계를 제외하고 순번·영수증·체인을 다시 구성한 뒤 같은 정정 요청을 적용한다. 이 파생 상태를 구현 테스트 setup에서 만들며 이미 존재하는 정정 이벤트를 다시 신규 정정으로 넣지 않는다. 정상 재전송 검증에서는 같은 정정 ID·키를 재사용한다.

실제 importer는 `principals.scopes`를 별도 권한 grant로 만들고 현재 테스트 시계에 맞춰 유효기간을 부여한다. `sources.principal_id`로 발급 주체를 결속한다. 과거 합성 경고는 seed 입력이며, 주행거리만 승인된 실제 앱 수집자가 경고를 제출할 권한이 생기는 것은 아니다. seed 적재 시 개발용 영수증·서명·체인을 생성한다면 합성 입력의 수신 사실로만 표시하고 실제 과거 서버 관측처럼 소개하지 않는다.

전체 리포트에 들어가는 원본과 정정 후 기록은 함께 보존한다. 부분 리포트는 타이어 작업 1건만 공유하고 일부 공개 고지와 공백 맥락을 유지한다. 어떤 자료에도 실제 공유 비밀·비밀번호·서명 키가 들어 있지 않다.

프로젝트 루트에서:

```sh
python3 -B scripts/prepare_stage7_handoff.py
python3 -B scripts/validate_stage7_handoff.py
```

생성기는 지정된 준비 JSON과 검증 계획 CSV를 덮어쓴다. DB import 명령이 아니다. 구현 후 검증 결과는 `docs/evidence/`에 따로 기록한다. `acceptance-matrix.csv`의 34개 항목은 모두 `NOT_RUN`으로 유지하고 실제 실행 근거가 생기면 별도 결과 파일로 연결한다.
