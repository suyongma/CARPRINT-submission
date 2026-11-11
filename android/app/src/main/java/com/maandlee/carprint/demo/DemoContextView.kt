package com.maandlee.carprint.demo

import android.widget.LinearLayout
import com.maandlee.carprint.R
import com.maandlee.carprint.ui.*

fun LinearLayout.showDemoContextSwitcher(
    controller: DemoContextController,
    switch: (String, String) -> Unit,
) {
    val current = controller.current ?: return
    divider()
    addView(context.label("개발용 차량·리포트 권한 전환", 26f, R.color.text_primary, true))
    addView(context.label("전환하면 기존 개인 연결은 종료됩니다. 위의 개인 계정 승인과 별개의 개발 설정입니다.", 17f))
    space(14)
    controller.choices
        .distinctBy { it.vehicleKey }
        .forEach { choice ->
            addView(
                context.recordButton(
                    (if (choice.vehicleKey == current.vehicleKey) "✓  " else "") +
                        choice.vehicleLabel
                ) {
                    switch(choice.vehicleKey, current.userKey)
                }
            )
        }
    space(12)
    controller.choices
        .distinctBy { it.userKey }
        .forEach { choice ->
            addView(
                context.recordButton(
                    (if (choice.userKey == current.userKey) "✓  " else "") + choice.userLabel
                ) {
                    switch(current.vehicleKey, choice.userKey)
                }
            )
        }
    divider()
    addView(
        context.label(
            if (current.canManageReports) "시연 권한: 차량 기록 조회 · 리포트 발급 및 취소"
            else "시연 권한: 차량 기록 조회 · 리포트 관리 권한 없음",
            17f,
        )
    )
}
