package com.maandlee.carprint.vehicle

/** SDK로 읽어도 에뮬레이터 값은 실차 관측이 아니다. 출처를 값과 함께 유지한다. */
enum class VehicleOrigin { PLEOS_EMULATOR, SIMULATED }

sealed interface DistanceResult {
    data class Available(val kilometers: Float) : DistanceResult
    data object Unavailable : DistanceResult
    data object Unsupported : DistanceResult
    data class Failed(val code: String) : DistanceResult
}

/** 일회성 지원 확인과 읽기. close 이후 지연 응답은 호출 측에서도 폐기한다. */
// 차량 읽기 공통 계약. flavor 달라도 같은 결과 모델로 줌. SDK 타입 새지 않게 하고 연결은 close에서 정리. _ma
interface VehicleAdapter {
    val origin: VehicleOrigin
    fun readDistance(callback: (DistanceResult) -> Unit)
    fun close()
}
