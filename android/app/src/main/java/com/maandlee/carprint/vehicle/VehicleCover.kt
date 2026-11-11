package com.maandlee.carprint.vehicle

import android.content.Context
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import com.maandlee.carprint.R
import com.maandlee.carprint.ui.column
import com.maandlee.carprint.ui.dp
import com.maandlee.carprint.ui.label
import com.maandlee.carprint.ui.space

/** 첫 화면의 그림은 장식이다. 차량 종류와 상태는 실제 조회 결과에 표시한다. */
internal fun Context.vehicleCover(wide: Boolean): LinearLayout {
    val cover = LinearLayout(this).apply {
        orientation = if (wide) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
        isBaselineAligned = false
    }
    val copy = column().apply {
        gravity = Gravity.CENTER_VERTICAL
        minimumHeight = dp(if (wide) 272 else 132)
        setPadding(0, dp(16), dp(24), dp(16))
        addView(View(context).apply {
            setBackgroundColor(getColor(R.color.cover_mark))
        }, LinearLayout.LayoutParams(dp(36), dp(4)))
        space(12)
        addView(label(getString(R.string.vehicle_heading), if (wide) 48f else 38f, R.color.text_primary, true).apply {
            isAccessibilityHeading = true
        })
        space(4)
        addView(label(getString(R.string.vehicle_description), 19f))
    }
    val art = ImageView(this).apply {
        scaleType = ImageView.ScaleType.CENTER_CROP
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        background = GradientDrawable().apply {
            cornerRadius = dp(26).toFloat()
            setColor(getColor(R.color.background))
        }
        clipToOutline = true
        setImageResource(R.drawable.parked_study)
    }
    val windowWidth = resources.configuration.screenWidthDp
    if (wide) {
        cover.addView(copy, LinearLayout.LayoutParams(0, -2, 1f))
        cover.addView(art, LinearLayout.LayoutParams(dp((windowWidth / 2 - 80).coerceIn(400, 700)), dp(272)))
    } else {
        cover.addView(copy, LinearLayout.LayoutParams(-1, -2))
        cover.addView(art, LinearLayout.LayoutParams(-1, dp((windowWidth / 3).coerceIn(144, 248))))
    }
    return cover
}
