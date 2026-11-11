package com.maandlee.carprint.driving

import android.os.Handler
import android.os.Looper
import com.maandlee.carprint.connection.*

class DrivingEvidenceController(
    private val connection: () -> BackendConnection?,
    private val adapterFactory: () -> DrivingSignalAdapter,
    private val gateway: DrivingEvidenceGateway,
    private val work: UiWorkScope,
    private val changed: () -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private var adapter: DrivingSignalAdapter? = null
    private var id: String? = null
    private var bound: BackendConnection? = null
    private var firstTimestamp: Long? = null
    private var closed = false
    private var stopRequested = false
    private var captureIssue: String? = null
    private val samples = mutableListOf<SpeedSample>()
    private val timeout = Runnable { stop() }
    var observing = false
        private set

    var busy = false
        private set

    var status = "Pleos 차량 속도 → 서버 급가감속 후보 분석 · 실제 개인 점수 반영 전 검증"
        private set

    var result: DrivingAssessment? = null
        private set

    val pending
        get() = id != null && !observing && !busy

    // 서버 관측 ID 받고 연결을 bound에 고정한 뒤 SDK 구독. 미완료 ID 남았으면 새 관측 못 시작함. _ma
    fun start() {
        if (closed || observing || busy || id != null) return
        val config = connection() ?: return
        if (config.environment != "pleos_emulator") {
            status = "일반 태블릿은 Pleos 주행 신호를 생성하지 않습니다."
            changed()
            return
        }
        stopRequested = false
        captureIssue = null
        busy = true
        result = null
        samples.clear()
        firstTimestamp = null
        bound = config
        status = "관측 ID 요청 중"
        changed()
        work.run(
            { gateway.begin(config) },
            { observationId ->
                if (!closed) {
                    busy = false
                    id = observationId
                    if (stopRequested) {
                        submit()
                        return@run
                    }
                    observing = true
                    status = "속도 관측 시작 · 최대 10분 · 종료 후 서버 계산"
                    val source = adapterFactory()
                    adapter = source
                    source.start(
                        sampleCallback@{ sample ->
                            if (observing && !closed) {
                                val first =
                                    firstTimestamp
                                        ?: sample.timestampNanos.also { firstTimestamp = it }
                                // 첫 표본 기준 ns → ms. 서버는 m/s, 화면은 km/h. _ma
                                val elapsed = (sample.timestampNanos - first) / 1_000_000
                                if (samples.lastOrNull()?.elapsedMs == elapsed)
                                    return@sampleCallback
                                if (elapsed < 0) {
                                    captureIssue = "단조 시각 역전"
                                    samples.clear()
                                    stop()
                                    return@sampleCallback
                                }
                                if (elapsed > 600000 || samples.size >= 6001) {
                                    stop()
                                    return@sampleCallback
                                }
                                samples.add(SpeedSample(elapsed, sample.metersPerSecond))
                                if (samples.size % 10 == 0 || samples.size == 1) {
                                    status =
                                        "Pleos 속도 관측 ${samples.size}개 · ${elapsed / 1000}초 · %.1f km/h"
                                            .format(sample.metersPerSecond * 3.6)
                                    changed()
                                }
                            }
                        },
                        { reason ->
                            captureIssue = reason
                            status = reason
                            // 오류가 난 부분 관측으로 만점을 만들지 않는다. 실패 종료는 빈 창으로 보류한다.
                            samples.clear()
                            stop()
                        },
                    )
                    if (observing) main.postDelayed(timeout, 600000)
                    changed()
                }
            },
            { error ->
                busy = false
                status =
                    if (error is ApiFailure && error.code == "observation_already_active")
                        "이전 속도 관측이 서버에 아직 열려 있습니다. 앱이 강제 종료된 경우 최대 15분 뒤 다시 시작할 수 있습니다."
                    else errorMessage(error)
                changed()
            },
        )
    }

    // 시작 응답 기다리는 중이어도 중단 표시 남김. 늦게 응답 오면 구독 열지 말고 빈 관측 창 제출해서 끝냄. _ma
    fun stop() {
        stopRequested = true
        if (!observing) return
        observing = false
        main.removeCallbacks(timeout)
        adapter?.close()
        adapter = null
        status = "관측 종료 · 서버 계산 중"
        submit()
    }

    // 전송할 표본은 복사해둠. 실패하면 ID·표본 그대로 두고 재전송. 성공해야 메모리 비움. _ma
    fun submit() {
        if (closed || busy || observing) return
        val observationId = id ?: return
        val config = bound ?: return
        val snapshot = samples.toList()
        busy = true
        changed()
        work.run(
            { gateway.finish(config, observationId, snapshot) },
            { value ->
                result = value
                id = null
                samples.clear()
                busy = false
                status = captureIssue?.let { "관측 보류 · $it" } ?: "서버 계산 완료 · 개인 점수 합산 보류"
                changed()
            },
            { error ->
                busy = false
                status = errorMessage(error)
                changed()
            },
        )
    }

    fun close() {
        closed = true
        observing = false
        main.removeCallbacks(timeout)
        adapter?.close()
        adapter = null
        samples.clear()
    }
}
