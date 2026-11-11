package com.maandlee.carprint.driving

import android.content.Context

/** 일반 태블릿/합성 환경은 Pleos 관측으로 가장하지 않는다. */
class UnavailableDrivingSignalAdapter : DrivingSignalAdapter {
    // 일반 demo엔 Pleos 속도 없음. 실패 콜백만 줌. 가짜 표본 만들어 보내지 말 것. _ma
    override fun start(sample: (VehicleSpeedSample) -> Unit, failure: (String) -> Unit) =
        failure("Pleos 에뮬레이터 앱에서 차량 신호를 확인하세요.")

    override fun close() {}
}

fun createDrivingSignalAdapter(context: Context): DrivingSignalAdapter =
    UnavailableDrivingSignalAdapter()
