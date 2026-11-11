package com.maandlee.carprint.personalscore

import android.app.AlertDialog
import android.widget.LinearLayout
import com.maandlee.carprint.R
import com.maandlee.carprint.ui.*

private fun stateLabel(state: String) =
    when (state) {
        "unassessed" -> "평가 전 · 시작값"
        "accumulating" -> "기록 누적 중"
        "sample_ready" -> "시연 표본 충족"
        else -> "평가 상태 확인 필요"
    }

fun LinearLayout.showPersonalScore(score: PersonalScore) {
    space(12)
    addView(context.label("내 점수 · 차량이 바뀌어도 이어집니다", 22f, R.color.text_primary, true))
    addView(
        context.label("${score.score}점", 44f, R.color.text_primary, true).apply {
            contentDescription = "개인 종합 점수 ${score.score}점"
        }
    )
    addView(context.label("${stateLabel(score.state)} · 합성 시연", 18f, R.color.warning))
    addView(
        LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            listOf("주행 습관" to score.driving, "관리 이행" to score.care).forEach { (name, part) ->
                addView(
                    context.label(
                        "$name  ${part.score}점\n${part.count}건 · ${stateLabel(part.state)}",
                        20f,
                    ),
                    LinearLayout.LayoutParams(0, -2, 1f),
                )
            }
        }
    )
    addView(
        context.recordButton("개인 점수 산정 기준") {
            val period =
                if (score.firstEvidenceAt == null) "반영할 누적 기록 없음"
                else "${score.firstEvidenceAt.take(10)} — ${score.lastEvidenceAt?.take(10)}"
            AlertDialog.Builder(context)
                .setTitle("차량 점수와 분리된 내 기록")
                .setMessage(
                    "${score.notice}\n\n$period\n주행 ${score.driving.count}건 · 관리 ${score.care.count}건 · 제외 ${score.excludedCount}건\n\n${score.ruleVersion}: 두 항목 모두 50점에서 시작합니다. 각 항목은 시작값 10건분과 누적 평가를 합산하고, 종합 점수에는 두 항목을 같은 비율로 반영합니다.\n\n주행은 합성 운행의 거리당 급가감속 횟수, 관리는 담당이 확인된 작업의 기한 이행을 봅니다. 자료 부족·담당 미확인·취소 기록은 벌점 대신 제외합니다. 각 항목 10건부터 시연 표본 충족이며 실제 안전성 인증이 아닙니다.\n\n로그아웃·재설치·차량 변경은 서버의 개인 이력을 초기화하지 않습니다. 새 계정의 50점은 누적 평가와 동등하지 않습니다. 현재 임시 계정에는 동일인의 재가입 판별 기능이 없습니다."
                )
                .setPositiveButton("닫기", null)
                .show()
        }
    )
    divider()
}
