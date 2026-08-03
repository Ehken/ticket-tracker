// Generates a rich, realistic-looking fake dataset under data/mock/ for
// frontend design/testing work (loaded only via ?mock=1). Never touches
// data/ (production). Deterministic (seeded PRNG) so re-running this after
// editing it reproduces the same output unless the generation logic itself
// changed — run with: node scripts/generateMockData.js
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { parseSeatmapSeatIds } from "./lib/seatmap.js";
import { compareAitioIds } from "./lib/sections.js";
import { sectionOfSeatId } from "../js/seatMapClassify.js";
import { mergeClassification } from "../js/classify.js";
import { appendSectionHistoryPointIfChanged, writeSectionHistoryIfChanged } from "./lib/dataStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const mockDir = path.join(repoRoot, "data", "mock");

const SEATED_CAPACITIES = {
  A1: 171,
  A2: 268,
  A3: 246,
  A4: 244,
  A5: 247,
  A6: 120,
  C1: 108,
  C2: 120,
  C3: 150,
  C4: 120,
  C5: 120,
  C6: 113,
  C7: 94,
  C8: 105,
  D1: 205,
  D2: 215,
};
const STANDING_CAPACITY = 2138;
const WHEELCHAIR_CAPACITY = 12;
const PRESS_CAPACITY = 24;

// Per-box capacities (real verified values) — boxes have no per-seat
// granularity, just a binary occupied/not-occupied state per box (see
// `soldAitioIds`), so this per-box breakdown exists purely to compute a
// sensible aggregate "aitiot" sold figure when a box is marked occupied.
const AITIO_CAPACITIES = {
  aitio_1: 16,
  aitio_2: 16,
  aitio_3: 18,
  aitio_4: 18,
  aitio_5: 18,
  aitio_6: 18,
  aitio_7: 18,
  aitio_8: 18,
  aitio_9: 16,
};
const AITIOT_CAPACITY = Object.values(AITIO_CAPACITIES).reduce((sum, n) => sum + n, 0);

// Shared "as of" reference instants, one per season — each season's own
// kausikortti event is generated as of this same moment, and every match
// event within that season shares it too (when the guard below allows it),
// so a single dashboard render has a coherent "today" to compute 24h/7d
// deltas and sellout velocity against, instead of every event carrying its
// own disconnected "now".
const SEASON_2026_27_NOW = "2026-10-25T12:00:00.000Z";
const SEASON_2027_28_NOW = "2027-08-10T12:00:00.000Z";

// Real map.prices shape from the live shop (product catalog + prices are
// effectively static across events) — reused verbatim for every mock event.
const MOCK_PRICES = {
  priceGroups: {
    seisomakatsomo: "8",
    D1: "7",
    C1: "6",
    D2: "7",
    C2: "5",
    A1: "7",
    C3: "5",
    A2: "6",
    C4: "5",
    A3: "5",
    C5: "5",
    A4: "5",
    C6: "5",
    A5: "6",
    C7: "6",
    A6: "10",
    C8: "6",
    invalid: "9",
  },
  productPrices: {
    "5": { "955": 1026 },
    "6": { "956": 852 },
    "7": { "956": 852, "957": 577 },
    "8": { "959": 405, "960": 179 },
    "9": { "961": 405, "1195": 179 },
    "10": { "956": 852, "958": 577 },
  },
  products: {
    "955": { id: "955", name: "Kategoria 1", vat: 13.5, bundle: false, type: "ticket", group: "Verkkomyyntipiste" },
    "956": { id: "956", name: "Kategoria 2", vat: 13.5, bundle: false, type: "ticket", group: "Verkkomyyntipiste" },
    "957": {
      id: "957",
      name: "Eläk., Opiskelija, Lapsi 7-15v",
      vat: 13.5,
      bundle: false,
      type: "ticket",
      group: "Verkkomyyntipiste",
    },
    "958": {
      id: "958",
      name: "Saimaan keltamustat RY jäsen",
      vat: 13.5,
      bundle: false,
      type: "ticket",
      group: "Verkkomyyntipiste",
    },
    "959": { id: "959", name: "Seisomakatsomo", vat: 13.5, bundle: false, type: "ticket", group: "Verkkomyyntipiste" },
    "960": {
      id: "960",
      name: "Junnukatsomo 7-18v",
      vat: 13.5,
      bundle: false,
      type: "ticket",
      group: "Verkkomyyntipiste",
    },
    "961": {
      id: "961",
      name: "Pyörätuoli",
      description: "Saattaja samalla lipulla",
      vat: 13.5,
      bundle: false,
      type: "ticket",
      group: "Verkkomyyntipiste",
    },
    "1195": {
      id: "1195",
      name: "Pyörätuoli Lapset",
      vat: 13.5,
      bundle: false,
      type: "ticket",
      group: "Verkkomyyntipiste",
    },
  },
};

