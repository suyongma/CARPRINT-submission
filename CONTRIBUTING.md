# 협업 안내

현재 구현 범위와 실행 방법은 [README](README.md)와 [로컬 개발 안내](docs/local-development.md)를 참고한다.

- 식별자는 역할을 설명하는 영어, 협업 문서·이유 중심 주석은 한국어로 작성한다. Kotlin 파일·클래스는 PascalCase, 함수·변수는 lowerCamelCase다.
- 기능별 책임을 `vehicle`, `vehiclehistory`, `personalization` 등에 둔다. Activity에는 화면 탐색만 두고 인증·평가·저장·차량 제어를 섞지 않는다.
- SDK·HTTP·저장소·서명 경계는 인터페이스와 구현체를 분리하고 생성자로 의존성을 전달한다. 구현체 선택은 조립 진입점에서 한다. 인터페이스 이름은 역할을, 구현체 이름은 기술과 환경을 드러낸다.
- 공통 처리는 같은 변경 이유가 있는 코드로 한정한다. 기술 오류·통신 설정·로그 처리는 모으되 기능별 권한·재시도·원자성 조건은 드러나게 유지한다. 모든 클래스의 인터페이스화, 만능 공통 함수, 범용 CRUD/기반 클래스는 필요성이 입증된 경우에만 추가한다.
- 실제 SDK 데이터와 합성 데이터는 구현명·화면·실행 환경에서 구분한다. 미확인 값을 0점이나 정상값으로 대체하지 않는다.
- `feature/목적`, `fix/목적`, `docs/목적`처럼 목적별 브랜치를 쓰고 변경 범위를 작게 유지한다. 커밋·PR에 문제, 변경, 검증 결과, 미검증 범위를 적는다.
- Kotlin은 ktfmt 0.61의 kotlinlang-style을 사용한다. 루트에서 `sh scripts/format-kotlin.sh 변경파일.kt`로 지정한 파일만 정리한다. 다운로드는 버전·SHA-256을 검증하며 로컬 도구는 Git 제외다. 서버는 `cd backend` 후 `npm run format` / `npm run format:check`를 사용한다. CI 자동 실행은 아직 없다.
- 앱 변경은 `cd android` 후 `./gradlew :app:assemblePleosDebug :app:assembleDemoDebug :app:lintPleosDebug :app:lintDemoDebug`로 확인한다. 메뉴·수명주기 변경 시 두 flavor의 `assemble…DebugAndroidTest`를 빌드하고 루트에서 `python3 scripts/run-android-checks.py --evidence-dir docs/evidence/stages-8-9`를 실행한다. 서버·AVD가 필요하며 설치와 운전자 사용자 설정을 함께 수행한다. 강제 프로세스 종료 복구는 `python3 scripts/check-process-recovery.py --evidence-dir docs/evidence/stages-8-9`로 별도 확인한다.
- 서버 변경은 `cd backend` 후 `npm run check && npm run format:check && npm test`로 검사한다. `carprint_test`만 초기화하며 브라우저 검토 서버와 동시에 실행하지 않는다.
- 의존성을 바꾸면 버전 이유를 기록하고 `--write-locks`로 잠금 파일을 갱신한다. Wrapper 체크섬도 유지한다.
- 리뷰에서는 진입점·데이터 소유권·실패 처리·화면의 미구현 고지·주석 정확성을 소스와 비교한다. 후속 독립 리뷰 미실행을 완료로 표시하지 않는다.
- 리뷰어가 실제 구현체를 고르는 위치, 기능의 업무 규칙, 저장 범위와 실패 이후 상태를 바로 찾을 수 있어야 한다. 기능 문서에는 진입점·호출 순서·실행/검증 명령·미검증 범위를 실제 파일에 맞춰 남긴다.
- `private/`, local.properties, .env, 토큰, 실제 VIN·개인정보·서명, SDK, 캐시, APK는 커밋하지 않는다. `git diff --cached`와 `git status --short`로 공개 범위를 확인한다.
