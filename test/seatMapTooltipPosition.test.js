import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTooltipPosition } from "../js/seatMapTooltipPosition.js";

const CONTAINER = { width: 400, height: 600 };
const TOOLTIP = { width: 200, height: 80 };
const GAP = 10;

function rect(left, top, width, height) {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

test("places the tooltip below the section by default when there's room", () => {
  const result = computeTooltipPosition({
    sectionRect: rect(150, 100, 100, 50),
    tooltipSize: TOOLTIP,
    containerSize: CONTAINER,
    gap: GAP,
  });
  assert.equal(result.placement, "below");
  assert.equal(result.anchor, "section");
  assert.equal(result.top, 100 + 50 + GAP);
});

test("flips above when below would overflow the container", () => {
  const result = computeTooltipPosition({
    sectionRect: rect(150, 500, 100, 60), // bottom = 560, only 40px left below
    tooltipSize: TOOLTIP,
    containerSize: CONTAINER,
    gap: GAP,
  });
  assert.equal(result.placement, "above");
  assert.equal(result.anchor, "section");
  assert.equal(result.top, 500 - GAP - TOOLTIP.height);
});

test("clamps left when centering would overflow the container's right edge", () => {
  const result = computeTooltipPosition({
    sectionRect: rect(370, 100, 20, 50), // centered would push well past width 400
    tooltipSize: TOOLTIP,
    containerSize: CONTAINER,
    gap: GAP,
  });
  assert.equal(result.left, CONTAINER.width - TOOLTIP.width);
});

test("clamps right (i.e. left stays at 0) when centering would overflow the left edge", () => {
  const result = computeTooltipPosition({
    sectionRect: rect(-10, 100, 20, 50),
    tooltipSize: TOOLTIP,
    containerSize: CONTAINER,
    gap: GAP,
  });
  assert.equal(result.left, 0);
});

test("escalates to beside the section (right) when it's too tall to clear vertically but narrow enough to clear horizontally", () => {
  // Modeled on the standing wedge's real proportions: narrow, and tall
  // enough (spans nearly the whole container height) that neither below
  // nor above fits, even unzoomed.
  const result = computeTooltipPosition({
    sectionRect: rect(40, -50, 120, 650), // top -50, bottom 600 — no room above or below in a 600-tall container
    tooltipSize: TOOLTIP,
    containerSize: CONTAINER,
    gap: GAP,
    pointer: { x: 100, y: 300 },
  });
  assert.equal(result.placement, "right");
  assert.equal(result.anchor, "section");
  assert.equal(result.left, 40 + 120 + GAP);
  // Genuinely clear of the section's own horizontal span, not just the pointer.
  assert.ok(result.left >= 40 + 120);
});

test("escalates to beside the section (left) when there's no room to its right either", () => {
  const result = computeTooltipPosition({
    sectionRect: rect(280, -50, 120, 650), // right edge near the container's own right edge (400)
    tooltipSize: TOOLTIP,
    containerSize: CONTAINER,
    gap: GAP,
    pointer: { x: 340, y: 300 },
  });
  assert.equal(result.placement, "left");
  assert.equal(result.anchor, "section");
  assert.ok(result.left + TOOLTIP.width <= 280);
});

test("escalates to the pointer anchor when the section is larger than the container in both axes (the real zoomed-in case)", () => {
  const result = computeTooltipPosition({
    sectionRect: rect(-500, -800, 1400, 2200), // fully encloses the container at MAX_ZOOM-ish scale
    tooltipSize: TOOLTIP,
    containerSize: CONTAINER,
    gap: GAP,
    pointer: { x: 200, y: 300 },
  });
  assert.equal(result.anchor, "pointer");
  assert.ok(result.left >= 0 && result.left + TOOLTIP.width <= CONTAINER.width);
  assert.ok(result.top >= 0 && result.top + TOOLTIP.height <= CONTAINER.height);
});

test("escalates to the pointer anchor when the section is panned off both the top and bottom (negative top, bottom past the container)", () => {
  const result = computeTooltipPosition({
    sectionRect: rect(50, -300, 300, 1000), // top -300, bottom 700 — container height is 600
    tooltipSize: TOOLTIP,
    containerSize: CONTAINER,
    gap: GAP,
    pointer: { x: 200, y: 250 },
  });
  assert.equal(result.anchor, "pointer");
  assert.ok(result.top >= 0 && result.top + TOOLTIP.height <= CONTAINER.height);
});

test("pointer anchor prefers above the pointer when there's room on both sides", () => {
  const result = computeTooltipPosition({
    sectionRect: rect(-500, -800, 1400, 2200),
    tooltipSize: TOOLTIP,
    containerSize: CONTAINER,
    gap: GAP,
    pointer: { x: 200, y: 300 },
  });
  assert.equal(result.placement, "above");
  assert.equal(result.anchor, "pointer");
  // Genuinely clear of the pointer's own y coordinate, not just non-overlapping by convention.
  assert.ok(result.top + TOOLTIP.height + GAP <= 300);
});

test("pointer anchor falls back to below when the pointer is near the container's own top edge", () => {
  const result = computeTooltipPosition({
    sectionRect: rect(-500, -800, 1400, 2200),
    tooltipSize: TOOLTIP,
    containerSize: CONTAINER,
    gap: GAP,
    pointer: { x: 200, y: 15 }, // no room above (15 - gap - tooltipHeight is deeply negative)
  });
  assert.equal(result.placement, "below");
  assert.equal(result.anchor, "pointer");
  assert.ok(result.top >= 15);
});

test("falls back to a deterministic, in-bounds clamp when neither the section nor a pointer leaves any usable room", () => {
  const result = computeTooltipPosition({
    sectionRect: rect(-500, -800, 1400, 2200),
    tooltipSize: TOOLTIP,
    containerSize: CONTAINER,
    gap: GAP,
    // no pointer
  });
  assert.ok(Number.isFinite(result.left) && Number.isFinite(result.top));
  assert.ok(result.left >= 0 && result.left + TOOLTIP.width <= CONTAINER.width);
  assert.ok(result.top >= 0 && result.top + TOOLTIP.height <= CONTAINER.height);
});
