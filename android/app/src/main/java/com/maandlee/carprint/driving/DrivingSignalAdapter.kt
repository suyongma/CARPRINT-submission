package com.maandlee.carprint.driving

/** 단조 시각(ns) + 실제 차량 프로퍼티 속도(m/s). 벽시계/GPS/기기 가속도와 혼합 금지. */
data class VehicleSpeedSample(val timestampNanos: Long, val metersPerSecond: Float)

data class SpeedSample(val elapsedMs: Long, val metersPerSecond: Float)

interface DrivingSignalAdapter : AutoCloseable {
    /**
     * main에서 시작/종료. 콜백도 main. unsupported/권한/오류는 failure이며 0속도로 대체하지 않음. close는 구독·연결 해제 및 늦은 콜백
     * 차단. 하나의 인스턴스는 한 관측에만 사용한다.
     */
    fun start(sample: (VehicleSpeedSample) -> Unit, failure: (String) -> Unit)

    override fun close()
}
