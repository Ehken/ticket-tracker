import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEAT_STATE,
  AITIO_STATE,
  sectionOfSeatId,
  buildDisabledSectionSet,
  classifySeat,
  classifyAitio,
  parseSeatId,
  nearestSeatId,
} from "../js/seatMapClassify.js";

test("sectionOfSeatId extracts the section prefix before the first dash", () => {
  assert.equal(sectionOfSeatId("A1-12-172"), "A1");
  assert.equal(sectionOfSeatId("C4-1-001"), "C4");
});

test("buildDisabledSectionSet collects only sections flagged disabled", () => {
  const sections = [
    { section: "A1", sold: 10, disabled: false },
    { section: "C7", sold: 5, disabled: true },
    { section: "C2", sold: 0, disabled: true },
    { section: "seisomakatsomo", sold: 50 }, // no disabled key at all
  ];
  assert.deepEqual(buildDisabledSectionSet(sections), new Set(["C7", "C2"]));
});

test("classifySeat: 4-state — kausikortti when sold and in the baseline set", () => {
  const state = classifySeat("A1-1-001", {
    soldSet: new Set(["A1-1-001"]),
    baselineSet: new Set(["A1-1-001"]),
    disabledSectionSet: new Set(),
  });
  assert.equal(state, SEAT_STATE.KAUSIKORTTI);
});

test("classifySeat: 4-state — irtolippu when sold but not in the baseline set", () => {
  const state = classifySeat("A1-1-001", {
    soldSet: new Set(["A1-1-001"]),
    baselineSet: new Set(["A1-1-002"]),
    disabledSectionSet: new Set(),
  });
  assert.equal(state, SEAT_STATE.IRTOLIPPU);
});

test("classifySeat: vapaa when not sold, regardless of baseline", () => {
  const state = classifySeat("A1-1-001", {
    soldSet: new Set(),
    baselineSet: new Set(["A1-1-001"]),
    disabledSectionSet: new Set(),
  });
  assert.equal(state, SEAT_STATE.VAPAA);
});

test("classifySeat: 3-state fallback (MYYTY, not KAUSIKORTTI/IRTOLIPPU) when baselineSet is null", () => {
  const state = classifySeat("A1-1-001", {
    soldSet: new Set(["A1-1-001"]),
    baselineSet: null,
    disabledSectionSet: new Set(),
  });
  assert.equal(state, SEAT_STATE.MYYTY);
});

test("classifySeat: sold status wins over disabled-section — a sold seat in a closed section is still kausikortti/irtolippu", () => {
  const state = classifySeat("C7-3-050", {
    soldSet: new Set(["C7-3-050"]),
    baselineSet: new Set(["C7-3-050"]),
    disabledSectionSet: new Set(["C7"]),
  });
  assert.equal(state, SEAT_STATE.KAUSIKORTTI);
});

test("classifySeat: sold status also wins over disabled-section in 3-state fallback mode", () => {
  const state = classifySeat("C7-3-050", {
    soldSet: new Set(["C7-3-050"]),
    baselineSet: null,
    disabledSectionSet: new Set(["C7"]),
  });
  assert.equal(state, SEAT_STATE.MYYTY);
});

test("classifySeat: an unsold seat in a disabled section is still ei-myynnissa", () => {
  const state = classifySeat("C7-3-050", {
    soldSet: new Set(),
    baselineSet: new Set(),
    disabledSectionSet: new Set(["C7"]),
  });
  assert.equal(state, SEAT_STATE.EI_MYYNNISSA);
});

test("classifyAitio: occupied box (in soldAitioSet) is aitio-myyty", () => {
  assert.equal(classifyAitio("aitio_2", new Set(["aitio_2", "aitio_5"])), AITIO_STATE.MYYTY);
});

test("classifyAitio: empty box is ei-myynnissa", () => {
  assert.equal(classifyAitio("aitio_9", new Set(["aitio_2", "aitio_5"])), AITIO_STATE.EI_MYYNNISSA);
});

test("parseSeatId splits section-row-seat and strips zero-padding via Number()", () => {
  assert.deepEqual(parseSeatId("A1-1-005"), { section: "A1", row: 1, seat: 5 });
  assert.deepEqual(parseSeatId("A1-10-128"), { section: "A1", row: 10, seat: 128 });
  assert.deepEqual(parseSeatId("C4-3-001"), { section: "C4", row: 3, seat: 1 });
});

test("nearestSeatId picks the closest seat by straight-line distance", () => {
  const seats = [
    { id: "A1-1-001", cx: 0, cy: 0 },
    { id: "A1-1-002", cx: 11, cy: 0 },
    { id: "A1-1-003", cx: 22, cy: 0 },
  ];
  assert.equal(nearestSeatId(seats, { x: 13, y: 0 }), "A1-1-002");
  assert.equal(nearestSeatId(seats, { x: 0, y: 0 }), "A1-1-001");
});

test("nearestSeatId returns null when the nearest seat exceeds maxDistance", () => {
  const seats = [{ id: "A1-1-001", cx: 0, cy: 0 }];
  assert.equal(nearestSeatId(seats, { x: 100, y: 0 }, 40), null);
  assert.equal(nearestSeatId(seats, { x: 30, y: 0 }, 40), "A1-1-001");
});

test("nearestSeatId with no cap (default Infinity) always returns the nearest seat, however far", () => {
  const seats = [{ id: "A1-1-001", cx: 0, cy: 0 }];
  assert.equal(nearestSeatId(seats, { x: 10000, y: 10000 }), "A1-1-001");
});
