package com.maandlee.carprint.vehicle

import android.content.Context
import ai.pleos.playground.vehicle.Vehicle
import ai.pleos.playground.vehicle.api.model.capability.AccessType

/** Vehicle 2.3.2의 읽기 전용 경계. 쓰기 API와 listener 구독은 사용하지 않는다. */
class PleosVehicleAdapter(context: Context) : VehicleAdapter {
    override val origin = VehicleOrigin.PLEOS_EMULATOR
    private val applicationContext = context.applicationContext
    private var vehicle: Vehicle? = null
    @Volatile private var closed = false
    private var initialized = false

    // 초기화 → 읽기 지원 확인 → 거리 조회. 미지원·값 없음·실패 구분해서 넘김. 안 된다고 합성값 주진 않음. _ma
    override fun readDistance(callback: (DistanceResult) -> Unit) {
        fun fail(error: Exception) {
            if (!closed) callback(DistanceResult.Failed(
                // 배포 sources와 AAR의 공개 예외 타입이 달라 공통 Exception 계약만 사용한다.
                error.message?.takeIf { it.matches(Regex("ERROR_[A-Z_]+|[0-9]+")) }
                    ?: error.javaClass.simpleName,
            ))
        }
        if (closed) return
        try {
            val sdk = vehicle ?: Vehicle(applicationContext).also { vehicle = it }
            // 초기화 도중 예외가 나도 close에서 부분 연결을 해제한다.
            if (!initialized) { initialized = true; sdk.initialize() }
            val odometer = sdk.getOdometer()
            odometer.checkCurrentDistanceDrivenCapabilities(onComplete = { config ->
                if (!closed) {
                    if (config.accessType !in setOf(AccessType.READ, AccessType.READ_WRITE)) {
                        callback(DistanceResult.Unsupported)
                    } else {
                        try {
                            odometer.getCurrentDistanceDriven(onComplete = { value ->
                                if (!closed) callback(when {
                                    value == null -> DistanceResult.Unavailable
                                    !value.isFinite() || value < 0 -> DistanceResult.Failed("INVALID_VALUE")
                                    else -> DistanceResult.Available(value)
                                })
                            }, onFailed = ::fail)
                        } catch (error: Exception) { fail(error) }
                    }
                }
            }, onFailed = ::fail)
        } catch (error: Exception) { fail(error) }
    }

    override fun close() {
        closed = true
        if (initialized) { initialized = false; vehicle?.release() }
        vehicle = null
    }
}
