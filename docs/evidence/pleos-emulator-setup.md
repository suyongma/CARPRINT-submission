# 1단계: Pleos 에뮬레이터 설치 근거

검증일: 2026-10-27. 설치·가상 기기 생성·Android 부팅 확인 완료. 사용자가 제공한 스크린샷으로 Pleos 차량 화면 표시를 확인했다. 클릭 반응은 미검증이다.
CARPRINT 앱 빌드, Pleos SDK API 호출, 실제 차량 관측·제어를 검증한 결과가 아니다.

## 환경 및 설정

| 항목 | 확인값 |
| --- | --- |
| 호스트 | macOS 27.0.1, Apple Silicon arm64 |
| Android Studio | Rabbit 1, 2026.2.1 |
| Android Emulator | 37.2.12.0, build 16428233 |
| Platform Tools | 37.0.1 |
| 이미지 | Pleos Connect v2.1.0, Android 14 / API 34, arm64-v8a |
| AVD 이름 | CARPRINT_Pleos_API34 |
| 프로필 | Pleos_Connect_v2_0 (표시명 Pleos Connect v2.1.0) |
| 화면 | 2560×1440, density 160, landscape |
| 메모리 / CPU | 4096MB / 4 cores |
| 부팅 / GPU | Cold boot, snapshot 사용 안 함 / host |

SDK는 macOS 기본 경로 `$HOME/Library/Android/sdk`, AVD는 `$HOME/.android/avd`에 설치했다. SDK·이미지·AVD는 프로젝트에 포함하지 않는다. 일반 태블릿 이미지는 추가 설치하지 않았다.

## 공식 출처

- [Pleos SDK·에뮬레이터 설치](https://document.pleos.ai/docs/connect/guide/getting-started/application-development/setup-connect-sdk-emulator)
- [Pleos 에뮬레이터 설정](https://document.pleos.ai/docs/connect/guide/getting-started/application-development/configure-pleos-connect-emulator)
- [Apple Silicon 이미지 저장소 XML](https://nexus-playground.pleos.ai/repository/raw-releases/connect-avd/2.x/crp-arm64-sys-img.xml)

Google 및 42dot 라이선스에 대한 사용자 동의를 받고 진행했다. 공식 이미지 ZIP의 크기 4,669,762,816 bytes 및 SHA-1 `24d28eb2f18eba5e87c861a7eb2bdccebb049419`를 저장소 정보와 대조했다.

## 설치 중 처리한 호환 문제

최신 sdkmanager가 위 추가 저장소의 패키지를 찾지 못하여, 공식 ZIP을 SDK의 `system-images/android-34/pleos_car_emulator/arm64-v8a/`에 직접 풀었다. avdmanager가 source.properties에서 생성한 package.xml은 일반 Automotive 경로를 사용했으므로, localPackage path를 공식 저장소의 `system-images;android-34;pleos_car_emulator;arm64-v8a`로 수정했다. revision은 2, 표시명은 공식 저장소 값으로 맞췄다. 시스템 이미지 내용은 수정하지 않았다.

가상 기기 생성에 성공한 명령:

```sh
export JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home'
export ANDROID_HOME="$HOME/Library/Android/sdk"
"$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd \
  --name CARPRINT_Pleos_API34 \
  --package 'system-images;android-34;pleos_car_emulator;arm64-v8a' \
  --device Pleos_Connect_v2_0
```

생성 뒤 config.ini의 메모리·가로 방향·GPU·Cold boot 값을 위 표에 맞췄다. 다른 개발자는 공식 SDK Manager 설치 경로를 우선 사용하고 동일 이름과 설정으로 AVD를 생성한다. 위 명령은 이미 생성된 기기를 덮어쓰는 명령이 아니다.

## 실행 및 검증

프로젝트 루트에서 실행한다. 이미 실행 중이면 새 인스턴스를 중복 실행하지 않는다.

```sh
./scripts/start-pleos-emulator.sh
```

이번 실행은 스크립트와 동일한 emulator 인수로 수행했다. 스크립트 자체는 `sh -n` 구문 검사만 했으며 중복 부팅은 하지 않았다.

```sh
sdk_root="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
"$sdk_root/platform-tools/adb" devices -l
"$sdk_root/platform-tools/adb" -s emulator-5554 shell getprop sys.boot_completed
"$sdk_root/platform-tools/adb" -s emulator-5554 shell getprop ro.build.version.release
"$sdk_root/platform-tools/adb" -s emulator-5554 shell getprop ro.build.version.sdk
"$sdk_root/platform-tools/adb" -s emulator-5554 shell pm list packages pleos
```

관측 결과:

- `emulator-5554 device`, product/device `crp_avd_arm64`, model `Car_on_arm64_emulator`.
- `sys.boot_completed=1`, Android release `14`, SDK `34`.
- `ai.pleos.service.car`, `ai.pleos.hardware.vehicle.emulator` 등 Pleos 시스템 패키지 확인.
- 에뮬레이터 로그: `Boot completed in 16212 ms`.
- 첫 실행 중 ADB 미연결 메시지는 ADB 서버 시작 후 정상 연결로 해소됨.
- 로그에 ColorBuffer/texture 오류가 있었음. 부팅은 완료됐지만 화면 표시 영향은 미확인.

다른 가상 기기를 먼저 실행한 경우 `emulator-5554` 대신 devices 명령의 실제 기기 ID를 사용한다.

## 남은 확인

독립 실행된 에뮬레이터를 화면 자동화 도구가 앱으로 인식하지 못했다. 사용자가 제공한 스크린샷에서 차량 모델·계기 정보·하단 메뉴·공조 UI 표시를 확인했다. 지도 영역은 비어 있어 지도 로딩 정상 여부는 확인하지 않았다. Device Manager 화면에서도 CARPRINT Pleos API34 실행 중 상태를 확인했다. 독립 실행 창 이름 qemu-system-aarch64로 다시 연결했으나 도구가 Invalid app을 반환했다. 따라서 설치·부팅·차량 화면 표시는 확인됐으며, 클릭 반응의 직접 검증은 남아 있다.

이 단계에서는 앱 소스 생성, GitHub 업로드, 서버·DB 설치, 차량 API 연동을 하지 않았다.
