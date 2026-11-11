package com.maandlee.carprint

import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.*
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.maandlee.carprint.vehicle.*
import org.hamcrest.Matchers.containsString
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.text.NumberFormat
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class PleosReadTest {
    @Test fun readsActualSdkAndShowsItsValue() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val latch = CountDownLatch(1)
        var response: DistanceResult? = null
        val adapter = PleosVehicleAdapter(context)
        Handler(Looper.getMainLooper()).post {
            adapter.readDistance { result -> response = result; latch.countDown() }
        }
        try {
            assertTrue("SDK callback timed out", latch.await(12, TimeUnit.SECONDS))
            assertTrue("Actual SDK read failed: $response", response is DistanceResult.Available)
            Log.i("CARPRINT_STAGE4", "origin=${adapter.origin}, result=$response")
        } finally {
            InstrumentationRegistry.getInstrumentation().runOnMainSync { adapter.close() }
        }
        val actual = (response as DistanceResult.Available).kilometers
        val expectedValue = context.getString(R.string.distance_value,
            NumberFormat.getNumberInstance().apply { maximumFractionDigits = 1 }.format(actual))
        ActivityScenario.launch(MainActivity::class.java).use {
            // SDK IPC는 Espresso idle 대상이 아니므로 실제 화면 결과를 기한 내 기다린다.
            val deadline = System.currentTimeMillis() + 12000
            while (true) {
                try {
                    onView(withId(R.id.distance_status)).check(matches(withContentDescription(expectedValue)))
                    break
                } catch (error: AssertionError) {
                    if (System.currentTimeMillis() >= deadline) throw error
                    Thread.sleep(100)
                }
            }
            onView(withId(R.id.distance_source)).check(matches(withText(containsString("Pleos 에뮬레이터"))))
            onView(withId(R.id.distance_status)).check(matches(isDisplayed()))
        }
    }
}
