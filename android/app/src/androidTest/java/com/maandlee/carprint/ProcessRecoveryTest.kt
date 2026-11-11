package com.maandlee.carprint

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.maandlee.carprint.connection.*
import com.maandlee.carprint.personalization.*
import com.maandlee.carprint.reports.*
import com.maandlee.carprint.vehicle.*
import com.maandlee.carprint.vehiclehistory.*
import java.io.File
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.FixMethodOrder
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.MethodSorters

/** 두 테스트 사이에 am force-stop을 실행하는 별도 스크립트로 프로세스 종료 복구를 검증한다. */
@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class ProcessRecoveryTest {
    private val instrumentation
        get() = InstrumentationRegistry.getInstrumentation()

    private val context
        get() = instrumentation.targetContext

    private fun config(): BackendConnection =
        requireNotNull(
            BackendConnectionStore(
                    context,
                    DeviceVault(context),
                    if (context.packageName.endsWith(".pleos")) "pleos_emulator" else "simulation",
                )
                .load()
        )

    @Test
    fun a_prepareOfflineObservation() {
        val config = config()
        val scope = UiWorkScope()
        instrumentation.runOnMainSync {
            ReportController(
                    { config },
                    HttpReportGateway(HttpTransport()),
                    DeviceVault(context),
                    scope,
                    "recovery-form",
                ) {}
                .apply {
                    fromDate = "2026-04-30"
                    toDate = "2026-10-27"
                    partial = true
                    expiresIn = 86400
                    select(listOf("stable-selection"))
                }
        }
        scope.close()
        val personalGateway = HttpPersonalizationGateway(HttpTransport())
        val challenge = personalGateway.request(config, listOf("climate"), "temporary")
        val connected = personalGateway.approve(config, challenge, "demo-a")
        PersonalSessionJournal(DeviceVault(context), "recovery-personal")
            .remember("session", connected.session.id)
        val latch = CountDownLatch(1)
        var reading: DistanceResult? = null
        lateinit var adapter: VehicleAdapter
        instrumentation.runOnMainSync {
            adapter = createVehicleAdapter(context)
            adapter.readDistance {
                reading = it
                latch.countDown()
            }
        }
        assertTrue(latch.await(10, TimeUnit.SECONDS))
        instrumentation.runOnMainSync { adapter.close() }
        val value = (reading as DistanceResult.Available).kilometers
        val id = UUID.randomUUID().toString()
        val body =
            JSONObject()
                .put("event_id", id)
                .put("event_type", "odometer.observed")
                .put("occurred_at", JSONObject.NULL)
                .put("observed_at", java.time.Instant.now().toString())
                .put("payload_version", 1)
                .put(
                    "payload",
                    JSONObject()
                        .put("value", value.toDouble())
                        .put("unit", "km")
                        .put("time_quality", "client_observed"),
                )
                .put("source_ref", config.sourceRef)
                .put("environment", config.environment)
                .put("collection_scope", JSONArray().put("odometer"))
                .put("source_signature", JSONObject.NULL)
                .toString()
        val queue =
            SqliteObservationOutbox(context, DeviceVault(context), name = "process-recovery.db")
        try {
            queue.enqueue(id, id, config.vehicleRef, body)
            try {
                HttpVehicleHistoryGateway(HttpTransport())
                    .upload(config.copy(baseUrl = "http://10.0.2.2:18081"), body, id)
                fail("Expected offline failure")
            } catch (error: ApiFailure) {
                assertEquals(0, error.status)
                queue.failed(id, true, error.code, 0)
            }
            File(context.filesDir, "process-recovery-id.txt").writeText(id)
            assertEquals(id, queue.ready(config.vehicleRef, Long.MAX_VALUE).single().id)
        } finally {
            queue.close()
        }
    }

    @Test
    fun b_recoverSameObservationAndReplaySafely() {
        val config = config()
        val work = UiWorkScope()
        val formReady = CountDownLatch(1)
        lateinit var form: ReportController
        instrumentation.runOnMainSync {
            form =
                ReportController(
                    { config },
                    HttpReportGateway(HttpTransport()),
                    DeviceVault(context),
                    work,
                    "recovery-form",
                ) {
                    if (!form.busy) formReady.countDown()
                }
            form.restore()
        }
        assertTrue(formReady.await(10, TimeUnit.SECONDS))
        assertEquals("2026-04-30", form.fromDate)
        assertEquals("2026-10-27", form.toDate)
        assertEquals(listOf("stable-selection"), form.selectedIds)
        assertTrue(form.partial)
        assertEquals(86400, form.expiresIn)
        val personalReady = CountDownLatch(1)
        val journal = PersonalSessionJournal(DeviceVault(context), "recovery-personal")
        lateinit var personal: PersonalizationController
        instrumentation.runOnMainSync {
            personal =
                PersonalizationController(
                    { config },
                    HttpPersonalizationGateway(HttpTransport()),
                    journal,
                    work,
                    com.maandlee.carprint.comfort.HttpComfortGateway(HttpTransport()),
                ) {
                    if (!personal.busy) personalReady.countDown()
                }
            assertTrue(personal.sessions.isEmpty())
            personal.load()
        }
        assertTrue(personalReady.await(10, TimeUnit.SECONDS))
        assertTrue(personal.sessions.isEmpty())
        assertTrue(journal.entries().isEmpty())
        DeviceVault(context).put("recovery-form:form", null)
        work.close()
        val id = File(context.filesDir, "process-recovery-id.txt").readText()
        val queue =
            SqliteObservationOutbox(context, DeviceVault(context), name = "process-recovery.db")
        try {
            val pending = queue.ready(config.vehicleRef, Long.MAX_VALUE).single()
            assertEquals(id, pending.id)
            val gateway = HttpVehicleHistoryGateway(HttpTransport())
            val receipt = gateway.upload(config, pending.body, pending.id)
            assertEquals(receipt, gateway.upload(config, pending.body, pending.id))
            queue.acknowledged(id, receipt)
            assertTrue(queue.ready(config.vehicleRef, Long.MAX_VALUE).isEmpty())
        } finally {
            queue.close()
            context.deleteDatabase("process-recovery.db")
            File(context.filesDir, "process-recovery-id.txt").delete()
        }
    }
}
