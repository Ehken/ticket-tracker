import { toHelsinkiDateString } from "./schedule.js";

const helsinkiHourFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Helsinki",
  hour: "2-digit",
  hourCycle: "h23",
});

export function getHelsinkiHour(date) {
  return Number(helsinkiHourFormatter.format(date));
}

const GAME_DAY_START_HOUR = 15;
const GAME_DAY_END_HOUR = 21;

// Sales-opening days aren't fixtures (they're not in schedule.json) and a
// morning opening doesn't fit the evening puck-drop window below — each
// watchDates.json entry may override these, but a bare { date } is by far
// the common case, so a sensible default matters. 08:00-20:00 is wide
// enough to catch a typical morning-through-evening opening without
// knowing its exact hour in advance (this data can't be recaptured if
// missed), while not polling overnight when nothing is happening.
const DEFAULT_WATCH_START_HOUR = 8;
const DEFAULT_WATCH_END_HOUR = 20;

export function isGameDayWindowNow(eventsIndex, now = new Date(), watchDates = []) {
  const hour = getHelsinkiHour(now);
  const today = toHelsinkiDateString(now);

  const isGameDayEvening =
    hour >= GAME_DAY_START_HOUR &&
    hour < GAME_DAY_END_HOUR &&
    eventsIndex.some((event) => event.status === "upcoming" && toHelsinkiDateString(event.start) === today);

  const isWatchWindow = watchDates.some((entry) => {
    if (entry.date !== today) return false;
    const startHour = entry.startHour ?? DEFAULT_WATCH_START_HOUR;
    const endHour = entry.endHour ?? DEFAULT_WATCH_END_HOUR;
    return hour >= startHour && hour < endHour;
  });

  return isGameDayEvening || isWatchWindow;
}

// A past watch date has no effect on the gate either way (its date is never
// === today again), but silent staleness is exactly the kind of gap this
// codebase otherwise treats as loud (warnOnUnmatchedDisabledSection,
// warnOnOrphanRowLevelDisabled) — one log line prompting a prune beats a
// stale entry nobody notices for a season.
export function warnOnPastWatchDates(watchDates, now, logger = console) {
  const today = toHelsinkiDateString(now);
  const stale = watchDates.filter((entry) => entry.date < today);
  if (stale.length === 0) return;

  logger.warn(
    `[watchDates] ${stale.length} entr${stale.length === 1 ? "y" : "ies"} in data/watchDates.json ` +
      `${stale.length === 1 ? "is" : "are"} in the past and can be pruned: ${stale.map((e) => e.date).join(", ")}`
  );
}
