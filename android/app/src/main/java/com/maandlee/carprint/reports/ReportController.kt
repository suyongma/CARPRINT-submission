package com.maandlee.carprint.reports

import com.maandlee.carprint.connection.*
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

class ReportController(
    private val connection: () -> BackendConnection?,
    private val gateway: ReportGateway,
    private val vault: DeviceVault,
    private val work: UiWorkScope,
    private val namespace: String,
    private val changed: () -> Unit,
) {
    var current: IssuedReport? = null
        private set

    var busy = false
        private set

    var status = "시연 관리 권한으로 발급합니다. 개인 로그인·소유권 인증과 별개입니다."
        private set

    var issued: List<IssuedReport> = emptyList()
        private set

    private var restoring = false
    var selectedIds: List<String> = emptyList()
        private set

    var fromDate = "2026-01-01"
        set(value) {
            field = value
            persistForm()
        }

    var toDate = java.time.LocalDate.now().toString()
        set(value) {
            field = value
            persistForm()
        }

    var partial = false
        set(value) {
            field = value
            persistForm()
        }

    var expiresIn = 3600
        set(value) {
            field = value
            persistForm()
        }

    fun select(ids: List<String>) {
        selectedIds = ids.distinct()
        persistForm()
    }

    // 작은 입력 상태는 동기 commit. 저장 직후 프로세스가 종료돼도 마지막 선택을 보존한다.
    private fun persistForm() {
        if (restoring) return
        try {
            vault.put(
                "$namespace:form",
                JSONObject()
                    .put("from", fromDate)
                    .put("to", toDate)
                    .put("partial", partial)
                    .put("expiry", expiresIn)
                    .put("ids", JSONArray(selectedIds))
                    .toString(),
            )
        } catch (error: Exception) {
            status = errorMessage(error)
        }
    }

    fun loadList() {
        if (busy) return
        busy = true
        // 온라인 목록 조회 중에는 발급 버튼도 즉시 잠근다. 표시와 내부 busy 상태가 다르면 빠른 탭이 유실된다.
        changed()
        work.run(
            { gateway.list(connection() ?: throw ApiFailure(401, "connection_required")) },
            {
                issued =
                    it.map { row ->
                        if (row.id == current?.id) row.copy(shareUrl = current?.shareUrl) else row
                    }
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

    fun choose(report: IssuedReport) {
        current = report
        refresh()
    }

    // 저장한 입력·마지막 발급 복구. restoring 중엔 setter 재저장 막음. 리포트 공유 상태는 서버에 다시 물어봄. _ma
    fun restore() {
        if (busy) return
        busy = true
        work.run(
            {
                val form = vault.get("$namespace:form")?.let(::JSONObject)
                Pair(vault.get("$namespace:last-report")?.let(::decodeReport), form)
            },
            {
                current = it.first
                restoring = true
                it.second?.let { form ->
                    fromDate = form.getString("from")
                    toDate = form.getString("to")
                    partial = form.getBoolean("partial")
                    expiresIn = form.getInt("expiry")
                    val ids = form.getJSONArray("ids")
                    selectedIds = (0 until ids.length()).map(ids::getString)
                }
                restoring = false
                busy = false
                if (current != null) refresh() else changed()
            },
            {
                status = errorMessage(it)
                busy = false
                changed()
            },
        )
    }

    // 날짜는 기기 시간대 기준. 종료일은 다음 날 자정 직전까지 넣어야 마지막 날도 통째로 들어감. _ma
    fun issue(selected: List<String>) {
        if (busy) return
        val from =
            runCatching {
                    java.time.LocalDate.parse(fromDate)
                        .atStartOfDay(java.time.ZoneId.systemDefault())
                        .toInstant()
                        .toString()
                }
                .getOrNull()
        val to =
            runCatching {
                    java.time.LocalDate.parse(toDate)
                        .plusDays(1)
                        .atStartOfDay(java.time.ZoneId.systemDefault())
                        .toInstant()
                        .minusMillis(1)
                        .toString()
                }
                .getOrNull()
        if (from == null || to == null || fromDate > toDate || (partial && selected.isEmpty())) {
            status = "기간을 YYYY-MM-DD로 입력하고 일부 발급 시 기록을 선택해 주세요."
            changed()
            return
        }
        val draft =
            ReportDraft(
                if (partial) "partial" else "full",
                from,
                to,
                if (partial) selected else emptyList(),
                expiresIn,
            )
        busy = true
        status = "발행 범위 확인 및 저장 중"
        changed()
        work.run(
            {
                val config = connection() ?: throw ApiFailure(401, "connection_required")
                val body = encodeDraft(draft).put("vehicle_ref", config.vehicleRef)
                // 보내기 전에 본문·멱등 키 암호화 저장. 응답 놓쳐도 같은 본문이면 이전 키로 결과 다시 받음. _ma
                val previous = vault.get("$namespace:pending-report")?.let(::JSONObject)
                // 응답 유실/프로세스 재시작에서도 같은 요청은 동일한 키를 사용한다.
                val key =
                    if (previous?.getJSONObject("draft")?.toString() == body.toString())
                        previous.getString("key")
                    else UUID.randomUUID().toString()
                vault.put(
                    "$namespace:pending-report",
                    JSONObject().put("draft", body).put("key", key).toString(),
                )
                val report = gateway.create(config, draft, key)
                vault.put("$namespace:last-report", encodeReport(report).toString())
                vault.put("$namespace:pending-report", null)
                report
            },
            {
                current = it
                status =
                    if (it.state == "reissue_required") "이전 발행은 완료됐습니다. 링크 복구 기간이 지나 새 발급이 필요합니다."
                    else "발급 완료 · 브라우저에서 공유 링크를 열 수 있습니다."
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

    fun refresh() {
        val report = current ?: return
        if (busy) return
        busy = true
        work.run(
            {
                gateway.status(connection() ?: throw ApiFailure(401, "connection_required"), report)
            },
            {
                current = it
                status = "공유 상태 확인 완료"
                busy = false
                changed()
            },
            {
                current = report.copy(state = "unconfirmed")
                status = errorMessage(it)
                busy = false
                changed()
            },
        )
    }

    fun revoke() {
        val report = current ?: return
        if (busy) return
        busy = true
        changed()
        work.run(
            {
                gateway.revoke(
                    connection() ?: throw ApiFailure(401, "connection_required"),
                    report.id,
                    "revoke:${report.id}",
                )
                report.copy(state = "revoked").also {
                    vault.put("$namespace:last-report", encodeReport(it).toString())
                }
            },
            {
                current = it
                status = "공유 취소 완료 · 차량 원본 기록은 보존됩니다."
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

    private fun encodeDraft(draft: ReportDraft) =
        JSONObject()
            .put("kind", draft.kind)
            .put("from", draft.from)
            .put("to", draft.to)
            .put("ids", JSONArray(draft.selectedIds))
            .put("expiry", draft.expiresIn)

    private fun encodeReport(report: IssuedReport) =
        JSONObject()
            .put("id", report.id)
            .put("url", report.shareUrl ?: JSONObject.NULL)
            .put("issued", report.issuedAt)
            .put("expires", report.expiresAt)
            .put("state", report.state)

    private fun decodeReport(raw: String): IssuedReport =
        JSONObject(raw).run {
            IssuedReport(
                getString("id"),
                if (isNull("url")) null else getString("url"),
                getString("issued"),
                getString("expires"),
                getString("state"),
            )
        }
}
