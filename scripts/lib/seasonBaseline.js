import {
  eventDirId,
  latestPath,
  seatsPath,
  seasonBaselinePath,
  seasonBaselineHistoryPath,
  readJson,
  writeJsonIfChanged,
} from "./dataStore.js";

// Sections with no per-seat granularity in the shop's usages payload —
// mirrors AGGREGATE_SECTIONS in sections.js (kept in sync by the
// aggregate-section test in test/seasonBaseline.test.js rather than a
// cross-import, so this module stays loadable without pulling in the
// scraper's HTML-parsing dependencies).
const COUNT_ONLY_SECTIONS = new Set(["seisomakatsomo", "invalid", "press", "aitiot"]);

// Below this many usable games, the intersection stops being evidence: with
// only a couple of games on sale, a seat bought as a single ticket to each
// of them is indistinguishable from a season ticket. When the season winds
// down and upcoming games drop under this floor, the caller keeps the last
// derived file on disk instead of writing a worse one (updateSeasonBaselines
// simply skips the write), so the display degrades to "frozen at the last
// trustworthy derivation" rather than snapping back to the contaminated raw
// count.
export const MIN_GAMES_FOR_DERIVATION = 5;

// A second, independent freeze condition on the same principle. The
// intersection's evidence that a seat is NOT a season ticket is "unsold in
// at least one upcoming game" — evidence that only exists while some
// upcoming game has real free capacity. Game count alone doesn't capture
// that: eight remaining games that have all pre-sold out (a playoff race)
// would pass the MIN_GAMES floor while the intersection creeps toward
// full capacity, ending the season claiming every seat in the arena is a
// season ticket. So the derivation also requires at least
// MIN_SLACK_GAMES usable games below MAX_TRUSTED_FILL total fill; when
// the season gets so hot that fewer remain, the last clean derivation is
// kept (same keep-the-file mechanism as above) — which by then still
// includes every season ticket sold before the freeze, unlike an anchor
// frozen at sales opening. A game with no totals recorded counts as NOT
// slack: missing data must never stand in as evidence of free capacity.
export const MIN_SLACK_GAMES = 3;
export const MAX_TRUSTED_FILL = 0.9;

// The season-ticket listing's own "sold" is NOT a season-ticket count once
// match tickets are on sale: the shop blocks a seat from season-ticket sale
// as soon as any single game sells it, so the listing's number grows with
// single-ticket sales. (Verified on real data 2026-08-03/04: the listing
// grew by ~200 seats in a day while the per-game sold floor stayed flat.)
// What a real season ticket does that a single ticket can't is appear as
// sold in EVERY game of the season — so the true season set is derived as:
//
//   seated:      kausikortti soldSeatIds ∩ soldSeatIds of every usable game
//   count-only:  min(kausikortti sold, min over games of that section's sold)
//
// Both directions of error are conservative: a single-ticket buyer would
// need a ticket to every remaining game to be miscounted as a season ticket,
// and a genuine season ticket bought mid-season still shows in every
// remaining game, so it's still caught. The same holds for count-only
// sections (standing etc.): every game's count = season floor + that game's
// own singles, so the min over games is a tight upper bound on the floor.
//
// A game is usable when it has both seats.json and latest.json AND its
// svgHash matches the kausikortti listing's — the same map-generation guard
// classifySeat's baseline uses; intersecting seat ids across two different
// maps would be meaningless. Games with missing data are skipped rather
// than treated as "nothing sold": skipping only loses exclusion evidence
// (mild overcount), while treating absence as empty would wrongly zero the
// whole intersection.
export function deriveSeasonBaseline({ kausikorttiSeats, kausikorttiSections, games }) {
  if (!kausikorttiSeats || !Array.isArray(kausikorttiSeats.soldSeatIds)) return null;

  const usable = games.filter(
    (g) => g?.seats && Array.isArray(g.seats.soldSeatIds) && g.seats.svgHash === kausikorttiSeats.svgHash && g.latest
  );
  if (usable.length < MIN_GAMES_FOR_DERIVATION) return null;

  const slackGames = usable.filter((g) => {
    const totals = g.latest.totals;
    return totals && totals.total > 0 && totals.sold / totals.total < MAX_TRUSTED_FILL;
  });
  if (slackGames.length < MIN_SLACK_GAMES) return null;

  let seatIds = kausikorttiSeats.soldSeatIds;
  for (const game of usable) {
    const gameSold = new Set(game.seats.soldSeatIds);
    seatIds = seatIds.filter((id) => gameSold.has(id));
    if (seatIds.length === 0) break;
  }

  const seatedBySection = {};
  for (const id of seatIds) {
    const section = id.slice(0, id.indexOf("-"));
    seatedBySection[section] = (seatedBySection[section] ?? 0) + 1;
  }

  const sections = kausikorttiSections.map((row) => {
    if (!COUNT_ONLY_SECTIONS.has(row.section)) {
      return { section: row.section, sold: seatedBySection[row.section] ?? 0 };
    }
    let sold = row.sold;
    for (const game of usable) {
      const gameRow = game.latest.sections.find((r) => r.section === row.section);
      if (gameRow && gameRow.sold < sold) sold = gameRow.sold;
    }
    return { section: row.section, sold };
  });

  const sold = sections.reduce((sum, row) => sum + row.sold, 0);
  const soldStanding = sections.find((r) => r.section === "seisomakatsomo")?.sold ?? 0;
  const wheelchair = sections.find((r) => r.section === "invalid")?.sold ?? 0;

  return {
    svgHash: kausikorttiSeats.svgHash,
    gamesUsed: usable.length,
    seatIds: [...seatIds].sort(),
    sections,
    // Same convention as history.json points (scripts/fetch.js):
    // soldSeated excludes both standing and wheelchair.
    totals: { sold, soldSeated: sold - soldStanding - wheelchair, soldStanding },
  };
}

