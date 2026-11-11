package com.maandlee.carprint.vehicle

/** 일반 태블릿 시연용 고정 합성값. Pleos 실패 시 대체값으로 사용하지 않는다. */
class SimulatedVehicleAdapter(private val kilometers: Float = 12345.6f) : VehicleAdapter {
    override val origin = VehicleOrigin.SIMULATED

    // 합성 거리 바로 콜백으로 줌. SDK랑 같은 계약이라 완료 스레드·응답 시점은 controller가 처리해야 함. _ma
    override fun readDistance(callback: (DistanceResult) -> Unit) {
        callback(DistanceResult.Available(kilometers))
    }

    override fun close() = Unit
}
