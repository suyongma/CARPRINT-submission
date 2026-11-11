package com.maandlee.carprint.demo

import android.content.Context
import com.maandlee.carprint.connection.*

/** 개인 로그인 없이 선택하는 합성 시연 맥락. 차량 결속과 개인 프로필은 별도 필드다. */
data class DemoContext(
    val id: String,
    val vehicleKey: String,
    val vehicleLabel: String,
    val userKey: String,
    val userLabel: String,
    val climateCelsius: Int,
    val mediaVolume: Int,
    val canManageReports: Boolean,
)

class DemoContextController(
    private val context: Context,
    private val store: BackendConnectionStore,
    private val work: UiWorkScope,
    val selectedId: String,
    private val changed: () -> Unit,
) {
    var choices: List<DemoContext> = emptyList()
        private set

    val current: DemoContext?
        get() = choices.firstOrNull { it.id == selectedId }

    fun load() {
        work.run(
            store::contexts,
            {
                choices = it
                changed()
            },
            {
                choices = emptyList()
                changed()
            },
        )
    }

    // 선택 ID만 저장함. Activity가 graph 새로 만들어야 차량 자격·상태도 바뀜. 개인 로그인은 따로. _ma
    fun select(vehicle: String, user: String): Boolean {
        val selected =
            choices.firstOrNull { it.vehicleKey == vehicle && it.userKey == user } ?: return false
        if (selected.id == selectedId) return false
        context
            .getSharedPreferences("demo-context", Context.MODE_PRIVATE)
            .edit()
            .putString("selected", selected.id)
            .apply()
        return true
    }
}
