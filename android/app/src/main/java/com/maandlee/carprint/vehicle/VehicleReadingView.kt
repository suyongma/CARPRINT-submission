package com.maandlee.carprint.vehicle

import android.content.Context
import android.text.SpannableString
import android.text.Spanned
import android.text.style.RelativeSizeSpan
import android.view.View
import android.widget.LinearLayout
import com.maandlee.carprint.R
import com.maandlee.carprint.ui.*
import java.text.SimpleDateFormat
import java.util.Locale
import java.text.NumberFormat
import java.util.Date

/** 값 갱신 시 읽기 영역만 변경해 버튼 포커스와 페이지 스크롤을 유지한다. */
class VehicleReadingView @JvmOverloads constructor(context: Context, refresh: () -> Unit = {}) : LinearLayout(context) {
    private val value = context.label("—", 68f, R.color.text_primary, true).apply {
        id = R.id.distance_status
        typeface = context.printTypeface(720)
        fontFeatureSettings = "'tnum'"
        accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
    }
    private val status = context.label("", 22f, R.color.text_secondary)
    private val origin = context.label("", 18f).apply { id = R.id.distance_source }
    private val received = context.label("", 18f)
    private val refreshButton = context.actionButton(R.string.refresh_distance, refresh).apply { id = R.id.refresh_distance }

    init {
        orientation = VERTICAL
        addView(context.label(context.getString(R.string.distance_label), 23f, R.color.text_primary, true).apply {
            isAccessibilityHeading = true
        })
        space(6)
        addView(value)
        addView(status)
        space(12)
        addView(origin)
        addView(received)
        space(16)
        addView(refreshButton, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT))
    }

    fun update(state: DistanceState) {
        val result = (state as? DistanceState.Finished)?.result
        val available = result as? DistanceResult.Available
        value.text = if (available != null) {
            val number = NumberFormat.getNumberInstance().apply { maximumFractionDigits = 1 }.format(available.kilometers)
            SpannableString("$number km").apply { setSpan(RelativeSizeSpan(0.32f), number.length, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
        } else "—"
        value.contentDescription = if (available != null) context.getString(R.string.distance_value,
            NumberFormat.getNumberInstance().apply { maximumFractionDigits = 1 }.format(available.kilometers)) else context.getString(R.string.distance_no_value)
        status.text = context.getString(when {
            state is DistanceState.Loading -> R.string.distance_loading
            available != null -> R.string.distance_success
            result == DistanceResult.Unavailable -> R.string.distance_unavailable
            result == DistanceResult.Unsupported -> R.string.distance_unsupported
            result is DistanceResult.Failed -> if (result.code == "TIMEOUT") R.string.distance_timeout else R.string.distance_failed
            else -> R.string.distance_idle
        })
        status.setTextColor(context.getColor(if (result is DistanceResult.Failed || result == DistanceResult.Unavailable || result == DistanceResult.Unsupported) R.color.warning else R.color.text_secondary))
        val source = when (state) {
            is DistanceState.Loading -> state.origin
            is DistanceState.Finished -> state.origin
            DistanceState.Idle -> null
        }
        origin.setText(if (source == VehicleOrigin.SIMULATED) R.string.origin_simulated else R.string.origin_pleos)
        origin.visibility = if (source == null) INVISIBLE else VISIBLE
        received.text = when {
            state is DistanceState.Finished && state.receivedAtMillis != null -> context.getString(R.string.distance_received,
                SimpleDateFormat("HH:mm:ss z", Locale.getDefault()).format(Date(state.receivedAtMillis)))
            result is DistanceResult.Failed -> context.getString(R.string.distance_error_detail, result.code)
            else -> context.getString(R.string.distance_measurement_note)
        }
        refreshButton.isEnabled = state !is DistanceState.Loading
        refreshButton.alpha = if (refreshButton.isEnabled) 1f else 0.5f
    }
}
