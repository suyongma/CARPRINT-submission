package com.maandlee.carprint.driving

import android.widget.LinearLayout
import com.maandlee.carprint.R
import com.maandlee.carprint.ui.*

fun LinearLayout.showDrivingEvidence(controller: DrivingEvidenceController, start: () -> Unit) {
    divider()
    addView(context.label("Pleos 주행 신호 분석", 26f, R.color.text_primary, true))
    addView(context.label(controller.status, 18f))
    addView(
        context
            .recordButton(if (controller.observing) "속도 관측 종료·서버 분석" else "Pleos 속도 관측 시작") {
                if (controller.observing) controller.stop() else start()
            }
            .apply { isEnabled = !controller.busy && !controller.pending }
    )
    if (controller.pending) addView(context.recordButton("같은 관측 다시 전송") { controller.submit() })
    controller.result?.let { value ->
        addView(
            context.label(
                if (value.candidateScore == null) "주행 평가 보류"
                else "주행 부드러움 미리보기 ${value.candidateScore}점",
                28f,
                R.color.text_primary,
                true,
            )
        )
        addView(
            context.label(
                "${value.durationSeconds}초 · ${value.distanceKm}km\n급감속 후보 ${value.harshDecelerationCandidates}회 · 급가속 후보 ${value.harshAccelerationCandidates}회",
                18f,
            )
        )
        addView(context.label(value.notice, 16f, R.color.warning))
    }
    addView(
        context.label(
            "정상 표본 5분·5km 이상부터 계산 미리보기. 자료 공백·후진·시각 오류는 보류합니다. 급감속은 위험 회피 상황일 수 있습니다.",
            16f,
        )
    )
}
