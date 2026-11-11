package com.maandlee.carprint.vehicle

import android.os.Handler
import android.os.Looper

/** Activity에 SDK·timeout 상태를 섞지 않는다. 모든 상태 변경은 메인 스레드에서 한다. */
class VehicleReadController(
    private val factory: () -> VehicleAdapter,
    private val onState: (DistanceState) -> Unit,
    private val timeoutMillis: Long = 8000,
) {
    private val main = Handler(Looper.getMainLooper())
    private var adapter: VehicleAdapter? = null
    private var generation = 0
    private var timeout: Runnable? = null

    // 이전 읽기 끝내고 새 세대 번호 잡음. timeout이랑 SDK 응답 같이 와도 현재 세대 것만 main에서 반영. _ma
    fun refresh() {
        stop()
        val request = generation
        val source = factory().also { adapter = it }
        onState(DistanceState.Loading(source.origin))
        timeout = Runnable {
            if (request == generation) {
                stop()
                onState(DistanceState.Finished(source.origin, DistanceResult.Failed("TIMEOUT"), null))
            }
        }.also { main.postDelayed(it, timeoutMillis) }
        val deliver: (DistanceResult) -> Unit = { rawResult ->
            val result = if (rawResult is DistanceResult.Available &&
                (!rawResult.kilometers.isFinite() || rawResult.kilometers < 0)) {
                DistanceResult.Failed("INVALID_VALUE")
            } else rawResult
            // SDK 콜백 스레드를 가정하지 않으며 종료·재시도 이전 요청은 화면을 바꾸지 못한다.
            main.post {
                if (request == generation) {
                    stop()
                    onState(DistanceState.Finished(source.origin, result,
                        if (result is DistanceResult.Available) System.currentTimeMillis() else null))
                }
            }
        }
        try { source.readDistance(deliver) }
        catch (_: Exception) { deliver(DistanceResult.Failed("READ_EXCEPTION")) }
    }

    fun stop() {
        // 콜백 취소해도 이미 오는 응답은 남을 수 있음. 번호 올려서 늦은 응답이 화면 되돌리는 것까지 막음. _ma
        generation++
        timeout?.let(main::removeCallbacks)
        timeout = null
        // 종료 실패가 Activity 수명주기를 중단하지 않도록 한다. 값이나 원문 오류는 로그에 남기지 않는다.
        try { adapter?.close() } catch (_: Exception) { android.util.Log.w("VehicleRead", "release failed") }
        adapter = null
    }
}

sealed interface DistanceState {
    data object Idle : DistanceState
    data class Loading(val origin: VehicleOrigin) : DistanceState
    data class Finished(val origin: VehicleOrigin, val result: DistanceResult, val receivedAtMillis: Long?) : DistanceState
}
