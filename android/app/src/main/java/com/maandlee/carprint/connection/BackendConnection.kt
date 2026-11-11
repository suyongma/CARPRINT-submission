package com.maandlee.carprint.connection

import android.content.Context
import android.content.pm.ApplicationInfo
import com.maandlee.carprint.demo.DemoContext
import java.io.File
import java.net.URL
import org.json.JSONObject

data class BackendConnection(
    val baseUrl: String,
    val vehicleRef: String,
    val sourceRef: String,
    val environment: String,
    val collectorToken: String,
    val managerToken: String,
)

/** 개발용 결속은 개인 로그인/차량 소유권 인증이 아니다. release에서는 파일 bootstrap을 읽지 않는다. */
class BackendConnectionStore(
    private val context: Context,
    private val vault: DeviceVault,
    private val expectedEnvironment: String,
    // graph 생성 시 고정. 전환 전 대기 작업이 새 차량 자격으로 전송되지 않게 한다.
    private val selectedContextId: String =
        context
            .getSharedPreferences("demo-context", Context.MODE_PRIVATE)
            .getString("selected", "a:a")!!,
) {
    @Synchronized
    // 개발 bootstrap은 검사하고 암호화 저장한 뒤 원문 지움. release는 파일 안 읽고 저장된 연결만 씀. _ma
    private fun readPack(): String? {
        val bootstrap = File(context.filesDir, "bootstrap.json")
        if (
            context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0 &&
                bootstrap.exists()
        ) {
            val text = bootstrap.readText()
            val pack = JSONObject(text)
            if (pack.has("contexts")) {
                val contexts = pack.getJSONArray("contexts")
                require(contexts.length() in 1..8)
                repeat(contexts.length()) { parse(contexts.getJSONObject(it).toString()) }
            } else parse(text)
            vault.put("backend-connection", text)
            check(bootstrap.delete()) { "BOOTSTRAP_CLEANUP_FAILED" }
        }
        return vault.get("backend-connection")
    }

    @Synchronized
    // graph 만들 때 정한 context 자격만 줌. 화면에서 차 바꿨다고 이전 대기 작업에 새 토큰 섞으면 안 됨. _ma
    fun load(): BackendConnection? {
        val pack = readPack()?.let(::JSONObject) ?: return null
        if (!pack.has("contexts")) return parse(pack.toString())
        val contexts = pack.getJSONArray("contexts")
        for (index in 0 until contexts.length()) {
            val selected = contexts.getJSONObject(index)
            if (selected.getString("context_id") == selectedContextId)
                return parse(selected.toString())
        }
        throw IllegalStateException("CONTEXT_BINDING_MISSING")
    }

    @Synchronized
    fun contexts(): List<DemoContext> {
        val pack = readPack()?.let(::JSONObject) ?: return emptyList()
        val contexts = pack.optJSONArray("contexts") ?: return emptyList()
        return (0 until contexts.length()).map { index ->
            contexts.getJSONObject(index).run {
                DemoContext(
                    getString("context_id"),
                    getString("vehicle_key"),
                    getString("vehicle_label"),
                    getString("user_key"),
                    getString("user_label"),
                    getInt("climate_celsius"),
                    getInt("media_volume"),
                    getBoolean("can_manage_reports"),
                )
            }
        }
    }

    /**
     * 최초 연결만 허용한다. 대기 기록·다른 서버의 세션을 새 서버 자격으로 보내지 않는다. 전체 pack을 검사한 뒤 한 암호화 값으로 저장한다. 검증/저장 예외를 숨기지
     * 않으며 기존 자격을 덮어쓰지 않는다. JSON 원문에는 토큰이 포함되므로 예외 메시지나 디버그 로그에 포함하지 않는다.
     */
    @Synchronized
    fun install(text: String, origin: String) {
        check(readPack() == null) { "CONNECTION_ALREADY_CONFIGURED" }
        val pack = JSONObject(text)
        val list = pack.optJSONArray("contexts")
        val entries =
            if (list == null) listOf(pack)
            else (0 until list.length()).map { list.getJSONObject(it) }
        require(entries.size in 1..8)
        val ids = mutableSetOf<String>()
        entries.forEach {
            val parsed = parse(it.toString())
            require(parsed.baseUrl == origin.trimEnd('/'))
            require(parsed.collectorToken.isNotBlank() && parsed.managerToken.isNotBlank())
            java.util.UUID.fromString(parsed.vehicleRef)
            java.util.UUID.fromString(parsed.sourceRef)
            if (list != null) {
                require(ids.add(it.getString("context_id")))
                require(
                    it.getString("context_id") ==
                        "${it.getString("vehicle_key")}:${it.getString("user_key")}"
                )
                require(it.getString("vehicle_key") in listOf("a", "b"))
                require(it.getString("user_key") in listOf("a", "b"))
                it.getString("vehicle_label")
                it.getString("user_label")
                it.getInt("climate_celsius")
                it.getInt("media_volume")
                it.getBoolean("can_manage_reports")
            }
        }
        if (list != null) require("a:a" in ids)
        vault.put("backend-connection", text)
        context
            .getSharedPreferences("demo-context", Context.MODE_PRIVATE)
            .edit()
            .putString("selected", "a:a")
            .commit()
    }

    // 주소랑 flavor 환경 확인. 기본 HTTPS고 debug에서만 정해진 로컬 호스트 HTTP 허용. _ma
    private fun parse(text: String): BackendConnection {
        val json = JSONObject(text)
        val address = URL(json.getString("base_url"))
        require(address.userInfo == null && address.query == null && address.ref == null)
        require(address.path.isEmpty() || address.path == "/")
        require(
            address.protocol == "https" ||
                (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0 &&
                    address.protocol == "http" &&
                    address.host in listOf("10.0.2.2", "127.0.0.1"))
        )
        require(json.getString("environment") == expectedEnvironment) {
            "ENVIRONMENT_BINDING_MISMATCH"
        }
        return BackendConnection(
            address.toString().trimEnd('/'),
            json.getString("vehicle_ref"),
            json.getString("source_ref"),
            json.getString("environment"),
            json.getString("collector_token"),
            json.getString("manager_token"),
        )
    }
}
