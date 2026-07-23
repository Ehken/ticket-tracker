import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getSeasonBaseline,
  buildBaselineIndex,
  irtoliput,
  irtolippuFillPct,
  irtolippuSections,
  baselineForEvent,
  seasonForEvent,
} from "../js/dashboardBaseline.js";

function kausikortti({ season, start = "2026-07-31T21:00:00.000Z", stop = "2027-03-15T22:00:00.000Z", sold = 2552, sections = [] }) {
  return {
    id: `kk-${season}`,
    season,
    start,
    latest: { stop, totals: { sold, available: 0, hold: 0, total: 4976 }, sections },
  };
}

test("getSeasonBaseline finds the matching season's sold count", () => {
  const kausikortitEvents = [kausikortti({ season: "2025-26", sold: 4500 }), kausikortti({ season: "2026-27", sold: 2552 })];
  assert.equal(getSeasonBaseline(kausikortitEvents, "2026-27"), 2552);
  assert.equal(getSeasonBaseline(kausikortitEvents, "2025-26"), 4500);
});

test("getSeasonBaseline returns 0 when no kausikortti event exists for that season", () => {
  assert.equal(getSeasonBaseline([], "2026-27"), 0);
  assert.equal(getSeasonBaseline([kausikortti({ season: "2025-26" })], "2026-27"), 0);
});

test("buildBaselineIndex builds a per-season map of total + per-section sold", () => {
  const kausikortitEvents = [
    kausikortti({
      season: "2026-27",
      sold: 2552,
      sections: [
        { section: "A1", sold: 100, total: 171 },
        { section: "seisomakatsomo", sold: 1000, total: 2138 },
      ],
    }),
  ];
  const index = buildBaselineIndex(kausikortitEvents);
  const entry = index.get("2026-27");
  assert.equal(entry.totalSold, 2552);
  assert.equal(entry.sections.get("A1"), 100);
  assert.equal(entry.sections.get("seisomakatsomo"), 1000);
});

test("irtoliput clamps negative differences to 0", () => {
  assert.equal(irtoliput(3000, 2552), 448);
  assert.equal(irtoliput(2000, 2552), 0); // game sold < baseline shouldn't happen, but must never go negative
});

test("irtolippuFillPct computes the fraction of non-baseline capacity sold", () => {
  // total=4976, baseline=2552 -> non-baseline capacity = 2424; sold=3000 -> irtoliput=448
  assert.equal(irtolippuFillPct(3000, 4976, 2552), 448 / 2424);
});

test("irtolippuFillPct returns null when total - baseline <= 0 (degenerate)", () => {
  assert.equal(irtolippuFillPct(2552, 2552, 2552), null); // total === baseline
  assert.equal(irtolippuFillPct(2000, 2000, 2552), null); // baseline > total
});

test("irtolippuFillPct clamps to [0, 1]", () => {
  assert.equal(irtolippuFillPct(2552, 4976, 2552), 0); // sold === baseline -> 0
  assert.equal(irtolippuFillPct(4976, 4976, 2552), 1); // fully sold -> 1
});

test("irtolippuSections matches by section key and defaults absent baseline sections to 0", () => {
  const gameSections = [
    { section: "A1", sold: 150, total: 171 },
    { section: "press", sold: 0, total: 24 },
  ];
  const baselineSectionMap = new Map([["A1", 100]]);
  const result = irtolippuSections(gameSections, baselineSectionMap);
  assert.deepEqual(result[0], { section: "A1", irtoliput: 50, irtolippuFillPct: 50 / 71 });
  assert.deepEqual(result[1], { section: "press", irtoliput: 0, irtolippuFillPct: 0 }); // no baseline entry -> defaults to 0, denom=24, sold=0 -> 0
});

test("baselineForEvent looks up by event.season and falls back to an empty baseline", () => {
  const index = buildBaselineIndex([kausikortti({ season: "2026-27", sold: 2552, sections: [{ section: "A1", sold: 100, total: 171 }] })]);
  const found = baselineForEvent({ season: "2026-27" }, index);
  assert.equal(found.totalSold, 2552);
  assert.equal(found.sections.get("A1"), 100);

  const missing = baselineForEvent({ season: "2099-00" }, index);
  assert.equal(missing.totalSold, 0);
  assert.equal(missing.sections.size, 0);
});

test("seasonForEvent returns the event's own season when set", () => {
  const event = { season: "2026-27", start: "2026-09-01T17:00:00.000Z" };
  assert.equal(seasonForEvent(event, []), "2026-27");
});

test("seasonForEvent falls back to date-inference for a null-season event", () => {
  const kausikortitEvents = [kausikortti({ season: "2026-27", start: "2026-07-31T21:00:00.000Z", stop: "2027-03-15T22:00:00.000Z" })];
  const unclassifiedEvent = { season: null, start: "2026-12-15T17:00:00.000Z" };
  assert.equal(seasonForEvent(unclassifiedEvent, kausikortitEvents), "2026-27");
});

test("seasonForEvent returns null when no kausikortti range contains the date", () => {
  const kausikortitEvents = [kausikortti({ season: "2026-27", start: "2026-07-31T21:00:00.000Z", stop: "2027-03-15T22:00:00.000Z" })];
  const orphanEvent = { season: null, start: "2020-01-01T17:00:00.000Z" };
  assert.equal(seasonForEvent(orphanEvent, kausikortitEvents), null);
});
