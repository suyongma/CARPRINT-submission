package com.maandlee.carprint

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.maandlee.carprint.care.*
import com.maandlee.carprint.connection.*
import com.maandlee.carprint.personalization.*
import com.maandlee.carprint.reports.*
import java.util.UUID
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ExperienceIntegrationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context
        get() = instrumentation.targetContext

    private fun config(): BackendConnection {
        val env = if (context.packageName.endsWith(".pleos")) "pleos_emulator" else "simulation"
        return requireNotNull(
            BackendConnectionStore(context, DeviceVault(context), env, "a:a").load()
        )
    }

    private fun waitFor(condition: () -> Boolean) {
        val end = System.currentTimeMillis() + 15000
        while (true) {
            var done = false
            instrumentation.runOnMainSync { done = condition() }
            if (done) return
            assertTrue("State timeout", System.currentTimeMillis() < end)
            Thread.sleep(50)
        }
    }

    @Test
    fun reportDraftRestoresDatesSelectionAndExpiryAcrossNewController() {
        val vault = DeviceVault(context)
        val scope = UiWorkScope()
        val namespace = "test-form-${UUID.randomUUID()}"
        try {
            lateinit var first: ReportController
            instrumentation.runOnMainSync {
                first =
                    ReportController(
                        { config() },
                        HttpReportGateway(HttpTransport()),
                        vault,
                        scope,
                        namespace,
                    ) {}
                first.fromDate = "2026-05-01"
                first.toDate = "2026-10-27"
                first.partial = true
                first.expiresIn = 86400
                first.select(listOf("selected-event"))
            }
            lateinit var restored: ReportController
            instrumentation.runOnMainSync {
                restored =
                    ReportController(
                        { config() },
                        HttpReportGateway(HttpTransport()),
                        vault,
                        scope,
                        namespace,
                    ) {}
                restored.restore()
            }
            waitFor { !restored.busy }
            assertEquals("2026-05-01", restored.fromDate)
            assertEquals("2026-10-27", restored.toDate)
            assertTrue(restored.partial)
            assertEquals(86400, restored.expiresIn)
            assertEquals(listOf("selected-event"), restored.selectedIds)
        } finally {
            vault.put("$namespace:form", null)
            scope.close()
        }
    }

    @Test
    fun careUsesServerCalculationAndWithholdsCurrentVehicle() {
        val gateway = HttpCareAssessmentGateway(HttpTransport())
        val c = config()
        assertTrue(gateway.assess(c, null).isNull("score"))
        assertEquals(95, gateway.assess(c, "care_95").getInt("score"))
        assertEquals(100, gateway.assess(c, "corrected_record").getInt("score"))
        assertTrue(gateway.assess(c, "coverage_gap").isNull("score"))
    }

    @Test
    fun selectiveSessionsCleanLocallyOfflineAndRetryAfterProcessLikeRecreation() {
        val c = config()
        var active = c
        val vault = DeviceVault(context)
        val journal = PersonalSessionJournal(vault, "test-personal-${UUID.randomUUID()}")
        val gateway = HttpPersonalizationGateway(HttpTransport())
        val work = UiWorkScope()
        lateinit var controller: PersonalizationController
        instrumentation.runOnMainSync {
            controller =
                PersonalizationController(
                    { active },
                    gateway,
                    journal,
                    work,
                    com.maandlee.carprint.comfort.HttpComfortGateway(HttpTransport()),
                ) {}
            controller.load()
        }
        waitFor { !controller.busy }
        try {
            instrumentation.runOnMainSync {
                controller.selectedScopes.add("climate")
                controller.request()
            }
            waitFor { !controller.busy }
            assertNotNull(controller.challenge)
            instrumentation.runOnMainSync { controller.approve() }
            waitFor { !controller.busy }
            assertEquals(1, controller.sessions.size)
            assertEquals(listOf("climate"), controller.sessions.single().scopes)
            val id = controller.sessions.single().id
            assertFalse(journal.entries().joinToString().contains("climate"))
            active = c.copy(baseUrl = "http://10.0.2.2:18081")
            instrumentation.runOnMainSync { controller.endAll() }
            assertTrue(controller.sessions.isEmpty())
            waitFor { !controller.busy }
            assertTrue(journal.entries().any { it.endsWith(id) })
            active = c
            lateinit var recovered: PersonalizationController
            instrumentation.runOnMainSync {
                recovered =
                    PersonalizationController(
                        { active },
                        gateway,
                        journal,
                        work,
                        com.maandlee.carprint.comfort.HttpComfortGateway(HttpTransport()),
                    ) {}
                recovered.load()
            }
            waitFor { !recovered.busy }
            assertTrue(recovered.sessions.isEmpty())
            assertTrue(journal.entries().isEmpty())
        } finally {
            active = c
            instrumentation.runOnMainSync { controller.endAll() }
            waitFor { !controller.busy }
            work.close()
        }
    }

    @Test
    fun realServerShowsTwoAccountPreferencesOnlyAfterApproval() {
        val c = config()
        val gateway = HttpPersonalizationGateway(HttpTransport())
        val a =
            gateway.approve(
                c,
                gateway.request(c, listOf("climate", "volume"), "temporary"),
                "demo-a",
            )
        var b: ConnectedPerson? = null
        try {
            b = gateway.approve(c, gateway.request(c, listOf("climate"), "temporary"), "demo-b")
            assertNotEquals(
                a.session.preferences.getInt("climate"),
                b.session.preferences.getInt("climate"),
            )
            assertFalse(b.session.preferences.has("volume"))
            assertFalse(a.session.preferences.has("destination"))
            if (c.environment == "simulation") {
                gateway.seat(c, a.token, "driver")
                gateway.seat(c, b.token, "front_passenger")
                val preview = gateway.preview(c, a.token)
                val result = gateway.apply(c, a.token, preview.id)
                assertEquals("simulated_confirmed", result.first { it.scope == "climate" }.status)
                assertEquals("unconfirmed", result.first { it.scope == "volume" }.status)
            } else assertTrue(gateway.preview(c, a.token).items.all { it.status == "unsupported" })
            gateway.end(c, a.session.id)
            assertEquals(b.session.id, gateway.refresh(c, b.token).id)
        } finally {
            gateway.end(c, a.session.id)
            b?.let { gateway.end(c, it.session.id) }
        }
    }

    @Test
    fun personalScoreSurvivesNewSessionAndVehicleWithoutCreditingOtherAccount() {
        val firstVehicle = config()
        val gateway = HttpPersonalizationGateway(HttpTransport())
        val first =
            gateway.approve(
                firstVehicle,
                gateway.request(firstVehicle, emptyList(), "temporary"),
                "demo-a",
            )
        val score = first.session.personalScore
        try {
            assertEquals(69, score.score)
            assertEquals(12, score.driving.count)
            assertEquals(4, score.care.count)
        } finally {
            gateway.end(firstVehicle, first.session.id)
        }
        val nextVehicle =
            if (firstVehicle.environment == "simulation")
                requireNotNull(
                    BackendConnectionStore(context, DeviceVault(context), "simulation", "b:a")
                        .load()
                )
            else firstVehicle
        val freshGateway = HttpPersonalizationGateway(HttpTransport())
        val next =
            freshGateway.approve(
                nextVehicle,
                freshGateway.request(nextVehicle, emptyList(), "temporary"),
                "demo-a",
            )
        try {
            assertEquals(score, next.session.personalScore)
            assertEquals(0, next.session.preferences.length())
            val newcomer =
                freshGateway.approve(
                    nextVehicle,
                    freshGateway.request(nextVehicle, emptyList(), "temporary"),
                    "demo-b",
                )
            try {
                assertEquals(50, newcomer.session.personalScore.score)
                assertEquals("unassessed", newcomer.session.personalScore.state)
                assertEquals(0, newcomer.session.personalScore.driving.count)
                assertEquals(score, freshGateway.refresh(nextVehicle, next.token).personalScore)
            } finally {
                freshGateway.end(nextVehicle, newcomer.session.id)
            }
        } finally {
            freshGateway.end(nextVehicle, next.session.id)
        }
    }

    @Test
    fun endingDuringApprovalDropsLatePersonalCallbackAndCleansServerSession() {
        val c = config()
        val real = HttpPersonalizationGateway(HttpTransport())
        val started = java.util.concurrent.CountDownLatch(1)
        val release = java.util.concurrent.CountDownLatch(1)
        val delayed =
            object : PersonalizationGateway by real {
                override fun approve(
                    connection: BackendConnection,
                    challenge: ConnectionChallenge,
                    account: String,
                ): ConnectedPerson {
                    val person = real.approve(connection, challenge, account)
                    started.countDown()
                    assertTrue(release.await(10, java.util.concurrent.TimeUnit.SECONDS))
                    return person
                }
            }
        val journal = PersonalSessionJournal(DeviceVault(context), "late-${UUID.randomUUID()}")
        val work = UiWorkScope()
        lateinit var controller: PersonalizationController
        try {
            instrumentation.runOnMainSync {
                controller =
                    PersonalizationController(
                        { c },
                        delayed,
                        journal,
                        work,
                        com.maandlee.carprint.comfort.HttpComfortGateway(HttpTransport()),
                    ) {}
                controller.selectedScopes.add("climate")
                controller.request()
            }
            waitFor { !controller.busy }
            instrumentation.runOnMainSync { controller.approve() }
            assertTrue(started.await(10, java.util.concurrent.TimeUnit.SECONDS))
            instrumentation.runOnMainSync { controller.endAll() }
            assertTrue(controller.sessions.isEmpty())
            release.countDown()
            waitFor { !controller.busy && journal.entries().isEmpty() }
            assertTrue(controller.sessions.isEmpty())
        } finally {
            release.countDown()
            instrumentation.runOnMainSync { controller.endAll() }
            waitFor { !controller.busy }
            work.close()
        }
    }
}
