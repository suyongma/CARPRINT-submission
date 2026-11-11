package com.maandlee.carprint

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.maandlee.carprint.vehicle.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class VehicleReadControllerTest {
    private class DeferredAdapter : VehicleAdapter {
        override val origin = VehicleOrigin.SIMULATED
        lateinit var callback: (DistanceResult) -> Unit
        var closed = false
        override fun readDistance(callback: (DistanceResult) -> Unit) { this.callback = callback }
        override fun close() { closed = true }
    }
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()

    @Test fun timeoutClosesSourceAndLateSuccessCannotReplaceFailure() {
        val source = DeferredAdapter()
        val states = mutableListOf<DistanceState>()
        val completed = CountDownLatch(1)
        lateinit var controller: VehicleReadController
        instrumentation.runOnMainSync {
            controller = VehicleReadController({ source }, { states.add(it)
                if (it is DistanceState.Finished) completed.countDown()
            }, timeoutMillis = 50)
            controller.refresh()
        }
        assertTrue(completed.await(3, TimeUnit.SECONDS))
        instrumentation.runOnMainSync { source.callback(DistanceResult.Available(99f)) }
        instrumentation.waitForIdleSync()
        instrumentation.runOnMainSync {
            assertTrue(source.closed)
            assertEquals(DistanceResult.Failed("TIMEOUT"), (states.last() as DistanceState.Finished).result)
            assertEquals(2, states.size)
            controller.stop()
        }
    }

    @Test fun retryRejectsOldResponseAndPreservesUnavailable() {
        val old = DeferredAdapter()
        val fresh = DeferredAdapter()
        val sources = ArrayDeque(listOf(old, fresh))
        val states = mutableListOf<DistanceState>()
        lateinit var controller: VehicleReadController
        instrumentation.runOnMainSync {
            controller = VehicleReadController({ sources.removeFirst() }, states::add)
            controller.refresh()
            controller.refresh()
            old.callback(DistanceResult.Available(99f))
            fresh.callback(DistanceResult.Unavailable)
        }
        instrumentation.waitForIdleSync()
        instrumentation.runOnMainSync {
            val final = states.last() as DistanceState.Finished
            assertEquals(DistanceResult.Unavailable, final.result)
            assertNull(final.receivedAtMillis)
            assertTrue(old.closed && fresh.closed)
            assertEquals(3, states.size)
            controller.stop()
        }
    }
    @Test fun stoppedScreenRejectsLateResponse() {
        val source = DeferredAdapter()
        val states = mutableListOf<DistanceState>()
        instrumentation.runOnMainSync {
            val controller = VehicleReadController({ source }, states::add)
            controller.refresh()
            controller.stop()
            source.callback(DistanceResult.Available(12f))
        }
        instrumentation.waitForIdleSync()
        assertTrue(source.closed)
        assertEquals(1, states.size)
    }

    @Test fun invalidNumbersAndSynchronousFailureNeverBecomeReadings() {
        val samples = listOf(Float.NaN, Float.POSITIVE_INFINITY, -1f)
        samples.forEach { value ->
            val source = DeferredAdapter()
            val states = mutableListOf<DistanceState>()
            instrumentation.runOnMainSync {
                VehicleReadController({ source }, states::add).refresh()
                source.callback(DistanceResult.Available(value))
            }
            instrumentation.waitForIdleSync()
            assertEquals(DistanceResult.Failed("INVALID_VALUE"), (states.last() as DistanceState.Finished).result)
        }
        val states = mutableListOf<DistanceState>()
        val source = object : VehicleAdapter {
            override val origin = VehicleOrigin.SIMULATED
            override fun readDistance(callback: (DistanceResult) -> Unit) { throw IllegalStateException("read failed") }
            override fun close() = Unit
        }
        instrumentation.runOnMainSync { VehicleReadController({ source }, states::add).refresh() }
        instrumentation.waitForIdleSync()
        assertEquals(DistanceResult.Failed("READ_EXCEPTION"), (states.last() as DistanceState.Finished).result)
    }

}
