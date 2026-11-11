package com.maandlee.carprint

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.maandlee.carprint.connection.*
import com.maandlee.carprint.reports.*
import com.maandlee.carprint.vehicle.*
import com.maandlee.carprint.vehiclehistory.*
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** CARPRINT 로컬 API와 실제 PostgreSQL이 필요하다. 해당 flavor를 provision한 뒤 실행한다. */
@RunWith(AndroidJUnit4::class)
class BackendJourneyTest {
    @Test
    fun offlineOutboxReopensReplaysReceiptAndReportCanBeRevoked() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val vault = DeviceVault(context)
        val environment =
            if (context.packageName.endsWith(".pleos")) "pleos_emulator" else "simulation"
        val config =
            requireNotNull(BackendConnectionStore(context, vault, environment).load()) {
                "Run scripts/provision-demo-device.py first"
            }
        val gateway = HttpVehicleHistoryGateway(HttpTransport())
        val latch = java.util.concurrent.CountDownLatch(1)
        var reading: DistanceResult? = null
        var adapter: VehicleAdapter? = null
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            adapter = createVehicleAdapter(context)
            adapter!!.readDistance {
                reading = it
                latch.countDown()
            }
        }
        assertTrue(
            "Vehicle reading timeout",
            latch.await(10, java.util.concurrent.TimeUnit.SECONDS),
        )
        InstrumentationRegistry.getInstrumentation().runOnMainSync { adapter!!.close() }
        val kilometers =
            (reading as? DistanceResult.Available)?.kilometers
                ?: error("Real adapter read required")
        val id = UUID.randomUUID().toString()
        val request =
            JSONObject()
                .put("event_id", id)
                .put("event_type", "odometer.observed")
                .put("occurred_at", JSONObject.NULL)
                .put("observed_at", java.time.Instant.now().toString())
                .put("payload_version", 1)
                .put(
                    "payload",
                    JSONObject()
                        .put("value", kilometers.toDouble())
                        .put("unit", "km")
                        .put("time_quality", "client_observed"),
                )
                .put("source_ref", config.sourceRef)
                .put("environment", config.environment)
                .put("collection_scope", JSONArray().put("odometer"))
                .put("source_signature", JSONObject.NULL)
                .toString()
        val name = "test-http-${UUID.randomUUID()}.db"
        var queue = SqliteObservationOutbox(context, vault, name = name)
        try {
            queue.enqueue("one", id, config.vehicleRef, request)
            try {
                gateway.upload(config.copy(baseUrl = "http://10.0.2.2:18081"), request, id)
                fail("Closed port should fail")
            } catch (error: ApiFailure) {
                assertEquals(0, error.status)
                queue.failed(id, true, error.code, 0)
            }
            queue.close()
            queue = SqliteObservationOutbox(context, vault, name = name)
            val pending = queue.ready(config.vehicleRef, System.currentTimeMillis()).single()
            val first = gateway.upload(config, pending.body, pending.id)
            // 응답 유실 상황: ack 전 동일 요청을 다시 보내도 같은 서버 순번.
            val second = gateway.upload(config, pending.body, pending.id)
            assertEquals(first, second)
            queue.acknowledged(id, second)
            assertTrue(queue.ready(config.vehicleRef, Long.MAX_VALUE).isEmpty())
            val timeline = gateway.timeline(config)
            assertTrue(
                timeline.events.any {
                    it.id == id && it.environment == environment && it.occurredAt == null
                }
            )
            val reports = HttpReportGateway(HttpTransport())
            val issued =
                reports.create(
                    config,
                    ReportDraft(
                        "partial",
                        "2026-01-01T00:00:00Z",
                        "2099-01-01T00:00:00Z",
                        listOf(id),
                        3600,
                    ),
                    UUID.randomUUID().toString(),
                )
            assertEquals("active", reports.status(config, issued).state)
            assertNotNull(issued.shareUrl)
            reports.revoke(config, issued.id, "revoke:${issued.id}")
            assertEquals("revoked", reports.status(config, issued).state)
        } finally {
            queue.close()
            context.deleteDatabase(name)
        }
    }
}
