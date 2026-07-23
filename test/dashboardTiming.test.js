import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WEEKDAY_LABELS,
  helsinkiWeekday,
  helsinkiHourMinute,
  computeWeekdayFillRates,
  computeWeekdayStartTimeGrid,
  computeWeekdayTierGrid,
  computeMonthTrend,
  computePurchaseTimingProfile,
} from "../js/dashboardTiming.js";

const EMPTY_BASELINE_INDEX = new Map();

// Jan 1 2026 is a Thursday, so:
const MON = "2026-01-05";
const TUE = "2026-01-06";
const WED = "2026-01-07";
const THU = "2026-01-08";
const FRI = "2026-01-09";
const SAT = "2026-01-10";

function matchEvent({ name = "SaiPa - Tappara", gameType = "runkosarja", start, sold, total = 100, history = [] }) {
  return {
    name,
    gameType,
    season: undefined,
    start,
    latest: { totals: { sold, available: total - sold, hold: 0, total } },
    history,
  };
}

test("helsinkiWeekday maps to a stable Mon=0..Sun=6 index, independent of locale string ordering", () => {
  assert.equal(helsinkiWeekday(`${MON}T17:00:00.000Z`), 0);
  assert.equal(helsinkiWeekday(`${TUE}T17:00:00.000Z`), 1);
  assert.equal(helsinkiWeekday(`${SAT}T17:00:00.000Z`), 5);
});

test("helsinkiWeekday resolves the Helsinki-local day, not the UTC day, across the day boundary", () => {
  // Monday 22:30 UTC = Tuesday 00:30 Helsinki (UTC+2 in January) — must read as Tuesday.
  assert.equal(helsinkiWeekday(`${MON}T22:30:00.000Z`), 1);
});

test("helsinkiHourMinute formats the Helsinki-local clock time", () => {
  assert.equal(helsinkiHourMinute(`${MON}T15:30:00.000Z`), "17:30"); // UTC+2 in January
});

test("computeWeekdayFillRates returns null with fewer than 2 distinct weekdays", () => {
  const events = [
    matchEvent({ start: `${MON}T17:00:00.000Z`, sold: 50 }),
    matchEvent({ start: `${MON}T17:00:00.000Z`, sold: 60 }),
  ];
  assert.equal(computeWeekdayFillRates(events, EMPTY_BASELINE_INDEX), null);
});

test("computeWeekdayFillRates averages irtolippu fill % per weekday, sorted Mon..Sun", () => {
  const events = [
    matchEvent({ start: `${MON}T17:00:00.000Z`, sold: 50, total: 100 }), // 0.5
    matchEvent({ start: `${MON}T17:00:00.000Z`, sold: 70, total: 100 }), // 0.7
    matchEvent({ start: `${WED}T17:00:00.000Z`, sold: 20, total: 100 }), // 0.2
  ];
  const result = computeWeekdayFillRates(events, EMPTY_BASELINE_INDEX);
  assert.equal(result.length, 2);
  assert.equal(result[0].label, WEEKDAY_LABELS[0]);
  assert.equal(result[0].avgIrtolippuFillPct, 0.6);
  assert.equal(result[0].gameCount, 2);
  assert.equal(result[1].label, WEEKDAY_LABELS[2]);
  assert.equal(result[1].avgIrtolippuFillPct, 0.2);
});

test("computeWeekdayStartTimeGrid returns null with fewer than 2 distinct (weekday, time) combos", () => {
  const events = [
    matchEvent({ start: `${MON}T17:00:00.000Z`, sold: 50 }),
    matchEvent({ start: `${MON}T17:00:00.000Z`, sold: 60 }),
  ];
  assert.equal(computeWeekdayStartTimeGrid(events, EMPTY_BASELINE_INDEX), null);
});

test("computeWeekdayStartTimeGrid buckets by actual distinct start times present, not a hardcoded set", () => {
  const events = [
    matchEvent({ start: `${MON}T15:00:00.000Z`, sold: 50, total: 100 }), // 17:00 Helsinki
    matchEvent({ start: `${MON}T16:30:00.000Z`, sold: 80, total: 100 }), // 18:30 Helsinki
  ];
  const grid = computeWeekdayStartTimeGrid(events, EMPTY_BASELINE_INDEX);
  assert.equal(grid.length, 2);
  const times = grid.map((c) => c.time).sort();
  assert.deepEqual(times, ["17:00", "18:30"]);
});

