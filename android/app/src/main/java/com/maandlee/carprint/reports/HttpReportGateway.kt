package com.maandlee.carprint.reports

import com.maandlee.carprint.connection.*
import org.json.JSONArray
import org.json.JSONObject

class HttpReportGateway(private val transport: HttpTransport) : ReportGateway {
    override fun create(
        connection: BackendConnection,
        draft: ReportDraft,
        key: String,
    ): IssuedReport {
        val body =
            JSONObject()
                .put("vehicle_ref", connection.vehicleRef)
                .put("kind", draft.kind)
                .put(
                    "scope",
                    JSONObject()
                        .put("from", draft.from)
                        .put("to", draft.to)
                        .put("selected_event_ids", JSONArray(draft.selectedIds)),
                )
                .put("expires_in", draft.expiresIn)
        val result =
            transport.request(
                connection.baseUrl,
                "/v1/reports",
                connection.managerToken,
                "POST",
                body.toString(),
                key,
            )
        return IssuedReport(
            result.getString("report_id"),
            result.optString("share_url").takeIf { it.isNotBlank() },
            result.getString("issued_at"),
            result.getString("expires_at"),
            if (result.optBoolean("reissue_required")) "reissue_required" else "active",
        )
    }

    override fun list(connection: BackendConnection): List<IssuedReport> {
        val rows =
            transport
                .request(connection.baseUrl, "/v1/reports", connection.managerToken)
                .getJSONArray("reports")
        return (0 until rows.length()).map { index ->
            rows.getJSONObject(index).run {
                IssuedReport(
                    getString("report_id"),
                    null,
                    getString("issued_at"),
                    getString("expires_at"),
                    getString("state"),
                )
            }
        }
    }

    override fun status(connection: BackendConnection, report: IssuedReport): IssuedReport {
        val result =
            transport.request(
                connection.baseUrl,
                "/v1/reports/${report.id}",
                connection.managerToken,
            )
        return report.copy(state = result.getString("state"))
    }

    override fun revoke(connection: BackendConnection, id: String, key: String) {
        transport.request(
            connection.baseUrl,
            "/v1/reports/$id/share",
            connection.managerToken,
            "DELETE",
            body = "{}",
            key = key,
        )
    }
}
