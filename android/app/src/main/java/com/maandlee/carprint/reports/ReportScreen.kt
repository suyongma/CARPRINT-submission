package com.maandlee.carprint.reports

import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.res.ColorStateList
import android.text.Editable
import android.text.TextWatcher
import android.widget.*
import com.maandlee.carprint.R
import com.maandlee.carprint.ui.*

fun LinearLayout.showReports(
    controller: ReportController,
    selected: List<String>,
    canManage: Boolean = true,
) {
    removeAllViews()
    recordHeading("RECORD REPORT", "기록을 공유하다", "원본·정정·공백을 함께 담고, 공유 기간을 직접 정합니다.")
    if (!canManage) {
        addView(context.label("현재 사용자는 차량 기록 조회만 가능합니다.", 26f, R.color.text_primary, true))
        addView(context.label("리포트 발급·조회·취소에는 관리 권한이 필요합니다. 내 공간에서 사용자 A로 전환해 시연할 수 있습니다.", 19f))
        return
    }
    addView(
        context.label(controller.status, 18f).apply {
            accessibilityLiveRegion = android.view.View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
    )
    divider()
    addView(context.label("발급 범위", 23f, R.color.text_primary, true))
    addView(
        Switch(context).apply {
            text = "일부 자료만 발급 · ${selected.size}개 선택"
            textSize = 20f
            minHeight = context.dp(64)
            setTextColor(context.getColor(R.color.text_primary))
            isChecked = controller.partial
            setOnCheckedChangeListener { _, checked -> controller.partial = checked }
        }
    )
    addView(context.label("전체 발급은 지정 기간 내 기록·정정·공백을 포함합니다. 일부 발급에는 전체 평가나 관리 점수를 넣지 않습니다.", 17f))
    fun dateField(label: String, initial: String, update: (String) -> Unit) {
        space(14)
        addView(context.label(label, 17f))
        addView(
            EditText(context).apply {
                setText(initial)
                textSize = 21f
                isSingleLine = true
                minHeight = context.dp(64)
                inputType =
                    android.text.InputType.TYPE_CLASS_DATETIME or
                        android.text.InputType.TYPE_DATETIME_VARIATION_DATE
                setTextColor(context.getColor(R.color.text_primary))
                backgroundTintList = ColorStateList.valueOf(context.getColor(R.color.stroke))
                contentDescription = label
                addTextChangedListener(
                    object : TextWatcher {
                        override fun beforeTextChanged(
                            s: CharSequence?,
                            start: Int,
                            count: Int,
                            after: Int,
                        ) {}

                        override fun onTextChanged(
                            s: CharSequence?,
                            start: Int,
                            before: Int,
                            count: Int,
                        ) {
                            update(s.toString())
                        }

                        override fun afterTextChanged(s: Editable?) {}
                    }
                )
            }
        )
    }
    dateField("시작일 · YYYY-MM-DD · 기기 시간대", controller.fromDate) { controller.fromDate = it }
    dateField("종료일 · YYYY-MM-DD · 기기 시간대", controller.toDate) { controller.toDate = it }
    space(20)
    addView(context.label("공유 유효기간", 19f, R.color.text_primary, true))
    val durations = listOf(3600, 86400, 604800)
    addView(
        RadioGroup(context).apply {
            orientation = RadioGroup.HORIZONTAL
            listOf("1시간", "1일", "7일").forEachIndexed { index, text ->
                addView(
                    RadioButton(context).apply {
                        id = android.view.View.generateViewId()
                        this.text = text
                        textSize = 18f
                        minHeight = context.dp(64)
                        setTextColor(context.getColor(R.color.text_primary))
                        buttonTintList = ColorStateList.valueOf(context.getColor(R.color.accent))
                        isChecked = durations[index] == controller.expiresIn
                        setOnCheckedChangeListener { _, checked ->
                            if (checked) controller.expiresIn = durations[index]
                        }
                    },
                    RadioGroup.LayoutParams(0, -2, 1f),
                )
            }
        }
    )
    space(16)
    addView(
        context
            .recordButton(if (controller.busy) "처리 중…" else "리포트 발급", true) {
                controller.issue(selected)
            }
            .apply {
                isEnabled = !controller.busy
                id = R.id.issue_report
            }
    )
    divider()
    addView(
        context
            .recordButton("발급 목록 새로고침") { controller.loadList() }
            .apply { isEnabled = !controller.busy }
    )
    controller.issued.forEach { report ->
        addView(
            context
                .recordButton("${displayTime(report.issuedAt)} · ${report.state}") {
                    controller.choose(report)
                }
                .apply { isEnabled = !controller.busy }
        )
    }
    controller.current?.let { report ->
        divider()
        val labels =
            mapOf(
                "active" to "공유 중",
                "revoked" to "공유 취소됨",
                "expired" to "공유 만료",
                "changed" to "근거 변경 · 재발급 필요",
                "reissue_required" to "링크 복구 기간 만료",
                "unconfirmed" to "현재 공유 상태 미확인",
            )
        addView(
            context.label(labels[report.state] ?: report.state, 30f, R.color.text_primary, true)
        )
        addView(
            context.label(
                "발급 ${displayTime(report.issuedAt)}\n만료 ${displayTime(report.expiresAt)}",
                18f,
            )
        )
        addView(
            context
                .recordButton("공유 상태 새로 확인") { controller.refresh() }
                .apply { isEnabled = !controller.busy }
        )
        if (report.state == "active" && report.shareUrl == null)
            addView(context.label("기존 공유 비밀은 목록에서 다시 내려받지 않습니다. 링크가 없으면 새로 발급해 주세요.", 17f))
        if (report.state == "active" && report.shareUrl != null) {
            addView(
                context.label(
                    if (report.shareUrl.startsWith("https://"))
                        "인터넷 브라우저에서 열 수 있는 시연 리포트입니다. 공유 취소 또는 만료 시 열람이 차단됩니다."
                    else "로컬 시연용 · 서버를 실행한 컴퓨터의 브라우저에서 열 수 있습니다.",
                    17f,
                )
            )
            addView(
                context.recordButton("공유 링크 복사") {
                    (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                        .setPrimaryClip(ClipData.newPlainText("CARPRINT report", report.shareUrl))
                    Toast.makeText(context, "링크를 복사했습니다", Toast.LENGTH_SHORT).show()
                }
            )
        }
        if (report.state !in listOf("revoked", "expired"))
            addView(
                context
                    .recordButton("공유 취소") {
                        AlertDialog.Builder(context)
                            .setTitle("이 리포트 공유를 취소할까요?")
                            .setMessage("기존 방문 세션도 더 이상 열람할 수 없습니다. 차량 원본 기록은 유지됩니다.")
                            .setNegativeButton("돌아가기", null)
                            .setPositiveButton("공유 취소") { _, _ -> controller.revoke() }
                            .show()
                    }
                    .apply { isEnabled = !controller.busy }
            )
    }
}
