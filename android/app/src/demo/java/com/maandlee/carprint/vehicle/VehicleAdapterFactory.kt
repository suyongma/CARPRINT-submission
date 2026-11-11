package com.maandlee.carprint.vehicle

import android.content.Context

/** 합성 전환은 demo flavor에만 존재한다. Pleos SDK 조회 경로에 섞지 않는다. */
fun createVehicleAdapter(context: Context): VehicleAdapter {
    val selected =
        context
            .getSharedPreferences("demo-context", Context.MODE_PRIVATE)
            .getString("selected", "a:a")!!
    return SimulatedVehicleAdapter(if (selected.startsWith("b:")) 8042.3f else 12345.6f)
}
