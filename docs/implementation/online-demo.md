# 제출용 온라인 시연

전용 Cloudflare Worker `carprint-demo-api`가 Fastify API를 실행하고 Neon `carprint-demo`의 `production` 브랜치에 시연용 데이터를 저장한다.

## APK만으로 접속

1. GitHub 릴리스의 일반 시연용 APK는 `MA.LEE_CARPRINT_demo_release.apk`, Pleos 연동용 APK는 `MA.LEE_CARPRINT_release.apk`다. 두 APK는 Pleos API 34 에뮬레이터에서 확인했다. [APK 선택 및 설치 안내](../../apk/README.md).
2. 첫 화면의 기본 서버 주소 `https://carprint-demo-api.kingteer2.workers.dev`와 별도 전달받은 시연 참여 코드를 사용한다. 인터넷 연결이 필요하다.
3. `demo`는 내 공간에서 합성 차량 A/B를 선택한다. 개발용 사용자 A/B는 기록 권한 전환이고, 개인 로그인 A/B와 별개다. 개인화 시연 중 개발용 사용자는 A를 유지한다.
4. 필요한 공조·좌석 항목을 선택하고 임시 계정 A/B로 승인한다. A는 합성 이력 69점, B는 평가 전 50점이다.
5. 기록·설정은 서버에 저장된다. 앱 재설치는 계정 원장을 지우지 않지만 첫 참여 코드 입력이 다시 필요하다. 다른 시연자도 동일한 합성 계정을 쓰므로 실제 개인정보를 입력하지 않는다.

참여 코드의 현재 만료는 **2026-11-24 23:59 KST**다. 만료·철회된 차량 자격은 코드가 맞아도 배포하지 않는다. 시연 전 서버 연결을 다시 확인하고, 이후 심사 일정이면 담당자가 코드 만료와 차량 자격 유효기간을 함께 갱신해야 한다. 서버 중단 시 설치 APK만으로 온라인 저장을 대신하지 않는다.

## 배포 경계

- Worker는 `carprint_api` 제한 DB 역할을 사용한다. 관리자/마이그레이션 자격과 정비사 발급 자격은 배포하지 않는다.
- APK에는 서버 주소만 기본값으로 제공한다. 참여 코드와 DB·차량 토큰은 APK/소스에 넣지 않는다. HTTPS 응답은 검증 후 Android Keystore로 암호화해 저장한다. 참여 코드 원문은 저장하지 않는다.
- `POST /v1/demo/setup`은 코드 해시·만료·flavor를 확인하고 차량 조회/관측/리포트 권한만 전달한다. 이는 합성 시연 참가 절차이며 차량 소유권이나 실제 본인 인증이 아니다.
- Fastify 라우트/인증/트랜잭션/32 KiB 본문 제한을 유지한다. Worker 시작 시 스키마를 준비하고, 요청마다 DB 연결을 만들고 응답 본문을 완성한 뒤 닫는다. 스트리밍 API를 추가하면 이 수명 계약을 다시 설계해야 한다.
- 요청 제한은 Worker 인스턴스의 메모리 기준이다. 전 세계 요청을 합산한 강제 제한이나 운영 서비스의 남용 방어가 완성된 것은 아니다.
- `placement.region`은 Neon의 AWS Singapore 인접 실행을 지정한다. [공식 Placement 문서](https://developers.cloudflare.com/workers/configuration/placement/). 기존 Cloudflare 플랜은 변경하지 않았다.

## 담당자 배포 절차

기존 [Neon 준비](neon-setup.md)의 전용 설정 파일과 권한 검증이 선행된다. 파일 경로는 이 프로젝트의 로컬 산출물이며 저장소에 포함하지 않는다. 먼저 `codex-cloud-validation`에서 확인한 뒤 제출용 `production`으로 전환한다.

```sh
cd backend
npm ci
npm run check
npx tsc --noEmit -p worker/tsconfig.json
node --env-file=.local/neon/codex-cloud-validation/connection.env --import tsx scripts/prepare-worker.ts https://carprint-demo-api.kingteer2.workers.dev
# CLOUDFLARE_API_TOKEN과 CLOUDFLARE_ACCOUNT_ID는 비밀 저장소에서 셸 환경으로 제공한다.
npx wrangler secret bulk .local/submission/codex-cloud-validation/worker-secrets.json
npx wrangler deploy
node --import tsx scripts/verify-online.ts https://carprint-demo-api.kingteer2.workers.dev .local/submission/codex-cloud-validation/participation-code.txt ../docs/evidence/first-submission/online-validation.json --exercise
```

`--exercise`는 합성 선호를 임시 수정하고 원래 값으로 되돌린다. 모의 적용·프리셋 기록은 검증 브랜치에 남으므로 실제 데이터에 실행하지 않는다. 제출용 전환은 위 `prepare-worker`와 `secret bulk`의 브랜치를 `production`으로 바꾸고 다시 배포한다. 제출용 확인에서는 `--exercise`를 생략한다. `.local/submission/`의 코드·설정·비밀 JSON을 로그·Git·영상에 포함하지 않는다.

현재 비밀 바인딩: `DATABASE_URL`, `PUBLIC_ORIGIN`, `CACHE_KEY_HEX`, `CURSOR_KEY_HEX`, `RECEIPT_PRIVATE_KEY`, `DEMO_SETUP_JSON`. 영수증 개인 키와 Android APK 서명 키는 별개다. 코드만 바꾸려면 새 코드의 해시와 만료를 준비해 `DEMO_SETUP_JSON`을 교체한다. 기존 차량 자격까지 철회하려면 DB 자격 정책에 따라 회수 후 새 제한 자격으로 pack을 다시 만든다.

## release 재현과 키 보관

```sh
# JAVA_HOME은 JDK 17, ANDROID_HOME은 설치된 Android SDK 경로
python3 scripts/build-release.py
```

최초 실행은 `android/.local/release/`에 서명 키·설정을 생성하며 이후에는 같은 키를 재사용한다. 둘 중 하나가 없어지면 자동 교체하지 않고 중단한다. 이 디렉터리는 담당자가 별도로 안전하게 백업하며 제출물에 포함하지 않는다. 출력은 Git 제외 `private/submission/apk/`의 두 release APK와 `SHA256.json`이다. APK에 동봉할 서명 비밀번호는 없다.

기존 debug 서명 앱에는 release를 덮어쓸 수 없다. 합성 시연 앱의 로컬 데이터를 정리하고 release를 새로 설치한다. 서버 계정·차량 기록은 유지된다. 일반 계측 검사는 debug를 사용하며, 명시적 제출 검증에만 `python3 scripts/build-release.py --with-ui-test`로 release 테스트 APK를 만든다. 테스트 APK는 제출하지 않는다.
