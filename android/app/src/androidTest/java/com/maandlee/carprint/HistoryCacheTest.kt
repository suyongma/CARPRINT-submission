package com.maandlee.carprint

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.maandlee.carprint.connection.*
import com.maandlee.carprint.vehiclehistory.*
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class HistoryCacheTest {
    @Test
    fun networkFailureRetainsLabeledCacheInsteadOfEmptySuccess() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val vault = DeviceVault(context)
        val environment =
            if (context.packageName.endsWith(".pleos")) "pleos_emulator" else "simulation"
        val config = requireNotNull(BackendConnectionStore(context, vault, environment).load())
        val gateway = HttpVehicleHistoryGateway(HttpTransport())
        val work = UiWorkScope()
        try {
            val loaded = CountDownLatch(1)
            lateinit var online: VehicleHistoryController
            online =
                VehicleHistoryController({ config }, gateway, vault, work) {
                    if (!online.busy) loaded.countDown()
                }
            instrumentation.runOnMainSync { online.load() }
            assertTrue(loaded.await(15, TimeUnit.SECONDS))
            assertTrue(online.status.contains("서버 동기화"))
            val restored = CountDownLatch(1)
            lateinit var offline: VehicleHistoryController
            offline =
                VehicleHistoryController(
                    { config.copy(baseUrl = "http://10.0.2.2:18081") },
                    gateway,
                    vault,
                    work,
                ) {
                    if (!offline.busy) restored.countDown()
                }
            instrumentation.runOnMainSync { offline.load() }
            assertTrue(restored.await(15, TimeUnit.SECONDS))
            assertEquals(online.events.map { it.id }, offline.events.map { it.id })
            assertTrue(offline.status.contains("오프라인 보관본"))
            assertTrue(offline.status.contains("마지막 동기화"))
            assertNull(offline.nextCursor)
        } finally {
            work.close()
        }
    }
}
