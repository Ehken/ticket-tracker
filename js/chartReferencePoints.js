import { findValueAtOrBefore } from "./dashboardTrends.js";

// Pure geometry and selection logic behind the per-game chart's labelled
// reference points. Kept out of js/chart.js so it can be unit-tested — the
// Chart.js/canvas assembly there stays hand-verified, per this project's
// convention.

const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

// Two labels this close would collide — and a point that close to an
// already-chosen one is at nearly the same date AND value anyway, so it
// says nothing the first one didn't. Box test, not radius: these labels
// ("31.8. 3 102") are roughly 3.5x wider than they are tall, so a radius
// test would drop pairs that don't overlap and keep pairs that do.
const MIN_SEPARATION_X = 64;
const MIN_SEPARATION_Y = 18;

function tooClose(a, b) {
  return Math.abs(a.x - b.x) < MIN_SEPARATION_X && Math.abs(a.y - b.y) < MIN_SEPARATION_Y;
}

// Priority for label placement when two labels can't both fit. The last
// observation is the number the chart exists to answer; T-7 is the most
// expendable, which is also why it loses the proximity test above.
const PRIORITY = { last: 0, first: 1, mover: 2, t7: 4 };

const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Helsinki",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function helsinkiDayKey(iso) {
  const parts = dayKeyFormatter.formatToParts(new Date(iso));
  const year = parts.find((p) => p.type === "year").value;
  const month = parts.find((p) => p.type === "month").value;
  const day = parts.find((p) => p.type === "day").value;
  return `${year}-${month}-${day}`;
}

// Calendar keys compared as UTC midnights: the arithmetic is exact
// regardless of the DST shift the Helsinki day itself may contain.
function isNextCalendarDay(previousKey, key) {
  const [py, pm, pd] = previousKey.split("-").map(Number);
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - Date.UTC(py, pm - 1, pd) === 86400000;
}

// One entry per Helsinki calendar day that has observations, carrying that
// day's CLOSING value and the index it was observed at. Assumes the input
// is chronological, which every history.json is.
function buildDayCloses(historyPoints) {
  const days = [];
  for (let i = 0; i < historyPoints.length; i++) {
    const key = helsinkiDayKey(historyPoints[i].t);
    const previous = days[days.length - 1];
    if (previous && previous.key === key) {
      previous.index = i;
      previous.sold = historyPoints[i].sold;
    } else {
      days.push({ key, index: i, sold: historyPoints[i].sold });
    }
  }
  return days;
}

// Day-over-day changes, largest absolute first. Only days whose previous
// observed day is the immediately preceding calendar day count: without
// that guard a scraper outage (real gaps of 12-21h exist in the data, and
// GitHub drops scheduled runs) would surface as a single fake "day" of
// movement. A zero change is not a mover, so a flat series has none.
function moverCandidates(historyPoints) {
  const days = buildDayCloses(historyPoints);
  const candidates = [];
  for (let i = 1; i < days.length; i++) {
    if (!isNextCalendarDay(days[i - 1].key, days[i].key)) continue;
    const change = days[i].sold - days[i - 1].sold;
    if (change === 0) continue;
    candidates.push({ index: days[i].index, change });
  }
  // Ties break toward the more recent day — recent movement is the more
  // useful of two equally sized ones.
  return candidates.sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || b.index - a.index);
}

// At most five points: first observation, T-7, last observation, and the
// two largest single-day changes. `project` maps a point to canvas pixels
// and is only consulted for the T-7 proximity test.
export function selectChartReferencePoints(historyPoints, { eventStart = null, project } = {}) {
  if (!Array.isArray(historyPoints) || historyPoints.length === 0) return [];

  const lastIndex = historyPoints.length - 1;
  const anchorIndices = new Set([0, lastIndex]);

  // A mover landing on top of a fixed anchor is skipped in favour of the
  // next largest: when a game's biggest day move happens to be its last,
  // the mover would otherwise repeat the final label's own date and value
  // verbatim and burn a slot doing it. Only anchors are tested here, so
  // which two movers are chosen stays a property of the data — two movers
  // crowding each other is a layout problem, resolved in
  // layoutReferenceLabels, not a reason to pick different ones.
  const anchorPixels = [project(historyPoints[0])];
  if (lastIndex > 0) anchorPixels.push(project(historyPoints[lastIndex]));

  const movers = [];
  const moverPixels = [];
  for (const candidate of moverCandidates(historyPoints)) {
    if (anchorIndices.has(candidate.index)) continue;
    const pixel = project(historyPoints[candidate.index]);
    if (anchorPixels.some((other) => tooClose(pixel, other))) continue;
    movers.push(candidate);
    moverPixels.push(pixel);
    if (movers.length === 2) break;
  }

  // T-7 is the last observation at or before start - 7 days. It falls away
  // whenever it would duplicate a point already chosen: no observation
  // qualifies (sales window under 7 days), or the boundary is later than
  // the last observation (the game is still more than 7 days out — the
  // common case, not an edge case).
  let t7Index = null;
  if (eventStart) {
    const cutoff = new Date(new Date(eventStart).getTime() - SEVEN_DAYS_MS).toISOString();
    const point = findValueAtOrBefore(historyPoints, cutoff);
    if (point) {
      const index = historyPoints.indexOf(point);
      const taken = anchorIndices.has(index) || movers.some((mover) => mover.index === index);
      if (!taken) t7Index = index;
    }
  }

  // T-7 is the one that loses a collision — it is the most expendable of
  // the five, and a point that close carries the same reading anyway.
  if (t7Index !== null) {
    const pixel = project(historyPoints[t7Index]);
    if ([...anchorPixels, ...moverPixels].some((other) => tooClose(pixel, other))) t7Index = null;
  }

  const chosen = [{ index: 0, role: "first", priority: PRIORITY.first }];
  if (lastIndex > 0) chosen.push({ index: lastIndex, role: "last", priority: PRIORITY.last });
  if (t7Index !== null) chosen.push({ index: t7Index, role: "t7", priority: PRIORITY.t7 });
  movers.forEach((mover, rank) => {
    chosen.push({ index: mover.index, role: "mover", priority: PRIORITY.mover + rank, change: mover.change });
  });

  return chosen
    .sort((a, b) => a.index - b.index)
    .map((entry) => ({ ...entry, t: historyPoints[entry.index].t, sold: historyPoints[entry.index].sold }));
}

