package com.maandlee.carprint.vehiclehistory

import com.maandlee.carprint.connection.BackendConnection
import com.maandlee.carprint.connection.HttpTransport
import java.net.URLEncoder
import org.json.JSONArray
import org.json.JSONObject

class HttpVehicleHistoryGateway(private val transport: HttpTransport) : VehicleHistoryGateway {
    // 응답의 이벤트·차량·환경이 요청이랑 맞는지 보고 영수증으로 변환. 서명 암호 검증까지 한 건 아님. _ma
    override fun upload(connection: BackendConnection, body: String, key: String): IngestReceipt {
        val receipt =
            transport
                .request(
                    connection.baseUrl,
                    "/v1/vehicle-events",
                    connection.collectorToken,
                    "POST",
                    body,
                    key,
                )
                .getJSONObject("receipt")
        require(
            receipt.getString("event_id") == JSONObject(body).getString("event_id") &&
                receipt.getString("vehicle_ref") == connection.vehicleRef &&
                receipt.getString("environment") == connection.environment &&
                receipt.getLong("server_seq") > 0
        ) {
            "RECEIPT_BINDING_MISMATCH"
        }
        // TLS/개발 HTTP 응답의 수신 확인. 앱 자체의 Ed25519 검증 완료로 표시하지 않는다.
        return IngestReceipt(
            receipt.getString("event_id"),
            receipt.getLong("server_seq"),
            receipt.getString("received_at"),
        )
    }

    override fun timeline(connection: BackendConnection, cursor: String?): HistoryPage {
        val query = cursor?.let { "?cursor=${URLEncoder.encode(it, "UTF-8")}" }.orEmpty()
        return parseHistory(
            transport
                .request(
                    connection.baseUrl,
                    "/v1/vehicles/${connection.vehicleRef}/timeline$query",
                    connection.collectorToken,
                )
                .toString()
        )
    }
}

internal fun JSONArray.strings(): List<String> = (0 until length()).map { getString(it) }

internal fun JSONObject.optionalString(key: String): String? =
    if (isNull(key)) null else getString(key)

// JSON을 화면 모델로 바꿈. 발생·관측·수신 시각이랑 정정·공백은 따로 유지. 제목만 남기면 근거 날아감. _ma
fun parseHistory(raw: String): HistoryPage {
    val json = JSONObject(raw)
    val events = json.getJSONArray("events")
    val names =
        mapOf(
            "demo-tire-rotation" to "타이어 위치 교환",
            "demo-cabin-filter" to "실내 필터 교체",
            "demo-brake-inspection" to "브레이크 점검",
            "demo-tire-repair" to "타이어 조치",
        )
    val items =
        (0 until events.length()).map { index ->
            val item = events.getJSONObject(index)
            val payload = item.getJSONObject("payload")
            val title =
                if (item.getString("event_type") == "odometer.observed")
                    String.format(java.util.Locale.KOREA, "%,.1f km", payload.getDouble("value"))
                else names[payload.optString("task_code")] ?: "타이어 공기압 경고"
            HistoryEvent(
                item.getString("event_id"),
                item.getString("event_type"),
                title,
                item.optionalString("occurred_at"),
                item.getString("observed_at"),
                item.getString("received_at"),
                sourceLabel(item.getString("source_kind")),
                if (item.getString("source_status") == "revoked") "출처 검증 취소" else "외부 검증 전 시연 자료",
                item.getString("environment"),
                item.getLong("server_seq"),
                item.optionalString("corrected_by"),
                item.getJSONArray("review_flags").strings(),
            )
        }
    val gaps = json.getJSONArray("gaps")
    val corrections = json.getJSONArray("corrections")
    return HistoryPage(
        items,
        (0 until gaps.length()).map {
            gaps.getJSONObject(it).run {
                HistoryGap(
                    getString("start"),
                    getString("end"),
                    getJSONArray("scope").strings().joinToString { scope ->
                        when (scope) {
                            "warnings" -> "경고 관측"
                            "maintenance" -> "정비"
                            "odometer" -> "주행거리"
                            else -> scope
                        }
                    },
                )
            }
        },
        (0 until corrections.length()).map {
            corrections.getJSONObject(it).run {
                HistoryCorrection(
                    getString("original_event_id"),
                    getString("new_event_id"),
                    getString("reason_code"),
                )
            }
        },
        json.optionalString("next_cursor"),
        raw,
    )
}

private fun sourceLabel(source: String): String =
    when (source) {
        "simulated_device" -> "합성 기기 관측"
        "simulated_workshop" -> "합성 정비 기록"
        "pleos_emulator" -> "Pleos 에뮬레이터"
        else -> source
    }
