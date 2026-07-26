import { test } from "node:test";
import assert from "node:assert/strict";
import { generateCandidateOffsets } from "../js/seatMapZoneCountPlacement.js";

test("generateCandidateOffsets: zone much taller than the box yields alternating offsets out to the exact edge", () => {
  const offsets = generateCandidateOffsets({ zoneHeight: 100, boxHeight: 20, step: 10 });
  assert.deepEqual(offsets, [0, 10, -10, 20, -20, 30, -30, 40, -40]);
});

test("generateCandidateOffsets: zone exactly the box's own height has no room to slide", () => {
  assert.deepEqual(generateCandidateOffsets({ zoneHeight: 20, boxHeight: 20, step: 4 }), [0]);
});

test("generateCandidateOffsets: zone smaller than the box clamps to just the centered candidate", () => {
  assert.deepEqual(generateCandidateOffsets({ zoneHeight: 10, boxHeight: 20, step: 4 }), [0]);
});

test("generateCandidateOffsets: non-positive step is defensively ignored, falling back to centered only", () => {
  assert.deepEqual(generateCandidateOffsets({ zoneHeight: 100, boxHeight: 20, step: 0 }), [0]);
  assert.deepEqual(generateCandidateOffsets({ zoneHeight: 100, boxHeight: 20, step: -5 }), [0]);
});

test("generateCandidateOffsets: max offset smaller than one step still yields the exact boundary candidates", () => {
  const offsets = generateCandidateOffsets({ zoneHeight: 22, boxHeight: 20, step: 4 });
  assert.deepEqual(offsets, [0, 1, -1]);
});

test("generateCandidateOffsets: first candidate is always the centered (zero-offset) position", () => {
  const offsets = generateCandidateOffsets({ zoneHeight: 200, boxHeight: 20, step: 5 });
  assert.equal(offsets[0], 0);
});

test("generateCandidateOffsets: every offset keeps the box fully within the zone span", () => {
  const zoneHeight = 137;
  const boxHeight = 24;
  const maxOffset = (zoneHeight - boxHeight) / 2;
  const offsets = generateCandidateOffsets({ zoneHeight, boxHeight, step: 6 });
  for (const offset of offsets) {
    assert.ok(offset <= maxOffset + 1e-9);
    assert.ok(offset >= -maxOffset - 1e-9);
  }
});
