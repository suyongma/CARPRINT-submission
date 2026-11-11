package com.maandlee.carprint.ui

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.maandlee.carprint.R

/** 세 화면에서 공유하는 색·간격·문자 위계. 데이터 접근이나 상태 변경은 담당하지 않는다. */
fun Context.dp(value: Int) = (value * resources.displayMetrics.density).toInt()

fun Context.column() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

internal fun Context.printTypeface(weight: Int): Typeface =
    Typeface.create(resources.getFont(R.font.pretendard_variable), weight, false)

fun Context.label(
    value: CharSequence,
    size: Float = 22f,
    color: Int = R.color.text_secondary,
    bold: Boolean = false,
) =
    TextView(this).apply {
        text = value
        textSize = size
        setTextColor(getColor(color))
        includeFontPadding = true
        setLineSpacing(dp(4).toFloat(), 1f)
        typeface = printTypeface(if (bold) 650 else 400)
    }

fun LinearLayout.space(height: Int) {
    addView(View(context), LinearLayout.LayoutParams(1, context.dp(height)))
}

fun LinearLayout.eyebrow(text: Int) {
    addView(
        context.label(context.getString(text), 15f, R.color.accent, true).apply {
            letterSpacing = 0.16f
        }
    )
}

fun LinearLayout.pageHeading(title: Int, description: Int) {
    addView(
        context.label(context.getString(title), 36f, R.color.text_primary, true).apply {
            isAccessibilityHeading = true
        }
    )
    space(8)
    addView(context.label(context.getString(description)))
    space(32)
}

fun Context.actionButton(label: Int, action: () -> Unit, primary: Boolean = true) =
    Button(this).apply {
        setText(label)
        textSize = 22f
        isAllCaps = false
        typeface = printTypeface(600)
        val foreground = getColor(if (primary) R.color.on_accent else R.color.text_primary)
        val disabledForeground = (foreground and 0x00ffffff) or 0x66000000
        setTextColor(
            ColorStateList(
                arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf()),
                intArrayOf(disabledForeground, foreground),
            )
        )
        setPadding(dp(24), dp(8), dp(24), dp(8))
        minHeight = dp(80)
        stateListAnimator = null
        val shape =
            GradientDrawable().apply {
                cornerRadius = dp(14).toFloat()
                setColor(getColor(if (primary) R.color.accent else R.color.secondary_action))
            }
        background = RippleDrawable(ColorStateList.valueOf(0x30ffffff), shape, null)
        setOnClickListener { action() }
    }
