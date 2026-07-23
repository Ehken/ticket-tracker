import { irtolippuFillPct, baselineForEvent } from "./dashboardBaseline.js";
import { findValueAtOrBefore } from "./dashboardTrends.js";
import { extractOpponentDisplay } from "./grouping.js";

export const WEEKDAY_LABELS = ["Maanantai", "Tiistai", "Keskiviikko", "Torstai", "Perjantai", "Lauantai", "Sunnuntai"];

const WEEKDAY_NAME_TO_INDEX = {
  Monday: 0,
  Tuesday: 1,
  Wednesday: 2,
  Thursday: 3,
  Friday: 4,
  Saturday: 5,
  Sunday: 6,
};

const weekdayFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Helsinki", weekday: "long" });

export function helsinkiWeekday(iso) {
  return WEEKDAY_NAME_TO_INDEX[weekdayFormatter.format(new Date(iso))];
}

const hourMinuteFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Helsinki",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function helsinkiHourMinute(iso) {
  return hourMinuteFormatter.format(new Date(iso));
}

const monthPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Helsinki",
  year: "numeric",
  month: "2-digit",
});

function helsinkiYearMonthKey(iso) {
  const parts = monthPartsFormatter.formatToParts(new Date(iso));
  const year = parts.find((p) => p.type === "year").value;
  const month = parts.find((p) => p.type === "month").value;
  return `${year}-${month}`;
}

function gameIrtolippuFillPct(event, baselineIndex) {
  const baseline = baselineForEvent(event, baselineIndex);
  return irtolippuFillPct(event.latest.totals.sold, event.latest.totals.total, baseline.totalSold);
}

function average(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function computeWeekdayFillRates(matchEvents, baselineIndex) {
  const byWeekday = new Map();

  for (const event of matchEvents) {
    const fillPct = gameIrtolippuFillPct(event, baselineIndex);
    if (fillPct === null) continue;
    const weekday = helsinkiWeekday(event.start);
    if (!byWeekday.has(weekday)) byWeekday.set(weekday, []);
    byWeekday.get(weekday).push(fillPct);
  }

  if (byWeekday.size < 2) return null;

  return [...byWeekday.entries()]
    .map(([weekday, values]) => ({
      weekday,
      label: WEEKDAY_LABELS[weekday],
      avgIrtolippuFillPct: average(values),
      gameCount: values.length,
    }))
    .sort((a, b) => a.weekday - b.weekday);
}

export function computeWeekdayStartTimeGrid(matchEvents, baselineIndex) {
  const cells = new Map();

  for (const event of matchEvents) {
    const fillPct = gameIrtolippuFillPct(event, baselineIndex);
    if (fillPct === null) continue;
    const weekday = helsinkiWeekday(event.start);
    const time = helsinkiHourMinute(event.start);
    const key = `${weekday}|${time}`;
    if (!cells.has(key)) cells.set(key, { weekday, time, values: [] });
    cells.get(key).values.push(fillPct);
  }

  if (cells.size < 2) return null;

  return [...cells.values()]
    .map(({ weekday, time, values }) => ({
      weekday,
      weekdayLabel: WEEKDAY_LABELS[weekday],
      time,
      avgIrtolippuFillPct: average(values),
      gameCount: values.length,
    }))
    .sort((a, b) => a.weekday - b.weekday || a.time.localeCompare(b.time));
}

export function computeWeekdayTierGrid(matchEvents, baselineIndex, opponentTiers) {
  const tierByOpponent = new Map(opponentTiers.map((t) => [t.opponent, t]));
  const byTierWeekday = { big: new Map(), small: new Map() };

  for (const event of matchEvents) {
    const opponent = extractOpponentDisplay(event.name);
    if (!opponent) continue;

    const tierInfo = tierByOpponent.get(opponent);
    // Qualified-opponent guard: an opponent needs >=2 games in scope to
    // contribute here — with only 1 game we can't separate the opponent
    // effect from the weekday effect (that single game IS a specific weekday).
    if (!tierInfo || tierInfo.gameCount < 2) continue;

    const fillPct = gameIrtolippuFillPct(event, baselineIndex);
    if (fillPct === null) continue;

    const weekday = helsinkiWeekday(event.start);
    const bucket = byTierWeekday[tierInfo.tier];
    if (!bucket.has(weekday)) bucket.set(weekday, []);
    bucket.get(weekday).push(fillPct);
  }

  // Both tiers need >=2 distinct weekdays' worth of qualified-opponent games,
  // otherwise the cross-view can't actually isolate a weekday effect from an
  // opponent-tier effect yet — gated as one all-or-nothing check, not per-cell.
  if (byTierWeekday.big.size < 2 || byTierWeekday.small.size < 2) return null;

  function summarize(map) {
    return [...map.entries()]
      .map(([weekday, values]) => ({
        weekday,
        label: WEEKDAY_LABELS[weekday],
        avgIrtolippuFillPct: average(values),
        gameCount: values.length,
      }))
      .sort((a, b) => a.weekday - b.weekday);
  }

  return { big: summarize(byTierWeekday.big), small: summarize(byTierWeekday.small) };
}

export function computeMonthTrend(matchEvents, baselineIndex) {
  const byMonth = new Map();

  for (const event of matchEvents) {
    const fillPct = gameIrtolippuFillPct(event, baselineIndex);
    if (fillPct === null) continue;
    const key = helsinkiYearMonthKey(event.start);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(fillPct);
  }

  if (byMonth.size < 2) return null;

  return [...byMonth.entries()]
    .map(([key, values]) => ({ key, avgIrtolippuFillPct: average(values), gameCount: values.length }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function computePurchaseTimingProfile(pastMatchEventsWithHistory) {
  // Past events only — an upcoming game's "final 3 days" haven't happened
  // yet, so this is inherently retrospective.
  const byWeekday = new Map();
  let resolvedCount = 0;

  for (const event of pastMatchEventsWithHistory) {
    const finalSold = event.latest.totals.sold;
    if (finalSold === 0) continue;

    const cutoffIso = new Date(new Date(event.start).getTime() - 3 * 86400 * 1000).toISOString();
    const pointBefore = findValueAtOrBefore(event.history, cutoffIso);
    if (!pointBefore) continue;

    const pctInFinalThreeDays = (finalSold - pointBefore.sold) / finalSold;
    const weekday = helsinkiWeekday(event.start);
    if (!byWeekday.has(weekday)) byWeekday.set(weekday, []);
    byWeekday.get(weekday).push(pctInFinalThreeDays);
    resolvedCount += 1;
  }

  if (resolvedCount < 2) return null;

  return [...byWeekday.entries()]
    .map(([weekday, values]) => ({
      weekday,
      label: WEEKDAY_LABELS[weekday],
      avgPctInFinalThreeDays: average(values),
      gameCount: values.length,
    }))
    .sort((a, b) => a.weekday - b.weekday);
}
