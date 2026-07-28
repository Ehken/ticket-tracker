import { toHelsinkiDateString } from "./schedule.js";

const helsinkiHourFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Helsinki",
  hour: "2-digit",
  hourCycle: "h23",
});

export function getHelsinkiHour(date) {
  return Number(helsinkiHourFormatter.format(date));
}

// Deliberately provisional — 8:00-19:59 Europe/Helsinki, not the evening-
// only window this used to be:
// - Start moves to 8 because we have zero observations of when single-
//   match tickets actually sell — no match has ever been on sale. The
//   baseline cadence now resolves to roughly 30 minutes (GitHub's :17
//   cron plus the external trigger), enough to detect that mornings
//   matter but not to resolve the shape of a spike. Each match day
//   happens once: morning detail is unrecoverable for every game already
//   played, while extra runs are cheap and reversible.
// - End moves to 20 because there's no plausible reason to buy a ticket
//   for an evening game between 20 and 21 either. A single post-game
//   measurement gives the final sold figure, and the hourly baseline
//   already provides that without a dedicated window.
// Revisit after ~4 home games (the first is the 27.8 friendly) and narrow
// to what the curves actually show — most likely by binding the window to
// each event's own start time rather than a fixed clock, which would end
// up narrower than even the original 15-21 for an evening game while
// still covering an afternoon one.
const GAME_DAY_START_HOUR = 8;
const GAME_DAY_END_HOUR = 20;

// Sales-opening days aren't fixtures (they're not in schedule.json) and a
// morning opening doesn't fit the evening puck-drop window above — each
// watchDates.json entry may override these, but a bare { date } is by far
// the common case, so a sensible default matters. 08:00-20:00 is wide
// enough to catch a typical morning-through-evening opening without
// knowing its exact hour in advance (this data can't be recaptured if
// missed), while not polling overnight when nothing is happening.
//
// This now coincides exactly with GAME_DAY_START_HOUR/GAME_DAY_END_HOUR
// above — by choice, not by coupling: they describe different phenomena
// (a known game's evening vs. an unknown sale's morning) and will diverge
// again once the game-day window is bound to each event's own start time
// per the note above. Don't collapse these into one constant.
const DEFAULT_WATCH_START_HOUR = 8;
const DEFAULT_WATCH_END_HOUR = 20;

// eventsIndex entries are expected to carry a merged gameType (see
// scripts/checkGameWindow.js, which merges classification onto the raw
// index before calling this) — kept optional/pure here rather than read
// here, matching how this function already just receives the index.
//
// Excluded by blacklist ("is it kausikortti?"), not a whitelist of known
// game types: a whitelist would silently stop opening the window the day
// a new gameType appears (e.g. playoffs), which is the far worse failure.
// An event with no gameType at all (unclassified — gameType "muu", or the
// caller passed a plain index with no classification merged in at all)
// still counts as a potential game day — on a day a batch of new events
// arrives unclassified, the gate must not go blind just because
// classification hasn't caught up yet. This also keeps the function
// backwards compatible: an event object with no gameType field is
// unaffected by this check.
export function isGameDayWindowNow(eventsIndex, now = new Date(), watchDates = []) {
  const hour = getHelsinkiHour(now);
  const today = toHelsinkiDateString(now);

  const isGameDayEvening =
    hour >= GAME_DAY_START_HOUR &&
    hour < GAME_DAY_END_HOUR &&
    eventsIndex.some(
      (event) =>
        event.status === "upcoming" &&
        event.gameType !== "kausikortti" &&
        toHelsinkiDateString(event.start) === today
    );

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
