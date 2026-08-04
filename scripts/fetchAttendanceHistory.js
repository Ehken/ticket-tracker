// One-off (re-runnable) fetcher for data/attendanceHistory.json — SaiPa's
// home-game attendance for recent completed Liiga seasons, from liiga.fi's
// public JSON API. NOT part of the hourly scrape: run manually with
//
//   node scripts/fetchAttendanceHistory.js
//
// whenever a season completes (or the file needs refreshing), review the
// diff, and commit. The dashboard's forecast module (js/dashboardForecast.js)
// reads the file if present and simply skips its opponent/weekday indices
// when it's absent — nothing else depends on it.
//
// Why /api/v2/schedule and not /api/v2/games: the schedule endpoint returns
// one compact row per game (with a `spectators` field), while games embeds
// full goal events and rosters — megabytes per season for data this script
// throws away.
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "data", "attendanceHistory.json");

// liiga.fi labels a season by its LATTER year: season=2026 is 2025-26.
// Completed seasons only — the running season's own games are already in
// this repo's data and carry more signal (sales trajectories, not just
// final attendance).
const API_SEASONS = [2024, 2025, 2026];
const HOME_TEAM = "SaiPa";

function seasonLabel(apiSeason) {
  return `${apiSeason - 1}-${String(apiSeason % 100).padStart(2, "0")}`;
}

async function fetchSeason(apiSeason) {
  const url = `https://liiga.fi/api/v2/schedule?tournament=runkosarja&season=${apiSeason}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const games = await res.json();

  return games
    .filter(
      (g) =>
        g.homeTeamName === HOME_TEAM &&
        g.ended === true &&
        Number.isFinite(g.spectators) &&
        g.spectators > 0
    )
    .map((g) => ({
      season: seasonLabel(apiSeason),
      start: g.start, // ISO; weekday is derived by the consumer in Helsinki time
      opponent: g.awayTeamName,
      attendance: g.spectators,
    }));
}

async function main() {
  const all = [];
  for (const apiSeason of API_SEASONS) {
    const games = await fetchSeason(apiSeason);
    console.log(`[attendanceHistory] season ${seasonLabel(apiSeason)}: ${games.length} SaiPa home games`);
    all.push(...games);
  }

  if (all.length === 0) {
    throw new Error("No games found — API shape may have changed; not writing an empty file.");
  }

  all.sort((a, b) => a.start.localeCompare(b.start));
  const out = {
    source: "liiga.fi/api/v2/schedule (runkosarja, kotiottelut, ilmoitetut yleisömäärät)",
    fetchedAt: new Date().toISOString(),
    games: all,
  };
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(`[attendanceHistory] wrote ${all.length} games to ${path.relative(process.cwd(), OUT_PATH)}`);
}

main().catch((err) => {
  console.error(`[attendanceHistory] FAILED: ${err.message}`);
  process.exit(1);
});
