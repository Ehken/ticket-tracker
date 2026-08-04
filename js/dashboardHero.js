// Pure computations behind the dashboard's hero tiles. "Attendance"
// throughout means SOLD TICKETS (season-ticket holders + singles + standing
// + wheelchair — latest.totals.sold), not turnstile attendance; the tiles'
// ⓘ copy says so.
import { baselineForEvent } from "./dashboardBaseline.js";
import { computeDelta } from "./dashboardTrends.js";

export function computeIrtoliputTotal(matchEvents, baselineIndex) {
  return matchEvents.reduce((sum, event) => {
    const baseline = baselineForEvent(event, baselineIndex);
    return sum + Math.max(0, event.latest.totals.sold - baseline.totalSold);
  }, 0);
}

// Sum of each game's sold-count movement over the last 24h. Equals the
// irtolippu delta as long as the season-ticket baseline holds still —
// which it now does by design (the pinned derived baseline). Events with
// no history point old enough contribute 0 rather than dropping the whole
// figure. Null only when NO event has any usable history (fresh install).
export function computeSold24hDelta(matchEventsWithHistory, nowIso) {
  let total = 0;
  let sawAny = false;
  for (const event of matchEventsWithHistory) {
    const delta = computeDelta(event.history ?? [], event.latest.totals.sold, 24, nowIso);
    if (delta !== null) {
      total += delta;
      sawAny = true;
    }
  }
  return sawAny ? total : null;
}

// Played games' actual average — null until the first game has been played.
export function computeAvgAttendancePlayed(matchEvents) {
  const played = matchEvents.filter((e) => e.status === "past");
  if (played.length === 0) return null;
  return {
    average: played.reduce((s, e) => s + e.latest.totals.sold, 0) / played.length,
    gameCount: played.length,
  };
}

// The season-average FLOOR: every game at its current sold count (played
// games are frozen at their final count, upcoming ones only sell upward).
// Deliberately labeled "nykymyynnillä", never "ennuste" — this is
// arithmetic, not a model.
export function computeAvgAttendanceFloor(matchEvents) {
  if (matchEvents.length === 0) return null;
  return {
    average: matchEvents.reduce((s, e) => s + e.latest.totals.sold, 0) / matchEvents.length,
    gameCount: matchEvents.length,
  };
}

// A game is sold out when nothing is publicly buyable. Includes played
// games on purpose: "how many games sold out this season" is the figure
// people actually quote. A game with zero capacity (defensive) never counts.
export function computeSelloutStats(matchEvents) {
  const soldOut = matchEvents.filter((e) => e.latest.totals.total > 0 && e.latest.totals.available === 0);
  return { soldOutCount: soldOut.length, gameCount: matchEvents.length, soldOutEvents: soldOut };
}

export function findNextGame(matchEvents, nowIso) {
  const upcoming = matchEvents
    .filter((e) => e.status === "upcoming" && new Date(e.start).getTime() >= new Date(nowIso).getTime())
    .sort((a, b) => a.start.localeCompare(b.start));
  return upcoming[0] ?? null;
}

// Model-based season average: played games at their actual final count,
// upcoming games at their forecast. Only meaningful when every upcoming
// game got a forecast — a half-forecast average would silently mix floor
// and model semantics, so bail to null instead.
export function computeAvgAttendanceForecast(matchEvents, forecastByEventId) {
  if (matchEvents.length === 0) return null;
  let sum = 0;
  let mode = null;
  for (const event of matchEvents) {
    if (event.status === "past") {
      sum += event.latest.totals.sold;
      continue;
    }
    const forecast = forecastByEventId.get(event.id);
    if (!forecast) return null;
    sum += forecast.attendance;
    mode = mode === "pace" ? "pace" : forecast.mode;
  }
  return { average: sum / matchEvents.length, gameCount: matchEvents.length, mode: mode ?? "actual" };
}
