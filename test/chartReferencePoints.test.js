import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeChartYBounds,
  layoutReferenceLabels,
  selectChartReferencePoints,
} from "../js/chartReferencePoints.js";

// Helsinki is UTC+3 in August, so 09:00Z is 12:00 local — comfortably
// inside the same calendar day either way.
function at(day, sold, hour = 9) {
  return { t: `2026-08-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`, sold };
}

// 4px per elapsed hour (so a day is 96px, well past the 64px collision
// threshold) and one pixel per seat, so distances in a test are exactly
// what the numbers say.
const ORIGIN = Date.parse("2026-08-01T00:00:00.000Z");
const pixelsPerHour = (scale) => (point) => ({
  x: ((Date.parse(point.t) - ORIGIN) / 3600000) * scale,
  y: point.sold,
});
const project = pixelsPerHour(4);

function roles(selected) {
  return selected.map((entry) => `${entry.role}@${entry.index}`);
}

test("selectChartReferencePoints: an empty history produces no labels", () => {
  assert.deepEqual(selectChartReferencePoints([], { project }), []);
});

test("selectChartReferencePoints: a single observation is labelled once, not twice", () => {
  const selected = selectChartReferencePoints([at(1, 2500)], { project });
  assert.deepEqual(roles(selected), ["first@0"]);
});

test("selectChartReferencePoints: fewer than five points available collapses to first and last, with no substitutes", () => {
  const history = [at(1, 0), at(4, 486)];
  const selected = selectChartReferencePoints(history, { project });
  assert.deepEqual(roles(selected), ["first@0", "last@1"]);
});

test("selectChartReferencePoints: the two largest single-day changes fill the remaining slots", () => {
  const history = [at(1, 2500), at(2, 2510), at(3, 2610), at(4, 2620), at(5, 2800), at(6, 2805)];
  const selected = selectChartReferencePoints(history, { project });
  // +100 on the 3rd and +180 on the 5th are the two biggest day moves.
  assert.deepEqual(roles(selected), ["first@0", "mover@2", "mover@4", "last@5"]);
});

test("selectChartReferencePoints: movers are ranked by absolute size, so all-negative days still produce the two biggest drops", () => {
  const history = [at(1, 3000), at(2, 2995), at(3, 2900), at(4, 2890), at(5, 2700), at(6, 2698)];
  const selected = selectChartReferencePoints(history, { project });
  assert.deepEqual(roles(selected), ["first@0", "mover@2", "mover@4", "last@5"]);
  const changes = selected.filter((entry) => entry.role === "mover").map((entry) => entry.change);
  assert.deepEqual(changes, [-95, -190]);
});

test("selectChartReferencePoints: a completely flat series has no movers at all", () => {
  const history = [at(1, 2500), at(2, 2500), at(3, 2500), at(4, 2500), at(5, 2500)];
  const selected = selectChartReferencePoints(history, { project });
  assert.deepEqual(roles(selected), ["first@0", "last@4"]);
});

test("selectChartReferencePoints: a multi-day scraper gap is not counted as a single-day change", () => {
  // Nothing observed on the 3rd or 4th, so the +400 spanning that outage
  // is not attributable to one day; the +20 on the 2nd is the only mover.
  const history = [at(1, 2500), at(2, 2520), at(5, 2920), at(6, 2925)];
  const selected = selectChartReferencePoints(history, { project });
  assert.deepEqual(roles(selected), ["first@0", "mover@1", "last@3"]);
});

test("selectChartReferencePoints: T-7 is the last observation at or before seven days before the start", () => {
  const history = [at(1, 2500), at(2, 2510), at(3, 2610, 8), at(3, 2760, 20), at(4, 2765), at(5, 2800), at(6, 2805)];
  // Start on the 10th at 12:00Z puts the T-7 boundary at the 3rd, 12:00Z —
  // so the 08:00Z observation qualifies and the 20:00Z one does not.
  const selected = selectChartReferencePoints(history, {
    eventStart: "2026-08-10T12:00:00.000Z",
    project,
  });
  assert.equal(selected.find((entry) => entry.role === "t7").index, 2);
});

