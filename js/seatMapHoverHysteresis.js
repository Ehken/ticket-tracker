// Pure timer logic for the mouse-hover seat/section resolution — no DOM.
// Extending elementFromPoint resolution to check .seat before
// .closest(".section") means a mouse gliding along a row of small, gapped
// circles resolves seat -> gap -> seat several times a second; swapping
// the tooltip's content/anchor on every one of those transitions reads as
// a strobing box, not a hover. Entering a seat always wins immediately;
// leaving one into bare background only commits after a short grace
// period, cancelled if a seat is re-entered before it elapses. The
// scheduler is injected so this is testable with a fake one instead of
// real timers.
// Default scheduler wraps the globals in receiver-free closures rather
// than passing them through directly ({ setTimeout, clearTimeout }) — a
// browser's native setTimeout/clearTimeout are specified as Window
// methods and throw "Illegal invocation" when called on any other
// receiver, which is exactly what `scheduler.setTimeout(...)` does once
// they're stored as a plain object's properties. Node's globals don't
// enforce this, so a Node-only test run would never catch it — this was
// only found by driving the real thing in an actual browser.
const REAL_SCHEDULER = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};

export function createHoverHysteresis(delayMs, scheduler = REAL_SCHEDULER) {
  let timer = null;

  function cancel() {
    if (timer !== null) {
      scheduler.clearTimeout(timer);
      timer = null;
    }
  }

  return {
    // A seat is under the pointer right now — commit immediately and drop
    // any revert that was pending from a moment ago.
    enterSeat(onSeat, seat) {
      cancel();
      onSeat(seat);
    },
    // No seat under the pointer right now — schedule a revert unless one
    // is already pending (repeated calls while still off-seat don't keep
    // pushing the deadline out).
    leaveSeat(onRevert) {
      if (timer !== null) return;
      timer = scheduler.setTimeout(() => {
        timer = null;
        onRevert();
      }, delayMs);
    },
    cancel,
  };
}
