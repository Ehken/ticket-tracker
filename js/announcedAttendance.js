// The announced-attendance comparison: liiga.fi's published spectator count
// for a played game against the ticket count we observed in the shop.
//
// WHAT THE TWO NUMBERS ARE. Ours is sold tickets (see js/dashboardHero.js).
// Liiga's is the club's published figure, which counts a season-ticket holder
// as present whether or not they attend — so it is NOT a turnstile count
// either. Their difference is a difference between two counting methods, not
// no-shows, and no string in this codebase may call it attendance. The UI
// says "ilmoitettu yleisö" and nothing stronger.
//
// ONE KNOWN COMPONENT OF THE GAP, deliberately not corrected for. The 4976 vs
// 4820 arithmetic in js/card.js's CAPACITY_INFO comment is the same fact seen
// from the other side: the 156 aitio seats are inside our sold count and
// outside Liiga's, so every comparison here carries that game's sold aitiot
// as a constant offset (118 of the 522 in the 2026-09-01 game). Comparing raw
// totals.sold anyway is a deliberate call. Nothing is precluded by it — a
// game's aitiot is re-derivable from latest.json's sections[] at any time, so
// switching would need no change to a stored shape.
//
// TWO SOURCES, MERGED HERE. data/announcedAttendance.json is fetched daily
// and rewritten wholesale; data/attendanceManual.json is hand-entered (the
// CHL games, which liiga.fi's endpoint will never carry) and only ever
// edited by a human. Manual wins on a collision — the same relationship
// overrides.json has with autoclass.json in mergeClassification
// (js/classify.js). Separate files so that no fetch, however broken, can
// destroy a number nobody can re-derive.
//
// THE JOIN IS ON DATE ALONE. Across 2023-24…2026-27 no two SaiPa home games
// in runkosarja or playoffs share a calendar date, so the Helsinki date is a
// unique key. Opponent names are compared only to RAISE A WARNING on an
// otherwise successful match; they never gate the match. Name matching is
// exactly what silently dropped the Pardubice game in August 2026, and a
// diagnosis that surfaces is worth more than a match that quietly fails.
import { normalizeName, extractOpponent, toHelsinkiDateString } from "../scripts/lib/schedule.js";

// The floor below which a derived season ratio is never published, matching
// MIN_COMPLETED_GAMES in js/dashboardForecast.js for the same reason: one
// game's ratio looks like a fact and is a coincidence.
export const MIN_RATIO_GAMES = 5;

// …and the precision the mean has to reach on top of that floor, as a
// half-width on the ratio (0.03 = ±3 percentage points).
//
// Why a measured gate rather than a chosen game count: the within-season
// coefficient of variation of announced attendance is 22.2% / 17.1% / 11.0%
// across the three seasons in data/attendanceHistory.json. Taken as a (loose)
// upper bound on how noisy the ratio itself can be, the 2σ band on a mean of
// five would be ±15% — wider than the ~13% effect being measured. The ratio
// is in truth far steadier than attendance, because the season-ticket
// baseline barely moves game to game, but by how much cannot be known until
// there are samples. So the gate measures the spread instead of guessing it:
// a steady ratio opens at the floor, a jumpy one waits.
export const MAX_RATIO_HALF_WIDTH = 0.03;

// Two-sided 95% t values by degrees of freedom. Hardcoded because this repo
// has no dependencies and never will; 1.96 (the normal limit) beyond df 29.
const T95 = new Map([
  [1, 12.706], [2, 4.303], [3, 3.182], [4, 2.776], [5, 2.571], [6, 2.447],
  [7, 2.365], [8, 2.306], [9, 2.262], [10, 2.228], [11, 2.201], [12, 2.179],
  [13, 2.16], [14, 2.145], [15, 2.131], [16, 2.12], [17, 2.11], [18, 2.101],
  [19, 2.093], [20, 2.086], [21, 2.08], [22, 2.074], [23, 2.069], [24, 2.064],
  [25, 2.06], [26, 2.056], [27, 2.052], [28, 2.048], [29, 2.045],
]);

function tValue(df) {
  return T95.get(df) ?? 1.96;
}

// fetched: parsed data/announcedAttendance.json ({ games: [...] }) or null.
// manual:  parsed data/attendanceManual.json (a flat array) or null.
// Returns a Map keyed by Helsinki date string. A manual entry replaces a
// fetched one for the same date, and a fetch that returns nothing therefore
// cannot remove a manual entry — the two are never in the same file.
export function mergeAnnounced({ fetched, manual } = {}) {
  const byDate = new Map();

  for (const game of fetched?.games ?? []) {
    if (!game?.date || !Number.isFinite(game.attendance)) continue;
    byDate.set(game.date, {
      date: game.date,
      opponent: game.opponent ?? null,
      attendance: game.attendance,
      source: fetched.source ?? "liiga.fi",
      origin: "liiga",
    });
  }

  for (const entry of manual ?? []) {
    if (!entry?.date || !Number.isFinite(entry.attendance)) continue;
    byDate.set(entry.date, {
      date: entry.date,
      opponent: entry.opponent ?? null,
      attendance: entry.attendance,
      source: entry.source ?? "käsin syötetty",
      origin: "manual",
    });
  }

  return byDate;
}

