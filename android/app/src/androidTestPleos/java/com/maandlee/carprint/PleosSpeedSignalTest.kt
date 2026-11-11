package com.maandlee.carprint

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.maandlee.carprint.connection.*
import com.maandlee.carprint.driving.*
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PleosSpeedSignalTest {
    private fun labels(view: android.view.View): List<android.widget.TextView> = buildList {
        if (view is android.widget.TextView) add(view)
        if (view is android.view.ViewGroup)
            repeat(view.childCount) { addAll(labels(view.getChildAt(it))) }
    }

    @Test
    fun speedObservationCanBeStartedAndStoppedFromVehicleScreen() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        instrumentation.uiAutomation.grantRuntimePermission(
            context.packageName,
            "android.car.permission.CAR_SPEED",
        )
        androidx.test.core.app.ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            fun awaitText(predicate: (String) -> Boolean) {
                val end = System.currentTimeMillis() + 20000
                while (true) {
                    var ready = false
                    scenario.onActivity {
                        ready =
                            labels(it.window.decorView).any { label ->
                                predicate(label.text.toString())
                            }
                    }
                    if (ready) return
                    assertTrue("driving UI timeout", System.currentTimeMillis() < end)
                    Thread.sleep(100)
                }
            }
            fun press(text: String) =
                scenario.onActivity { activity ->
                    labels(activity.window.decorView)
                        .filterIsInstance<android.widget.Button>()
                        .first { it.text.toString() == text }
                        .performClick()
                }
            press("Pleos 속도 관측 시작")
            awaitText { it.startsWith("Pleos 속도 관측 ") && it.contains("개") }
            press("속도 관측 종료·서버 분석")
            awaitText { it == "주행 평가 보류" }
            scenario.onActivity { activity ->
                val target =
                    labels(activity.window.decorView).first {
                        it.text.toString() == "Pleos 주행 신호 분석"
                    }
                activity
                    .findViewById<android.widget.ScrollView>(R.id.content_scroll)
                    .scrollTo(0, target.top)
            }
            instrumentation.waitForIdleSync()
            scenario.onActivity { activity ->
                val root = activity.window.decorView
                val image =
                    android.graphics.Bitmap.createBitmap(
                        root.width,
                        root.height,
                        android.graphics.Bitmap.Config.ARGB_8888,
                    )
                root.draw(android.graphics.Canvas(image))
                java.io.File(context.filesDir, "pleos-driving-review.png").outputStream().use {
                    image.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
                }
                image.recycle()
            }
        }
    }

    @Test
    fun realAaosSpeedSamplesReachServerAndInsufficientWindowDoesNotEarnPoints() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        instrumentation.uiAutomation.grantRuntimePermission(
            context.packageName,
            "android.car.permission.CAR_SPEED",
        )
        val config =
            requireNotNull(
                BackendConnectionStore(context, DeviceVault(context), "pleos_emulator", "a:a")
                    .load()
            )
        val gateway = HttpDrivingEvidenceGateway(HttpTransport())
        val id = gateway.begin(config)
        val source = PleosSpeedSignalAdapter(context)
        val samples = mutableListOf<VehicleSpeedSample>()
        val ready = CountDownLatch(1)
        val error = AtomicReference<String>()
        instrumentation.runOnMainSync {
            source.start(
                { sample ->
                    samples.add(sample)
                    if (samples.size >= 6) ready.countDown()
                },
                { reason ->
                    error.set(reason)
                    ready.countDown()
                },
            )
        }
        try {
            assertTrue("speed callback timeout", ready.await(15, TimeUnit.SECONDS))
        } finally {
            instrumentation.runOnMainSync { source.close() }
        }
        // 닫은 뒤 늦은 콜백으로 점수가 오염되지 않는지 함께 확인한다.
        val size = samples.size
        Thread.sleep(300)
        assertEquals(size, samples.size)
        val first = samples.firstOrNull()?.timestampNanos ?: 0
        val body =
            samples.map { SpeedSample((it.timestampNanos - first) / 1_000_000, it.metersPerSecond) }
        val result = gateway.finish(config, id, body)
        assertNull("SDK failure: ${error.get()}", error.get())
        assertTrue(samples.size >= 6)
        assertTrue(samples.zipWithNext().all { (a, b) -> b.timestampNanos > a.timestampNanos })
        assertNull(result.candidateScore)
        assertFalse(result.scoreEligible)
        assertEquals("pleos_emulator_aaos", result.source)
        java.io
            .File(context.filesDir, "pleos-speed-evidence.json")
            .writeText(
                org.json
                    .JSONObject()
                    .put("sampleCount", samples.size)
                    .put(
                        "assessment",
                        org.json
                            .JSONObject()
                            .put("source", result.source)
                            .put("scoreEligible", result.scoreEligible)
                            .put(
                                "candidateScore",
                                result.candidateScore ?: org.json.JSONObject.NULL,
                            )
                            .put("durationSeconds", result.durationSeconds)
                            .put("distanceKm", result.distanceKm)
                            .put("reasons", org.json.JSONArray(result.reasons)),
                    )
                    .toString(2)
            )
    }
}
