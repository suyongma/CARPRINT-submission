# Neon 무료 DB와 GitHub 인수인계

2026-10-28 기준. CARPRINT 전용 Neon `carprint-demo` 프로젝트, PostgreSQL 18, AWS Singapore, Free Plan을 사용한다. 기존 서비스의 프로젝트·DB·설정은 변경하지 않는다. 이 문서는 **온라인 DB 연결**을 설명한다. 공개 HTTPS API 배포와 APK의 서버 설정 화면은 아직 완료되지 않았다.

## 책임과 비밀

- `production`: 이름은 Neon 기본값이며 실제 운영 서비스가 아닌 **합성 시연 DB**다.
- `codex-cloud-validation`: 마이그레이션과 쓰기 검증 전용 브랜치. 새 기능 검증을 시연 DB와 분리한다.
- 소유자 접속은 마이그레이션·합성 seed에만 사용한다. API는 SQL로 생성한 `carprint_api` 역할을 사용하며 소유자 역할을 상속하지 않는다.
- API에는 차량 원본/점수 원장 수정·삭제와 정비사 자격 생성 권한을 주지 않는다. 기존 DB 트리거와 권한 계약을 유지한다.
- 관리자 연결은 direct endpoint, API 연결은 pooled endpoint다. 모두 `sslmode=verify-full`로 인증서를 검사한다.
- `.local/neon/<branch>/connection.env`: 관리자용 설정. `.local/neon/<branch>/runtime.env`: 관리자 자격을 제외한 API용 설정. 토큰·영수증 키·credentials.json도 같은 Git 제외 폴더에 보관한다.
- 로컬 `backend/.env`와 `.local/credentials.json`은 그대로 둔다. 다른 서비스의 연결 정보를 복사하거나 기존 비밀번호를 변경하지 않는다.

## 새 개발자가 재현하기

로컬 전용 시연은 [개발 환경 준비](../local-development.md#설치와-실행)의 `scripts/setup-local.sh`를 사용한다. 온라인 DB가 필요하면 본인 계정에서 무료 **별도 `carprint-demo` 프로젝트**, DB `carprint_demo`, PostgreSQL 18을 만든다. 이 문서에 실제 접속 비밀번호는 제공하지 않는다. 검증 당시 Neon CLI는 8.10.3이다. 아래 `PROJECT_ID`는 해당 프로젝트의 ID로 바꾼다.

```sh
neon branches create --project-id PROJECT_ID --parent production --name codex-cloud-validation --cu 0.25 --no-secrets
cd backend
npm ci
node scripts/bootstrap-neon.mjs PROJECT_ID codex-cloud-validation
node --env-file=.local/neon/codex-cloud-validation/connection.env --import tsx scripts/prepare-neon.ts
node --env-file=.local/neon/codex-cloud-validation/connection.env --import tsx scripts/verify-neon.ts --exercise
```

Neon CLI 로그인은 본인 계정으로 미리 완료해야 한다. 무료 플랜에서는 절전 시간을 변경할 수 없어 `--suspend-timeout`을 전달하지 않는다. 부트스트랩은 프로젝트 이름과 무료 요금제를 검사하고, 기존 설정 파일이 있으면 덮어쓰지 않고 종료한다. `prepare-neon.ts`는 exact endpoint·DB 이름·TLS를 검사한다. 로컬 `migrate`/`seed`의 localhost 제한을 완화하지 않는다.

검증을 통과한 뒤 시연 브랜치에 적용한다.

```sh
node scripts/bootstrap-neon.mjs PROJECT_ID production
node --env-file=.local/neon/production/connection.env --import tsx scripts/prepare-neon.ts
node --env-file=.local/neon/production/connection.env --import tsx scripts/verify-neon.ts
```

`verify-neon.ts --exercise`는 검증 브랜치에서만 실행된다. 로그인·선호 저장·차량 간 점수 이동·정비 입력을 검사하며, 정비 성공 기록은 원본 보존 정책에 따라 검증 브랜치에 남는다. 로그인 세션은 종료하고 프로필은 원래 값으로 복구한다. 시연 브랜치에서는 읽기와 API 인증 거부만 검사한다. `npm test`는 계속 **로컬 carprint_test**만 사용한다.

이미 적용한 마이그레이션은 건너뛴다. 기존 프로필과 이력은 덮어쓰지 않는다. seed 중간 실패로 DB와 credentials.json이 불일치하면 자동 초기화·비밀번호 회전을 하지 않고 중단한다. 원인을 확인하고 검증 브랜치를 새로 준비한다.

현재 Mac에서 API 프로세스만 별도 포트로 실행해 온라인 DB를 사용할 수 있다.

```sh
node --env-file=.local/neon/production/runtime.env --import tsx src/server.ts
```

주소는 **로컬 `127.0.0.1:18081`**이다. 이 명령을 실행했다고 다른 장소의 APK가 인터넷으로 접속할 수 있는 것은 아니다. 실제 API 호스팅에서는 관리자 env를 전달하지 않고, HTTPS 공개 주소·고정 영수증 키·런타임 비밀 주입·요청 제한을 별도로 구성해야 한다.

## 현재 시연 범위와 남은 작업

- 온라인 DB: 합성 차량 3개(일반 demo 2개 + Pleos 에뮬레이터 결속 1개), 개인 계정 A/B, 차량별 좌석 배치, 개인 점수 원장, 관리 평가 예제와 이력.
- 샘플 역할: 수집자/조회자/리포트 관리자/`local_demo` 정비사. 실제 정비 면허 검증이나 외부 로그인 제공자가 아니다.
- `local_demo` 정비사 fixture 자격은 2027-01-01까지이며, 장기 시연 전에 만료 여부를 확인한다. 기기 역할 토큰의 허용 기간은 초기 준비 시점부터 30일이다. 재실행으로 자동 연장하지 않는다.
- 차량별 선호 편집·변환과 동승자 프리셋은 migration 007로 추가했다. [공개 API와 APK 연결 설정](online-demo.md).
- 무료 용량은 현재 프로젝트당 1GB, 월 100 CU-hours, 전송량 5GB다. 일시 절전·한도 소진과 외부 인터넷 장애에 대비해 시연 전에 접속을 확인한다. 연속 원시 속도 자료를 무제한 수집하지 않는다.

## 소스 공유

GitHub `suyongma/CARPRINT`는 사용자가 승인한 **비공개 소스 저장소**다. 심사위원에게 링크만 전달하면 바로 열람 가능한 상태는 아니다. 제출 시 요구되는 공개 여부/심사 계정 초대 방식에 맞춰 별도 공유한다. 공개 전환·팀원 초대는 아직 수행하지 않았다.

소스·계약·합성 fixture·잠금 파일·협업 문서·검증 근거를 올린다. APK, 로컬 SDK, DB 데이터 볼륨, 비밀 설정, 제출 동의서·서명·개인정보는 제외한다. 제출용 APK는 이후 Releases 등으로 소스와 구분한다. 오픈소스 라이선스 부여는 별도 결정이며 외부 의존성 출처는 `THIRD_PARTY_NOTICES.md`를 따른다.

## 확인한 공식 자료

- [Neon 무료 범위](https://neon.com/docs/introduction/plans)
- [연결 풀](https://neon.com/docs/connect/connection-pooling)
- [역할과 권한](https://neon.com/docs/manage/roles)
