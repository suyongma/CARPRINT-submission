package com.maandlee.carprint.comfort

import android.app.AlertDialog
import android.widget.*
import com.maandlee.carprint.R
import com.maandlee.carprint.personalization.PersonalSession
import com.maandlee.carprint.personalization.PersonalizationController
import com.maandlee.carprint.ui.*

private val titles =
    linkedMapOf(
        "temperature" to "공조 온도",
        "fanPercent" to "선호 풍량",
        "seatPositionPercent" to "시트 앞뒤 상대 위치",
        "seatHeating" to "좌석 열선",
        "seatVentilation" to "좌석 통풍",
    )

private fun number(value: Double) =
    if (value % 1.0 == 0.0) value.toInt().toString() else value.toString()

private fun inputUnit(key: String) =
    when (key) {
        "temperature" -> "°C"
        "fanPercent",
        "seatPositionPercent" -> "%"
        else -> "단계"
    }

private fun targetText(item: ComfortItem): String {
    val value = item.target ?: return "건너뜀"
    return if (item.unit == "모의 mm") "모의 ${number(value)}mm" else number(value) + item.unit
}

private fun state(item: ComfortItem) =
    when (item.disposition) {
        "unchanged" -> "그대로"
        "adjusted" -> "차량 맞춤"
        "unsupported" -> "지원 안 됨"
        else -> "배정 필요"
    }

private fun LinearLayout.items(items: List<ComfortItem>) {
    items.forEach { item ->
        space(8)
        addView(
            context.label(
                "${titles[item.key]} · ${state(item)}",
                21f,
                if (item.target == null) R.color.warning else R.color.text_primary,
                true,
            )
        )
        addView(
            context.label(
                "${number(item.requested)}${inputUnit(item.key)} → ${targetText(item)}  ·  ${if(item.source == "vehicle") "이 차량 저장값" else "내 공통 선호"}\n${item.reason}",
                17f,
            )
        )
    }
}

/** 화면은 입력과 변환 결과만 다룬다. 지원 판단·저장 범위·승인은 서버 계약이 결정한다. */
fun LinearLayout.showComfort(controller: PersonalizationController, session: PersonalSession) {
    if (session.scopes.none { it == "climate" || it == "seat" }) return
    val account = session.account
    fun button(title: String, primary: Boolean = false, action: () -> Unit) {
        addView(context.recordButton(title, primary, action).apply { isEnabled = !controller.busy })
    }
    divider()
    addView(context.label("차가 달라도, 나에게 맞게", 27f, R.color.text_primary, true))
    val view = controller.comfortViews[account]
    button(if (view == null) "차량별 맞춤 설정 불러오기" else "설정·프리셋 새로고침") {
        controller.loadComfort(account)
    }
    if (view == null) return
    addView(context.label(view.vehicleName, 24f, R.color.text_primary, true))
    addView(context.label("${view.capabilitySummary}\n${view.notice}", 17f))
    items(view.items)
    val combined = view.portable + view.vehicleValues
    button("내 공통 선호 편집·저장") {
        editValues("차를 바꿔도 유지할 내 선호", view.portable) { _, values ->
            controller.saveComfort(account, "account", values)
        }
    }
    if (session.seat != null) {
        button("이 차량·이 좌석만 편집·저장") {
            editValues("현재 차량·좌석에만 저장", combined) { _, values ->
                controller.saveComfort(account, "vehicle", values)
            }
        }
        if (view.vehicleValues.isNotEmpty())
            button("이 차량 저장값 대신 내 공통 선호 사용") {
                AlertDialog.Builder(context)
                    .setTitle("현재 차량·좌석의 별도 저장값 해제")
                    .setMessage(
                        "승인한 항목만 공통 선호로 돌아갑니다. 다른 차량의 설정은 유지합니다. 모의 적용 상태는 다시 확인·적용해야 바뀝니다."
                    )
                    .setNegativeButton("취소", null)
                    .setPositiveButton("공통 선호 사용") { _, _ -> controller.resetComfort(account) }
                    .show()
            }
    }
    button("차량 맞춤 적용 전 확인", true) { controller.previewComfort(account) }
    controller.comfortPreviews[account]?.let { preview ->
        addView(
            context.label(
                "확인할 변환 결과 · ${displayTime(preview.expiresAt)}까지",
                21f,
                R.color.text_primary,
                true,
            )
        )
        items(preview.items)
        if (preview.items.any { it.target != null })
            button("지원 항목만 모의 적용", true) { controller.applyComfort(account) }
    }
    if (view.lastApplied.isNotEmpty()) {
        addView(context.label("마지막 모의 적용 결과", 21f, R.color.accent, true))
        addView(
            context.label(
                view.lastApplied.joinToString(" · ") { "${titles[it.key]} ${targetText(it)}" } +
                    "\n서버에 저장한 시연 상태이며 물리 차량 제어가 아닙니다.",
                17f,
            )
        )
    }
    divider()
    addView(context.label("동승자 프리셋", 23f, R.color.text_primary, true))
    if (session.seat == "driver") {
        addView(context.label("운전자 계정에 템플릿을 저장합니다. 동승자의 개인 계정 원본을 복사하거나 대신 로그인하지 않습니다.", 17f))
        button("동승자 프리셋 만들기·덮어쓰기") {
            editValues("동승자용 선호 직접 입력", view.portable, true) { name, values ->
                controller.savePassengerPreset(account, name, values)
            }
        }
    } else addView(context.label("현재 운전자가 공유한 프리셋 중 내가 승인한 항목만 불러옵니다. 내 계정 공통 선호는 유지합니다.", 17f))
    val presets = controller.passengerPresets[account].orEmpty()
    if (presets.isEmpty()) addView(context.label("저장된 프리셋 없음 · 운전자 로그인 후 생성하고 새로고침하세요.", 17f))
    presets.forEach { preset ->
        addView(
            context.label("${preset.name} · ${preset.ownerName}", 19f, R.color.text_primary, true)
        )
        val description =
            preset.values.entries.joinToString(" · ") {
                "${titles[it.key]} ${number(it.value)}${inputUnit(it.key)}"
            }
        addView(context.label(description, 17f))
        if (session.seat != null && session.seat != "driver" && preset.values.isNotEmpty())
            button("${preset.name}을 이 좌석에 불러오기") {
                AlertDialog.Builder(context)
                    .setTitle("동승자 설정 불러오기 승인")
                    .setMessage(
                        "$description\n\n현재 차량·좌석의 별도 저장값으로 불러옵니다. 실제 적용 전 변환 결과를 다시 확인합니다."
                    )
                    .setNegativeButton("취소", null)
                    .setPositiveButton("선택 범위 불러오기") { _, _ ->
                        controller.loadPassengerPreset(account, preset.id)
                    }
                    .show()
            }
    }
}

