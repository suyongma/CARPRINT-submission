package com.maandlee.carprint.personalization

import com.maandlee.carprint.connection.*
import com.maandlee.carprint.personalscore.personalScoreFromJson
import org.json.JSONArray
import org.json.JSONObject

class HttpPersonalizationGateway(private val transport: HttpTransport) : PersonalizationGateway {
    private fun call(
        c: BackendConnection,
        path: String,
        method: String = "GET",
        body: JSONObject? = null,
        token: String? = null,
    ) =
        transport.request(
            c.baseUrl,
            path,
            c.collectorToken,
            method,
            body?.toString(),
            personalToken = token,
        )

    override fun accounts(connection: BackendConnection): List<PersonalAccount> {
        val rows = call(connection, "/v1/demo/accounts").getJSONArray("accounts")
        return (0 until rows.length()).map {
            rows.getJSONObject(it).run { PersonalAccount(getString("id"), getString("name")) }
        }
    }

    override fun request(
        connection: BackendConnection,
        scopes: List<String>,
        mode: String,
    ): ConnectionChallenge =
        call(
                connection,
                "/v1/personal/connections",
                "POST",
                JSONObject().put("scopes", JSONArray(scopes)).put("mode", mode),
            )
            .run {
                ConnectionChallenge(
                    getString("requestId"),
                    getString("code"),
                    getString("expiresAt"),
                )
            }

    override fun approve(
        connection: BackendConnection,
        challenge: ConnectionChallenge,
        account: String,
    ): ConnectedPerson =
        call(
                connection,
                "/v1/demo/personal/connections/${challenge.id}/approve",
                "POST",
                JSONObject()
                    .put("accountId", account)
                    .put("code", challenge.code)
                    .put("confirmed", true),
            )
            .run { ConnectedPerson(getString("token"), session(getJSONObject("session"))) }

    override fun cancel(connection: BackendConnection, id: String) {
        call(connection, "/v1/personal/connections/$id", "DELETE", JSONObject())
    }

    override fun refresh(connection: BackendConnection, token: String) =
        session(call(connection, "/v1/personal/session", token = token))

    override fun seat(connection: BackendConnection, token: String, seat: String) =
        session(
            call(
                connection,
                "/v1/personal/session/seat",
                "PUT",
                JSONObject().put("seat", seat),
                token,
            )
        )

    override fun scopes(connection: BackendConnection, token: String, scopes: List<String>) =
        session(
            call(
                connection,
                "/v1/personal/session/scopes",
                "PUT",
                JSONObject().put("scopes", JSONArray(scopes)),
                token,
            )
        )

    override fun preview(connection: BackendConnection, token: String): PreferencePreview =
        call(connection, "/v1/personal/session/preview", "POST", JSONObject(), token).run {
            PreferencePreview(
                getString("previewId"),
                getString("expiresAt"),
                items(getJSONArray("items")),
            )
        }

    override fun apply(connection: BackendConnection, token: String, id: String) =
        items(
            call(
                    connection,
                    "/v1/personal/session/previews/$id/apply",
                    "POST",
                    JSONObject().put("confirmed", true),
                    token,
                )
                .getJSONArray("items")
        )

    override fun save(
        connection: BackendConnection,
        token: String,
        revision: Int,
        values: JSONObject,
    ) =
        session(
            call(
                connection,
                "/v1/personal/profile",
                "PUT",
                JSONObject().put("revision", revision).put("values", values),
                token,
            )
        )

    override fun end(connection: BackendConnection, id: String) {
        call(connection, "/v1/personal/sessions/$id", "DELETE", JSONObject())
    }

    private fun items(rows: JSONArray) =
        (0 until rows.length()).map {
            rows.getJSONObject(it).run {
                PreferenceItem(
                    getString("scope"),
                    opt("value").toString(),
                    getString("status"),
                    getString("reason"),
                )
            }
        }

    private fun session(value: JSONObject) =
        value.run {
            fun strings(key: String): List<String> {
                val array = getJSONArray(key)
                return (0 until array.length()).map(array::getString)
            }
            PersonalSession(
                getString("sessionId"),
                getString("accountId"),
                getString("displayName"),
                strings("scopes"),
                if (isNull("seat")) null else getString("seat"),
                strings("availableSeats"),
                getString("expiresAt"),
                getInt("revision"),
                getInt("profileRevision"),
                getJSONObject("preferences"),
                personalScoreFromJson(getJSONObject("personalScore")),
            )
        }
}
