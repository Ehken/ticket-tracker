// Attendance forecasting for the dashboard, in two tiers of ambition:
//
// PACE estimator (the real model): from this season's completed games'
// sales trajectories, learn how many irtoliput a game typically still
// sells from D days out, and forecast an upcoming game as
//   current sold + expected remaining(D) × opponent index × weekday index.
// Additive on remaining sales, never multiplicative on the sold count —
// early in a game's window the sold count is nearly all season-ticket
// baseline, and ratio models explode there. Needs at least
// MIN_COMPLETED_GAMES completed games to say anything.
//
// INDEX estimator (the cold-start stand-in): before any pace data exists,
// predict final attendance directly from historical draw —
//   level × opponent index × weekday index,
// floored at the game's current sold count. Level and indices come from
// data/attendanceHistory.json (past seasons' announced attendance from
// liiga.fi — see scripts/fetchAttendanceHistory.js). Explicitly a rough,
// experimental number; the production gate below keeps it off the live
// page, visible only behind ?forecast=1.
//
// Both estimators are blind to team form, standings, TV picks and weather —
// the biggest real-world drivers. The UI copy must say "if this season
// keeps behaving like the data so far", not promise more.
//
// Index shrinkage: an opponent seen n times with mean relative draw m gets
// index (m·n + 1·K)/(n + K) — pulled toward 1 (neutral) when n is small,
// so two loud data points can't triple a forecast. Same for weekdays.
import { findValueAtOrBefore } from "./dashboardTrends.js";
import { helsinkiWeekday } from "./dashboardTiming.js";
import { extractOpponentDisplay } from "./grouping.js";

// Below this many completed games, the pace curve is anecdote, not data —
// the forecast tile stays off the live page (the ?forecast=1 override shows
// whatever the estimators can produce, index estimator included).
export const MIN_COMPLETED_GAMES = 5;

// Days-out grid for the pace curve. Games first appear ~4-6 weeks before
// their date; beyond the grid the earliest bucket is used.
export const MAX_DAYS_OUT = 45;

const INDEX_SHRINKAGE_K = 2;

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function shrunkIndexMap(samplesByKey) {
  const map = new Map();
  for (const [key, samples] of samplesByKey) {
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    map.set(key, (mean * samples.length + 1 * INDEX_SHRINKAGE_K) / (samples.length + INDEX_SHRINKAGE_K));
  }
  return map;
}

// attendanceHistory: the parsed data/attendanceHistory.json ({games: [...]})
// or null. Returns null when there's nothing usable — every consumer treats
// missing indices as "all factors neutral".
export function computeAttendanceIndices(attendanceHistory) {
  const games = attendanceHistory?.games ?? [];
  if (games.length === 0) return null;

  // Relative draw within each season — normalizing per season makes numbers
  // comparable across seasons even if capacity, pricing or team form moved
  // the absolute level between them.
  const bySeason = new Map();
  for (const g of games) {
    if (!bySeason.has(g.season)) bySeason.set(g.season, []);
    bySeason.get(g.season).push(g);
  }

  const opponentSamples = new Map();
  const weekdaySamples = new Map();
  let latestSeason = null;
  let latestSeasonMean = null;

  for (const [season, seasonGames] of bySeason) {
    const mean = seasonGames.reduce((s, g) => s + g.attendance, 0) / seasonGames.length;
    if (latestSeason === null || season > latestSeason) {
      latestSeason = season;
      latestSeasonMean = mean;
    }
    for (const g of seasonGames) {
      const rel = g.attendance / mean;
      if (!opponentSamples.has(g.opponent)) opponentSamples.set(g.opponent, []);
      opponentSamples.get(g.opponent).push(rel);
      const wd = helsinkiWeekday(g.start);
      if (!weekdaySamples.has(wd)) weekdaySamples.set(wd, []);
      weekdaySamples.get(wd).push(rel);
    }
  }

  return {
    opponentIndex: shrunkIndexMap(opponentSamples),
    weekdayIndex: shrunkIndexMap(weekdaySamples),
    // Absolute level for the INDEX estimator only — deliberately the most
    // recent completed season's mean, and deliberately never mixed into
    // the pace estimator, whose level comes from this season's own sales.
    level: latestSeasonMean,
    sampleCount: games.length,
  };
}