test("selectChartReferencePoints: a sales window shorter than seven days has no T-7 anchor, and nothing replaces it", () => {
  const history = [at(5, 2500), at(6, 2600), at(7, 2650), at(8, 2900)];
  const selected = selectChartReferencePoints(history, {
    eventStart: "2026-08-09T12:00:00.000Z",
    project,
  });
  assert.equal(selected.some((entry) => entry.role === "t7"), false);
  assert.deepEqual(roles(selected), ["first@0", "mover@1", "mover@2", "last@3"]);
});

test("selectChartReferencePoints: a game still more than seven days out has no T-7 anchor either", () => {
  const history = [at(1, 2500), at(2, 2510), at(3, 2610), at(4, 2620), at(5, 2800)];
  // T-7 lands after the last observation, so it would only duplicate it.
  const selected = selectChartReferencePoints(history, {
    eventStart: "2026-09-30T12:00:00.000Z",
    project,
  });
  assert.equal(selected.some((entry) => entry.role === "t7"), false);
});

// The biggest mover closes the 3rd at 20:00Z on 2 800; T-7 resolves to the
// 4th at 02:00Z on 2 802 — six hours and two seats away, which is what a
// collision looks like in practice.
const COLLIDING = [
  at(1, 2500),
  at(2, 2510),
  at(3, 2500, 8),
  at(3, 2800, 20),
  at(4, 2802, 2),
  at(4, 2810, 20),
  at(5, 2830),
  at(6, 2835),
];

test("selectChartReferencePoints: T-7 loses to a mover it would collide with", () => {
  const selected = selectChartReferencePoints(COLLIDING, {
    eventStart: "2026-08-11T06:00:00.000Z",
    project,
  });
  // 24px apart on x, 2 on y — inside the 64x18 threshold.
  assert.equal(selected.some((entry) => entry.role === "t7"), false);
  assert.deepEqual(roles(selected), ["first@0", "mover@3", "mover@6", "last@7"]);
});

test("selectChartReferencePoints: T-7 survives a mover that is far enough away on screen", () => {
  // Same data on a wider canvas: 120px apart on x, so the two labels no
  // longer compete for the same space.
  const selected = selectChartReferencePoints(COLLIDING, {
    eventStart: "2026-08-11T06:00:00.000Z",
    project: pixelsPerHour(20),
  });
  assert.equal(selected.find((entry) => entry.role === "t7").index, 4);
});

test("computeChartYBounds: crops to the data with round bounds instead of starting at zero", () => {
  // The real Tappara (53:611) range.
  assert.deepEqual(computeChartYBounds([{ sold: 2506 }, { sold: 2785 }]), {
    min: 2450,
    max: 2850,
    stepSize: 50,
  });
});

test("computeChartYBounds: a barely-moving game is not magnified into drama", () => {
  // The flattest real event (53:585) moves 87 seats; the noise floor keeps
  // it to roughly a quarter of the axis rather than filling it.
  const bounds = computeChartYBounds([{ sold: 2487 }, { sold: 2574 }]);
  assert.deepEqual(bounds, { min: 2350, max: 2700, stepSize: 50 });
  assert.ok((2574 - 2487) / (bounds.max - bounds.min) < 0.3);
});

test("computeChartYBounds: a completely flat series still gets an axis with height", () => {
  const bounds = computeChartYBounds([{ sold: 1000 }, { sold: 1000 }, { sold: 1000 }]);
  assert.ok(bounds.max > bounds.min);
  assert.ok(bounds.min < 1000 && bounds.max > 1000);
});

test("computeChartYBounds: never drops below zero when the data starts there", () => {
  assert.deepEqual(computeChartYBounds([{ sold: 0 }, { sold: 486 }]), { min: 0, max: 600, stepSize: 100 });
});

test("computeChartYBounds: an empty history returns a usable axis rather than an infinite one", () => {
  const bounds = computeChartYBounds([]);
  assert.ok(Number.isFinite(bounds.min) && Number.isFinite(bounds.max));
  assert.ok(bounds.max > bounds.min);
});

