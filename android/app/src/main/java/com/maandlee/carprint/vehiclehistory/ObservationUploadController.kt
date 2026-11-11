package com.maandlee.carprint.vehiclehistory

import com.maandlee.carprint.connection.*
import com.maandlee.carprint.vehicle.*
import java.time.Instant
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

class ObservationUploadController(
    private val connection: () -> BackendConnection?,
    private val gateway: VehicleHistoryGateway,
    private val outbox: ObservationOutbox,
    private val work: UiWorkScope,
    private val changed: () -> Unit,
) {
    var status = "서버 연결 확인 전"
        private set

    var busy = false
        private set

    // 성공한 거리만 대기열에 저장하고 전송함. 오프라인이면 다음에 같은 본문·ID로 다시 보냄. _ma
    fun save(state: DistanceState) {
        if (busy) return
        val finished = state as? DistanceState.Finished ?: return
        val distance = finished.result as? DistanceResult.Available ?: return
        val observedAt = finished.receivedAtMillis ?: return
        if (!distance.kilometers.isFinite() || distance.kilometers < 0f) {
            status = "유효하지 않은 관측값은 저장하지 않습니다."
            changed()
            return
        }
        busy = true
        status = "기기 대기열에 보관 중"
        changed()
        work.run(
            {
                val config = connection() ?: throw ApiFailure(401, "connection_required")
                val environment =
                    if (finished.origin == VehicleOrigin.SIMULATED) "simulation"
                    else "pleos_emulator"
                require(environment == config.environment)
                val eventId = UUID.randomUUID().toString()
                val request =
                    JSONObject()
                        .put("event_id", eventId)
                        .put("event_type", "odometer.observed")
                        // 측정 시각은 몰라서 null. observed_at은 앱 수신 시각임. _ma
                        .put("occurred_at", JSONObject.NULL)
                        .put("observed_at", Instant.ofEpochMilli(observedAt).toString())
                        .put("payload_version", 1)
                        .put(
                            "payload",
                            JSONObject()
                                .put("value", distance.kilometers.toDouble())
                                .put("unit", "km")
                                .put("time_quality", "client_observed"),
                        )
                        .put("source_ref", config.sourceRef)
                        .put("environment", environment)
                        .put("collection_scope", JSONArray().put("odometer"))
                        .put("source_signature", JSONObject.NULL)
                outbox.enqueue(
                    "${config.vehicleRef}:$observedAt:${distance.kilometers}",
                    eventId,
                    config.vehicleRef,
                    request.toString(),
                )
                transmit(config)
            },
            {
                status = it
                busy = false
                changed()
            },
            {
                status =
                    if (it is OutboxFull) "대기열이 가득 찼습니다. 기존 기록 전송 후 이 관측을 다시 저장해 주세요."
                    else errorMessage(it)
                busy = false
                changed()
            },
        )
    }

    fun retry(manual: Boolean = false) {
        if (busy) return
        busy = true
        changed()
        work.run(
            {
                val config = connection() ?: throw ApiFailure(401, "connection_required")
                if (manual) outbox.resumeRetries(config.vehicleRef)
                transmit(config)
            },
            {
                status = it
                busy = false
                changed()
            },
            {
                status = errorMessage(it)
                busy = false
                changed()
            },
        )
    }

    // 현재 차량 것만 순서대로 보냄. 영수증 확인돼야 ACK. 응답 놓치면 같은 ID로 다시 보내면 됨. _ma
    private fun transmit(config: BackendConnection): String {
        for (pending in outbox.ready(config.vehicleRef, System.currentTimeMillis())) {
            try {
                outbox.acknowledged(pending.id, gateway.upload(config, pending.body, pending.id))
            } catch (failure: ApiFailure) {
                outbox.failed(
                    pending.id,
                    failure.retryable,
                    failure.code,
                    System.currentTimeMillis(),
                )
                // 네트워크/인증 실패 시 나머지를 연속 소모하지 않고 다음 사용자 요청/앱 시작을 기다린다.
                return "${errorMessage(failure)}\n${outbox.summary(config.vehicleRef)}"
            }
        }
        return outbox.summary(config.vehicleRef)
    }
}
