package com.maandlee.carprint.connection

import android.content.Context
import android.content.pm.ApplicationInfo
import android.text.InputType
import android.widget.*
import com.maandlee.carprint.R
import com.maandlee.carprint.ui.*
import java.net.URL
import org.json.JSONObject

interface DemoSetupGateway {
    /**
     * 백그라운드 스레드에서 동기 I/O로 호출한다. 만료·권한·네트워크 실패를 호출자에게 전달한다. 서버 조회만 수행하며 기기 저장은 Store의 책임이다. 재시도는
     * 사용자가 결정하고 코드 원문은 저장하지 않는다.
     */
    fun connect(origin: String, code: String, flavor: String): String
}

class HttpDemoSetupGateway(private val http: HttpTransport) : DemoSetupGateway {
    override fun connect(origin: String, code: String, flavor: String): String =
        http
            .request(
                origin,
                "/v1/demo/setup",
                "",
                "POST",
                JSONObject().put("code", code).put("flavor", flavor).toString(),
            )
            .toString()
}

class DemoSetupController(
    private val context: Context,
    private val store: BackendConnectionStore,
    private val gateway: DemoSetupGateway,
    private val work: UiWorkScope,
    private val changed: () -> Unit,
) {
    var configured = false
        private set

    var checking = true
        private set

    var busy = false
        private set

    var status = "시연 연결 확인 중"
        private set

    var serverAddress = "https://carprint-demo-api.kingteer2.workers.dev"
        private set

    fun load() {
        work.run(
            { store.load() != null },
            {
                configured = it
                checking = false
                changed()
            },
            {
                checking = false
                status = errorMessage(it)
                changed()
            },
        )
    }

    // 코드 교환하고 연결 정보 검사·저장까지 worker에서 끝내야 configured. 응답 왔다고 끝난 거 아님. _ma
    fun connect(address: String, code: String) {
        if (busy || configured) return
        serverAddress = address.trim()
        busy = true
        status = "시연 서버 연결 중"
        changed()
        work.run(
            {
                val url = URL(address.trim())
                val debug = context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
                require(
                    url.protocol == "https" ||
                        (debug &&
                            url.protocol == "http" &&
                            url.host in listOf("10.0.2.2", "127.0.0.1"))
                )
                require(
                    url.userInfo == null &&
                        url.query == null &&
                        url.ref == null &&
                        url.path in listOf("", "/")
                )
                val origin = url.toString().trimEnd('/')
                require(code.trim().length in 12..100)
                val flavor = if (context.packageName.endsWith(".pleos")) "pleos" else "demo"
                store.install(gateway.connect(origin, code.trim(), flavor), origin)
            },
            {
                busy = false
                configured = true
                status = "시연 연결 완료"
                changed()
            },
            {
                busy = false
                status =
                    if (it is ApiFailure && it.status in listOf(401, 403))
                        "참여 코드가 올바르지 않거나 만료되었습니다. 제공받은 코드를 확인해 주세요."
                    else errorMessage(it)
                changed()
            },
        )
    }
}

fun LinearLayout.showDemoSetup(controller: DemoSetupController) {
    removeAllViews()
    recordHeading("CARPRINT DEMO", "시연 시작하기", "서버 주소와 제공받은 참여 코드를 입력하면 차량 A/B와 임시 계정으로 시작할 수 있습니다.")
    addView(context.label("합성 차량·계정으로 저장하고 조회하는 시연입니다. 실제 차량 소유권이나 본인 인증이 아닙니다.", 18f))
    val address =
        EditText(context).apply {
            hint = "https://시연 서버 주소"
            setText(controller.serverAddress)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine()
            minHeight = context.dp(64)
            setTextColor(context.getColor(R.color.text_primary))
        }
    val code =
        EditText(context).apply {
            hint = "시연 참여 코드"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setSingleLine()
            minHeight = context.dp(64)
            importantForAutofill = android.view.View.IMPORTANT_FOR_AUTOFILL_NO
            setTextColor(context.getColor(R.color.text_primary))
        }
    addView(address)
    addView(code)
    addView(context.label(controller.status, 18f))
    addView(
        context
            .recordButton("시연 서버에 연결", true) {
                controller.connect(address.text.toString(), code.text.toString())
            }
            .apply { isEnabled = !controller.checking && !controller.busy }
    )
    addView(
        context.label("연결 뒤 개인 로그인에서 필요한 설정만 선택합니다. 다른 사람도 같은 합성 계정을 쓰므로 실제 개인정보는 입력하지 마세요.", 16f)
    )
}