const CHART_AREA = { left: 40, right: 400, top: 10, bottom: 200 };
const measureWidth = (text) => text.length * 6;

test("layoutReferenceLabels: the label on the last point stays inside the plot area instead of clipping", () => {
  const [label] = layoutReferenceLabels(
    [{ index: 9, priority: 0, text: "25.8. 2 780", x: 400, y: 60 }],
    { chartArea: CHART_AREA, measureWidth, lineHeight: 14 },
  );
  assert.ok(label.x >= CHART_AREA.left);
  assert.ok(label.x + measureWidth(label.text) <= CHART_AREA.right);
});

test("layoutReferenceLabels: the label on the first point does not overflow the left edge", () => {
  const [label] = layoutReferenceLabels(
    [{ index: 0, priority: 1, text: "3.8. 2 509", x: 40, y: 150 }],
    { chartArea: CHART_AREA, measureWidth, lineHeight: 14 },
  );
  assert.ok(label.x >= CHART_AREA.left);
});

test("layoutReferenceLabels: a label that would sit above the top edge is flipped below its marker", () => {
  const [label] = layoutReferenceLabels(
    [{ index: 3, priority: 0, text: "12.8. 2 611", x: 200, y: 12 }],
    { chartArea: CHART_AREA, measureWidth, lineHeight: 14 },
  );
  assert.ok(label.y > 12);
});

test("layoutReferenceLabels: two labels on the same spot are separated, not stacked on top of each other", () => {
  const placed = layoutReferenceLabels(
    [
      { index: 2, priority: 0, text: "12.8. 2 611", x: 200, y: 100 },
      { index: 5, priority: 2, text: "13.8. 2 615", x: 200, y: 100 },
    ],
    { chartArea: CHART_AREA, measureWidth, lineHeight: 14 },
  );
  assert.equal(placed.length, 2);
  assert.notEqual(placed[0].y, placed[1].y);
});

test("layoutReferenceLabels: a label with nowhere left to go is dropped rather than drawn over another", () => {
  // Room for exactly one label above the marker and one below it.
  const tight = { left: 40, right: 400, top: 80, bottom: 140 };
  const placed = layoutReferenceLabels(
    [
      { index: 2, priority: 0, text: "12.8. 2 611", x: 200, y: 110 },
      { index: 5, priority: 2, text: "13.8. 2 615", x: 200, y: 110 },
      { index: 7, priority: 4, text: "14.8. 2 620", x: 200, y: 110 },
    ],
    { chartArea: tight, measureWidth, lineHeight: 14 },
  );
  assert.equal(placed.length, 2);
  // The lowest-priority label (T-7) is the one that goes.
  assert.equal(placed.some((label) => label.index === 7), false);
});

test("layoutReferenceLabels: placements come back in chronological order regardless of priority", () => {
  const placed = layoutReferenceLabels(
    [
      { index: 9, priority: 0, text: "25.8. 2 780", x: 380, y: 40 },
      { index: 0, priority: 1, text: "3.8. 2 509", x: 45, y: 180 },
      { index: 4, priority: 2, text: "12.8. 2 611", x: 200, y: 120 },
    ],
    { chartArea: CHART_AREA, measureWidth, lineHeight: 14 },
  );
  assert.deepEqual(placed.map((label) => label.index), [0, 4, 9]);
});

test("selectChartReferencePoints: a mover that would repeat an anchor's own date and value gives up its slot", () => {
  // The real shape of this on Tappara 53:611: the biggest day move closes
  // the 5th at 2 900 and the last observation, six hours later, is still
  // 2 900 — labelling both prints the same number twice, side by side.
  // The next largest moves take the slots instead.
  const history = [at(1, 2500), at(2, 2510), at(3, 2570), at(4, 2580), at(5, 2900, 20), at(6, 2900, 2)];
  const selected = selectChartReferencePoints(history, { project });
  assert.deepEqual(roles(selected), ["first@0", "mover@2", "mover@3", "last@5"]);
});