// Same append-if-changed contract as appendHistoryPointIfChanged
// (dataStore.js), adapted to this series' fields: gamesUsed participates in
// the change gate because a shrinking game pool changes how much the point
// can be trusted, which is worth a data point even at identical sold.
export function appendSeasonBaselineHistoryPointIfChanged(history, { tISO, totals, gamesUsed }) {
  const point = {
    t: tISO,
    sold: totals.sold,
    soldSeated: totals.soldSeated,
    soldStanding: totals.soldStanding,
    gamesUsed,
  };

  if (history.length === 0) return [point];

  const prev = history[history.length - 1];
  const changed =
    prev.sold !== point.sold ||
    prev.soldSeated !== point.soldSeated ||
    prev.soldStanding !== point.soldStanding ||
    prev.gamesUsed !== point.gamesUsed;

  return changed ? [...history, point] : history;
}

function classify(dashId, { overrides, autoclass }) {
  const override = overrides[dashId] ?? {};
  const auto = autoclass[dashId] ?? {};
  return {
    gameType: override.gameType ?? auto.gameType ?? "muu",
    season: override.season ?? auto.season ?? null,
  };
}

// Runs after the per-event scrape loop in scripts/fetch.js, reading what
// that loop just wrote to disk. Only upcoming games participate: a played
// game's seat data is frozen at its last scrape, so a season ticket bought
// mid-season (absent from already-played games) must not be excluded by
// them. Failures never abort the run — this is derived data; the raw files
// it derives from are already safely written.
export async function updateSeasonBaselines({ dataDir, index, overrides, autoclass, nowISO, log = console }) {
  const classified = index.map((entry) => ({ entry, ...classify(eventDirId(entry.id), { overrides, autoclass }) }));

  const kausikorttiEvents = classified.filter((c) => c.gameType === "kausikortti" && c.season != null);
  for (const kk of kausikorttiEvents) {
    try {
      // Manual, human-owned pin (overrides.json is never written by code):
      // with seasonBaselineFrozen set, the derived files on disk are the
      // permanent baseline and this run must not touch them — no rewrite,
      // no history point. The intended workflow is to let the derivation
      // run while its evidence is strong (plenty of games with free
      // capacity), then set this flag to lock the result in for the rest
      // of the season; removing the flag for one scrape re-derives and
      // updates the pinned files.
      if (overrides[eventDirId(kk.entry.id)]?.seasonBaselineFrozen === true) {
        log.log(`[seasonBaseline] ${kk.entry.id}: frozen via overrides.json — leaving existing files untouched`);
        continue;
      }

      if (kk.entry.status !== "upcoming") continue; // archived listing: keep the frozen derived file as-is

      const kausikorttiSeats = await readJson(seatsPath(dataDir, kk.entry.id), null);
      const kausikorttiLatest = await readJson(latestPath(dataDir, kk.entry.id), null);
      if (!kausikorttiSeats || !kausikorttiLatest) continue;

      const gameEntries = classified.filter(
        (c) => c.gameType !== "kausikortti" && c.season === kk.season && c.entry.status === "upcoming"
      );
      const games = await Promise.all(
        gameEntries.map(async (g) => ({
          seats: await readJson(seatsPath(dataDir, g.entry.id), null),
          latest: await readJson(latestPath(dataDir, g.entry.id), null),
        }))
      );

      const derived = deriveSeasonBaseline({
        kausikorttiSeats,
        kausikorttiSections: kausikorttiLatest.sections,
        games,
      });
      if (!derived) {
        log.log(
          `[seasonBaseline] ${kk.entry.id}: not derivable (${games.length} candidate games; needs ` +
            `>=${MIN_GAMES_FOR_DERIVATION} usable, >=${MIN_SLACK_GAMES} below ${MAX_TRUSTED_FILL * 100}% fill) — ` +
            `leaving existing files untouched`
        );
        continue;
      }

      // No timestamp in this file on purpose: writeJsonIfChanged's no-op
      // gate is what keeps quiet scrapes from committing a byte-identical
      // derivation with a fresh "derivedAt" every hour.
      await writeJsonIfChanged(seasonBaselinePath(dataDir, kk.entry.id), {
        season: kk.season,
        svgHash: derived.svgHash,
        gamesUsed: derived.gamesUsed,
        totals: derived.totals,
        sections: derived.sections,
        seatIds: derived.seatIds,
      });

      const history = await readJson(seasonBaselineHistoryPath(dataDir, kk.entry.id), []);
      const updated = appendSeasonBaselineHistoryPointIfChanged(history, {
        tISO: nowISO,
        totals: derived.totals,
        gamesUsed: derived.gamesUsed,
      });
      await writeJsonIfChanged(seasonBaselineHistoryPath(dataDir, kk.entry.id), updated);

      log.log(
        `[seasonBaseline] ${kk.entry.id}: derived sold=${derived.totals.sold} from ${derived.gamesUsed} games ` +
          `(listing reports ${kausikorttiLatest.totals.sold})`
      );
    } catch (err) {
      log.error(`[seasonBaseline] ${kk.entry.id}: FAILED — ${err.message}`);
    }
  }
}
