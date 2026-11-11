package com.maandlee.carprint

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

@RunWith(AndroidJUnit4::class)
class SimulatedReadTest {
    @Test fun syntheticValueIsExplicitlyLabeled() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val adapter = createVehicleAdapter(context)
        assertEquals(VehicleOrigin.SIMULATED, adapter.origin)
        adapter.readDistance { assertEquals(DistanceResult.Available(12345.6f), it) }
        adapter.close()
        ActivityScenario.launch(MainActivity::class.java).use {
            val expected = NumberFormat.getNumberInstance().apply { maximumFractionDigits = 1 }.format(12345.6f)
            onView(withId(R.id.distance_status)).check(matches(withText(containsString(expected))))
            onView(withId(R.id.distance_source)).check(matches(withText(containsString("합성 데이터"))))
            onView(withText(R.string.environment_notice)).check(matches(isDisplayed()))
        }
    }
}
