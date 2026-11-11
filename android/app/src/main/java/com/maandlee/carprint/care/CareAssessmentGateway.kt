package com.maandlee.carprint.care

import com.maandlee.carprint.connection.*
import org.json.JSONObject

data class CareExample(val id: String, val label: String)

interface CareAssessmentGateway {
    fun examples(connection: BackendConnection): List<CareExample>

    /** 현재 차량과 합성 예제를 명시적으로 구분한다. 실패는 점수 0/100으로 대체하지 않는다. */
    fun assess(connection: BackendConnection, example: String?): JSONObject
}

class HttpCareAssessmentGateway(private val transport: HttpTransport) : CareAssessmentGateway {
    override fun examples(connection: BackendConnection): List<CareExample> {
        val rows =
            transport
                .request(connection.baseUrl, "/v1/care/examples", connection.collectorToken)
                .getJSONArray("examples")
        return (0 until rows.length()).map {
            rows.getJSONObject(it).run { CareExample(getString("id"), getString("label")) }
        }
    }

    override fun assess(connection: BackendConnection, example: String?) =
        transport.request(
            connection.baseUrl,
            "/v1/care/assessment" +
                (example?.let { "?example=" + java.net.URLEncoder.encode(it, "UTF-8") } ?: ""),
            connection.collectorToken,
        )
}

class CareAssessmentController(
    private val connection: () -> BackendConnection?,
    private val gateway: CareAssessmentGateway,
    private val work: UiWorkScope,
    private val changed: () -> Unit,
) {
    var examples: List<CareExample> = emptyList()
        private set

    var result: JSONObject? = null
        private set

    var busy = false
        private set

    var example: String? = null
        private set

    var status = "관리 평가를 불러오면 근거와 보류 사유를 확인할 수 있습니다."
        private set

    // id 없으면 현재 차량, 있으면 합성 예제. 조회 전에 옛 결과 비움. 실패했는데 딴 점수 남아 있으면 곤란함. _ma
    fun load(id: String? = null) {
        if (busy) return
        busy = true
        example = id
        result = null
        status = "평가 근거 확인 중"
        changed()
        work.run(
            {
                val c = connection() ?: throw ApiFailure(401, "connection_required")
                Pair(gateway.assess(c, id), gateway.examples(c))
            },
            {
                result = it.first
                examples = it.second
                busy = false
                status = if (id == null) "현재 차량의 저장 기록 기준" else "합성 계산 예제 · 현재 차량의 평가가 아닙니다."
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
