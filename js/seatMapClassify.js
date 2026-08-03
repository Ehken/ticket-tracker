// scripts/lib/schedule.js is imported the same way by
// js/dashboardUnclassified.js (guarded there by its own browser-safety
// test) — this repo has no build step, so a Node-side module reused on
// the frontend must stay free of node:/require/process for the browser
// to load it at all. seatRecency.js's own RECENCY_CAP_MS is imported
// here rather than duplicated so the scraper's cap and the frontend's
// display-time cap can never silently drift to two different numbers.
import { RECENCY_CAP_MS } from "../scripts/lib/seatRecency.js";

export const SEAT_STATE = {
  KAUSIKORTTI: "kausikortti",
  IRTOLIPPU: "irtolippu",
  MYYTY: "myyty", // 3-state fallback (no baseline available)
  VAPAA: "vapaa",
  EI_MYYNNISSA: "ei-myynnissa",
};

export function sectionOfSeatId(seatId) {
  return seatId.slice(0, seatId.indexOf("-"));
}

// Seat ids are "section-row-seat" (e.g. "A1-6-123"), row/seat not
// fixed-width (verified against real data: row "1"/"10", seat zero-padded
// to 3 digits in the sample checked but not assumed elsewhere) — Number()
// both strips any zero-padding for display and gives the caller real
// numbers to format with, rather than raw substrings.
export function parseSeatId(seatId) {
  const [section, row, seat] = seatId.split("-");
  return { section, row: Number(row), seat: Number(seat) };
}

// Nearest seat to `point` (SVG user-space, same space as each seat's own
// cx/cy) among `seatPositions` — a plain linear scan, not spatially
// indexed: cheap enough at ~2,600 seats for a single tap event (not run on
// every pointermove). `maxDistance` (user units) is the touch fingertip
// disambiguation cap — a genuinely nearest seat that's still farther than
// this (a walkway, the rink edge, an empty corner) isn't a plausible match
// for the tap and returns null, rather than picking something arbitrarily
// far from where the finger actually landed.
export function nearestSeatId(seatPositions, point, maxDistance = Infinity) {
  let bestId = null;
  let bestDist = Infinity;
  for (const { id, cx, cy } of seatPositions) {
    const dist = Math.hypot(cx - point.x, cy - point.y);
    if (dist < bestDist) {
      bestDist = dist;
      bestId = id;
    }
  }
  return bestDist <= maxDistance ? bestId : null;
}

// The frontend-side mirror of scripts/lib/seatRecency.js's own FIX 1
// guard: a recentSeatActivity.json fetched alongside a seats.json from a
// DIFFERENT map generation (its own svgHash disagrees) must never be
// trusted, even though both files are written from the same per-event
// scraper run today — a partial write failure between the two, or a
// transition period, could leave them momentarily mismatched, and
// diffing seat ids across two different maps is exactly the phantom-
// marks bug FIX 1 exists to prevent.
//
// Also enforces the 24h cap at DISPLAY time, not just scrape time — the
// scraper only prunes an expired mark on its own next run, so without
// this a mark that crossed 24h between scrapes (or in a long-open tab)
// would still render. `nowISO` is passed in by the caller rather than
// read here (e.g. `Date.now()`), so this stays pure and testable; the
// caller uses the real current time at map build. A tab left open across
// the cap doesn't get its already-rendered marks re-pruned live — that's
// accepted, not a gap: this only re-runs on the next card expansion
// (a fresh map build), and machinery to re-check a static render on a
// timer isn't worth it for a page people refresh rather than leave open
// for 24h.
export function resolveRecencyMarks(seats, recentActivity, nowISO) {
  if (!seats || !recentActivity || recentActivity.svgHash !== seats.svgHash) {
    return { freed: {}, sold: {} };
  }

  const now = new Date(nowISO).getTime();
  function prune(map) {
    const result = {};
    for (const [id, entry] of Object.entries(map)) {
      if (now - new Date(entry.detectedAtISO).getTime() < RECENCY_CAP_MS) result[id] = entry;
    }
    return result;
  }

  return { freed: prune(recentActivity.freed), sold: prune(recentActivity.sold) };
}

export function buildDisabledSectionSet(sections) {
  return new Set(sections.filter((row) => row.disabled).map((row) => row.section));
}

// baselineSet === null means "no baseline available" (missing kausikortti
// seats.json, or svgHash mismatch) — collapses to the 3-state MYYTY. Sold
// status wins over disabled: hold is defined as total - sold precisely so
// the two never overlap, so a closed section's sold seats are still real
// occupied seats (a season-ticket holder sitting there, or a single
// ticket sold before the section closed). disabled only ever applies to
// the section's unsold remainder.
export function classifySeat(seatId, { soldSet, baselineSet, disabledSectionSet }) {
  if (soldSet.has(seatId)) {
    if (baselineSet === null) return SEAT_STATE.MYYTY;
    return baselineSet.has(seatId) ? SEAT_STATE.KAUSIKORTTI : SEAT_STATE.IRTOLIPPU;
  }
  if (disabledSectionSet.has(sectionOfSeatId(seatId))) return SEAT_STATE.EI_MYYNNISSA;
  return SEAT_STATE.VAPAA;
}

// Boxes (aitio_1..aitio_9) have no per-seat granularity — a box is either
// occupied (through a channel other than the public shop flow) or not.
export const AITIO_STATE = { MYYTY: "aitio-myyty", EI_MYYNNISSA: "ei-myynnissa" };

export function classifyAitio(aitioId, soldAitioSet) {
  return soldAitioSet.has(aitioId) ? AITIO_STATE.MYYTY : AITIO_STATE.EI_MYYNNISSA;
}