// A game counts as played when the shop has dropped it (status "past", this
// repo's meaning of played everywhere else — computeAvgAttendancePlayed,
// completedGames, the "Pelattu" tag) OR when an announced figure exists for
// its date, which is itself proof the game happened.
//
// The second half exists because status lags puck drop by a few hours: the
// 2026-09-01 game flipped to "past" at 19:47 for a 15:30 face-off. A bare
// start < now would close that gap but opens a worse one — a listing that
// lingers, or any dataset where a past date is still on sale (?mock=1 has
// nine such games), would show a row claiming to await a figure for a game
// the shop still considers sellable.
function isPlayed(event, announced) {
  return event.status === "past" || announced !== null;
}

function detectNameMismatch(event, announced) {
  if (!announced.opponent) return null;
  const ours = extractOpponent(event.name);
  const theirs = normalizeName(announced.opponent);
  if (ours === null || ours === theirs) return null;
  return { ours: event.name, theirs: announced.opponent };
}

// One row per played match event, oldest first. `events` are merged events
// (js/classify.js) with `latest` attached (js/app.js's attachLatest).
//
// state:
//   "compared"       both numbers exist
//   "awaitingFetch"  liiga.fi covers this fixture; the figure isn't out yet
//   "awaitingManual" a CHL game; it needs a hand-entered row, and that is
//                    the owner's action, not a bug
export function joinAnnouncedToEvents(events, announcedByDate) {
  return events
    .filter((e) => e.gameType !== "kausikortti" && Number.isFinite(e.latest?.totals?.sold))
    .map((event) => ({ event, announced: announcedByDate.get(toHelsinkiDateString(event.start)) ?? null }))
    .filter(({ event, announced }) => isPlayed(event, announced))
    .map(({ event, announced }) => {
      const date = toHelsinkiDateString(event.start);
      const sold = event.latest.totals.sold;

      if (!announced) {
        return {
          event,
          date,
          sold,
          announced: null,
          source: null,
          origin: null,
          difference: null,
          ratio: null,
          nameMismatch: null,
          state: event.gameType === "chl" ? "awaitingManual" : "awaitingFetch",
        };
      }

      return {
        event,
        date,
        sold,
        announced: announced.attendance,
        source: announced.source,
        origin: announced.origin,
        difference: sold - announced.attendance,
        // Per-game ratio is computed for the aggregate below and deliberately
        // never rendered on its own: a single game's ratio moves with walk-ups
        // and weather, and a percentage invites reading n=1 as a rate.
        ratio: sold > 0 ? announced.attendance / sold : null,
        nameMismatch: detectNameMismatch(event, announced),
        state: "compared",
      };
    })
    .sort((a, b) => a.event.start.localeCompare(b.event.start));
}

// Announced figures whose date hits no event we hold. Not necessarily a bug:
// the 2026-08-27 pre-season game against Jukurit was announced at 1438 and was
// never sold through this shop at all. Pass the UNSCOPED event list — an
// entry filtered out by the season picker is not unmatched.
export function findUnmatchedAnnounced(events, announcedByDate) {
  const dates = new Set(events.map((e) => toHelsinkiDateString(e.start)));
  return [...announcedByDate.values()].filter((a) => !dates.has(a.date)).sort((a, b) => a.date.localeCompare(b.date));
}

// The season aggregate: the mean of the per-game ratios, with the honesty
// gate applied. `published` is the only thing a caller may branch on before
// showing a number — `ratio` is present as soon as one game is comparable so
// that tests and diagnostics can see it, and showing it ungated is a lie.
//
// `ratio` is a plain announced/sold number. Applying it forward to an
// upcoming game's sold count needs no change to any stored shape — that use
// is deliberately not built yet.
export function computeAnnouncedRatio(rows) {
  const ratios = rows.filter((r) => r.state === "compared" && Number.isFinite(r.ratio)).map((r) => r.ratio);
  const gameCount = ratios.length;
  if (gameCount === 0) {
    return { ratio: null, gameCount: 0, halfWidth: null, published: false };
  }

  const mean = ratios.reduce((a, b) => a + b, 0) / gameCount;
  if (gameCount === 1) {
    return { ratio: mean, gameCount, halfWidth: null, published: false };
  }

  const variance = ratios.reduce((s, r) => s + (r - mean) ** 2, 0) / (gameCount - 1);
  const halfWidth = tValue(gameCount - 1) * Math.sqrt(variance / gameCount);

  return {
    ratio: mean,
    gameCount,
    halfWidth,
    published: gameCount >= MIN_RATIO_GAMES && halfWidth <= MAX_RATIO_HALF_WIDTH,
  };
}
