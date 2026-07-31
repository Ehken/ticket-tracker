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
export function createHoverHysteresis(delayMs, scheduler = { setTimeout, clearTimeout }) {
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