// Round axis steps, smallest first — the first one that keeps the axis
// under MAX_GRIDLINES lines wins.
const NICE_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
const MAX_GRIDLINES = 8;

// The axis never zooms tighter than this, so a game that barely moved
// stays visibly flat instead of having its noise magnified into a
// dramatic-looking curve. Proportional to the largest value so it scales
// with the venue rather than being tuned to this one arena.
const NOISE_FLOOR_FRACTION = 0.1;
const MIN_VISIBLE_SPAN = 100;
const LABEL_HEADROOM = 0.15;

// Cropped to the data instead of starting at zero: with a ~2 400
// season-ticket floor under every game, a zero-based axis spends most of
// its height on space nothing ever enters. Still the same total-sold
// number — this changes the frame, not the value.
export function computeChartYBounds(historyPoints) {
  if (!Array.isArray(historyPoints) || historyPoints.length === 0) {
    return { min: 0, max: 100, stepSize: 20 };
  }

  let lo = Infinity;
  let hi = -Infinity;
  for (const point of historyPoints) {
    if (point.sold < lo) lo = point.sold;
    if (point.sold > hi) hi = point.sold;
  }

  const span = Math.max(hi - lo, Math.max(MIN_VISIBLE_SPAN, hi * NOISE_FLOOR_FRACTION));
  const centre = (lo + hi) / 2;
  const half = (span / 2) * (1 + LABEL_HEADROOM);
  const rawMin = Math.max(0, centre - half);
  const rawMax = centre + half;

  const step = NICE_STEPS.find((candidate) => (rawMax - rawMin) / candidate <= MAX_GRIDLINES) ?? NICE_STEPS.at(-1);

  return {
    min: Math.floor(rawMin / step) * step,
    max: Math.ceil(rawMax / step) * step,
    stepSize: step,
  };
}

// Breathing room between two label boxes before they count as colliding.
const BOX_PADDING_X = 3;
const BOX_PADDING_Y = 2;

// Vertical distance from the marker to the label's nearest edge.
const MARKER_GAP = 9;

// Keeps labels off the very edge of the plot area.
const EDGE_PADDING = 2;

function overlaps(a, b) {
  return (
    a.left - BOX_PADDING_X < b.right &&
    b.left - BOX_PADDING_X < a.right &&
    a.top - BOX_PADDING_Y < b.bottom &&
    b.top - BOX_PADDING_Y < a.bottom
  );
}

// Places already-projected labels so none overflows the plot area and none
// overlaps another. Each is tried above its marker first, then below;
// anything that still collides with a higher-priority label is dropped
// rather than drawn on top of it. Returns left-edge x and baseline y, so
// the caller always draws left-aligned.
export function layoutReferenceLabels(items, { chartArea, measureWidth, lineHeight }) {
  const placed = [];

  for (const item of [...items].sort((a, b) => a.priority - b.priority)) {
    const width = measureWidth(item.text);

    // The last point sits at the right edge, which is the one that would
    // otherwise clip.
    let left = item.x - width / 2;
    if (left < chartArea.left + EDGE_PADDING) left = chartArea.left + EDGE_PADDING;
    if (left + width > chartArea.right - EDGE_PADDING) left = chartArea.right - EDGE_PADDING - width;

    const baselines = [];
    if (item.y - MARKER_GAP - lineHeight >= chartArea.top) baselines.push(item.y - MARKER_GAP);
    if (item.y + MARKER_GAP + lineHeight <= chartArea.bottom) baselines.push(item.y + MARKER_GAP + lineHeight);

    for (const baseline of baselines) {
      const box = { left, right: left + width, top: baseline - lineHeight, bottom: baseline };
      if (placed.some((other) => overlaps(other.box, box))) continue;
      placed.push({ index: item.index, text: item.text, x: left, y: baseline, box });
      break;
    }
  }

  return placed.sort((a, b) => a.index - b.index).map(({ box, ...label }) => label);
}
