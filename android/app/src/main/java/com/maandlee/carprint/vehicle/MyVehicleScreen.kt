package com.maandlee.carprint.vehicle

import android.content.Context
import android.graphics.drawable.GradientDrawable
import android.widget.LinearLayout
import com.maandlee.carprint.R
import com.maandlee.carprint.care.*
import com.maandlee.carprint.ui.*

fun LinearLayout.showMyVehicle(
    state: DistanceState,
    refresh: () -> Unit,
    care: CareAssessmentController? = null,
    observationActions: LinearLayout.() -> Unit = {},
): VehicleReadingView {
    removeAllViews()
    val wide = resources.getBoolean(R.bool.dashboard_columns)
    addView(context.vehicleCover(wide))
    space(28)
    val reading = VehicleReadingView(context, refresh).apply { update(state) }
    val distanceCard = context.overviewCard().apply {
        addView(reading)
        observationActions()
    }
    val assessmentCard = context.overviewCard().apply {
        if (care != null) showCareAssessment(care)
        else addView(context.label("관리 평가를 불러오는 중", 24f, R.color.text_secondary))
    }
    if (wide) {
        addView(
            LinearLayout(context).apply {
                isBaselineAligned = false
                addView(distanceCard, LinearLayout.LayoutParams(0, -2, 1.15f))
                addView(
                    assessmentCard,
                    LinearLayout.LayoutParams(0, -2, 1f).apply {
                        marginStart = context.dp(20)
                    },
                )
            }
        )
    } else {
        addView(distanceCard)
        space(16)
        addView(assessmentCard)
    }
    return reading
}

private fun Context.overviewCard() = column().apply {
    val inset = dp(22)
    setPadding(inset, inset, inset, inset)
    background = GradientDrawable().apply {
        cornerRadius = dp(22).toFloat()
        setColor(getColor(R.color.card_surface))
        setStroke(dp(1), getColor(R.color.card_outline))
    }
}
