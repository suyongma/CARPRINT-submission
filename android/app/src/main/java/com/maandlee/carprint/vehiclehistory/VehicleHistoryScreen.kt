package com.maandlee.carprint.vehiclehistory

import android.app.AlertDialog
import android.content.res.ColorStateList
import android.widget.CheckBox
import android.widget.LinearLayout
import com.maandlee.carprint.R
import com.maandlee.carprint.ui.*

fun LinearLayout.showVehicleHistory(
    controller: VehicleHistoryController,
    openReports: () -> Unit,
    selectionChanged: (List<String>) -> Unit = {},
) {
    removeAllViews()
    eyebrow(R.string.history_eyebrow)
    space(12)
    pageHeading(R.string.history_heading, R.string.history_description)
    addView(
        context.label(controller.status, 17f).apply {
            accessibilityLiveRegion = android.view.View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
    )
    space(12)
    addView(
        context
            .recordButton(if (controller.busy) "조회 중…" else "기록 새로고침") { controller.load() }
            .apply { isEnabled = !controller.busy }
    )
    if (controller.gaps.isNotEmpty()) {
        divider()
        addView(context.label("수집 공백 ${controller.gaps.size}개", 23f, R.color.warning, true))
        controller.gaps.forEach {
            addView(
                context.label(
                    "${displayTime(it.start)} — ${displayTime(it.end)}\n${it.scope} · 원인 미확인 · 정상/조작으로 단정하지 않음",
                    17f,
                )
            )
        }
    }
    if (controller.events.isEmpty() && !controller.busy) {
        divider()
        addView(context.label("첫 기록을 기다리고 있어요", 28f, R.color.text_primary, true))
    }
    controller.events.forEach { event ->
        divider()
        val source = if (event.environment == "simulation") "합성 시연" else "Pleos 에뮬레이터"
        addView(
            context.label(
                "#${event.sequence}  ·  $source  ·  ${displayTime(event.occurredAt)}",
                16f,
            )
        )
        addView(context.label(event.title, 30f, R.color.text_primary, true))
        if (event.correctedBy != null)
            addView(context.label("정정 전 원본 · 삭제하지 않고 보존", 17f, R.color.warning))
        if (event.type == "maintenance.corrected")
            addView(context.label("수행일 정정 · 원본과 연결됨", 17f, R.color.accent))
        if (event.flags.isNotEmpty()) addView(context.label("시각/거리 확인 항목 있음", 17f, R.color.warning))
        addView(
            context.recordButton("출처 · 정정 내역 보기") {
                val correction =
                    controller.corrections.firstOrNull {
                        it.originalId == event.id || it.newId == event.id
                    }
                val notes =
                    mapOf(
                        "measurement_time_unknown" to "차량 측정 시각 미제공",
                        "odometer_decreased_review" to "이전 수신 거리보다 작음 · 검토 필요",
                        "client_clock_ahead" to "앱 시각이 서버보다 앞섬",
                        "delayed_observation" to "발생 후 늦게 관측됨",
                    )
                AlertDialog.Builder(context)
                    .setTitle(event.title)
                    .setMessage(
                        "$source · ${event.source}\n출처 상태 ${event.sourceStatus}\n\n발생 ${displayTime(event.occurredAt)}\n앱 관측 ${displayTime(event.observedAt)}\n서버 수신 ${displayTime(event.receivedAt)}\n수신 순번 ${event.sequence}\n\n${event.flags.joinToString("\n") { notes[it] ?: it }}" +
                            (correction?.let {
                                "\n\n정정 사유: 수행일 변경\n원본 ${it.originalId}\n정정 ${it.newId}\n원본을 보존하며 정정된 근거로 다시 평가합니다."
                            } ?: "")
                    )
                    .setPositiveButton("닫기", null)
                    .show()
            }
        )
        addView(
            CheckBox(context).apply {
                text = "일부 리포트에 포함"
                textSize = 18f
                setTextColor(context.getColor(R.color.text_primary))
                buttonTintList = ColorStateList.valueOf(context.getColor(R.color.accent))
                minHeight = context.dp(64)
                isChecked = event.id in controller.selected
                setOnCheckedChangeListener { _, checked ->
                    if (checked) controller.selected.add(event.id)
                    else controller.selected.remove(event.id)
                    selectionChanged(controller.selected.toList())
                }
            }
        )
    }
    if (controller.nextCursor != null)
        addView(
            context
                .recordButton("이전 기록 더 보기") { controller.load(true) }
                .apply { isEnabled = !controller.busy }
        )
    divider()
    addView(context.recordButton("리포트 구성으로 이동", true, openReports))
}