private fun LinearLayout.editValues(
    title: String,
    values: Map<String, Double>,
    preset: Boolean = false,
    save: (String, Map<String, Double>) -> Unit,
) {
    val form =
        LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(context.dp(24), context.dp(12), context.dp(24), context.dp(12))
        }
    val name =
        EditText(context).apply {
            hint = "프리셋 이름 (같은 이름은 덮어쓰기)"
            setSingleLine()
            filters = arrayOf(android.text.InputFilter.LengthFilter(40))
            setText("동승자 기본")
        }
    if (preset) form.addView(name)
    val selectors = linkedMapOf<String, Pair<Spinner, List<Double>>>()
    values.forEach { (key, value) ->
        val options =
            when (key) {
                    "temperature" -> (32..60).map { it / 2.0 }
                    "fanPercent",
                    "seatPositionPercent" -> (0..100 step 5).map { it.toDouble() }
                    else -> (0..3).map { it.toDouble() }
                }
                .plus(value)
                .distinct()
                .sorted()
        form.addView(context.label(titles[key] ?: key, 18f))
        val spinner =
            Spinner(context).apply {
                adapter =
                    ArrayAdapter(
                        context,
                        android.R.layout.simple_spinner_dropdown_item,
                        options.map { number(it) + inputUnit(key) },
                    )
                setSelection(options.indexOf(value))
                minimumHeight = context.dp(48)
            }
        form.addView(spinner)
        selectors[key] = spinner to options
    }
    val dialog =
        AlertDialog.Builder(context)
            .setTitle(title)
            .setView(ScrollView(context).apply { addView(form) })
            .setNegativeButton("취소", null)
            .setPositiveButton("입력값 저장", null)
            .create()
    dialog.setOnShowListener {
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
            if (preset && name.text.toString().trim().isEmpty()) name.error = "이름을 입력하세요"
            else {
                save(
                    name.text.toString().trim(),
                    selectors.mapValues { (_, pair) ->
                        pair.second[pair.first.selectedItemPosition]
                    },
                )
                dialog.dismiss()
            }
        }
    }
    dialog.show()
}
