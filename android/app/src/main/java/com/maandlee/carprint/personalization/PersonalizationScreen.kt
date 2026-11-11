package com.maandlee.carprint.personalization

import android.app.AlertDialog
import android.content.res.ColorStateList
import android.widget.*
import com.maandlee.carprint.R
import com.maandlee.carprint.comfort.showComfort
import com.maandlee.carprint.personalscore.showPersonalScore
import com.maandlee.carprint.ui.*

private val scopeNames =
    linkedMapOf(
        "climate" to "공조 선호",
        "volume" to "미디어 음량",
        "destination" to "목적지 별칭",
        "seat" to "좌석 위치·열선·통풍 선호",
    )
private val seatNames =
    mapOf(
        "driver" to "운전석",
        "front_passenger" to "조수석",
        "second_left" to "2열 왼쪽",
        "second_center" to "2열 가운데",
        "second_right" to "2열 오른쪽",
        "third_left" to "3열 왼쪽",
        "third_right" to "3열 오른쪽",
    )

// 개인 상태 화면에 붙이는 LinearLayout 확장 함수. 버튼 처리는 controller로. 여기서 HTTP나 토큰 저장 안 함. _ma
fun LinearLayout.showPersonalization(controller: PersonalizationController) {
    removeAllViews()
    recordHeading(
        "PERSONAL SPACE",
        context.getString(R.string.space_heading),
        "차량 점수는 차에, 내 점수는 계정에 남습니다. 임시 계정으로 확인하세요.",
    )
    addView(context.label(controller.status, 18f))
    fun button(text: String, primary: Boolean = false, action: () -> Unit) {
        addView(context.recordButton(text, primary, action).apply { isEnabled = !controller.busy })
    }
    if (controller.locked) {
        addView(context.label("개인 정보 잠금", 30f, R.color.text_primary, true))
        button("연결 상태 확인 후 다시 보기", true) { controller.unlock() }
        addView(context.recordButton("모든 개인 연결 종료") { controller.endAll() })
        return
    }
    if (controller.accounts.isEmpty()) button("임시 계정 불러오기") { controller.load() }
    if (!controller.addingConnection && controller.sessions.isNotEmpty())
        button("다른 계정 연결") { controller.addConnection() }
    if (
        controller.challenge == null &&
            (controller.addingConnection || controller.sessions.isEmpty())
    ) {
        divider()
        addView(context.label("새 개인 연결", 25f, R.color.text_primary, true))
        addView(context.label("로그인 승인 시 이름·내 점수를 표시합니다. 아래 선택 설정은 기본 꺼짐입니다.", 17f))
        scopeNames.forEach { (scope, title) ->
            addView(
                CheckBox(context).apply {
                    text = title
                    textSize = 19f
                    minHeight = context.dp(64)
                    setTextColor(context.getColor(R.color.text_primary))
                    buttonTintList = ColorStateList.valueOf(context.getColor(R.color.accent))
                    isChecked = scope in controller.selectedScopes
                    isEnabled = !controller.busy
                    setOnCheckedChangeListener { _, checked ->
                        if (checked) controller.selectedScopes.add(scope)
                        else controller.selectedScopes.remove(scope)
                    }
                }
            )
        }
        addView(
            context.label(
                "좌석·공조는 차량별 맞춤 모의 적용을 제공합니다. 실제 시트·공조 제어와 외부 내비 전송은 하지 않습니다.",
                16f,
                R.color.warning,
            )
        )
        addView(
            Switch(context).apply {
                text = "이번 이용 동안 연결 · 최대 2시간 (끄면 일회성 30분)"
                textSize = 18f
                minHeight = context.dp(64)
                setTextColor(context.getColor(R.color.text_primary))
                isChecked = controller.mode == "trip"
                isEnabled = !controller.busy
                setOnCheckedChangeListener { _, checked ->
                    controller.mode = if (checked) "trip" else "temporary"
                }
            }
        )
        button("선택 항목으로 연결 요청", true) { controller.request() }
    } else if (controller.challenge != null) {
        val request = controller.challenge!!
        divider()
        addView(context.label("연결 확인 코드 ${request.code}", 30f, R.color.text_primary, true))
        addView(
            context.label(
                "선택: ${controller.selectedScopes.joinToString {scopeNames[it]?:it}.ifEmpty {"선택 없음"}}\n만료 ${displayTime(request.expiresAt)}",
                18f,
            )
        )
        controller.accounts.forEach { account ->
            button("${account.name}로 승인") {
                AlertDialog.Builder(context)
                    .setTitle("${account.name} 연결 승인")
                    .setMessage(
                        "현재 차량 · 코드 ${request.code}\n${controller.selectedScopes.joinToString {scopeNames[it]?:it}}\n${if(controller.mode=="temporary")"일회성 30분" else "이번 이용 최대 2시간"}\n\n계정 이름·개인 점수와 선택한 설정을 이 화면에 표시합니다.\nDB의 임시 계정 승인입니다. 실제 본인 인증은 아닙니다."
                    )
                    .setNegativeButton("돌아가기", null)
                    .setPositiveButton("선택 범위 승인") { _, _ ->
                        controller.selectedAccount = account.id
                        controller.approve()
                    }
                    .show()
            }
        }
        button("연결 요청 취소") { controller.cancelRequest() }
    }
    controller.sessions.forEach { session ->
        divider()
        addView(context.label(session.name, 28f, R.color.text_primary, true))
        addView(
            context.label(
                "이용 만료 ${displayTime(session.expiresAt)} · 프로필 버전 ${session.profileRevision}",
                16f,
            )
        )
        showPersonalScore(session.personalScore)
        addView(context.label("좌석 배정 · 설정 적용과 별개", 20f, R.color.text_primary, true))
        if (session.seats.isEmpty())
            addView(context.label("이 환경의 좌석 구성 미확인 · 실제 적용 차단", 18f, R.color.warning))
        listOf(
                session.seats.filter { it == "driver" || it == "front_passenger" },
                session.seats.filter { it.startsWith("second_") },
                session.seats.filter { it.startsWith("third_") },
            )
            .filter { it.isNotEmpty() }
            .forEach { rowSeats ->
                addView(
                    LinearLayout(context).apply {
                        orientation = LinearLayout.HORIZONTAL
                        rowSeats.forEach { seat ->
                            addView(
                                context
                                    .recordButton(
                                        (if (seat == session.seat) "✓ " else "") +
                                            (seatNames[seat] ?: seat)
                                    ) {
                                        controller.assign(session.account, seat)
                                    }
                                    .apply { isEnabled = !controller.busy },
                                LinearLayout.LayoutParams(0, -2, 1f),
                            )
                        }
                    }
                )
            }
        session.scopes.forEach { scope ->
            space(10)
            addView(
                context.label(
                    "${scopeNames[scope]} · ${if (scope in listOf("climate", "seat")) "연결됨" else session.preferences.opt(scope)}",
                    21f,
                    R.color.text_primary,
                    true,
                )
            )
            button("${scopeNames[scope]} 연결 해제") { controller.removeScope(session.account, scope) }
        }
        showComfort(controller, session)
        button("기존 연결 항목 진단 (음량·목적지 포함)") { controller.preview(session.account) }
        controller.previews[session.account]?.let { preview ->
            addView(
                context.label(
                    "적용 전 확인 · ${displayTime(preview.expiresAt)}까지",
                    20f,
                    R.color.text_primary,
                    true,
                )
            )
            preview.items.forEach {
                addView(context.label("${scopeNames[it.scope]} ${it.value}\n${it.reason}", 18f))
            }
            button("기존 연결 항목 진단 실행", true) { controller.apply(session.account) }
        }
        controller.results[session.account]?.forEach {
            addView(
                context.label(
                    "${scopeNames[it.scope]} · ${it.reason}",
                    19f,
                    if (it.status == "simulated_confirmed") R.color.accent else R.color.warning,
                )
            )
        }
        addView(context.recordButton("${session.name} 이용 종료") { controller.end(session.account) })
    }
    divider()
    addView(context.recordButton("모든 개인 연결 종료") { controller.endAll() })
    button("원격 종료 확인 재시도") { controller.retryCleanup() }
    addView(
        context.label(
            "종료 시 기기 개인 토큰·프로필·좌석 연결을 지웁니다. 차량 기록과 서버 계정 원본·개인 점수 이력은 유지합니다. 프로세스 재시작 시 개인 정보를 복구하지 않고 남은 연결 종료를 재시도합니다.",
            17f,
        )
    )
}
