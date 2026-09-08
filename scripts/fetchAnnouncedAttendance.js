// Daily fetcher for data/announcedAttendance.json — the RUNNING season's
// announced spectator figures from liiga.fi's public JSON API, for comparison
// against our own observed ticket counts (see js/announcedAttendance.js).
//
// Run by .github/workflows/fetch-attendance.yml, once a day. Deliberately NOT
// part of the hourly scrape and never imported by scripts/fetch.js: a liiga.fi
// outage must not be able to cost a ticket-sales sample.
//
// Why a separate file from data/attendanceHistory.json: that one holds
// COMPLETED seasons and feeds the forecast's opponent and weekday indices
// (js/dashboardForecast.js). Folding the running season into it would let the
// model partly forecast itself. It also stays hand-run and diff-reviewed —
// nothing automated may rewrite a model's inputs unattended.
//
// Why /api/v2/schedule and not /api/v2/games: one compact row per game with a
// `spectators` field, instead of megabytes of goal events and rosters.
//
// TOURNAMENT COVERAGE. The endpoint is not runkosarja-only; playoffs, playout
// and pre-season all answer it with real spectator counts. Fetching only
// runkosarja would go silently blind during a home playoff run — several
// games, more than the CHL gap this comparison was built around. CHL is the
// one competition liiga.fi genuinely never carries, and it is covered by the
// hand-maintained data/attendanceManual.json instead.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWithRetry } from "./lib/httpClient.js";
import { readJson, writeJsonIfChanged, schedulePath, announcedAttendancePath } from "./lib/dataStore.js";
import { toHelsinkiDateString } from "./lib/schedule.js";

const TOURNAMENTS = ["runkosarja", "playoffs", "playout", "valmistavat_ottelut"];
const HOME_TEAM = "SaiPa";
const API_BASE = "https://liiga.fi/api/v2/schedule";

// liiga.fi labels a season by its LATTER year: season=2027 is 2026-27. The
// inverse of seasonLabel in scripts/fetchAttendanceHistory.js.
export function apiSeasonFromLabel(label) {
  const match = /^(\d{4})-(\d{2})$/.exec(label ?? "");
  if (!match) throw new Error(`Unrecognised season label: ${JSON.stringify(label)}`);
  return Number(match[1]) + 1;
}

// The running season is whichever one data/schedule.json describes. That file
// is human-owned and gets its new fixtures typed in every summer, so the same
// edit that starts a season also rolls this fetcher over — no annual constant
// to forget, and no date arithmetic guessing where a season boundary falls.
export function latestSeasonLabel(schedule) {
  const labels = schedule.map((row) => row.season).filter(Boolean);
  if (labels.length === 0) throw new Error("data/schedule.json has no season labels — cannot pick a season to fetch.");
  return labels.reduce((a, b) => (b > a ? b : a));
}

export function extractHomeGames(games, { season, tournament }) {
  return games
    .filter(
      (g) =>
        g.homeTeamName === HOME_TEAM &&
        g.ended === true &&
        Number.isFinite(g.spectators) &&
        g.spectators > 0
    )
    .map((g) => ({
      date: toHelsinkiDateString(g.start),
      start: g.start,
      opponent: g.awayTeamName,
      tournament,
      attendance: g.spectators,
      season,
    }));
}

export async function run({
  dataDir,
  httpClient = { fetchWithRetry },
  now = () => new Date(),
  log = console,
} = {}) {
  const schedule = await readJson(schedulePath(dataDir), []);
  const season = latestSeasonLabel(schedule);
  const apiSeason = apiSeasonFromLabel(season);

  const games = [];
  let anyResponded = false;

  for (const tournament of TOURNAMENTS) {
    const url = `${API_BASE}?tournament=${tournament}&season=${apiSeason}`;
    let payload;
    try {
      const res = await httpClient.fetchWithRetry(url, { headers: { accept: "application/json" } });
      payload = await res.json();
    } catch (err) {
      // One tournament failing is survivable — the others still carry games,
      // and the all-failed case is caught below. A hard throw here would let
      // a single 500 on the playout endpoint (which is empty most seasons
      // anyway) wipe out a whole day's runkosarja figures.
      log.warn?.(`[announcedAttendance] ${tournament}: ${err.message}`);
      continue;
    }
    if (!Array.isArray(payload)) {
      log.warn?.(`[announcedAttendance] ${tournament}: expected an array, got ${typeof payload}`);
      continue;
    }
    anyResponded = true;
    const found = extractHomeGames(payload, { season, tournament });
    log.log(`[announcedAttendance] ${tournament} ${season}: ${found.length} played SaiPa home game(s)`);
    games.push(...found);
  }

  // The brief's original guard was "throw rather than write an empty file".
  // Taken literally it fails this job every single day in August, when zero
  // games have legitimately ended yet. So the guard splits in two: an empty
  // RESULT is fine, an empty RESPONSE never is.
  if (!anyResponded) {
    throw new Error("No tournament returned a usable array — API shape may have changed; not writing.");
  }

  const outPath = announcedAttendancePath(dataDir);
  const existing = await readJson(outPath, null);
  // …and mid-season, going from "we had games" to "we have none" is the same
  // shape of lie that assertListingNotSuspiciouslyEmpty guards against in the
  // scraper. A pre-season empty file is written; an empty file that would
  // erase recorded games is refused.
  if (games.length === 0 && (existing?.games?.length ?? 0) > 0) {
    throw new Error(
      `liiga.fi returned no played home games while ${path.basename(outPath)} holds ` +
        `${existing.games.length}. Refusing to overwrite — this looks like a broken fetch.`
    );
  }

  games.sort((a, b) => a.start.localeCompare(b.start));

  // fetchedAt only moves when the games do. This job runs daily and commits
  // to the same branch as the scrape; a timestamp that changed on every run
  // would produce a guaranteed empty commit every day of the off-season,
  // which is the same churn the kuvat/ regeneration gate exists to avoid.
  const unchanged = JSON.stringify(existing?.games ?? null) === JSON.stringify(games);
  const changed = await writeJsonIfChanged(outPath, {
    source: "liiga.fi/api/v2/schedule (kotiottelut, ilmoitetut yleisömäärät)",
    season,
    fetchedAt: unchanged && existing?.fetchedAt ? existing.fetchedAt : now().toISOString(),
    games,
  });
  log.log(`[announcedAttendance] ${games.length} game(s), ${changed ? "written" : "unchanged"}`);
  return { season, games, changed };
}

async function main() {
  const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
  await run({ dataDir });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[announcedAttendance] FAILED: ${err.message}`);
    process.exit(1);
  });
}
