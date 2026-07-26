import { test } from "node:test";
import assert from "node:assert/strict";
import { generateCandidateOffsets, generateZoneCountPlacementCandidates } from "../js/seatMapZoneCountPlacement.js";

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

test("generateZoneCountPlacementCandidates: first candidate is the fully-centered, full-scale position", () => {
  const candidates = generateZoneCountPlacementCandidates({
    zoneHeight: 100,
    boxHeight: 20,
    yStep: 5,
    shapeWidth: 200,
    xStep: 5,
  });
  assert.deepEqual(candidates[0], { scale: 1, yOffset: 0, xOffset: 0 });
});

test("generateZoneCountPlacementCandidates: for a fixed yOffset, xOffsets follow the same nearest-first alternating order", () => {
  const candidates = generateZoneCountPlacementCandidates({
    zoneHeight: 100,
    boxHeight: 20,
    yStep: 10,
    shapeWidth: 100,
    xStep: 10,
    maxXOffsetFraction: 0.3,
  });
  const atYZero = candidates.filter((c) => c.scale === 1 && c.yOffset === 0).map((c) => c.xOffset);
  assert.deepEqual(atYZero, [0, 10, -10, 20, -20, 30, -30]);
});

test("generateZoneCountPlacementCandidates: every 1x candidate precedes every shrunk candidate", () => {
  const candidates = generateZoneCountPlacementCandidates({
    zoneHeight: 30,
    boxHeight: 28,
    yStep: 4,
    shapeWidth: 100,
    xStep: 10,
  });
  const firstShrunkIndex = candidates.findIndex((c) => c.scale !== 1);
  assert.ok(firstShrunkIndex > 0, "expected at least one full-scale candidate before the shrunk ones");
  assert.ok(
    candidates.slice(0, firstShrunkIndex).every((c) => c.scale === 1),
    "every candidate before the first shrunk one must be full-scale"
  );
  assert.ok(
    candidates.slice(firstShrunkIndex).every((c) => c.scale === 0.75),
    "every candidate from the first shrunk one onward must be shrunk"
  );
});

test("generateZoneCountPlacementCandidates: shrinking the box unlocks more vertical room in a tight zone", () => {
  // zoneHeight only just exceeds the full-scale box (little to no room to
  // slide), but comfortably exceeds the shrunk box.
  const candidates = generateZoneCountPlacementCandidates({
    zoneHeight: 21,
    boxHeight: 20,
    yStep: 2,
    shapeWidth: 100,
    xStep: 100, // collapses x to [0] so this isolates the y-axis effect
  });
  const fullScaleYOffsets = new Set(candidates.filter((c) => c.scale === 1).map((c) => c.yOffset));
  const shrunkYOffsets = new Set(candidates.filter((c) => c.scale === 0.75).map((c) => c.yOffset));
  assert.ok(shrunkYOffsets.size > fullScaleYOffsets.size);
});

test("generateZoneCountPlacementCandidates: every xOffset stays within maxXOffsetFraction of the shape width", () => {
  const shapeWidth = 244;
  const maxXOffsetFraction = 0.35;
  const candidates = generateZoneCountPlacementCandidates({
    zoneHeight: 100,
    boxHeight: 30,
    yStep: 6,
    shapeWidth,
    xStep: 8,
    maxXOffsetFraction,
  });
  const maxAllowed = shapeWidth * maxXOffsetFraction;
  for (const { xOffset } of candidates) {
    assert.ok(Math.abs(xOffset) <= maxAllowed + 1e-9);
  }
});

test("generateZoneCountPlacementCandidates: every yOffset stays within the zone's fit bound for its own scale", () => {
  const zoneHeight = 62.4;
  const boxHeight = 32;
  const candidates = generateZoneCountPlacementCandidates({
    zoneHeight,
    boxHeight,
    yStep: 4,
    shapeWidth: 100,
    xStep: 8,
  });
  for (const { scale, yOffset } of candidates) {
    const maxOffset = Math.max(0, (zoneHeight - boxHeight * scale) / 2);
    assert.ok(Math.abs(yOffset) <= maxOffset + 1e-9);
  }
});

test("generateZoneCountPlacementCandidates: default maxXOffsetFraction/shrinkScale apply when omitted", () => {
  const candidates = generateZoneCountPlacementCandidates({
    zoneHeight: 100,
    boxHeight: 20,
    yStep: 10,
    shapeWidth: 200,
    xStep: 10,
  });
  const scales = new Set(candidates.map((c) => c.scale));
  assert.deepEqual([...scales], [1, 0.75]);
  const maxXOffset = Math.max(...candidates.map((c) => Math.abs(c.xOffset)));
  assert.equal(maxXOffset, 200 * 0.35);
});
