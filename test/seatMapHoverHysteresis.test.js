import { test } from "node:test";
import assert from "node:assert/strict";
import { createHoverHysteresis } from "../js/seatMapHoverHysteresis.js";

// Fake scheduler: setTimeout just records the callback instead of running
// it — tests fire it manually via `pending()` to simulate the delay
// elapsing, keeping this test file free of real timers.
function fakeScheduler() {
  let pending = null;
  let scheduleCount = 0;
  return {
    scheduler: {
      setTimeout(fn) {
        pending = fn;
        scheduleCount++;
        return scheduleCount;
      },
      clearTimeout() {
        pending = null;
      },
    },
    fire() {
      const fn = pending;
      pending = null;
      fn();
    },
    isPending() {
      return pending !== null;
    },
    get scheduleCount() {
      return scheduleCount;
    },
  };
}

test("enterSeat commits immediately", () => {
  const { scheduler } = fakeScheduler();
  const hysteresis = createHoverHysteresis(100, scheduler);
  const calls = [];
  hysteresis.enterSeat((seat) => calls.push(seat), "A1-1-001");
  assert.deepEqual(calls, ["A1-1-001"]);
});

test("enterSeat cancels a pending revert instead of letting it fire later", () => {
  const { scheduler, isPending } = fakeScheduler();
  const hysteresis = createHoverHysteresis(100, scheduler);
  const calls = [];
  hysteresis.leaveSeat(() => calls.push("reverted"));
  assert.equal(isPending(), true);
  hysteresis.enterSeat((seat) => calls.push(seat), "A1-1-002");
  assert.equal(isPending(), false);
  assert.deepEqual(calls, ["A1-1-002"]);
});

test("leaveSeat does not fire onRevert until the timer elapses", () => {
  const { scheduler, fire } = fakeScheduler();
  const hysteresis = createHoverHysteresis(100, scheduler);
  const calls = [];
  hysteresis.leaveSeat(() => calls.push("reverted"));
  assert.deepEqual(calls, []);
  fire();
  assert.deepEqual(calls, ["reverted"]);
});

test("leaveSeat called repeatedly while still off-seat does not reschedule the timer", () => {
  const fake = fakeScheduler();
  const hysteresis = createHoverHysteresis(100, fake.scheduler);
  hysteresis.leaveSeat(() => {});
  hysteresis.leaveSeat(() => {});
  hysteresis.leaveSeat(() => {});
  assert.equal(fake.scheduleCount, 1);
});

test("cancel drops a pending revert without firing it", () => {
  const { scheduler, isPending } = fakeScheduler();
  const hysteresis = createHoverHysteresis(100, scheduler);
  const calls = [];
  hysteresis.leaveSeat(() => calls.push("reverted"));
  hysteresis.cancel();
  assert.equal(isPending(), false);
  assert.deepEqual(calls, []);
});

test("after a revert fires, a new leaveSeat schedules again (not stuck permanently pending)", () => {
  const fake = fakeScheduler();
  const hysteresis = createHoverHysteresis(100, fake.scheduler);
  hysteresis.leaveSeat(() => {});
  fake.fire();
  hysteresis.leaveSeat(() => {});
  assert.equal(fake.scheduleCount, 2);
});
