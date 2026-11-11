package com.maandlee.carprint.vehiclehistory

/** 로컬 영속 대기열. enqueue 중복은 같은 관측 키로 병합하며 본문/멱등 키를 다시 생성하지 않는다. */
interface ObservationOutbox {
    fun enqueue(observationKey: String, eventId: String, vehicleRef: String, body: String): String

    fun ready(vehicleRef: String, now: Long): List<PendingObservation>

    fun acknowledged(id: String, receipt: IngestReceipt)

    fun failed(id: String, retryable: Boolean, reason: String, now: Long)

    /** 사용자가 재시도를 요청할 때만 예산/대기 시각을 재설정. 입력·충돌 오류는 그대로 보존. */
    fun resumeRetries(vehicleRef: String)

    fun summary(vehicleRef: String): String

    fun close()
}

data class PendingObservation(val id: String, val body: String, val attempts: Int)

class OutboxFull : Exception("OUTBOX_FULL")
