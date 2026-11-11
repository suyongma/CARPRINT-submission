package com.maandlee.carprint.care

import android.app.AlertDialog
import android.widget.LinearLayout
import com.maandlee.carprint.R
import com.maandlee.carprint.ui.*

fun LinearLayout.showCareAssessment(controller: CareAssessmentController) {
    addView(context.label("차량 관리 평가", 23f, R.color.text_primary, true).apply {
        isAccessibilityHeading = true
    })
    addView(
        context.label(
            controller.status,
            18f,
            if (controller.example == null) R.color.text_secondary else R.color.warning,
        )
    )
    controller.result?.let { result ->
        val score = if (result.isNull("score")) "평가 보류" else "${result.getInt("score")}점"
        addView(
            context.label(score, 46f, R.color.text_primary, true).apply {
                contentDescription = "관리 평가 $score"
            }
        )
        val period = result.getJSONObject("period")
        addView(
            context.label(
                "${period.getString("from").take(10)} — ${period.getString("to").take(10)} · 작업 기회 ${result.getInt("opportunityCount")}개 · D0.1",
                17f,
            )
        )
        addView(context.label(result.getString("notice"), 16f, R.color.warning))
        val reasons = result.getJSONArray("reasons")
        val reasonText = (0 until reasons.length()).joinToString("\n") { "• ${reasons.getString(it)}" }
        if (reasons.length() > 0) addView(context.label(reasons.getString(0), 18f))
        space(12)
        addView(
            context.recordButton("점수 근거와 평가 범위") {
                val items = result.getJSONArray("items")
                val details =
                    (0 until items.length()).joinToString("\n\n") {
                        items.getJSONObject(it).run {
                            "${getString("label")} · ${if(isNull("quality"))"확인 필요" else "${Math.round(getDouble("quality")*100)}%"}\n근거 ${optString("evidenceId")}"
                        }
                    }
                AlertDialog.Builder(context)
                    .setTitle("예방 관리 75% · 문제 조치 25%")
                    .setMessage(
                        listOf(
                            result.getString("notice"),
                            reasonText,
                            details,
                            "${result.getString("changeReason")}\n평가 ID ${result.getString("assessmentId")}",
                            "자료 공백이나 검증 취소를 0점 또는 정상으로 바꾸지 않습니다.",
                        ).filter(String::isNotBlank).joinToString("\n\n")
                    )
                    .setPositiveButton("닫기", null)
                    .show()
            },
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT,
        )
        val departure = result.getJSONObject("departure")
        divider()
        addView(context.label("출발 전 확인", 23f, R.color.text_primary, true))
        val alerts = departure.getJSONArray("items")
        if (alerts.length() == 0)
            addView(
                context.label(
                    if (departure.getString("state") == "unknown") "확인할 관측 자료가 부족합니다."
                    else "저장 기록에서 우선 확인할 미해결 경고가 없습니다.",
                    18f,
                )
            )
        else addView(context.label(alerts.getString(0), 22f, R.color.warning, true))
        addView(context.label(departure.getString("notice"), 16f))
    }
    space(12)
    addView(
        context
            .recordButton("현재 차량 기록으로 평가 확인") { controller.load() }
            .apply { isEnabled = !controller.busy },
        LinearLayout.LayoutParams.WRAP_CONTENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
    )
    if (controller.examples.isNotEmpty()) {
        space(8)
        addView(
            context
                .recordButton("합성 평가 예제 보기") {
                    AlertDialog.Builder(context)
                        .setTitle("현재 차량과 분리된 계산 예제")
                        .setItems(controller.examples.map { it.label }.toTypedArray()) { _, index ->
                            controller.load(controller.examples[index].id)
                        }
                        .setNegativeButton("취소", null)
                        .show()
                }
                .apply { isEnabled = !controller.busy },
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT,
        )
    }
}
