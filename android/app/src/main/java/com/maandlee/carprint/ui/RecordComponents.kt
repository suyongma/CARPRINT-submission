package com.maandlee.carprint.ui

import android.content.Context
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import com.maandlee.carprint.R
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

fun displayTime(value: String?): String =
    value?.let {
        runCatching {
                DateTimeFormatter.ofPattern("yyyy.MM.dd HH:mm (z)")
                    .withZone(ZoneId.systemDefault())
                    .format(Instant.parse(it))
            }
            .getOrDefault(it)
    } ?: "원천 측정 시각 미상"

fun LinearLayout.divider() {
    space(18)
    addView(
        View(context).apply { setBackgroundColor(context.getColor(R.color.stroke)) },
        LinearLayout.LayoutParams(-1, context.dp(1)),
    )
    space(18)
}

fun Context.recordButton(text: String, primary: Boolean = false, action: () -> Unit): Button =
    actionButton(R.string.refresh_distance, action, primary).apply {
        this.text = text
        textSize = 19f
    }

fun LinearLayout.recordHeading(kicker: String, title: String, subtitle: String) {
    addView(context.label(kicker, 14f, R.color.accent, true).apply { letterSpacing = .12f })
    space(10)
    addView(
        context.label(title, 36f, R.color.text_primary, true).apply {
            isAccessibilityHeading = true
        }
    )
    space(8)
    addView(context.label(subtitle, 19f))
    space(24)
}
