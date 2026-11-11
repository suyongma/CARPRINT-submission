package com.maandlee.carprint

import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.Espresso.pressBack
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.ViewAction
import androidx.test.espresso.UiController
import android.view.View
import org.hamcrest.Matcher
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.*
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Test
import org.junit.runner.RunWith

/** 실제 AVD에서 메뉴 이동·Activity 재생성·뒤로가기의 사용자 흐름을 검증한다. */
@RunWith(AndroidJUnit4::class)
class NavigationTest {
    // Pleos 런처가 앱 창 크기·위치를 정하는 전환은 Espresso의 메인 큐 idle 이후에도 계속된다.
    private fun waitForWindowPlacement() = object : ViewAction {
        override fun getConstraints(): Matcher<View> = isRoot()
        override fun getDescription() = "wait for Pleos launch window placement"
        override fun perform(controller: UiController, view: View) {
            controller.loopMainThreadForAtLeast(1500)
        }
    }

    @Test fun navigationSurvivesRecreationAndReturnsHome() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            onView(isRoot()).perform(waitForWindowPlacement())
            onView(withText(R.string.vehicle_heading)).check(matches(isDisplayed()))
            onView(withId(R.id.nav_history)).perform(click())
            onView(withText(R.string.history_heading)).check(matches(isDisplayed()))
            onView(withId(R.id.nav_space)).perform(click())
            onView(withText(R.string.space_heading)).check(matches(isDisplayed()))
            scenario.recreate()
            onView(withText(R.string.space_heading)).check(matches(isDisplayed()))
            onView(withId(R.id.nav_space)).check(matches(isSelected()))
            pressBack()
            onView(withText(R.string.vehicle_heading)).check(matches(isDisplayed()))
            onView(withText(R.string.environment_notice)).check(matches(isDisplayed()))
        }
    }
}
