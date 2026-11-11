# 외부 도구·라이브러리

- Gradle Wrapper / Gradle 8.11.1: Gradle Inc., Apache-2.0. https://github.com/gradle/gradle
- Kotlin 2.2.21 / kotlin-stdlib: JetBrains, Apache-2.0. https://github.com/JetBrains/kotlin
- Android Gradle Plugin 8.9.2 및 AndroidX Test: Android Open Source Project, Apache-2.0. https://source.android.com/ / https://github.com/android/android-test
- Android SDK 및 Pleos 에뮬레이터는 각각의 공급자 약관을 따르는 로컬 설치 도구이며 저장소에 재배포하지 않는다.
- Eclipse Temurin JDK 17: Eclipse Adoptium, GPLv2 with Classpath Exception. 로컬 빌드 도구로만 사용한다. https://adoptium.net/

앱 아이콘은 이 프로젝트에서 작성한 벡터다. Gradle Wrapper 원본의 저작권·라이선스 헤더를 유지한다.

- 앱 글꼴은 [Pretendard Variable v1.3.9](https://github.com/orioncactus/pretendard/tree/v1.3.9) 원본이다. Copyright (c) 2021, Kil Hyung-jin, SIL Open Font License 1.1. [원본 라이선스](android/app/src/main/assets/licenses/pretendard-ofl.txt)를 APK에도 포함한다.
- 내 차 화면의 주차 장면은 사용자가 제공한 제네시스 X 콘셉트 차량 사진을 참고해 GPT Image 2.6 Sunburst로 편집한 그림이다.

- Pleos Vehicle SDK 2.3.2 및 vehicle-aidl 1.1.1, vehicle-data 1.1.11: 42dot/현대자동차그룹 공급자 SDK 약관 적용. 공식 Maven에서 빌드 시 해석하며 AAR·sources JAR는 저장소에 재배포하지 않는다. https://document.pleos.ai/docs/pleos-only/connect-sdk-pleos/Vehicle/project-setup
- Pleos 전이 의존성 Gson 2.10.1(Google), kotlinx-coroutines 1.6.3(JetBrains), AndroidX Core 1.8.0(AOSP): Apache-2.0. 실제 해석 버전은 android/app/gradle.lockfile을 따른다.

## 5~7단계 서버·개발 도구

직접 의존성의 실제 버전은 `backend/package-lock.json`을 따른다. npm 설치본의 LICENSE를 보존한다.

- Fastify 5.12.7, @fastify/cookie 11.1.5, @fastify/rate-limit 11.2.1: MIT. https://github.com/fastify/fastify / https://github.com/fastify/fastify-cookie / https://github.com/fastify/fastify-rate-limit
- pg 8.23.1: MIT. https://github.com/brianc/node-postgres
- canonicalize 5.1.0: Apache-2.0. https://github.com/erdtman/canonicalize
- TypeScript 7.0.2: Apache-2.0. https://github.com/microsoft/TypeScript
- tsx 4.23.15: MIT. https://github.com/privatenumber/tsx
- Prettier 3.9.10: MIT. https://github.com/prettier/prettier
- @types/node, @types/pg: MIT, DefinitelyTyped. https://github.com/DefinitelyTyped/DefinitelyTyped
- PostgreSQL 18.3: PostgreSQL License. https://www.postgresql.org/about/licence/
- ktfmt 0.61: Apache-2.0. 로컬 포매터로만 사용하며 JAR는 Git 제외. https://github.com/Kotlin/ktfmt

앱과 웹 화면의 인터페이스는 프로젝트 코드로 구성한다. 제조사 UI 자산은 Pleos 에뮬레이터 자체에서 제공한다.
