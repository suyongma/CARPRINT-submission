package com.maandlee.carprint

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.maandlee.carprint.connection.*
import com.maandlee.carprint.vehicle.*
import com.maandlee.carprint.vehiclehistory.*
import java.util.UUID
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ObservationOutboxTest {
    private val context
        get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun encryptedQueueSurvivesReopenAndDeduplicatesSameObservation() {
        val name = "test-outbox-${UUID.randomUUID()}.db"
        val vault = DeviceVault(context)
        val body = "{\"event_id\":\"secret-test-event\",\"value\":12345}"
        var queue = SqliteObservationOutbox(context, vault, name = name)
        try {
            assertEquals("one", queue.enqueue("observed:1", "one", "vehicle", body))
            assertEquals("one", queue.enqueue("observed:1", "two", "vehicle", "different"))
            queue.readableDatabase.rawQuery("SELECT body FROM observation", null).use {
                assertTrue(it.moveToFirst())
                assertFalse(it.getString(0).contains("secret-test-event"))
            }
            queue.failed("one", true, "network_unavailable", 0)
            queue.close()
            queue = SqliteObservationOutbox(context, DeviceVault(context), name = name)
            val restored = queue.ready("vehicle", 10000)
            assertEquals(1, restored.size)
            assertEquals(body, restored.single().body)
            assertTrue(queue.ready("other-vehicle", 10000).isEmpty())
            queue.acknowledged("one", IngestReceipt("one", 42, "2026-10-28T00:00:00Z"))
            assertTrue(queue.ready("vehicle", 10000).isEmpty())
            assertTrue(queue.summary("vehicle").contains("서버 저장 #42"))
        } finally {
            queue.close()
            context.deleteDatabase(name)
        }
    }

    @Test
    fun capacityAndPermanentErrorsRemainVisibleWithoutSilentDrop() {
        val name = "test-limit-${UUID.randomUUID()}.db"
        val queue =
            SqliteObservationOutbox(context, DeviceVault(context), capacity = 1, name = name)
        try {
            queue.enqueue("one", "one", "v", "{}")
            try {
                queue.enqueue("two", "two", "v", "{}")
                fail("Expected explicit backpressure")
            } catch (_: OutboxFull) {}
            assertTrue(queue.summary("v").contains("대기열 한도 초과 1회"))
            assertEquals(1, queue.ready("v", Long.MAX_VALUE).size)
            queue.failed("one", false, "scope_or_vehicle_forbidden", 0)
            assertTrue(queue.ready("v", Long.MAX_VALUE).isEmpty())
            assertTrue(queue.summary("v").contains("확인 필요 1건"))
        } finally {
            queue.close()
            context.deleteDatabase(name)
        }
    }

    @Test
    fun retryBudgetAndKeystoreTamperingFailClosed() {
        val name = "test-budget-${UUID.randomUUID()}.db"
        val vault = DeviceVault(context)
        val queue = SqliteObservationOutbox(context, vault, name = name)
        try {
            queue.enqueue("one", "one", "v", "secret")
            repeat(5) { queue.failed("one", true, "network_unavailable", 0) }
            assertTrue(queue.ready("v", Long.MAX_VALUE).isEmpty())
            assertTrue(queue.summary("v").contains("확인 필요 1건"))
            queue.resumeRetries("v")
            assertEquals(1, queue.ready("v", Long.MAX_VALUE).size)
            val encrypted = vault.encrypt("private test data")
            val bytes = android.util.Base64.decode(encrypted, android.util.Base64.NO_WRAP)
            bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte()
            try {
                vault.decrypt(
                    android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
                )
                fail("Modified ciphertext must fail")
            } catch (_: javax.crypto.AEADBadTagException) {}
        } finally {
            queue.close()
            context.deleteDatabase(name)
        }
    }

    @Test
    fun failedSdkReadDoesNotEnqueueZeroOrSyntheticFallback() {
        val name = "test-sdk-${UUID.randomUUID()}.db"
        val queue = SqliteObservationOutbox(context, DeviceVault(context), name = name)
        val work = UiWorkScope()
        val gateway =
            object : VehicleHistoryGateway {
                override fun upload(
                    connection: BackendConnection,
                    body: String,
                    key: String,
                ): IngestReceipt = error("No HTTP for failed SDK read")

                override fun timeline(connection: BackendConnection, cursor: String?): HistoryPage =
                    error("Unused")
            }
        val controller = ObservationUploadController({ null }, gateway, queue, work) {}
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            controller.save(
                DistanceState.Finished(
                    VehicleOrigin.PLEOS_EMULATOR,
                    DistanceResult.Failed("TIMEOUT"),
                    null,
                )
            )
            controller.save(
                DistanceState.Finished(
                    VehicleOrigin.PLEOS_EMULATOR,
                    DistanceResult.Unavailable,
                    null,
                )
            )
        }
        assertTrue(queue.ready("v", Long.MAX_VALUE).isEmpty())
        work.close {
            queue.close()
            context.deleteDatabase(name)
        }
    }
}