test("computeWeekdayTierGrid renders once both tiers have >=2 weekdays from qualified (>=2 game) opponents", () => {
  const tiers = [
    { opponent: "BigA", tier: "big", gameCount: 2 },
    { opponent: "SmallA", tier: "small", gameCount: 2 },
  ];
  const events = [
    matchEvent({ name: "SaiPa - BigA", start: `${MON}T17:00:00.000Z`, sold: 90, total: 100 }),
    matchEvent({ name: "SaiPa - BigA", start: `${WED}T17:00:00.000Z`, sold: 95, total: 100 }),
    matchEvent({ name: "SaiPa - SmallA", start: `${TUE}T17:00:00.000Z`, sold: 20, total: 100 }),
    matchEvent({ name: "SaiPa - SmallA", start: `${THU}T17:00:00.000Z`, sold: 25, total: 100 }),
  ];
  const grid = computeWeekdayTierGrid(events, EMPTY_BASELINE_INDEX, tiers);
  assert.ok(grid);
  assert.equal(grid.big.length, 2);
  assert.equal(grid.small.length, 2);
});

test("computeWeekdayTierGrid stays gated when a big opponent's only game is a single weekday (opponent effect vs weekday effect inseparable)", () => {
  const tiers = [
    { opponent: "BigOnly", tier: "big", gameCount: 1 }, // single game — excluded by the qualified-opponent guard
    { opponent: "SmallA", tier: "small", gameCount: 2 },
  ];
  const events = [
    matchEvent({ name: "SaiPa - BigOnly", start: `${TUE}T17:00:00.000Z`, sold: 90, total: 100 }),
    matchEvent({ name: "SaiPa - SmallA", start: `${WED}T17:00:00.000Z`, sold: 20, total: 100 }),
    matchEvent({ name: "SaiPa - SmallA", start: `${THU}T17:00:00.000Z`, sold: 25, total: 100 }),
  ];
  assert.equal(computeWeekdayTierGrid(events, EMPTY_BASELINE_INDEX, tiers), null);
});

test("computeMonthTrend returns null with fewer than 2 distinct months, else averages per month", () => {
  const singleMonth = [
    matchEvent({ start: "2026-01-05T17:00:00.000Z", sold: 50, total: 100 }),
    matchEvent({ start: "2026-01-20T17:00:00.000Z", sold: 70, total: 100 }),
  ];
  assert.equal(computeMonthTrend(singleMonth, EMPTY_BASELINE_INDEX), null);

  const twoMonths = [
    ...singleMonth,
    matchEvent({ start: "2026-02-05T17:00:00.000Z", sold: 30, total: 100 }),
  ];
  const trend = computeMonthTrend(twoMonths, EMPTY_BASELINE_INDEX);
  assert.equal(trend.length, 2);
  assert.deepEqual(trend.map((m) => m.key), ["2026-01", "2026-02"]);
  assert.equal(trend[0].avgIrtolippuFillPct, 0.6);
  assert.equal(trend[1].avgIrtolippuFillPct, 0.3);
});

test("computePurchaseTimingProfile only considers past events with a resolvable 3-day-before point, and guards finalSold === 0", () => {
  const start = "2026-01-08T17:00:00.000Z"; // Thursday
  const cutoff = new Date(new Date(start).getTime() - 3 * 86400 * 1000).toISOString();

  const withHistory = matchEvent({
    start,
    sold: 100,
    total: 200,
    history: [
      { t: "2026-01-01T00:00:00.000Z", sold: 10 },
      { t: cutoff, sold: 40 },
      { t: start, sold: 100 },
    ],
  });
  const zeroSold = matchEvent({ start, sold: 0, total: 200, history: [{ t: cutoff, sold: 0 }] });
  const noHistoryBeforeCutoff = matchEvent({
    start,
    sold: 50,
    total: 200,
    history: [{ t: "2026-01-07T23:00:00.000Z", sold: 10 }], // after the 3-day-before cutoff
  });

  // Only 1 event resolves -> below the >=2 minimum, stays null.
  assert.equal(computePurchaseTimingProfile([withHistory, zeroSold, noHistoryBeforeCutoff]), null);

  const secondResolvable = matchEvent({
    start: "2026-01-09T17:00:00.000Z", // Friday
    sold: 80,
    total: 200,
    history: [
      { t: new Date(new Date("2026-01-09T17:00:00.000Z").getTime() - 3 * 86400 * 1000).toISOString(), sold: 20 },
    ],
  });

  const profile = computePurchaseTimingProfile([withHistory, zeroSold, noHistoryBeforeCutoff, secondResolvable]);
  assert.ok(profile);
  const total = profile.reduce((sum, w) => sum + w.gameCount, 0);
  assert.equal(total, 2);
});
