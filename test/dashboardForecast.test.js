import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeAttendanceIndices,
  buildPaceCurve,
  forecastGame,
  forecastVisibility,
  MIN_COMPLETED_GAMES,
  MAX_DAYS_OUT,
} from "../js/dashboardForecast.js";

// --- indices ---

function historyFixture() {
  // Two seasons; season means differ (3000 vs 4000) so per-season
  // normalization is what makes the indices come out clean.
  const games = [];
  // 2024-25, mean 3000: Tappara draws 1.2x, KooKoo 0.8x, both on Friday/Tuesday
  games.push({ season: "2024-25", start: "2024-09-20T14:30:00Z", opponent: "Tappara", attendance: 3600 }); // Fri
  games.push({ season: "2024-25", start: "2024-09-24T14:30:00Z", opponent: "KooKoo", attendance: 2400 }); // Tue
  // 2025-26, mean 4000: same relative pattern at a different level
  games.push({ season: "2025-26", start: "2025-09-19T14:30:00Z", opponent: "Tappara", attendance: 4800 }); // Fri
  games.push({ season: "2025-26", start: "2025-09-23T14:30:00Z", opponent: "KooKoo", attendance: 3200 }); // Tue
  return { games };
}

test("computeAttendanceIndices normalizes within season and shrinks toward 1", () => {
  const indices = computeAttendanceIndices(historyFixture());
  // Tappara: rel 1.2 in both seasons, n=2, K=2 -> (1.2*2 + 2)/4 = 1.1
  assert.ok(Math.abs(indices.opponentIndex.get("Tappara") - 1.1) < 1e-9);
  // KooKoo: rel 0.8 -> (0.8*2 + 2)/4 = 0.9
  assert.ok(Math.abs(indices.opponentIndex.get("KooKoo") - 0.9) < 1e-9);
  // level = most recent season's mean
  assert.equal(indices.level, 4000);
  assert.equal(indices.sampleCount, 4);
});

test("computeAttendanceIndices returns null with no data", () => {
  assert.equal(computeAttendanceIndices(null), null);
  assert.equal(computeAttendanceIndices({ games: [] }), null);
});

// --- pace curve ---

function completedGame({ startIso, baselineSold, points, finalSold }) {
  return { startIso, baselineSold, finalSold, history: points };
}

function daysBefore(startIso, d) {
  return new Date(new Date(startIso).getTime() - d * 86400000).toISOString();
}

test("buildPaceCurve: remaining sales grow with days out, gaps filled, monotonic", () => {
  const start = "2026-09-20T14:30:00Z";
  const game = completedGame({
    startIso: start,
    baselineSold: 2000,
    finalSold: 3000, // 1000 irtoliput in the end
    points: [
      { t: daysBefore(start, 20), sold: 2100 }, // 100 sold -> 900 remaining
      { t: daysBefore(start, 10), sold: 2400 }, // 400 sold -> 600 remaining
      { t: daysBefore(start, 2), sold: 2800 }, // 800 sold -> 200 remaining
      { t: daysBefore(start, 0), sold: 3000 },
    ],
  });

  const curve = buildPaceCurve([game]);
  assert.equal(curve.samples, 1);
  assert.equal(curve.remainingByDay[0], 0);
  assert.equal(curve.remainingByDay[2], 200);
  assert.equal(curve.remainingByDay[10], 600);
  assert.equal(curve.remainingByDay[20], 900);
  // Beyond the first history point there are no samples: filled by carrying
  // the running max forward, so far-out days never claim LESS than nearer.
  assert.equal(curve.remainingByDay[MAX_DAYS_OUT], 900);
  for (let d = 1; d <= MAX_DAYS_OUT; d++) {
    assert.ok(curve.remainingByDay[d] >= curve.remainingByDay[d - 1], `monotonic at ${d}`);
  }
});

test("buildPaceCurve returns null with no usable games", () => {
  assert.equal(buildPaceCurve([]), null);
  assert.equal(buildPaceCurve([{ startIso: "2026-01-01T17:00:00Z", baselineSold: 0, finalSold: NaN, history: [] }]), null);
});

