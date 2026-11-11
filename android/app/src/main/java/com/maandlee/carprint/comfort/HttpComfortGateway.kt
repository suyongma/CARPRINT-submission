package com.maandlee.carprint.comfort

import com.maandlee.carprint.connection.*
import org.json.JSONArray
import org.json.JSONObject

class HttpComfortGateway(private val transport: HttpTransport) : ComfortGateway {
    private fun call(
        c: BackendConnection,
        token: String,
        path: String = "",
        method: String = "GET",
        body: JSONObject? = null,
    ) =
        transport.request(
            c.baseUrl,
            "/v1/personal/comfort$path",
            c.collectorToken,
            method,
            body?.toString(),
            personalToken = token,
        )

    override fun read(c: BackendConnection, token: String) = view(call(c, token))

    override fun save(
        c: BackendConnection,
        token: String,
        revision: Int,
        target: String,
        values: Map<String, Double>,
    ) =
        view(
            call(
                c,
                token,
                method = "PUT",
                body =
                    JSONObject()
                        .put("revision", revision)
                        .put("target", target)
                        .put("values", JSONObject(values)),
            )
        )

    override fun reset(c: BackendConnection, token: String, revision: Int) =
        view(
            call(
                c,
                token,
                "/reset-vehicle",
                "POST",
                JSONObject().put("revision", revision).put("confirmed", true),
            )
        )

    override fun preview(c: BackendConnection, token: String) =
        call(c, token, "/previews", "POST", JSONObject()).run {
            ComfortPreview(getString("id"), getString("expiresAt"), items(getJSONArray("items")))
        }

    override fun apply(c: BackendConnection, token: String, id: String) =
        items(
            call(c, token, "/previews/$id/apply", "POST", JSONObject().put("confirmed", true))
                .getJSONArray("items")
        )

    override fun presets(c: BackendConnection, token: String): List<PassengerPreset> {
        val rows = call(c, token, "/presets").getJSONArray("presets")
        return (0 until rows.length()).map {
            rows.getJSONObject(it).run {
                PassengerPreset(
                    getString("id"),
                    getString("name"),
                    getString("ownerName"),
                    values(getJSONObject("values")),
                )
            }
        }
    }

    override fun savePreset(
        c: BackendConnection,
        token: String,
        name: String,
        values: Map<String, Double>,
    ) {
        call(
            c,
            token,
            "/presets",
            "POST",
            JSONObject().put("name", name).put("values", JSONObject(values)).put("confirmed", true),
        )
    }

    override fun loadPreset(c: BackendConnection, token: String, id: String, revision: Int) =
        view(
            call(
                c,
                token,
                "/presets/$id/load",
                "POST",
                JSONObject().put("revision", revision).put("confirmed", true),
            )
        )

    private fun values(json: JSONObject): Map<String, Double> =
        json.keys().asSequence().associateWith { json.getDouble(it) }

    private fun items(rows: JSONArray) =
        (0 until rows.length()).map {
            rows.getJSONObject(it).run {
                ComfortItem(
                    getString("key"),
                    getDouble("requested"),
                    if (isNull("target")) null else getDouble("target"),
                    getString("unit"),
                    getString("disposition"),
                    getString("source"),
                    getString("reason"),
                )
            }
        }

    private fun view(json: JSONObject): ComfortView =
        json.run {
            val cap = optJSONObject("capability")
            val range = cap?.getJSONObject("temperature")
            ComfortView(
                getInt("revision"),
                cap?.getString("name") ?: "지원 범위 미확인",
                if (cap == null) "실차 기능 확인 전 적용 차단"
                else
                    "${cap.getJSONArray("seats").length()}인승 · 공조 ${range!!.getDouble("min")}~${range.getDouble("max")}°C / ${range.getDouble("step")}°C 간격 · 풍량 ${cap.getInt("fanLevels")}단계",
                values(getJSONObject("portable")),
                values(getJSONObject("vehicleValues")),
                items(getJSONArray("items")),
                items(getJSONArray("lastApplied")),
                getString("notice"),
            )
        }
}
