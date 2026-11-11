# CARPRINT 로컬 개발

## 설치와 실행

소스·계약·합성 입력·의존성 잠금 파일·설정 예시·초기화 스크립트를 전달한다. 현재 Mac의 DB 볼륨, 자격 증명, 서명 키, SDK 경로를 복사하지 않는다. 새 환경에서 개발 키와 제한 자격을 새로 생성한다. 도구 설치 및 최초 의존성 다운로드에는 인터넷이 필요하다.

아래 도구를 준비한다.

| 구분 | 사용·검증 버전 |
| --- | --- |
| 서버 | Node 26.12.0, npm 11.20.0. 정확한 의존성은 `backend/package-lock.json` |
| DB | Docker Compose, PostgreSQL 18.3 Alpine 이미지 digest 고정 |
| 앱 | JDK 17, Android SDK Platform 34, Build Tools 36.0.0, Platform Tools |
| 빌드 | Gradle 8.11.1 Wrapper, AGP 8.9.2, Kotlin 2.2.21 |
| 보조 | Python 3, POSIX shell. macOS arm64에서 검증 |

프로젝트 루트에서 서버 환경을 준비한다. Docker 엔진은 실행되어 있어야 한다.

```sh
sh scripts/setup-local.sh
cd backend
npm run dev
```

초기화는 CARPRINT 전용 `carprint_demo`와 파괴적 검증 전용 `carprint_test` DB를 분리한다. API는 `127.0.0.1:18080`, DB는 `127.0.0.1:15432`다. 기존 자료가 있으면 seed를 덮어쓰지 않는다. `.env`·`.local/`은 Git 제외다. 다른 서비스의 포트가 겹치면 CARPRINT의 설정을 조정한다. [서버 실행·보관 정책](../backend/README.md).

앱 빌드는 `JAVA_HOME`(JDK 17), `ANDROID_HOME`(Android SDK), `ANDROID_AVD_HOME`(가상 기기 저장 위치)을 확인한 뒤 실행한다. 이 Mac은 개발 도구를 외장 SSD P3로 이전했으며 SDK는 `/Volumes/P3/Android/sdk`, AVD는 `/Volumes/P3/Android/avd`에 있다. 아래 예시는 이미 지정한 환경변수를 우선하고, Android 환경변수가 미설정이거나 비어 있을 때만 P3 경로를 사용한다. 다른 PC에서는 해당 PC의 설치 경로를 지정한다.

```sh
export ANDROID_HOME="${ANDROID_HOME:-/Volumes/P3/Android/sdk}"
export ANDROID_AVD_HOME="${ANDROID_AVD_HOME:-/Volumes/P3/Android/avd}"
: "${JAVA_HOME:?JDK 17 설치 경로를 JAVA_HOME에 지정하세요}"
"$JAVA_HOME/bin/java" -version
cd android
./gradlew :app:assembleDemoDebug :app:assemblePleosDebug :app:lintDemoDebug :app:lintPleosDebug
```

`JAVA_HOME`에는 실제 JDK 17의 홈 디렉터리를 지정한다. macOS에 등록된 JDK 17은 `/usr/libexec/java_home -v 17`로 경로를 확인할 수 있다. 위 `java -version` 출력이 17인지 확인한다. P3 경로에서 `No such file` 오류가 나면 먼저 `ls /Volumes/P3`로 SSD 마운트를 확인한다.

Android Studio에서는 `android/`를 열고 SDK 위치를 `ANDROID_HOME`과 같게, Gradle JDK를 17로 선택한다. `android/local.properties`가 있으면 이전 SDK 경로가 남아 있는지 확인하며 이 파일은 커밋하지 않는다. 일반 Android 에뮬레이터/태블릿은 `demo`, 별도 Pleos 이미지에서는 `pleos`를 선택한다. [Pleos 설치 근거](evidence/pleos-emulator-setup.md)는 당시 설치 기록이며, 현재 실행은 위 환경변수를 지정한 터미널에서 `sh scripts/start-pleos-emulator.sh`를 사용한다.

AVD를 실행한 뒤 프로젝트 루트에서 앱을 설치한다.

```sh
"$ANDROID_HOME/platform-tools/adb" devices
"$ANDROID_HOME/platform-tools/adb" -s emulator-5554 install -r android/app/build/outputs/apk/demo/debug/app-demo-debug.apk
python3 scripts/provision-demo-device.py --flavor demo --serial emulator-5554
```

`pleos`도 같은 방식으로 해당 APK와 `--flavor pleos`를 사용한다. bootstrap은 **현재 운전자 사용자**의 앱 내부로 전달한 뒤 Keystore로 암호화하고 원문 파일을 삭제한다. 토큰을 APK·명령행·소스에 넣지 않는다. 기본 API 주소 `10.0.2.2:18080`은 Android Emulator용이다. 다른 연결 방식은 `--api-url`로 주입한다. 실물 태블릿은 아직 검증하지 않았다.

## 검증

```sh
cd backend
npm run check
npm run format:check
npm test
```

`npm test`는 전용 `carprint_test`를 초기화한다. `carprint_demo`와 다른 프로젝트 DB는 건드리지 않는다. 별도 브라우저 확인 서버 `npm run browser:review`도 같은 테스트 DB를 사용하므로 두 명령을 동시에 실행하지 않는다.

API와 AVD를 실행한 상태에서 앱을 검증한다.

```sh
cd android
./gradlew :app:assembleDemoDebug :app:assemblePleosDebug :app:assembleDemoDebugAndroidTest :app:assemblePleosDebugAndroidTest
cd ..
python3 scripts/run-android-checks.py --evidence-dir docs/evidence/security-pleos
```

스크립트가 앱을 설치하고 현재 Pleos 사용자에게 시연 자격을 전달한 뒤 계측 검사를 실행한다. 검사 결과는 위 명령에 지정한 폴더에 저장한다.