// --- forecastGame ---

const NOW = "2026-09-10T12:00:00Z";

function paceSetup() {
  const start = "2026-09-01T14:30:00Z";
  const game = completedGame({
    startIso: start,
    baselineSold: 2000,
    finalSold: 3000,
    points: [
      { t: daysBefore(start, 10), sold: 2400 },
      { t: daysBefore(start, 0), sold: 3000 },
    ],
  });
  return buildPaceCurve([game]); // remaining at 10d out = 600
}

test("forecastGame pace mode: current + expected remaining, scaled by indices, capped and floored", () => {
  const paceCurve = paceSetup();
  const indices = computeAttendanceIndices(historyFixture());

  // Tappara game 10 days out (2026-09-20 vs now 2026-09-10)
  const f = forecastGame(
    { name: "SaiPa - Tappara", startIso: "2026-09-20T14:30:00Z", currentSold: 2600, capacity: 4976, nowIso: NOW },
    { paceCurve, indices, completedCount: MIN_COMPLETED_GAMES }
  );
  assert.equal(f.mode, "pace");
  // remaining 600 × opponent 1.1 × weekday idx (Sunday=1, unseen -> 1)... start is a Sunday
  assert.equal(f.attendance, 2600 + Math.round(600 * 1.1 * 1));

  // capacity cap
  const capped = forecastGame(
    { name: "SaiPa - Tappara", startIso: "2026-09-20T14:30:00Z", currentSold: 4900, capacity: 4976, nowIso: NOW },
    { paceCurve, indices, completedCount: MIN_COMPLETED_GAMES }
  );
  assert.equal(capped.attendance, 4976);
});

test("forecastGame falls back to index mode below the completed-games floor", () => {
  const paceCurve = paceSetup(); // exists, but completedCount below floor
  const indices = computeAttendanceIndices(historyFixture());
  const f = forecastGame(
    { name: "SaiPa - KooKoo", startIso: "2026-09-22T14:30:00Z", currentSold: 2500, capacity: 4976, nowIso: NOW },
    { paceCurve, indices, completedCount: MIN_COMPLETED_GAMES - 1 }
  );
  assert.equal(f.mode, "index");
  // level 4000 × KooKoo 0.9 × Tuesday idx 0.9 = 3240
  assert.equal(f.attendance, Math.round(4000 * 0.9 * 0.9));
});

test("forecastGame index mode never predicts below the current sold count", () => {
  const indices = computeAttendanceIndices(historyFixture());
  const f = forecastGame(
    { name: "SaiPa - KooKoo", startIso: "2026-09-22T14:30:00Z", currentSold: 4200, capacity: 4976, nowIso: NOW },
    { paceCurve: null, indices, completedCount: 0 }
  );
  assert.equal(f.attendance, 4200);
});

test("forecastGame returns null with neither pace data nor indices", () => {
  assert.equal(
    forecastGame(
      { name: "SaiPa - KooKoo", startIso: "2026-09-22T14:30:00Z", currentSold: 2500, capacity: 4976, nowIso: NOW },
      { paceCurve: null, indices: null, completedCount: 0 }
    ),
    null
  );
});

// --- visibility gate ---

test("forecastVisibility: live from MIN_COMPLETED_GAMES; before that only via override, and only if computable", () => {
  assert.deepEqual(forecastVisibility({ completedCount: MIN_COMPLETED_GAMES, hasIndices: false, forceVisible: false }), {
    show: true,
    experimental: false,
  });
  assert.deepEqual(forecastVisibility({ completedCount: 0, hasIndices: true, forceVisible: false }), {
    show: false,
    experimental: true,
  });
  assert.deepEqual(forecastVisibility({ completedCount: 0, hasIndices: true, forceVisible: true }), {
    show: true,
    experimental: true,
  });
  assert.deepEqual(forecastVisibility({ completedCount: 0, hasIndices: false, forceVisible: true }), {
    show: false,
    experimental: true,
  });
});
