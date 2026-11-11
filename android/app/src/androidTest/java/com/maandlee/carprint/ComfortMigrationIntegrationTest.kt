package com.maandlee.carprint

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.maandlee.carprint.comfort.*
import com.maandlee.carprint.connection.*
import com.maandlee.carprint.personalization.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ComfortMigrationIntegrationTest {
    @Test
    fun accountMovesBetweenCarsButVehicleOverridesStayWithEachSeat() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assumeTrue(context.packageName.endsWith(".demo"))
        val transport = HttpTransport()
        val personal = HttpPersonalizationGateway(transport)
        val comfort = HttpComfortGateway(transport)
        val a =
            requireNotNull(
                BackendConnectionStore(context, DeviceVault(context), "simulation", "a:a").load()
            )
        val b =
            requireNotNull(
                BackendConnectionStore(context, DeviceVault(context), "simulation", "b:a").load()
            )
        val sessions = mutableListOf<Pair<BackendConnection, ConnectedPerson>>()
        fun connect(c: BackendConnection): ConnectedPerson =
            personal
                .approve(c, personal.request(c, listOf("climate", "seat"), "temporary"), "demo-a")
                .also {
                    sessions.add(c to it)
                    personal.seat(c, it.token, "driver")
                }
        var original: Map<String, Double>? = null
        val overrides = mutableMapOf<BackendConnection, Map<String, Double>>()
        try {
            val pa = connect(a)
            val pb = connect(b)
            original = comfort.read(a, pa.token).portable
            for ((c, p) in sessions) {
                val v = comfort.read(c, p.token)
                overrides[c] = v.vehicleValues
                comfort.reset(c, p.token, v.revision)
            }
            comfort.save(
                a,
                pa.token,
                comfort.read(a, pa.token).revision,
                "account",
                mapOf(
                    "temperature" to 29.5,
                    "fanPercent" to 60.0,
                    "seatPositionPercent" to 60.0,
                    "seatHeating" to 3.0,
                    "seatVentilation" to 2.0,
                ),
            )
            val va = comfort.read(a, pa.token)
            val vb = comfort.read(b, pb.token)
            assertEquals(29.5, va.items.first { it.key == "temperature" }.target!!, 0.0)
            assertEquals(28.0, vb.items.first { it.key == "temperature" }.target!!, 0.0)
            assertNull(vb.items.first { it.key == "seatVentilation" }.target)
            assertEquals(120.0, vb.items.first { it.key == "seatPositionPercent" }.target!!, 0.0)
            val preview = comfort.preview(b, pb.token)
            assertEquals(4, comfort.apply(b, pb.token, preview.id).size)
            assertEquals(4, comfort.read(b, pb.token).lastApplied.size)
            comfort.save(b, pb.token, vb.revision, "vehicle", mapOf("temperature" to 23.0))
            assertEquals(
                23.0,
                comfort.read(b, pb.token).items.first { it.key == "temperature" }.target!!,
                0.0,
            )
            assertEquals(
                29.5,
                comfort.read(a, pa.token).items.first { it.key == "temperature" }.target!!,
                0.0,
            )
            assertEquals(
                personal.refresh(a, pa.token).personalScore.score,
                personal.refresh(b, pb.token).personalScore.score,
            )
        } finally {
            try {
                sessions.firstOrNull()?.let { (c, p) ->
                    original?.let {
                        comfort.save(c, p.token, comfort.read(c, p.token).revision, "account", it)
                    }
                }
                for ((c, p) in sessions) overrides[c]?.let {
                    comfort.reset(c, p.token, comfort.read(c, p.token).revision)
                    if (it.isNotEmpty())
                        comfort.save(c, p.token, comfort.read(c, p.token).revision, "vehicle", it)
                }
            } finally {
                sessions.forEach { (c, p) -> personal.end(c, p.session.id) }
            }
        }
    }
}
