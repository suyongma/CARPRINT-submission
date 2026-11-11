# 정비 쓰기 보안과 주행 관측 계약

정비 이벤트 JSON 계약은 기존 stages-5-7을 유지하며 최근 168시간·유효 정비사 자격이 추가된다. 원본 발생일/수신일이 지난 정정도 막는다. 실제 자격기관 인증은 현재 local_demo 자격과 구분한다.

주행 API의 요청·응답 스키마는 [routes.ts](../../backend/src/driving-evidence/routes.ts), 도메인 인터페이스는 같은 폴더의 [contracts.ts](../../backend/src/driving-evidence/contracts.ts)에 있다.
