package com.maandlee.carprint.driving

import android.car.Car
import android.car.VehiclePropertyIds
import android.car.hardware.CarPropertyValue
import android.car.hardware.property.CarPropertyManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock

/** Pleos 공식 FAQ가 안내하는 AAOS 클러스터 속도 읽기. 쓰기 API 사용 없음. */
class PleosSpeedSignalAdapter(private val context: Context) : DrivingSignalAdapter {
    private val main = Handler(Looper.getMainLooper())
    private var car: Car? = null
    private var manager: CarPropertyManager? = null
    private var listener: CarPropertyManager.CarPropertyEventCallback? = null
    private var closed = false
    private var firstSampleTimeout: Runnable? = null

    override fun start(sample: (VehicleSpeedSample) -> Unit, failure: (String) -> Unit) {
        check(car == null && !closed)
        fun fail(reason: String) {
            if (!closed) failure(reason)
        }
        firstSampleTimeout =
            Runnable { fail("차량 속도 표본 수신 시간 초과") }.also { main.postDelayed(it, 10000) }
        try {
            val created =
                Car.createCar(context, main, Car.CAR_WAIT_TIMEOUT_DO_NOT_WAIT) { connected, ready ->
                    if (closed) {
                        connected.disconnect()
                        return@createCar
                    }
                    if (!ready) {
                        fail("차량 서비스 연결 끊김")
                        return@createCar
                    }
                    if (listener != null) return@createCar
                    try {
                        val properties =
                            connected.getCarManager(Car.PROPERTY_SERVICE) as CarPropertyManager
                        manager = properties
                        if (
                            properties.getCarPropertyConfig(
                                VehiclePropertyIds.PERF_VEHICLE_SPEED
                            ) == null
                        ) {
                            fail("차량 속도 프로퍼티 미지원")
                            return@createCar
                        }
                        val callback =
                            object : CarPropertyManager.CarPropertyEventCallback {
                                override fun onChangeEvent(value: CarPropertyValue<*>) {
                                    if (
                                        closed ||
                                            value.propertyId !=
                                                VehiclePropertyIds.PERF_VEHICLE_SPEED
                                    )
                                        return
                                    val speed = value.value as? Float
                                    if (
                                        value.status != CarPropertyValue.STATUS_AVAILABLE ||
                                            speed == null ||
                                            !speed.isFinite()
                                    ) {
                                        fail("속도 자료 사용 불가")
                                        return
                                    }
                                    // 단조 시간 ns로 나이 계산. 2초 지난 표본은 패스. _ma
                                    val age = SystemClock.elapsedRealtimeNanos() - value.timestamp
                                    if (age < 0 || age > 2_000_000_000) {
                                        return
                                    }
                                    firstSampleTimeout?.let(main::removeCallbacks)
                                    sample(VehicleSpeedSample(value.timestamp, speed))
                                }

                                override fun onErrorEvent(propertyId: Int, areaId: Int) {
                                    fail("속도 관측 오류")
                                }
                            }
                        listener = callback
                        if (
                            !properties.registerCallback(
                                callback,
                                VehiclePropertyIds.PERF_VEHICLE_SPEED,
                                10f,
                            )
                        )
                            fail("속도 구독 거부")
                    } catch (_: SecurityException) {
                        fail("차량 속도 읽기 권한 필요")
                    } catch (_: Exception) {
                        fail("차량 속도 연결 실패")
                    }
                }
            if (closed) created?.disconnect() else car = created
        } catch (_: Exception) {
            fail("차량 서비스 사용 불가")
        }
    }

    // closed부터 켜서 늦은 콜백 막고 구독·Car 연결 해제. 구독 해제 터져도 finally에서 나머지 정리. _ma
    override fun close() {
        if (closed) return
        closed = true
        firstSampleTimeout?.let(main::removeCallbacks)
        try {
            listener?.let { manager?.unregisterCallback(it) }
        } catch (_: Exception) {
            // 서비스가 이미 종료됐어도 남은 연결 해제를 계속한다.
        } finally {
            listener = null
            manager = null
            car?.disconnect()
            car = null
        }
    }
}

fun createDrivingSignalAdapter(context: Context): DrivingSignalAdapter =
    PleosSpeedSignalAdapter(context)
