package com.maandlee.carprint.reports

import com.maandlee.carprint.connection.BackendConnection

data class ReportDraft(
    val kind: String,
    val from: String,
    val to: String,
    val selectedIds: List<String>,
    val expiresIn: Int,
)

data class IssuedReport(
    val id: String,
    val shareUrl: String?,
    val issuedAt: String,
    val expiresAt: String,
    val state: String,
)

interface ReportGateway {
    /** 서버에서 범위 확정. 같은 key/body 재시도는 원본 리포트 유지, 암호화 응답 TTL 후 재발행 필요. */
    fun create(connection: BackendConnection, draft: ReportDraft, key: String): IssuedReport

    fun list(connection: BackendConnection): List<IssuedReport>

    fun status(connection: BackendConnection, report: IssuedReport): IssuedReport

    fun revoke(connection: BackendConnection, id: String, key: String)
}
