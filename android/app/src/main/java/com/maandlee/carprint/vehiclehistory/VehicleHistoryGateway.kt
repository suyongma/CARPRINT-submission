package com.maandlee.carprint.vehiclehistory

import com.maandlee.carprint.connection.BackendConnection

data class HistoryEvent(
    val id: String,
    val type: String,
    val title: String,
    val occurredAt: String?,
    val observedAt: String,
    val receivedAt: String,
    val source: String,
    val sourceStatus: String,
    val environment: String,
    val sequence: Long,
    val correctedBy: String?,
    val flags: List<String>,
)

data class HistoryGap(val start: String, val end: String, val scope: String)

data class HistoryCorrection(val originalId: String, val newId: String, val reason: String)

data class HistoryPage(
    val events: List<HistoryEvent>,
    val gaps: List<HistoryGap>,
    val corrections: List<HistoryCorrection>,
    val nextCursor: String?,
    val rawJson: String,
)

data class IngestReceipt(val eventId: String, val sequence: Long, val receivedAt: String)

interface VehicleHistoryGateway {
    /** worker에서 호출. 동일 본문/키 재시도 안전. 401/403/409/422는 자동 재시도하지 않는다. */
    fun upload(connection: BackendConnection, body: String, key: String): IngestReceipt

    fun timeline(connection: BackendConnection, cursor: String? = null): HistoryPage
}
