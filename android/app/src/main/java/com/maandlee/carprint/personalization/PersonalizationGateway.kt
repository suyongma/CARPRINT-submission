package com.maandlee.carprint.personalization

import com.maandlee.carprint.connection.BackendConnection
import com.maandlee.carprint.personalscore.PersonalScore
import org.json.JSONObject

data class PersonalAccount(val id: String, val name: String)

data class ConnectionChallenge(val id: String, val code: String, val expiresAt: String)

data class PersonalSession(
    val id: String,
    val account: String,
    val name: String,
    val scopes: List<String>,
    val seat: String?,
    val seats: List<String>,
    val expiresAt: String,
    val revision: Int,
    val profileRevision: Int,
    val preferences: JSONObject,
    val personalScore: PersonalScore,
)

data class ConnectedPerson(val token: String, val session: PersonalSession)

data class PreferencePreview(val id: String, val expiresAt: String, val items: List<PreferenceItem>)

data class PreferenceItem(
    val scope: String,
    val value: String,
    val status: String,
    val reason: String,
)

interface PersonalizationGateway {
    /** 합성 계정만 조회. 승인 후 계정 이름·개인 점수와 선택한 설정만 내려받는다. 모두 worker I/O. */
    fun accounts(connection: BackendConnection): List<PersonalAccount>

    fun request(
        connection: BackendConnection,
        scopes: List<String>,
        mode: String,
    ): ConnectionChallenge

    fun approve(
        connection: BackendConnection,
        challenge: ConnectionChallenge,
        account: String,
    ): ConnectedPerson

    fun cancel(connection: BackendConnection, id: String)

    fun refresh(connection: BackendConnection, token: String): PersonalSession

    fun seat(connection: BackendConnection, token: String, seat: String): PersonalSession

    fun scopes(connection: BackendConnection, token: String, scopes: List<String>): PersonalSession

    fun preview(connection: BackendConnection, token: String): PreferencePreview

    fun apply(connection: BackendConnection, token: String, id: String): List<PreferenceItem>

    fun save(
        connection: BackendConnection,
        token: String,
        revision: Int,
        values: JSONObject,
    ): PersonalSession

    /** 멱등 종료. 종료 재전송은 차량 자격+ID만 필요하므로 개인 토큰은 보관하지 않는다. */
    fun end(connection: BackendConnection, id: String)
}
