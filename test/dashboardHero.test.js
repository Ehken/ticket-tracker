import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeIrtoliputTotal,
  computeSold24hDelta,
  computeAvgAttendancePlayed,
  computeAvgAttendanceFloor,
  computeSelloutStats,
  findNextGame,
  computeAvgAttendanceForecast,
} from "../js/dashboardHero.js";
import { buildBaselineIndex } from "../js/dashboardBaseline.js";

const NOW = "2026-09-10T12:00:00.000Z";

function kk(sold = 2490) {
  return {
    id: "kk",
    season: "2026-27",
    latest: { totals: { sold, total: 4976 }, sections: [] },
  };
}

function game({ id, sold, available = 1000, total = 4976, status = "upcoming", start = "2026-10-01T15:30:00.000Z", history }) {
  return {
    id,
    name: `SaiPa - ${id}`,
    season: "2026-27",
    status,
    start,
    latest: { totals: { sold, available, hold: total - sold - available, total }, sections: [] },
    history,
  };
}

const baselineIndex = buildBaselineIndex([kk()]);

test("computeIrtoliputTotal sums sold minus baseline, clamped at 0 per game", () => {
  const events = [game({ id: "a", sold: 2600 }), game({ id: "b", sold: 2400 })]; // b below baseline -> 0
  assert.equal(computeIrtoliputTotal(events, baselineIndex), 110);
});

test("computeSold24hDelta sums per-game movement; null only when no game has usable history", () => {
  const t25hAgo = new Date(new Date(NOW).getTime() - 25 * 3600 * 1000).toISOString();
  const events = [
    game({ id: "a", sold: 2600, history: [{ t: t25hAgo, sold: 2550 }] }), // +50
    game({ id: "b", sold: 2500, history: [{ t: t25hAgo, sold: 2510 }] }), // -10 (release)
    game({ id: "c", sold: 2500, history: [] }), // no history -> contributes 0
  ];
  assert.equal(computeSold24hDelta(events, NOW), 40);
  assert.equal(computeSold24hDelta([game({ id: "d", sold: 1, history: [] })], NOW), null);
});

test("played and floor averages", () => {
  const events = [
    game({ id: "a", sold: 4000, status: "past" }),
    game({ id: "b", sold: 3000, status: "past" }),
    game({ id: "c", sold: 2600 }),
  ];
  assert.deepEqual(computeAvgAttendancePlayed(events), { average: 3500, gameCount: 2 });
  assert.deepEqual(computeAvgAttendanceFloor(events), { average: 3200, gameCount: 3 });
  assert.equal(computeAvgAttendancePlayed([game({ id: "x", sold: 1 })]), null);
  assert.equal(computeAvgAttendanceFloor([]), null);
});

test("computeSelloutStats counts games with zero available, played included", () => {
  const events = [
    game({ id: "a", sold: 4796, available: 0 }),
    game({ id: "b", sold: 4796, available: 0, status: "past" }),
    game({ id: "c", sold: 2600 }),
  ];
  const stats = computeSelloutStats(events);
  assert.equal(stats.soldOutCount, 2);
  assert.equal(stats.gameCount, 3);
});

test("findNextGame picks the earliest upcoming game at or after now", () => {
  const events = [
    game({ id: "later", start: "2026-09-20T15:30:00.000Z" }),
    game({ id: "next", start: "2026-09-12T15:30:00.000Z" }),
    game({ id: "played", start: "2026-09-01T15:30:00.000Z", status: "past" }),
  ];
  assert.equal(findNextGame(events, NOW).id, "next");
  assert.equal(findNextGame([events[2]], NOW), null);
});

test("computeAvgAttendanceForecast mixes played actuals with forecasts, bails if any upcoming game lacks one", () => {
  const events = [
    game({ id: "played", sold: 4000, status: "past" }),
    game({ id: "up1", sold: 2600 }),
    game({ id: "up2", sold: 2700 }),
  ];
  const forecasts = new Map([
    ["up1", { attendance: 3600, mode: "pace" }],
    ["up2", { attendance: 3800, mode: "pace" }],
  ]);
  assert.deepEqual(computeAvgAttendanceForecast(events, forecasts), {
    average: (4000 + 3600 + 3800) / 3,
    gameCount: 3,
    mode: "pace",
  });

  forecasts.delete("up2");
  assert.equal(computeAvgAttendanceForecast(events, forecasts), null);
});