// mulberry32: tiny seeded PRNG, deterministic per seed.
function makeRng(seedStr) {
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (Math.imul(31, seed) + seedStr.charCodeAt(i)) | 0;
  return function rng() {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function toDashId(id) {
  return id.replace(/:/g, "-");
}

// Rough Helsinki UTC offset by month — fine for synthetic display timestamps.
function helsinkiOffsetHours(month) {
  return month >= 4 && month <= 10 ? 3 : 2;
}

function helsinkiLocalToUtcIso(dateStr, hour, minute) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const offset = helsinkiOffsetHours(m);
  const utc = new Date(Date.UTC(y, m - 1, d, hour - offset, minute, 0));
  return utc.toISOString();
}

// Season-ticket holders occupy specific seats for every game that season, so
// a match event's sold count is baselineSold + some fraction of the
// remaining ("irtolippu") capacity — never an independent fraction of the
// section's raw total, or most mock games would show zero irtolippu demand
// once the dashboard subtracts the baseline back out.
function soldWithBaseline(rng, popularity, total, baselineSold, spread, fixedFraction) {
  const nonBaselineCapacity = Math.max(0, total - baselineSold);
  const fraction = fixedFraction ?? clamp(popularity + (rng() - 0.5) * spread, 0.02, 0.99);
  return baselineSold + Math.round(nonBaselineCapacity * fraction);
}

function buildSections(
  rng,
  popularity,
  disabledSections,
  baselineBySection,
  sectionFractionOverrides = {},
  soldAitioIds = [],
  aggregateSoldOverrides = {}
) {
  const baseline = baselineBySection ?? new Map();
  const sections = [];

  for (const [section, total] of Object.entries(SEATED_CAPACITIES)) {
    const disabled = disabledSections.includes(section);
    const sold = soldWithBaseline(
      rng,
      popularity,
      total,
      baseline.get(section) ?? 0,
      0.35,
      sectionFractionOverrides[section]
    );
    sections.push({
      section,
      sold,
      available: disabled ? 0 : total - sold,
      hold: disabled ? total - sold : 0,
      total,
      disabled,
    });
  }

  const standingDisabled = disabledSections.includes("seisomakatsomo");
  const standingSold =
    aggregateSoldOverrides.seisomakatsomo ??
    soldWithBaseline(rng, popularity, STANDING_CAPACITY, baseline.get("seisomakatsomo") ?? 0, 0.3);
  sections.push({
    section: "seisomakatsomo",
    sold: standingSold,
    available: standingDisabled ? 0 : STANDING_CAPACITY - standingSold,
    hold: standingDisabled ? STANDING_CAPACITY - standingSold : 0,
    total: STANDING_CAPACITY,
    disabled: standingDisabled,
  });

  const wheelchairDisabled = disabledSections.includes("invalid");
  const wheelchairSold =
    aggregateSoldOverrides.invalid ??
    soldWithBaseline(rng, popularity, WHEELCHAIR_CAPACITY, baseline.get("invalid") ?? 0, 0.3);
  sections.push({
    section: "invalid",
    sold: wheelchairSold,
    available: wheelchairDisabled ? 0 : WHEELCHAIR_CAPACITY - wheelchairSold,
    hold: wheelchairDisabled ? WHEELCHAIR_CAPACITY - wheelchairSold : 0,
    total: WHEELCHAIR_CAPACITY,
    disabled: wheelchairDisabled,
  });

  sections.push({ section: "press", sold: 0, available: 0, hold: PRESS_CAPACITY, total: PRESS_CAPACITY });

  const aitioSold = soldAitioIds.reduce((sum, id) => sum + (AITIO_CAPACITIES[id] ?? 0), 0);
  sections.push({
    section: "aitiot",
    sold: aitioSold,
    available: 0,
    hold: Math.max(0, AITIOT_CAPACITY - aitioSold),
    total: AITIOT_CAPACITY,
  });

  return sections;
}

function computeTotals(sections) {
  return sections.reduce(
    (acc, s) => ({
      sold: acc.sold + s.sold,
      available: acc.available + s.available,
      hold: acc.hold + s.hold,
      total: acc.total + s.total,
    }),
    { sold: 0, available: 0, hold: 0, total: 0 }
  );
}

// Groups a flat sold-seat-id list (e.g. from a pinned real-data snapshot)
// back into the per-section shape assignSeatIds/addEvent expect, using the
// same section-prefix convention the frontend already relies on
// (sectionOfSeatId, js/seatMapClassify.js). Sorted per section for stable
// diffs, same as pickSeats's own output.
export function groupSeatIdsBySection(seatIds) {
  const bySection = {};
  for (const id of seatIds) {
    const section = sectionOfSeatId(id);
    (bySection[section] ??= []).push(id);
  }
  for (const ids of Object.values(bySection)) ids.sort();
  return bySection;
}

function pinnedSectionRow(section, total, pinnedBySection) {
  const { sold = 0, disabled = false } = pinnedBySection.get(section) ?? {};
  return {
    section,
    sold,
    available: disabled ? 0 : total - sold,
    hold: disabled ? total - sold : 0,
    total,
    disabled,
  };
}

// Builds a kausikortti event's own `sections` directly from a pinned real
// snapshot's per-section sold counts, instead of buildSections's rng-driven
// soldWithBaseline draw. Mirrors buildSections's/sections.js's disabled
// handling exactly (available: 0, hold: total - sold when disabled) — the
// real kausikortti event demonstrably can have closed sections (e.g.
// C2/C7/C8/D2 today), so disabled is read from the pinned data, not
// hardcoded false. press/aitiot aren't in the snapshot (see
// refreshMockBaseline.js) so they default to their fixed capacities, never
// disabled.
export function buildPinnedKausikorttiSections(pinnedBySection) {
  const sections = [];
  for (const [section, total] of Object.entries(SEATED_CAPACITIES)) {
    sections.push(pinnedSectionRow(section, total, pinnedBySection));
  }
  sections.push(pinnedSectionRow("seisomakatsomo", STANDING_CAPACITY, pinnedBySection));
  sections.push(pinnedSectionRow("invalid", WHEELCHAIR_CAPACITY, pinnedBySection));

  sections.push({ section: "press", sold: 0, available: 0, hold: PRESS_CAPACITY, total: PRESS_CAPACITY });
  sections.push({ section: "aitiot", sold: 0, available: 0, hold: AITIOT_CAPACITY, total: AITIOT_CAPACITY });

  return sections;
}

// Validates a loaded baseline snapshot before it's used to generate any mock
// data. Both checks matter because the snapshot pins real, independently-
// drifting external state: the svgHash check catches the arena SVG changing
// underneath a stale pinned seat-id list (phantom/missing seats on the
// rendered map); the capacity check catches mock's own hardcoded capacity
// constants drifting apart from what the live shop actually reports.
export function assertBaselineSnapshotValid(snapshot, realCapacitiesHash) {
  if (snapshot.svgHash !== realCapacitiesHash) {
    throw new Error(
      `generateMockData: baseline snapshot's svgHash (${snapshot.svgHash}) doesn't match the current capacities ` +
        `SVG (${realCapacitiesHash}) — run \`npm run refresh-mock-baseline\` to update it.`
    );
  }

  const capacities = { ...SEATED_CAPACITIES, seisomakatsomo: STANDING_CAPACITY, invalid: WHEELCHAIR_CAPACITY };
  for (const { section, sold } of snapshot.sections) {
    const capacity = capacities[section];
    if (capacity !== undefined && sold > capacity) {
      throw new Error(
        `generateMockData: baseline snapshot's ${section} sold (${sold}) exceeds mock's hardcoded capacity ` +
          `(${capacity}) — mock capacities have drifted from the live arena.`
      );
    }
  }
}

// Shared progress/timestamp grid for both buildHistory (aggregate) and
// buildSectionHistory (per-section) — same points in time, so the two series
// describe the same synthetic timeline, just at different granularity.
// Splices in denser points close to "now" (the tracked window's end) so
// 24h/7d deltas have real data to compute on — only for events with enough
// tracked history for these offsets to fall inside their range — and
// guarantees an exact final point at progress 1.
function generateProgressPoints(firstSeenIso, lastPointIso, pointCount) {
  const startTime = new Date(firstSeenIso).getTime();
  const endTime = new Date(lastPointIso).getTime();
  const spanDays = (endTime - startTime) / 86400000;

  const progresses = [];
  for (let i = 0; i < pointCount; i++) progresses.push(i / (pointCount - 1));

  const recentProgressSet = new Set();
  if (spanDays >= 7) {
    for (const offsetDays of [7, 3, 1, 0.25]) {
      const progress = 1 - offsetDays / spanDays;
      if (progress > 0 && progress < 1) {
        progresses.push(progress);
        recentProgressSet.add(progress);
      }
    }
  }

  const uniqueSortedProgresses = [...new Set(progresses)].sort((a, b) => a - b);
  uniqueSortedProgresses[uniqueSortedProgresses.length - 1] = 1; // guarantee an exact final point

  return uniqueSortedProgresses.map((progress, i) => ({
    progress,
    t: new Date(startTime + (endTime - startTime) * progress).toISOString(),
    isLast: i === uniqueSortedProgresses.length - 1,
    isRecent: recentProgressSet.has(progress),
  }));
}

function buildHistory(
  rng,
  {
    finalSold,
    finalStanding,
    finalHold,
    grandTotal,
    firstSeenIso,
    lastPointIso,
    pointCount,
    pinRecentToFinal = false,
    closed = [],
  }
) {
  const progressPoints = generateProgressPoints(firstSeenIso, lastPointIso, pointCount);

  const points = [];
  let prevSold = 0;
  for (const { t, progress, isLast, isRecent } of progressPoints) {
    let sold;
    if (pinRecentToFinal && (isRecent || isLast)) {
      // Sales have plateaued over the recent window — a deliberately "flat"
      // mock game, so top-movers/sellout-estimate have a real zero-velocity
      // case to exclude, not just synthetic unit-test fixtures.
      sold = finalSold;
    } else {
      sold = clamp(Math.round(finalSold * progress * (0.85 + rng() * 0.3)), prevSold, finalSold);
    }
    if (isLast) sold = finalSold;
    prevSold = Math.max(prevSold, sold);

    const standingShare = finalSold > 0 ? finalStanding / finalSold : 0;
    const soldStanding = Math.round(sold * standingShare);
    // hold is a constant across the whole synthetic timeline — mock data
    // never simulates a section opening/closing mid-event, only sold
    // changing — so available is derived the same way production derives it
    // for an open section: total - hold - sold. closed is likewise constant
    // across the timeline (the event's own disabled-section list, matching
    // its latest.json exactly) — not empty, just never changing; no release
    // scenario is invented here (that belongs to a later PR).
    points.push({
      t,
      sold,
      soldSeated: sold - soldStanding,
      soldStanding,
      available: grandTotal - finalHold - sold,
      hold: finalHold,
      closed,
    });
  }

  // Same "only append when sold changed" rule as production's real history.json.
  return points.filter((p, i) => i === 0 || p.sold !== points[i - 1].sold);
}

// Per-section counterpart to buildHistory — same progress/timestamp grid,
// but each section's sold ramps independently with the same shape buildHistory
// already uses (just per-section), and the result is built by calling the
// real appendSectionHistoryPointIfChanged once per progress point, so this
// mock fixture is produced by the exact accumulation logic production uses,
// not a reimplementation of it. Every mock event's own disabled set and
// capacitiesHash are constant across its timeline (no transitions in this
// PR — that fixture gap is a later PR's job), so this always yields exactly
// one generation.
function buildSectionHistory(rng, { sections, capacitiesHash, firstSeenIso, lastPointIso, pointCount, pinRecentToFinal = false }) {
  const progressPoints = generateProgressPoints(firstSeenIso, lastPointIso, pointCount);
  const sectionNames = sections.map((s) => s.section);
  const closed = sections.filter((s) => s.disabled).map((s) => s.section).sort();
  const prevSold = new Array(sections.length).fill(0);

  let generations = [];
  for (const { t, progress, isLast, isRecent } of progressPoints) {
    const sold = sections.map((s, idx) => {
      let value;
      if (pinRecentToFinal && (isRecent || isLast)) {
        value = s.sold;
      } else {
        value = clamp(Math.round(s.sold * progress * (0.85 + rng() * 0.3)), prevSold[idx], s.sold);
      }
      if (isLast) value = s.sold;
      prevSold[idx] = Math.max(prevSold[idx], value);
      return value;
    });

    generations = appendSectionHistoryPointIfChanged(generations, {
      capacitiesHash,
      sections: sectionNames,
      tISO: t,
      sold,
      closed,
    });
  }

  return generations;
}

// Deterministic seeded pick of `count` items from `pool`, sorted in the
// output for stable diffs. Uses the event's own rng, so re-running the
// generator with unchanged inputs reproduces the same seat assignments.
export function pickSeats(rng, pool, count) {
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count).sort();
}

