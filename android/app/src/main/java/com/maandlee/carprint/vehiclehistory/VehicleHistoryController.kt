package com.maandlee.carprint.vehiclehistory

import com.maandlee.carprint.connection.*

class VehicleHistoryController(
    private val connection: () -> BackendConnection?,
    private val gateway: VehicleHistoryGateway,
    private val vault: DeviceVault,
    private val work: UiWorkScope,
    private val changed: () -> Unit,
) {
    var events: List<HistoryEvent> = emptyList()
        private set

    var gaps: List<HistoryGap> = emptyList()
        private set

    var corrections: List<HistoryCorrection> = emptyList()
        private set

    var nextCursor: String? = null
        private set

    var busy = false
        private set

    var status = "기록을 불러오면 출처·정정·수집 공백을 확인할 수 있습니다."
        private set

    val selected = linkedSetOf<String>()

    // 첫 페이지 실패하면 차량별 암호화 캐시 보여줌. 다음 페이지 실패를 캐시 성공으로 퉁치진 않음. _ma
    fun load(more: Boolean = false) {
        if (busy) return
        busy = true
        status = "서버 기록 조회 중"
        changed()
        work.run(
            {
                val config = connection() ?: throw ApiFailure(401, "connection_required")
                try {
                    val page = gateway.timeline(config, if (more) nextCursor else null)
                    val stamp = java.time.Instant.now().toString()
                    if (!more)
                        vault.put(
                            "history:${config.vehicleRef}",
                            org.json
                                .JSONObject()
                                .put("page", page.rawJson)
                                .put("at", stamp)
                                .toString(),
                        )
                    Triple(page, "서버 동기화 $stamp · 수신 순번 기준", false)
                } catch (error: ApiFailure) {
                    if (more) throw error
                    val cached = vault.get("history:${config.vehicleRef}") ?: throw error
                    val json = org.json.JSONObject(cached)
                    Triple(
                        parseHistory(json.getString("page")),
                        "오프라인 보관본 · 마지막 동기화 ${json.getString("at")}\n${errorMessage(error)}",
                        true,
                    )
                }
            },
            { (page, message, cached) ->
                events = if (more) (events + page.events).distinctBy { it.id } else page.events
                gaps = page.gaps
                corrections = page.corrections
                // 캐시 커서는 옛날 거라 더 읽기 막음. 온라인으로 첫 페이지 다시 받아야 이어서 조회 가능. _ma
                nextCursor = if (cached) null else page.nextCursor
                status = if (events.isEmpty()) "$message\n수집된 기록 없음" else message
                busy = false
                changed()
            },
            {
                status = errorMessage(it)
                busy = false
                changed()
            },
        )
    }
}
