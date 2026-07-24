import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeZoomedViewBox,
  computePannedViewBox,
  parseViewBox,
  serializeViewBox,
  viewBoxesEqual,
  normalizeWheelDeltaY,
} from "../js/seatMapViewBox.js";

const ORIGINAL = { x: 0, y: 0, width: 1780, height: 1261 };
const BOUNDS = { original: ORIGINAL, maxZoom: 4 };

test("parseViewBox/serializeViewBox round-trip a viewBox attribute string", () => {
  const parsed = parseViewBox("0 0 1780 1261");
  assert.deepEqual(parsed, { x: 0, y: 0, width: 1780, height: 1261 });
  assert.equal(serializeViewBox(parsed), "0 0 1780 1261");
});

test("computeZoomedViewBox keeps the focal point's relative position fixed when zooming in", () => {
  const focalPoint = { x: 890, y: 630.5 }; // dead center of ORIGINAL
  const zoomed = computeZoomedViewBox(ORIGINAL, focalPoint, 0.5, BOUNDS);

  assert.equal(zoomed.width, 890);
  assert.equal(zoomed.height, 630.5);

  const relXBefore = (focalPoint.x - ORIGINAL.x) / ORIGINAL.width;
  const relYBefore = (focalPoint.y - ORIGINAL.y) / ORIGINAL.height;
  const relXAfter = (focalPoint.x - zoomed.x) / zoomed.width;
  const relYAfter = (focalPoint.y - zoomed.y) / zoomed.height;
  assert.ok(Math.abs(relXBefore - relXAfter) < 1e-9);
  assert.ok(Math.abs(relYBefore - relYAfter) < 1e-9);
});

test("computeZoomedViewBox keeps an off-center focal point's relative position fixed too", () => {
  const focalPoint = { x: 200, y: 1000 };
  const zoomed = computeZoomedViewBox(ORIGINAL, focalPoint, 0.5, BOUNDS);
  const relXAfter = (focalPoint.x - zoomed.x) / zoomed.width;
  const relYAfter = (focalPoint.y - zoomed.y) / zoomed.height;
  assert.ok(Math.abs(relXAfter - 200 / 1780) < 1e-9);
  assert.ok(Math.abs(relYAfter - 1000 / 1261) < 1e-9);
});

test("computeZoomedViewBox clamps zoom-out at the original bounds", () => {
  const alreadyZoomedIn = { x: 400, y: 300, width: 500, height: 400 };
  const zoomedOut = computeZoomedViewBox(alreadyZoomedIn, { x: 650, y: 500 }, 10, BOUNDS);
  assert.equal(zoomedOut.width, ORIGINAL.width);
  assert.equal(zoomedOut.height, ORIGINAL.height);
  assert.equal(zoomedOut.x, 0);
  assert.equal(zoomedOut.y, 0);
});

test("computeZoomedViewBox clamps zoom-in at the max zoom factor", () => {
  const focalPoint = { x: 890, y: 630.5 };
  let viewBox = ORIGINAL;
  for (let i = 0; i < 10; i++) {
    viewBox = computeZoomedViewBox(viewBox, focalPoint, 0.5, BOUNDS);
  }
  assert.equal(viewBox.width, ORIGINAL.width / BOUNDS.maxZoom);
  assert.equal(viewBox.height, ORIGINAL.height / BOUNDS.maxZoom);
});

test("computePannedViewBox translates by (dx, dy) when the result stays within bounds", () => {
  const viewBox = { x: 400, y: 300, width: 500, height: 400 };
  const panned = computePannedViewBox(viewBox, 50, -20, BOUNDS);
  assert.deepEqual(panned, { x: 450, y: 280, width: 500, height: 400 });
});

test("computePannedViewBox clamps so the viewBox can't leave the original canvas", () => {
  const viewBox = { x: 400, y: 300, width: 500, height: 400 };
  const pannedFarRight = computePannedViewBox(viewBox, 5000, 0, BOUNDS);
  assert.equal(pannedFarRight.x, ORIGINAL.width - viewBox.width);

  const pannedFarLeft = computePannedViewBox(viewBox, -5000, 0, BOUNDS);
  assert.equal(pannedFarLeft.x, 0);
});

test("computePannedViewBox at full zoom-out has zero room to pan (x/y pinned to origin)", () => {
  const panned = computePannedViewBox(ORIGINAL, 100, 100, BOUNDS);
  assert.equal(panned.x, 0);
  assert.equal(panned.y, 0);
});

test("viewBoxesEqual is true for identical viewBoxes and false for a real difference", () => {
  assert.equal(viewBoxesEqual(ORIGINAL, { ...ORIGINAL }), true);
  assert.equal(viewBoxesEqual(ORIGINAL, { ...ORIGINAL, width: 1000 }), false);
});

test("viewBoxesEqual tolerates floating-point noise within its epsilon", () => {
  assert.equal(viewBoxesEqual(ORIGINAL, { ...ORIGINAL, x: ORIGINAL.x + 1e-9 }), true);
});

test("viewBoxesEqual detects a wheel tick that was fully clamped to a no-op", () => {
  // Already at max zoom-in — a further zoom-in request clamps to the same viewBox.
  const maxZoomedIn = { x: 667.5, y: 472.875, width: 445, height: 315.25 };
  const noop = computeZoomedViewBox(maxZoomedIn, { x: 890, y: 630.5 }, 0.5, BOUNDS);
  assert.equal(viewBoxesEqual(noop, maxZoomedIn), true);
});

test("normalizeWheelDeltaY passes pixel-mode (deltaMode 0) deltas through unchanged", () => {
  assert.equal(normalizeWheelDeltaY(100, 0), 100);
});

test("normalizeWheelDeltaY scales line-mode (deltaMode 1) deltas up so Firefox zooms at the same rate as Chrome", () => {
  const chromePixelDelta = 100;
  const firefoxLineDelta = 3; // a typical single-notch line-mode delta
  const normalized = normalizeWheelDeltaY(firefoxLineDelta, 1);
  assert.ok(normalized > firefoxLineDelta);
  // Should land in the same rough order of magnitude as Chrome's own pixel delta.
  assert.ok(Math.abs(normalized - chromePixelDelta) < chromePixelDelta);
});

test("normalizeWheelDeltaY scales page-mode (deltaMode 2) deltas up substantially", () => {
  assert.equal(normalizeWheelDeltaY(1, 2), 800);
});
