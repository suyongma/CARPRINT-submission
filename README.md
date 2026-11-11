# CARPRINT (카프린트)

CARPRINT는 차량의 정비·관리 기록을 확인하고, 차를 바꿔도 내 운전·관리 점수와 좌석·공조 설정을 이어갈 수 있게 만든 차량용 앱입니다.

## 1차 제출용 APK

1. **1차 제출 릴리스**에서 실행할 환경에 맞는 APK(앱 설치 파일)를 선택하세요. [APK 다운로드](https://github.com/suyongma/CARPRINT-submission/releases/tag/first-submission-20261106)
   - **일반 시연용** `MA.LEE_CARPRINT_demo_release.apk`에서 차량을 바꿔 보거나 개인 설정을 불러올 수 있어요.
   - **Pleos 연동용** `MA.LEE_CARPRINT_release.apk`에서 Pleos의 차량 데이터로 누적 주행거리를 읽는 모습을 볼 수 있어요.
2. 에뮬레이터에 APK를 설치하고 앱 목록에서 **CARPRINT Demo** 또는 **CARPRINT Pleos**를 여세요. [APK 설치 방법](apk/README.md)
3. 첫 화면에서 서버 주소는 기본값을 사용하고, 팀에서 별도로 안내한 **시연 참여 코드**를 입력한 뒤 **시연 서버에 연결**을 누르세요.

## 테스트 환경과 준비물

**Pleos Connect 에뮬레이터 v2.1.0**에서 확인했습니다. Android 14(API 34), **2560×1440 가로 화면**을 사용했습니다. 일반 시연용 APK는 일반 Android 에뮬레이터에서도 실행할 수 있습니다. 온라인 시연에는 **인터넷 연결과 시연 참여 코드**가 필요합니다.

일반 시연용 앱의 **내 공간**에서 차량 A와 B를 바꾼 뒤 같은 계정으로 다시 연결해 보세요. 개인 점수는 그대로이고, 좌석과 공조 설정은 새 차량이 지원하는 범위에 맞춰 제안합니다. 이 과정은 시연용 차량과 계정으로 화면에서 확인할 수 있어요.

앱 소스는 `android/`, 서버 소스는 `backend/`에 있습니다. [개발 환경 준비와 빌드·테스트 방법](docs/local-development.md)