function daysOut(startIso, nowIso) {
  const ms = new Date(startIso).getTime() - new Date(nowIso).getTime();
  return Math.max(0, Math.min(MAX_DAYS_OUT, Math.ceil(ms / 86400000)));
}

// completedGames: [{ startIso, history, finalSold, baselineSold }] for this
// season's played games (history = history.json points; finalSold = the
// frozen last sold count). Returns { remainingByDay, samples } or null.
// remainingByDay[D] = median additional irtoliput a game sold from D days
// out to the end. Monotonicity is enforced (more days out can never mean
// LESS remaining sales) — small samples produce noisy medians otherwise.
export function buildPaceCurve(completedGames) {
  const usable = completedGames.filter((g) => g.history?.length > 0 && Number.isFinite(g.finalSold));
  if (usable.length === 0) return null;

  const perDay = Array.from({ length: MAX_DAYS_OUT + 1 }, () => []);
  for (const game of usable) {
    const finalIrtoliput = Math.max(0, game.finalSold - game.baselineSold);
    const startMs = new Date(game.startIso).getTime();
    for (let d = 0; d <= MAX_DAYS_OUT; d++) {
      const cutoffIso = new Date(startMs - d * 86400000).toISOString();
      const point = findValueAtOrBefore(game.history, cutoffIso);
      if (!point) continue; // game wasn't on sale yet D days out — no sample
      const irtoliputAtD = Math.max(0, point.sold - game.baselineSold);
      perDay[d].push(Math.max(0, finalIrtoliput - irtoliputAtD));
    }
  }

  const remainingByDay = perDay.map((samples) => median(samples));
  // Fill gaps and enforce monotonic growth with days-out.
  let running = 0;
  for (let d = 0; d <= MAX_DAYS_OUT; d++) {
    if (remainingByDay[d] === null) remainingByDay[d] = running;
    running = Math.max(running, remainingByDay[d]);
    remainingByDay[d] = running;
  }

  return { remainingByDay, samples: usable.length };
}

function indexFor(indices, mapName, key) {
  const value = indices?.[mapName]?.get(key);
  return value ?? 1;
}

// Forecast one upcoming game's final attendance (sold tickets).
// Returns { attendance, mode: "pace" | "index" } or null when no estimator
// has enough to go on. `capacity` caps the prediction; currentSold floors it.
export function forecastGame(
  { name, startIso, currentSold, capacity, nowIso },
  { paceCurve, indices, completedCount }
) {
  const opponent = extractOpponentDisplay(name);
  const opponentIdx = opponent ? indexFor(indices, "opponentIndex", opponent) : 1;
  const weekdayIdx = indexFor(indices, "weekdayIndex", helsinkiWeekday(startIso));

  if (paceCurve && completedCount >= MIN_COMPLETED_GAMES) {
    const d = daysOut(startIso, nowIso);
    const expectedRemaining = paceCurve.remainingByDay[d] * opponentIdx * weekdayIdx;
    const attendance = Math.min(capacity, Math.round(currentSold + expectedRemaining));
    return { attendance: Math.max(currentSold, attendance), mode: "pace" };
  }

  if (indices?.level) {
    const attendance = Math.min(capacity, Math.round(indices.level * opponentIdx * weekdayIdx));
    return { attendance: Math.max(currentSold, attendance), mode: "index" };
  }

  return null;
}

// The production gate: the forecast renders on the live page only from
// MIN_COMPLETED_GAMES completed games onwards. `forceVisible` (?forecast=1)
// reveals whatever the estimators can currently produce — for validating
// the model against reality before trusting it publicly.
export function forecastVisibility({ completedCount, hasIndices, forceVisible }) {
  const productionReady = completedCount >= MIN_COMPLETED_GAMES;
  const anythingComputable = productionReady || hasIndices;
  return {
    show: productionReady || (forceVisible && anythingComputable),
    experimental: !productionReady,
  };
}
