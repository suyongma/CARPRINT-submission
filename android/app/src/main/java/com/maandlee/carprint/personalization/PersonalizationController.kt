package com.maandlee.carprint.personalization

import com.maandlee.carprint.comfort.*
import com.maandlee.carprint.connection.*
import org.json.JSONObject

/** 개인 세션은 메모리에만 존재. 종료 시 먼저 화면/토큰을 비우고 ID만으로 원격 종료를 재시도한다. */
class PersonalizationController(
    private val connection: () -> BackendConnection?,
    private val gateway: PersonalizationGateway,
    private val journal: PersonalSessionJournal,
    private val work: UiWorkScope,
    private val comfort: ComfortGateway,
    private val changed: () -> Unit,
) {
    var addingConnection = true
        private set

    fun addConnection() {
        addingConnection = true
        changed()
    }

    var accounts: List<PersonalAccount> = emptyList()
        private set

    val selectedScopes = linkedSetOf<String>()
    var mode = "temporary"
    var selectedAccount = "demo-a"
    var challenge: ConnectionChallenge? = null
        private set

    var busy = false
        private set

    var locked = false
        private set

    var status = "필요한 항목만 선택해 임시 계정으로 연결하세요. 외부 로그인·실제 차량 제어가 아닙니다."
        private set

    private val expiryHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val expire = Runnable {
        val expired =
            connected.values
                .filter {
                    java.time.Instant.parse(it.session.expiresAt).toEpochMilli() <=
                        System.currentTimeMillis()
                }
                .map { it.session.account }
        expired.forEach(::end)
    }

    // 제일 빨리 만료될 세션에 타이머 하나 걸음. 종료 후 남은 걸로 다시 예약. 서버도 매 요청마다 만료 확인함. _ma
    private fun scheduleExpiry() {
        expiryHandler.removeCallbacks(expire)
        connected.values
            .map { java.time.Instant.parse(it.session.expiresAt).toEpochMilli() }
            .minOrNull()
            ?.let { deadline ->
                expiryHandler.postDelayed(
                    expire,
                    (deadline - System.currentTimeMillis()).coerceAtLeast(1),
                )
            }
    }

    private var generation = 0
    private val connected = linkedMapOf<String, ConnectedPerson>()
    val sessions: List<PersonalSession>
        get() = if (locked) emptyList() else connected.values.map { it.session }

    val previews = mutableMapOf<String, PreferencePreview>()
    val results = mutableMapOf<String, List<PreferenceItem>>()

    val comfortViews = mutableMapOf<String, ComfortView>()
    val comfortPreviews = mutableMapOf<String, ComfortPreview>()
    val passengerPresets = mutableMapOf<String, List<PassengerPreset>>()

    private fun clearComfort(account: String? = null) {
        if (account == null) {
            comfortViews.clear()
            comfortPreviews.clear()
            passengerPresets.clear()
        } else {
            comfortViews.remove(account)
            comfortPreviews.remove(account)
            passengerPresets.remove(account)
        }
    }

    /** 토큰은 이 컨트롤러 경계 밖 UI로 넘기지 않는다. 저장 후 기존 개인 세션 버전도 갱신한다. */
    private fun updateComfort(account: String, action: (BackendConnection, String) -> ComfortView) {
        val p = person(account)
        run(
            {
                val c = config()
                val view = action(c, p.token)
                Triple(view, gateway.refresh(c, p.token), comfort.presets(c, p.token))
            },
            {
                replace(p, it.second)
                comfortViews[account] = it.first
                passengerPresets[account] = it.third
                status = "차량에 맞춘 설정 확인 완료 · 저장과 모의 적용은 별도입니다."
            },
        )
    }

    fun loadComfort(account: String) = updateComfort(account) { c, token -> comfort.read(c, token) }

    fun saveComfort(account: String, target: String, values: Map<String, Double>) {
        val revision = comfortViews[account]?.revision ?: return
        updateComfort(account) { c, token -> comfort.save(c, token, revision, target, values) }
    }

    fun resetComfort(account: String) {
        val revision = comfortViews[account]?.revision ?: return
        updateComfort(account) { c, token -> comfort.reset(c, token, revision) }
    }

    fun previewComfort(account: String) {
        val p = person(account)
        run(
            { comfort.preview(config(), p.token) },
            {
                comfortPreviews[account] = it
                status = "변환 내용을 확인하세요 · 1분 내 모의 적용 가능"
            },
        )
    }

    fun applyComfort(account: String) {
        val p = comfortPreviews[account] ?: return
        updateComfort(account) { c, token ->
            comfort.apply(c, token, p.id)
            comfort.read(c, token)
        }
    }

    fun savePassengerPreset(account: String, name: String, values: Map<String, Double>) =
        updateComfort(account) { c, token ->
            comfort.savePreset(c, token, name, values)
            comfort.read(c, token)
        }

    fun loadPassengerPreset(account: String, id: String) {
        val revision = comfortViews[account]?.revision ?: return
        updateComfort(account) { c, token -> comfort.loadPreset(c, token, id, revision) }
    }

    private fun config() = connection() ?: throw ApiFailure(401, "connection_required")

    private fun person(id: String) =
        connected[id] ?: throw ApiFailure(401, "personal_session_required")

    fun load() {
        if (busy) return
        run(
            {
                drain()
                gateway.accounts(config())
            },
            {
                accounts = it
                status = "임시 계정 준비됨 · 차량 데이터 연결과 개인 설정 연결은 별개입니다."
            },
        )
    }

    fun request() {
        if (busy || challenge != null || locked) return
        val scopes = selectedScopes.toList()
        val duration = mode
        run(
            {
                gateway.request(config(), scopes, duration).also {
                    journal.remember("request", it.id)
                }
            },
            {
                challenge = it
                status = "차량·계정·선택 항목·유효기간을 확인하고 승인해 주세요."
            },
        )
    }

    // 토큰은 메모리에만. 정리용 세션 ID 먼저 기록하고 요청 ID 지움. 중간에 끊겨도 종료할 단서는 남아야 함. _ma
    fun approve() {
        val request = challenge ?: return
        val account = selectedAccount
        run(
            {
                gateway.approve(config(), request, account).also {
                    journal.remember("session", it.session.id)
                    journal.forget("request", request.id)
                }
            },
            {
                connected[it.session.account] = it
                challenge = null
                addingConnection = false
                selectedScopes.clear()
                status = "승인 완료 · 좌석을 따로 배정하고 적용 내용을 확인하세요."
            },
        )
    }

    fun cancelRequest() {
        challenge = null
        retryCleanup()
    }

    fun assign(account: String, seat: String) {
        val p = person(account)
        run(
            { gateway.seat(config(), p.token, seat) },
            {
                replace(p, it)
                status = "좌석 배정만 완료 · 물리 시트 이동 없음"
            },
        )
    }

    fun removeScope(account: String, scope: String) {
        val p = person(account)
        // 응답이 지연되더라도 해제하려는 개인 값을 즉시 화면에서 숨긴다.
        val remaining = p.session.scopes.filterNot { it == scope }
        val safe = JSONObject(p.session.preferences.toString()).apply { remove(scope) }
        connected[account] =
            p.copy(session = p.session.copy(scopes = remaining, preferences = safe))
        clearComfort(account)
        previews.remove(account)
        results.remove(account)
        run(
            { gateway.scopes(config(), p.token, remaining) },
            {
                replace(p, it)
                status = "선택 항목 해제 완료 · 항목 추가는 새 승인 필요"
            },
            onFailure = { end(account) },
        )
    }

    fun preview(account: String) {
        val p = person(account)
        run(
            { gateway.preview(config(), p.token) },
            {
                previews[account] = it
                results.remove(account)
                status = "미리보기 유효시간 1분 · 아직 적용하지 않았습니다."
            },
        )
    }

    fun apply(account: String) {
        val p = person(account)
        val preview = previews[account] ?: return
        run(
            { gateway.apply(config(), p.token, preview.id) },
            {
                results[account] = it
                clearComfort(account)
                previews.remove(account)
                status = "항목별 결과를 확인하세요. 요청 접수는 적용 완료와 다릅니다."
            },
        )
    }

    fun saveClimate(account: String, value: Double) {
        val p = person(account)
        run(
            {
                gateway.save(
                    config(),
                    p.token,
                    p.session.profileRevision,
                    JSONObject().put("climate", value),
                )
            },
            {
                replace(p, it)
                status = "임시 계정 선호를 명시적으로 저장했습니다. 차량 적용은 별도입니다."
            },
        )
    }

    // 화면·메모리부터 비우고 원격 종료는 journal로 재시도. 세대 올려서 옛 응답이 계정 되살리지 못하게 함. _ma
    fun end(account: String) {
        generation++
        connected.remove(account)
        if (connected.isEmpty()) addingConnection = true
        clearComfort(account)
        previews.remove(account)
        results.remove(account)
        status = "기기 개인 정보 정리 완료 · 원격 종료 확인 중"
        changed()
        retryCleanup()
    }

    fun endAll() {
        generation++
        addingConnection = true
        connected.clear()
        clearComfort()
        previews.clear()
        results.clear()
        challenge = null
        selectedScopes.clear()
        locked = false
        status = "기기 개인 정보 정리 완료 · 원격 종료 확인 중"
        changed()
        retryCleanup()
    }

    // 잠금은 세션 종료 아님. 메모리 연결 두고 화면만 숨김. unlock할 때 서버에 아직 유효한지 다시 물어봄. _ma
    fun lock() {
        if (connected.isNotEmpty()) {
            locked = true
            clearComfort()
            previews.clear()
            results.clear()
            changed()
        }
    }

    fun unlock() {
        if (busy) return
        val people = connected.values.toList()
        run(
            { people.map { it.copy(session = gateway.refresh(config(), it.token)) } },
            {
                connected.clear()
                clearComfort()
                it.forEach { p -> connected[p.session.account] = p }
                locked = false
                status = "현재 연결 상태를 확인했습니다."
            },
        )
    }

    fun retryCleanup() {
        if (busy) return
        val retained = retainedIds()
        run(
            { drain(retained) },
            {
                status =
                    if (it == 0) "기기 정리·원격 종료 확인 완료 · 차량 기록과 계정 원본은 유지됩니다."
                    else "기기 정리 완료 · 원격 종료 확인 대기 ${it}건"
            },
        )
    }

    /** graph 폐기 시에도 worker 종료 전에 정리 작업을 큐에 넣는다. UI callback은 조립점에서 끊는다. */
    fun close() {
        expiryHandler.removeCallbacks(expire)
        generation++
        addingConnection = true
        connected.clear()
        clearComfort()
        previews.clear()
        results.clear()
        challenge = null
        work.run({ drain() }, {}, {})
    }

    private fun retainedIds() =
        connected.values.map { "session:${it.session.id}" }.toSet() +
            listOfNotNull(challenge?.let { "request:${it.id}" })

    // 지금 쓰는 ID 빼고 서버 정리함. 성공·404면 목록에서 삭제. 네트워크·권한 문제면 나중에 다시 하게 남겨둠. _ma
    private fun drain(retained: Set<String> = emptySet()): Int {
        val c = config()
        for (entry in journal.entries().filterNot { it in retained }) {
            val kind = entry.substringBefore(':')
            val id = entry.substringAfter(':')
            try {
                if (kind == "session") gateway.end(c, id) else gateway.cancel(c, id)
                journal.forget(kind, id)
            } catch (error: ApiFailure) {
                if (error.status == 404) journal.forget(kind, id)
                else if (!error.retryable && error.status !in listOf(401, 403)) throw error
            }
        }
        return journal.entries().count { it !in retained }
    }

    private fun replace(old: ConnectedPerson, session: PersonalSession) {
        connected[session.account] = old.copy(session = session)
        clearComfort(session.account)
        previews.remove(session.account)
        results.remove(session.account)
    }

    // 작업 하나씩 접수하고 시작·완료 세대 비교. 종료 뒤 온 응답은 화면에 안 쓰고 원격 정리 다시 시도. _ma
    private fun <T> run(action: () -> T, success: (T) -> Unit, onFailure: (() -> Unit)? = null) {
        if (busy) return
        val epoch = generation
        busy = true
        changed()
        work.run(
            action,
            {
                if (epoch == generation) success(it)
                busy = false
                scheduleExpiry()
                changed()
                if (epoch != generation) retryCleanup()
            },
            failure@{ error ->
                if (epoch != generation) {
                    busy = false
                    retryCleanup()
                    return@failure
                }
                if (error is ApiFailure && error.status == 401) {
                    connected.clear()
                    clearComfort()
                    previews.clear()
                    results.clear()
                    locked = false
                }
                status =
                    when ((error as? ApiFailure)?.code) {
                        "seat_already_assigned" -> "다른 계정이 사용 중인 좌석입니다. 해당 연결을 먼저 해제하세요."
                        "account_already_connected" ->
                            "이 계정의 이전 연결이 남아 있습니다. 이용 종료 또는 원격 종료 재시도 후 연결하세요."
                        "preview_changed",
                        "profile_revision_changed",
                        "preview_expired" -> {
                            clearComfort()
                            previews.clear()
                            "상태가 바뀌었거나 미리보기가 만료됐습니다. 연결을 확인하고 다시 미리보기 해 주세요."
                        }
                        else -> errorMessage(error)
                    }
                busy = false
                changed()
                onFailure?.invoke()
            },
        )
    }
}