// A match event's seat set must be a SUPERSET of its season's kausikortti
// seat set, per section — season-ticket holders sit in the same seats every
// game. `baselineSeatsBySection` is null/undefined for kausikortti events
// themselves (they define the baseline rather than build on one).
export function assignSeatIds(rng, seatPoolBySection, sections, baselineSeatsBySection) {
  const bySection = {};

  for (const row of sections) {
    const pool = seatPoolBySection[row.section];
    if (!pool) continue; // aggregate row (seisomakatsomo/invalid/press/aitiot) — no individual seat IDs

    const baselineIds = baselineSeatsBySection?.[row.section] ?? [];
    const baselineSet = new Set(baselineIds);
    const additionalPool = pool.filter((id) => !baselineSet.has(id));
    const additionalCount = Math.max(0, row.sold - baselineIds.length);

    bySection[row.section] = [...baselineIds, ...pickSeats(rng, additionalPool, additionalCount)];
  }

  return bySection;
}

async function main() {
  const schedule = JSON.parse(await readFile(path.join(repoRoot, "data", "schedule.json"), "utf8"));

  // Pinned real 2026-27 season-ticket baseline (see refreshMockBaseline.js —
  // never read live at generation time, since season tickets keep selling
  // and that would make the mock tree shift on every regeneration).
  const baselineSnapshot = JSON.parse(
    await readFile(path.join(repoRoot, "scripts", "mockKausikorttiBaseline.json"), "utf8")
  );

  // Real season-ticket event's seatmap — its actual seat IDs (e.g.
  // "A1-1-001") are reused for every mock event's seats.json, so mock seat
  // IDs look like the real arena rather than synthetic placeholders.
  // Resolved via the pinned snapshot's own sourceEventId rather than a
  // hardcoded id — the snapshot is the one place that id is allowed to live.
  const realLatest = JSON.parse(
    await readFile(path.join(repoRoot, "data", "events", baselineSnapshot.sourceEventId, "latest.json"), "utf8")
  );
  const realSvg = await readFile(
    path.join(repoRoot, "data", "capacities", `${realLatest.capacitiesHash}.svg`),
    "utf8"
  );
  const realCapacitiesJson = await readFile(
    path.join(repoRoot, "data", "capacities", `${realLatest.capacitiesHash}.json`),
    "utf8"
  );
  assertBaselineSnapshotValid(baselineSnapshot, realLatest.capacitiesHash);
  const seatPoolBySection = parseSeatmapSeatIds(realSvg);
  const pinned2026_27Baseline = {
    sectionsMap: new Map(baselineSnapshot.sections.map((s) => [s.section, { sold: s.sold, disabled: s.disabled }])),
    soldSeatIds: baselineSnapshot.soldSeatIds,
  };

  const events = [];
  const latestById = new Map();
  const historyById = new Map();
  const sectionHistoryById = new Map();
  const seatsById = new Map();
  // Only set for events that get a hand-authored recency fixture (see
  // below) — everything else has no recentSeatActivity.json at all,
  // exercising the frontend's own fallback-on-404 path (getSectionHistory
  // convention) for every other card, not just the one with a fixture.
  const recentSeatActivityById = new Map();
  const overrides = {};
  const autoclass = {};
  const baselineBySeason = new Map();
  const baselineSeatsBySeason = new Map();

  function addEvent({
    id,
    name,
    gameType,
    season,
    dateStr,
    hour = 18,
    minute = 30,
    durationHours = 2.5,
    stopIsoOverride, // e.g. kausikortti's "stop" is end-of-season, not start+durationHours
    status,
    firstSeenDaysBefore = 45,
    nowIso, // shared per-season "as of" instant (SEASON_2026_27_NOW etc.) — used as lastPointIso for any non-past event; firstSeenIso is clamped below so it's never after this
    popularity,
    disabledSections = [],
    historyPoints = 10,
    sectionFractionOverrides,
    aggregateSoldOverrides,
    pinRecentToFinal,
    soldAitioIds = [],
    pinnedBaseline, // { sectionsMap, soldSeatIds } — real data, bypasses rng entirely (kausikortti events only)
  }) {
    const startIso = helsinkiLocalToUtcIso(dateStr, hour, minute);
    const stopIso = stopIsoOverride ?? new Date(new Date(startIso).getTime() + durationHours * 3600 * 1000).toISOString();
    const lastPointIso =
      status === "past" ? new Date(new Date(stopIso).getTime() + 3600 * 1000).toISOString() : nowIso ?? startIso;

    // firstSeen must never be after the last tracked point, or the
    // synthetic timeline runs backwards (sold decreasing as "time"
    // advances). A game more than firstSeenDaysBefore days after its
    // season's nowIso would otherwise get a firstSeen in the future
    // relative to lastPointIso — clamp to a short but valid tracked window
    // ending at lastPointIso instead: every upcoming event keeps a
    // plausible short history rather than an inverted one, and no event
    // drops out of the dataset.
    const naturalFirstSeenIso = new Date(
      new Date(startIso).getTime() - firstSeenDaysBefore * 86400 * 1000
    ).toISOString();
    const MIN_TRACKED_WINDOW_DAYS = 3;
    const firstSeenIso =
      new Date(naturalFirstSeenIso).getTime() <= new Date(lastPointIso).getTime()
        ? naturalFirstSeenIso
        : new Date(new Date(lastPointIso).getTime() - MIN_TRACKED_WINDOW_DAYS * 86400 * 1000).toISOString();

    const rng = makeRng(id);
    const baselineBySection = gameType === "kausikortti" ? null : baselineBySeason.get(season);
    const sections = pinnedBaseline
      ? buildPinnedKausikorttiSections(pinnedBaseline.sectionsMap)
      : buildSections(
          rng,
          popularity,
          disabledSections,
          baselineBySection,
          sectionFractionOverrides,
          soldAitioIds,
          aggregateSoldOverrides
        );
    const totals = computeTotals(sections);

    const baselineSeatsBySection = gameType === "kausikortti" ? null : baselineSeatsBySeason.get(season);
    const seatsBySection = pinnedBaseline
      ? groupSeatIdsBySection(pinnedBaseline.soldSeatIds)
      : assignSeatIds(rng, seatPoolBySection, sections, baselineSeatsBySection);
    const soldSeatIds = Object.values(seatsBySection).flat().sort();

    events.push({
      id,
      name,
      start: startIso,
      status,
      firstSeen: firstSeenIso,
      lastSeen: lastPointIso,
    });

    latestById.set(id, {
      eventId: id,
      name,
      start: startIso,
      stop: stopIso,
      fetchedAt: lastPointIso,
      capacitiesHash: "mock-fixture",
      sections,
      totals,
      prices: MOCK_PRICES,
    });

    seatsById.set(id, {
      fetchedAt: lastPointIso,
      svgHash: "mock-fixture",
      soldSeatIds,
      soldAitiot: [...soldAitioIds].sort(compareAitioIds),
    });

    const standingRow = sections.find((s) => s.section === "seisomakatsomo");
    // Same derivation production uses (scripts/fetch.js): sorted section
    // names of every disabled row. Constant across the timeline — mock data
    // doesn't simulate a section opening/closing mid-event — so every
    // history point below carries this same list, matching latest.json.
    const closed = sections.filter((s) => s.disabled).map((s) => s.section).sort();
    historyById.set(
      id,
      buildHistory(rng, {
        finalSold: totals.sold,
        finalStanding: standingRow.sold,
        finalHold: totals.hold,
        grandTotal: totals.total,
        firstSeenIso,
        lastPointIso,
        pointCount: historyPoints,
        pinRecentToFinal,
        closed,
      })
    );

    // Called after buildHistory so it doesn't disturb buildSections'/
    // assignSeatIds'/buildHistory's existing relative rng-draw order for
    // this event — this is purely additional rng consumption at the end.
    sectionHistoryById.set(
      id,
      buildSectionHistory(rng, {
        sections,
        capacitiesHash: "mock-fixture",
        firstSeenIso,
        lastPointIso,
        pointCount: historyPoints,
        pinRecentToFinal,
      })
    );

    if (gameType === "kausikortti") {
      const sectionBaseline = new Map(sections.map((s) => [s.section, s.sold]));
      baselineBySeason.set(season, sectionBaseline);
      baselineSeatsBySeason.set(season, seatsBySection);
    }

    return { gameType, season };
  }

  // --- Kausikortit: one per season, each its own strip. Tests the multi-strip
  // "newest season first" ordering, an archived (past) strip's frozen data,
  // and the season selector picking up a 3rd season. Also: the season each
  // kausikortti is generated "as of" (nowIso) becomes that season's shared
  // baseline AND the shared "now" reference for its match events below.
  //
  // 2025-26 and 2027-28 stay fully synthetic (rng-derived, via popularity)
  // below — no real season-ticket data exists for either season (2025-26's
  // sale window has closed with nothing archived; 2027-28's hasn't opened
  // for real yet). Only 2026-27 uses the pinned real baseline (see
  // pinned2026_27Baseline above and refreshMockBaseline.js) — made explicit
  // here rather than left implicit.
  addEvent({
    id: "90:900",
    name: "SaiPa kausikortit 2025-2026",
    gameType: "kausikortti",
    season: "2025-26",
    dateStr: "2025-08-01",
    hour: 0,
    minute: 0,
    stopIsoOverride: "2026-03-15T22:00:00.000Z",
    status: "past",
    firstSeenDaysBefore: 0,
    popularity: 0.92,
    historyPoints: 10,
  });
  overrides["90-900"] = { gameType: "kausikortti", season: "2025-26" };

  const kausikorttiId = "90:000";
  addEvent({
    id: kausikorttiId,
    name: "SaiPa kausikortit 2026-2027",
    gameType: "kausikortti",
    season: "2026-27",
    dateStr: "2026-07-31",
    hour: 0,
    minute: 0,
    stopIsoOverride: "2027-03-15T22:00:00.000Z",
    status: "upcoming",
    firstSeenDaysBefore: 0,
    nowIso: SEASON_2026_27_NOW, // sales opened 07-31; "now" is ~3 months into the season
    historyPoints: 14,
    pinnedBaseline: pinned2026_27Baseline, // real data — popularity is unused, sections come from the snapshot
  });
  overrides[toDashId(kausikorttiId)] = { gameType: "kausikortti", season: "2026-27" };

  addEvent({
    id: "90:901",
    name: "SaiPa kausikortit 2027-2028",
    gameType: "kausikortti",
    season: "2027-28",
    dateStr: "2027-07-31",
    hour: 0,
    minute: 0,
    stopIsoOverride: "2028-03-15T22:00:00.000Z",
    status: "upcoming",
    firstSeenDaysBefore: 0,
    nowIso: SEASON_2027_28_NOW, // sales just opened
    popularity: 0.08,
    historyPoints: 3,
  });
  overrides["90-901"] = { gameType: "kausikortti", season: "2027-28" };

  // --- All 36 real schedule.json fixtures become mock games (id range 90:001-90:036) ---
  const PAST_OPPONENTS_BY_ORDER = 4; // first 4 fixtures (chronologically earliest) are archived
  const START_TIMES = [
    [17, 0],
    [18, 30],
    [19, 30],
  ];
  // Two hand-picked games (both close enough to SEASON_2026_27_NOW to carry
  // dense recent history) exercise scenarios the generic popularity formula
  // wouldn't reliably reach on its own.
  const NEAR_SELLOUT_INDEX = 8; // 2026-10-08 vs JYP
  const FLAT_VELOCITY_INDEX = 14; // 2026-11-13 vs Ilves
  // Two more hand-picked games demo aitiot sold through another channel —
  // a real (if speculative) scraper capability, not yet observed live.
  const AITIO_OCCUPANCY = {
    5: ["aitio_2"],
    20: ["aitio_5", "aitio_7"],
  };
  // First *upcoming* runkosarja fixture — resolved dynamically (not a
  // hardcoded index like the two above) because schedule.json is
  // human-owned and can be reordered/regenerated. Skips the archived range
  // (i >= PAST_OPPONENTS_BY_ORDER): an archived fixture is hidden by
  // default (pelatut off hides past events), which would make this
  // permanently-verifiable-on-plain-?mock=1 scenario invisible. Throws
  // loudly rather than silently landing on nothing, or silently colliding
  // with one of the two hardcoded scenario indices above (a schedule
  // reorder could make the dynamic lookup land on either one).
  const firstUpcomingRunkosarjaIndex = schedule.findIndex(
    (f, i) => i >= PAST_OPPONENTS_BY_ORDER && f.gameType === "runkosarja"
  );
  if (firstUpcomingRunkosarjaIndex === -1) {
    throw new Error("generateMockData: no upcoming runkosarja fixture found for the 1-ticket-left scenario");
  }
  if (firstUpcomingRunkosarjaIndex === NEAR_SELLOUT_INDEX || firstUpcomingRunkosarjaIndex === FLAT_VELOCITY_INDEX) {
    throw new Error(
      `generateMockData: firstUpcomingRunkosarjaIndex (${firstUpcomingRunkosarjaIndex}) collides with a ` +
        "hardcoded scenario index — schedule.json has likely been reordered"
    );
  }

  schedule.forEach((fixture, index) => {
    const num = String(index + 1).padStart(3, "0");
    const id = `90:${num}`;
    const isPast = index < PAST_OPPONENTS_BY_ORDER;
    const [hour, minute] = START_TIMES[index % START_TIMES.length];
    const disabledSections = !isPast && index % 6 === 0 ? ["C7", "C2"] : [];

    let popularity = isPast ? 0.85 + (index % 3) * 0.05 : 0.15 + ((index * 37) % 60) / 100;
    let sectionFractionOverrides;
    let pinRecentToFinal;
    let aggregateSoldOverrides;

    if (index === NEAR_SELLOUT_INDEX) {
      popularity = 0.9; // overall irtolippu fill % well above the Kiirehdi threshold
      sectionFractionOverrides = { C4: 0.97 }; // premium section individually near sold out
    } else if (index === FLAT_VELOCITY_INDEX) {
      pinRecentToFinal = true; // sales have plateaued — a real zero-velocity case
    } else if (index === firstUpcomingRunkosarjaIndex) {
      aggregateSoldOverrides = { seisomakatsomo: STANDING_CAPACITY - 1 }; // exactly 1 standing ticket left
    }

    addEvent({
      id,
      name: `SaiPa - ${fixture.opponent}`,
      gameType: fixture.gameType,
      season: fixture.season,
      dateStr: fixture.date,
      hour,
      minute,
      status: isPast ? "past" : "upcoming",
      nowIso: isPast ? undefined : SEASON_2026_27_NOW,
      popularity,
      disabledSections,
      historyPoints: isPast ? 12 : 8,
      sectionFractionOverrides,
      aggregateSoldOverrides,
      pinRecentToFinal,
      soldAitioIds: AITIO_OCCUPANCY[index] ?? [],
    });

    autoclass[toDashId(id)] = { gameType: fixture.gameType, season: fixture.season };
  });

  // --- A couple of manual-override test cases layered on top of the auto-classified games ---
  const hifkDerby = events.find((e) => e.name === "SaiPa - HIFK" && e.start.startsWith("2026-10-17"));
  overrides[toDashId(hifkDerby.id)] = { displayName: "SaiPa - HIFK (derby)" };

  const jokeritGame = events.find((e) => e.name === "SaiPa - Jokerit" && e.start.startsWith("2026-11-28"));
  overrides[toDashId(jokeritGame.id)] = { note: "Ottelu saattaa siirtyä TV-aikataulun vuoksi." };

  const kalpaGame = events.find((e) => e.name === "SaiPa - KalPa" && e.start.startsWith("2027-01-05"));
  overrides[toDashId(kalpaGame.id)] = { hidden: true };

  // --- Recency fixture: freed/newly-sold seat marks for manual
  // verification of js/seatMap.js's recency UI (legend toggle, tooltip
  // lines, section-count rows). Decoupled from this generator's own
  // sold-history synthesis, which stays monotonic (see buildHistory's own
  // comment) — mid-timeline sold DECREASES remain deliberately
  // unsupported here until the release-detection follow-up lands; this
  // fixture is a static hand-authored snapshot layered onto one event's
  // already-computed seats.json, not that support having arrived.
  // Section C4 — visible without zooming, easy to locate by eye — and
  // both kinds/both zoom-visibilities are covered: one freed seat (always
  // visible, no zoom gate), and two newly-sold seats (zoom-gated; a fresh
  // one and one near the 24h cutoff) so the always-visible and
  // zoom-gated paths both have a real fixture to check against.
  const kEspooGame = events.find((e) => e.name === "SaiPa - K-Espoo" && e.start.startsWith("2026-09-15"));
  const kEspooSoldSeatIds = new Set(seatsById.get(kEspooGame.id).soldSeatIds);
  // Excludes kausikortti-baseline seats from the "sold" pick — a season-
  // ticket seat renders solid BLACK (kausikortti/myyty share that fill),
  // against which the newly-sold ring (#5a3d00) is deliberately near-
  // invisible (documented, accepted edge case — see style.css). Picking
  // one for the fixture by accident would demo the rare unreadable case
  // instead of the realistic one (irtolippu, bright yellow, 6.98:1
  // against the ring). A freed seat has no such concern — it's always
  // vapaa underneath regardless of baseline membership.
  const kEspooSeason = autoclass[toDashId(kEspooGame.id)].season;
  const c4BaselineIds = new Set(baselineSeatsBySeason.get(kEspooSeason)?.C4 ?? []);
  const c4Pool = seatPoolBySection.C4 ?? [];
  const c4SoldIds = c4Pool.filter((id) => kEspooSoldSeatIds.has(id) && !c4BaselineIds.has(id));
  const c4FreeIds = c4Pool.filter((id) => !kEspooSoldSeatIds.has(id));
  if (c4SoldIds.length < 2 || c4FreeIds.length < 1) {
    throw new Error(
      "generateMockData: not enough C4 seats to build the recency fixture (need >=2 non-baseline sold, >=1 free) — " +
        "check popularity/sectionFractionOverrides for the K-Espoo (2026-09-15) event"
    );
  }

  const RECENCY_FIXTURE_NOW_MS = Date.parse(SEASON_2026_27_NOW);
  const minutesBeforeFixtureNow = (m) => new Date(RECENCY_FIXTURE_NOW_MS - m * 60_000).toISOString();

  recentSeatActivityById.set(kEspooGame.id, {
    svgHash: "mock-fixture",
    freed: {
      [c4FreeIds[0]]: { sinceISO: minutesBeforeFixtureNow(107), detectedAtISO: minutesBeforeFixtureNow(60) },
    },
    sold: {
      // Fresh.
      [c4SoldIds[0]]: { sinceISO: minutesBeforeFixtureNow(20), detectedAtISO: minutesBeforeFixtureNow(10) },
      // Near the 24h cutoff.
      [c4SoldIds[1]]: {
        sinceISO: minutesBeforeFixtureNow(24 * 60 + 5),
        detectedAtISO: minutesBeforeFixtureNow(24 * 60 - 10),
      },
    },
  });

  // --- Synthetic playoffs games (not in schedule.json — playoffs aren't pre-scheduled) ---
  addEvent({
    id: "90:037",
    name: "SaiPa - Tappara",
    gameType: "playoffs",
    season: "2026-27",
    dateStr: "2027-04-05",
    status: "upcoming",
    firstSeenDaysBefore: 10,
    popularity: 0.4,
    historyPoints: 5,
  });
  autoclass["90-037"] = { gameType: "playoffs", season: "2026-27" };

  addEvent({
    id: "90:038",
    name: "SaiPa - Ilves",
    gameType: "playoffs",
    season: "2026-27",
    dateStr: "2027-04-08",
    status: "upcoming",
    firstSeenDaysBefore: 7,
    popularity: 0.25,
    historyPoints: 4,
  });
  autoclass["90-038"] = { gameType: "playoffs", season: "2026-27" };

  // --- Synthetic next-season games (season 2027-28), so the season selector + "kaikki" + badges have real data to show ---
  addEvent({
    id: "90:039",
    name: "SaiPa - HIFK",
    gameType: "runkosarja",
    season: "2027-28",
    dateStr: "2027-09-05",
    status: "upcoming",
    firstSeenDaysBefore: 30,
    nowIso: SEASON_2027_28_NOW,
    popularity: 0.08,
    historyPoints: 3,
  });
  autoclass["90-039"] = { gameType: "runkosarja", season: "2027-28" };

  addEvent({
    id: "90:040",
    name: "SaiPa - Frölunda",
    gameType: "chl",
    season: "2027-28",
    dateStr: "2027-09-16",
    status: "upcoming",
    firstSeenDaysBefore: 25,
    nowIso: SEASON_2027_28_NOW,
    popularity: 0.05,
    historyPoints: 2,
  });
  autoclass["90-040"] = { gameType: "chl", season: "2027-28" };

  addEvent({
    id: "90:041",
    name: "SaiPa - Jukurit",
    gameType: "harjoitusottelu",
    season: "2027-28",
    dateStr: "2027-08-20",
    status: "upcoming",
    firstSeenDaysBefore: 15,
    nowIso: SEASON_2027_28_NOW,
    popularity: 0.03,
    historyPoints: 2,
  });
  autoclass["90-041"] = { gameType: "harjoitusottelu", season: "2027-28" };

  // --- One deliberately unclassified event: no override, no autoclass entry.
  // Exercises the "muu" default -> "(luokittelematon)" label under Runkosarja.
  addEvent({
    id: "90:042",
    name: "SaiPa - Yllätysvastustaja",
    gameType: "muu",
    season: null,
    dateStr: "2026-12-15",
    status: "upcoming",
    firstSeenDaysBefore: 5,
    popularity: 0.2,
    historyPoints: 3,
  });
  // Intentionally: no overrides["90-042"], no autoclass["90-042"].

  // --- One event with a closed standing area (seisomakatsomo) carrying a
  // nonzero sold count — permanent ?mock=1 coverage for the aggregate-row
  // half of the closed-section-with-sold-seats fix, so it doesn't rely on
  // a hand-edit-and-revert to verify. popularity is high enough that
  // soldWithBaseline's minimum 2% floor alone would still produce a
  // meaningfully nonzero standingSold even in an unlucky rng draw.
  addEvent({
    id: "90:043",
    name: "SaiPa - Färjestad",
    gameType: "harjoitusottelu",
    season: "2027-28",
    dateStr: "2027-10-01",
    status: "upcoming",
    firstSeenDaysBefore: 20,
    nowIso: SEASON_2027_28_NOW,
    popularity: 0.6,
    historyPoints: 4,
    disabledSections: ["seisomakatsomo"],
  });
  autoclass["90-043"] = { gameType: "harjoitusottelu", season: "2027-28" };

  // --- Verify the sold+available+hold=total invariant on every generated
  // history point, rather than assuming buildHistory's "hold is constant"
  // reasoning holds for every event shape it's fed (e.g. a disabled
  // section's hold = that section's own total-sold, which only stays
  // constant across the timeline if it never sells any seats in mock data —
  // true today, but worth checking rather than assuming forever). Also
  // verify every point's closed list matches the event's own latest.json —
  // this is what would have caught closed staying [] while latest.json
  // already listed disabled sections. ---
  const invariantViolations = [];
  for (const event of events) {
    const latest = latestById.get(event.id);
    const total = latest.totals.total;
    const expectedClosed = latest.sections
      .filter((s) => s.disabled)
      .map((s) => s.section)
      .sort();
    for (const point of historyById.get(event.id)) {
      if (point.sold + point.available + point.hold !== total) {
        invariantViolations.push(
          `${event.id} @ ${point.t}: sold(${point.sold}) + available(${point.available}) + hold(${point.hold}) ` +
            `= ${point.sold + point.available + point.hold}, expected total ${total}`
        );
      }
      const actualClosed = [...point.closed].sort();
      if (JSON.stringify(actualClosed) !== JSON.stringify(expectedClosed)) {
        invariantViolations.push(
          `${event.id} @ ${point.t}: closed=[${point.closed.join(", ")}], expected [${expectedClosed.join(", ")}] ` +
            "(latest.json's disabled sections)"
        );
      }
    }
  }
  // --- Verify the within-season baseline invariant: every match event in a
  // season must be a strict superset of that season's kausikortti baseline
  // (season-ticket holders sit in the same seats every game), for both
  // individual seat ids and per-section sold counts (including the
  // seisomakatsomo/invalid aggregate rows). Already true today by
  // construction — this locks it in as a regression guard, which matters
  // more after 2026-27's baseline switched from rng-derived to a pinned
  // real snapshot: there are now two code paths producing a baseline, and
  // only one is exercised by the season anyone looks at first. ---
  for (const [season, baselineSeatsBySection] of baselineSeatsBySeason) {
    const baselineSectionSold = baselineBySeason.get(season);
    const baselineSeatIds = new Set(Object.values(baselineSeatsBySection).flat());

    for (const event of events) {
      const merged = mergeClassification(event, { overrides, autoclass });
      if (merged.season !== season || merged.gameType === "kausikortti") continue;

      const matchSeatIds = new Set(seatsById.get(event.id).soldSeatIds);
      const missingSeats = [...baselineSeatIds].filter((id) => !matchSeatIds.has(id));
      if (missingSeats.length > 0) {
        invariantViolations.push(
          `${event.id} (season ${season}): missing ${missingSeats.length} baseline seat id(s), ` +
            `e.g. ${missingSeats.slice(0, 3).join(", ")}`
        );
      }

      const matchSections = latestById.get(event.id).sections;
      for (const [section, baselineSold] of baselineSectionSold) {
        const row = matchSections.find((s) => s.section === section);
        if (!row || row.sold < baselineSold) {
          invariantViolations.push(
            `${event.id} (season ${season}): section ${section} sold(${row?.sold ?? "missing"}) ` +
              `< baseline sold(${baselineSold})`
          );
        }
      }
    }
  }

  // --- Verify sectionHistory.json's shape: every mock event's own disabled
  // set and capacitiesHash are constant across its timeline (no
  // open/closed transitions in this PR), so every mock event must produce
  // exactly one generation, whose sections match latest.json's row order,
  // with every point's sold array the same length as that section list. ---
  for (const event of events) {
    const generations = sectionHistoryById.get(event.id);
    const latestSections = latestById.get(event.id).sections.map((s) => s.section);

    if (generations.length !== 1) {
      invariantViolations.push(
        `${event.id}: expected exactly 1 sectionHistory generation (no mock event transitions in this PR), ` +
          `got ${generations.length}`
      );
      continue;
    }

    const [generation] = generations;
    if (JSON.stringify(generation.sections) !== JSON.stringify(latestSections)) {
      invariantViolations.push(`${event.id}: sectionHistory sections don't match latest.json's row order`);
    }
    for (const point of generation.points) {
      if (point.sold.length !== generation.sections.length) {
        invariantViolations.push(
          `${event.id} @ ${point.t}: sectionHistory sold array length (${point.sold.length}) != ` +
            `sections length (${generation.sections.length})`
        );
      }
    }
  }

  // --- Verify every event's timeline runs forward: history.json and
  // sectionHistory.json points must be strictly ascending in time, and
  // firstSeen must never be after the first point of either series. This
  // is exactly what would have caught the backwards-timeline bug where an
  // upcoming event's game date fell more than firstSeenDaysBefore days
  // after its season's nowIso, giving it a firstSeen in the future
  // relative to lastPointIso. ---
  for (const event of events) {
    const history = historyById.get(event.id);
    for (let i = 1; i < history.length; i++) {
      if (new Date(history[i].t).getTime() <= new Date(history[i - 1].t).getTime()) {
        invariantViolations.push(
          `${event.id}: history.json point ${i} (${history[i].t}) is not strictly after point ${i - 1} ` +
            `(${history[i - 1].t})`
        );
      }
    }
    if (history.length > 0 && new Date(event.firstSeen).getTime() > new Date(history[0].t).getTime()) {
      invariantViolations.push(
        `${event.id}: firstSeen (${event.firstSeen}) is after history.json's first point (${history[0].t})`
      );
    }

    const [firstGeneration] = sectionHistoryById.get(event.id);
    for (const generation of sectionHistoryById.get(event.id)) {
      for (let i = 1; i < generation.points.length; i++) {
        if (new Date(generation.points[i].t).getTime() <= new Date(generation.points[i - 1].t).getTime()) {
          invariantViolations.push(
            `${event.id}: sectionHistory.json point ${i} (${generation.points[i].t}) is not strictly after ` +
              `point ${i - 1} (${generation.points[i - 1].t})`
          );
        }
      }
    }
    if (
      firstGeneration &&
      firstGeneration.points.length > 0 &&
      new Date(event.firstSeen).getTime() > new Date(firstGeneration.points[0].t).getTime()
    ) {
      invariantViolations.push(
        `${event.id}: firstSeen (${event.firstSeen}) is after sectionHistory.json's first point ` +
          `(${firstGeneration.points[0].t})`
      );
    }
  }

  // --- Verify the recency fixture agrees with the event's own
  // soldSeatIds/disabled sections — this is what would catch the fixture
  // disagreeing with latest.json's own per-section sold figures, which
  // would otherwise silently show up as the section tooltip's new
  // "Vapautunut/Myyty viime päivityksissä" row contradicting the numbers
  // right above it in the same tooltip. Not trusted by hand. ---
  for (const [eventId, activity] of recentSeatActivityById) {
    const soldSet = new Set(seatsById.get(eventId).soldSeatIds);
    const disabledSections = new Set(
      latestById.get(eventId).sections.filter((s) => s.disabled).map((s) => s.section)
    );
    for (const [kind, ids, mustBeSold] of [
      ["freed", Object.keys(activity.freed), false],
      ["sold", Object.keys(activity.sold), true],
    ]) {
      for (const id of ids) {
        const section = id.slice(0, id.indexOf("-"));
        if (!(seatPoolBySection[section] ?? []).includes(id)) {
          invariantViolations.push(`${eventId}: recentSeatActivity ${kind} id ${id} doesn't exist in the mock SVG`);
        }
        if (disabledSections.has(section)) {
          invariantViolations.push(`${eventId}: recentSeatActivity ${kind} id ${id} is in a disabled section`);
        }
        if (soldSet.has(id) !== mustBeSold) {
          invariantViolations.push(
            `${eventId}: recentSeatActivity ${kind} id ${id} is ${soldSet.has(id) ? "" : "not "}in soldSeatIds, ` +
              `expected ${mustBeSold ? "" : "not "}sold`
          );
        }
      }
    }
  }

  if (invariantViolations.length > 0) {
    throw new Error(
      `generateMockData: ${invariantViolations.length} invariant violation(s):\n` + invariantViolations.join("\n")
    );
  }

  // --- Write everything out ---
  await mkdir(mockDir, { recursive: true });
  await writeFile(path.join(mockDir, "events.json"), JSON.stringify(events, null, 2) + "\n");
  await writeFile(path.join(mockDir, "overrides.json"), JSON.stringify(overrides, null, 2) + "\n");
  await writeFile(path.join(mockDir, "autoclass.json"), JSON.stringify(autoclass, null, 2) + "\n");

  // Every mock event shares capacitiesHash/svgHash "mock-fixture" — without
  // these files, ?mock=1's seat-map fetch 404s for every event. Copy the
  // real, already-loaded files verbatim rather than regenerating.
  const mockCapacitiesDir = path.join(mockDir, "capacities");
  await mkdir(mockCapacitiesDir, { recursive: true });
  await writeFile(path.join(mockCapacitiesDir, "mock-fixture.svg"), realSvg);
  await writeFile(path.join(mockCapacitiesDir, "mock-fixture.json"), realCapacitiesJson);

  for (const event of events) {
    const dir = path.join(mockDir, "events", toDashId(event.id));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "latest.json"), JSON.stringify(latestById.get(event.id), null, 2) + "\n");
    await writeFile(path.join(dir, "history.json"), JSON.stringify(historyById.get(event.id), null, 2) + "\n");
    await writeFile(path.join(dir, "seats.json"), JSON.stringify(seatsById.get(event.id), null, 2) + "\n");
    await writeSectionHistoryIfChanged(path.join(dir, "sectionHistory.json"), sectionHistoryById.get(event.id));
    if (recentSeatActivityById.has(event.id)) {
      await writeFile(
        path.join(dir, "recentSeatActivity.json"),
        JSON.stringify(recentSeatActivityById.get(event.id), null, 2) + "\n"
      );
    }
  }

  console.log(`Generated ${events.length} mock events under ${path.relative(repoRoot, mockDir)}/`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
