# 1차 제출용 APK

[GitHub 릴리스에서 APK 내려받기](https://github.com/suyongma/CARPRINT-submission/releases/tag/first-submission-20261106)

| 파일 | 실행 환경 | 확인할 기능 |
| --- | --- | --- |
| `MA.LEE_CARPRINT_release.apk` | Pleos API 34 에뮬레이터 | Pleos 차량 데이터에서 누적 주행거리 읽기 |
| `MA.LEE_CARPRINT_demo_release.apk` | Android API 34 또는 Pleos API 34 에뮬레이터 | 시연용 차량 전환, 개인 설정 불러오기, 차량 이력과 리포트 확인 |

1. 릴리스에서 APK를 내려받으세요. 함께 제공하는 `SHA256SUMS.txt`에서 각 파일의 SHA-256 확인값을 볼 수 있어요.
2. 사용할 에뮬레이터를 켜고 APK를 설치하세요. Pleos에서 설치 명령을 사용할 때는 아래 예시를 참고하세요.
3. 앱 목록에서 **CARPRINT Pleos** 또는 **CARPRINT Demo**를 열고, 팀에서 받은 시연 참여 코드를 입력한 뒤 **시연 서버에 연결**을 누르세요. 서버 주소는 기본값을 사용합니다.

Pleos에서 명령으로 설치할 경우, 터미널에서 APK를 내려받은 폴더를 열고 아래 순서로 실행하세요. `adb`는 Android SDK의 Platform Tools에 포함됩니다.

```sh
adb devices
adb -s emulator-5554 shell am get-current-user
adb -s emulator-5554 install --user 10 -r MA.LEE_CARPRINT_release.apk
```

위의 `emulator-5554`와 `10`을 앞의 두 명령에 표시된 기기 ID와 현재 사용자 번호로 바꾸세요. 마지막에는 받은 APK 파일명을 넣으세요.

두 APK는 별도 앱으로 함께 설치할 수 있어요. 차량 맞춤 설정은 화면에서 모의로 적용하고, Pleos의 누적 주행거리 읽기는 에뮬레이터에서 확인했습니다.
