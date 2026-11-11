package com.maandlee.carprint.comfort

import com.maandlee.carprint.connection.BackendConnection

data class ComfortItem(
    val key: String,
    val requested: Double,
    val target: Double?,
    val unit: String,
    val disposition: String,
    val source: String,
    val reason: String,
)

data class ComfortView(
    val revision: Int,
    val vehicleName: String,
    val capabilitySummary: String,
    val portable: Map<String, Double>,
    val vehicleValues: Map<String, Double>,
    val items: List<ComfortItem>,
    val lastApplied: List<ComfortItem>,
    val notice: String,
)

data class ComfortPreview(val id: String, val expiresAt: String, val items: List<ComfortItem>)

data class PassengerPreset(
    val id: String,
    val name: String,
    val ownerName: String,
    val values: Map<String, Double>,
)

/**
 * Worker I/O. 모든 요청은 차량 자격+개인 세션에 귀속. 저장은 버전 검사, 적용은 서버 미리보기 ID로 재전송 가능. 좌석/HVAC 물리 제어를 하지 않는다. 오류
 * 시 호출자가 재조회하며 자동으로 덮어쓰지 않는다.
 */
interface ComfortGateway {
    fun read(c: BackendConnection, token: String): ComfortView

    fun save(
        c: BackendConnection,
        token: String,
        revision: Int,
        target: String,
        values: Map<String, Double>,
    ): ComfortView

    fun reset(c: BackendConnection, token: String, revision: Int): ComfortView

    fun preview(c: BackendConnection, token: String): ComfortPreview

    fun apply(c: BackendConnection, token: String, id: String): List<ComfortItem>

    fun presets(c: BackendConnection, token: String): List<PassengerPreset>

    fun savePreset(c: BackendConnection, token: String, name: String, values: Map<String, Double>)

    fun loadPreset(c: BackendConnection, token: String, id: String, revision: Int): ComfortView
}
