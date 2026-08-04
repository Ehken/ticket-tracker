import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  deriveSeasonBaseline,
  appendSeasonBaselineHistoryPointIfChanged,
  updateSeasonBaselines,
  MIN_GAMES_FOR_DERIVATION,
  MIN_SLACK_GAMES,
  MAX_TRUSTED_FILL,
} from "../scripts/lib/seasonBaseline.js";

const HASH = "hash-1";

function seats(soldSeatIds, svgHash = HASH) {
  return { svgHash, soldSeatIds };
}

function latestWith(sections, totals = { sold: 500, total: 4976 }) {
  return { sections, totals };
}

// A minimal but realistic shape: two seated sections plus the two
// count-only rows the derivation treats specially.
const KK_SECTIONS = [
  { section: "A1", sold: 3 },
  { section: "C3", sold: 2 },
  { section: "seisomakatsomo", sold: 100 },
  { section: "invalid", sold: 2 },
];

const KK_SEATS = seats(["A1-1-001", "A1-1-002", "A1-1-003", "C3-2-001", "C3-2-002"]);

function game({ sold, standing = 150, wheelchair = 3, svgHash = HASH, totals }) {
  return {
    seats: seats(sold, svgHash),
    latest: latestWith(
      [
        { section: "A1", sold: 99 },
        { section: "C3", sold: 99 },
        { section: "seisomakatsomo", sold: standing },
        { section: "invalid", sold: wheelchair },
      ],
      totals
    ),
  };
}

// A game filled past MAX_TRUSTED_FILL — usable for the map/seat checks but
// contributing no free-capacity evidence.
function fullGame(overrides = {}) {
  return game({ sold: SEASON_SEATS, totals: { sold: 4900, total: 4976 }, ...overrides });
}

// Season seats sold in every game; A1-1-003 and C3-2-002 blocked by a
// single-game purchase (each sold in just one game beyond the listing).
const SEASON_SEATS = ["A1-1-001", "A1-1-002", "C3-2-001"];
function makeGames(count) {
  return Array.from({ length: count }, (_, i) =>
    game({
      sold: i === 0 ? [...SEASON_SEATS, "A1-1-003"] : i === 1 ? [...SEASON_SEATS, "C3-2-002"] : SEASON_SEATS,
      standing: 150 + i,
    })
  );
}

test("deriveSeasonBaseline keeps only seats sold in every usable game", () => {
  const derived = deriveSeasonBaseline({
    kausikorttiSeats: KK_SEATS,
    kausikorttiSections: KK_SECTIONS,
    games: makeGames(MIN_GAMES_FOR_DERIVATION),
  });

  assert.deepEqual(derived.seatIds, ["A1-1-001", "A1-1-002", "C3-2-001"]);
  assert.deepEqual(
    derived.sections.find((r) => r.section === "A1"),
    { section: "A1", sold: 2 }
  );
  assert.deepEqual(
    derived.sections.find((r) => r.section === "C3"),
    { section: "C3", sold: 1 }
  );
  assert.equal(derived.gamesUsed, MIN_GAMES_FOR_DERIVATION);
  assert.equal(derived.svgHash, HASH);
});

test("deriveSeasonBaseline takes the min across games for count-only sections, capped by the listing's own count", () => {
  const games = makeGames(MIN_GAMES_FOR_DERIVATION);
  const derived = deriveSeasonBaseline({
    kausikorttiSeats: KK_SEATS,
    kausikorttiSections: KK_SECTIONS,
    games,
  });

  // min game standing is 150, above nothing — listing says 100, games say
  // >=150, so the listing's own 100 is the cap that wins.
  assert.equal(derived.sections.find((r) => r.section === "seisomakatsomo").sold, 100);

  // A game with LESS standing than the listing pulls the min down.
  const withQuietGame = deriveSeasonBaseline({
    kausikorttiSeats: KK_SEATS,
    kausikorttiSections: KK_SECTIONS,
    games: [...games.slice(0, -1), game({ sold: SEASON_SEATS, standing: 80 })],
  });
  assert.equal(withQuietGame.sections.find((r) => r.section === "seisomakatsomo").sold, 80);
});

test("deriveSeasonBaseline totals follow the history.json convention (seated excludes standing and wheelchair)", () => {
  const derived = deriveSeasonBaseline({
    kausikorttiSeats: KK_SEATS,
    kausikorttiSections: KK_SECTIONS,
    games: makeGames(MIN_GAMES_FOR_DERIVATION),
  });

  // seated 3 (A1: 2, C3: 1) + standing 100 + wheelchair 2
  assert.deepEqual(derived.totals, { sold: 105, soldSeated: 3, soldStanding: 100 });
});

test("deriveSeasonBaseline skips games with a mismatched svgHash or missing data instead of zeroing the intersection", () => {
  const games = [
    ...makeGames(MIN_GAMES_FOR_DERIVATION),
    game({ sold: [], svgHash: "other-map" }), // different map generation: ignored
    { seats: null, latest: null }, // failed scrape: ignored
  ];
  const derived = deriveSeasonBaseline({
    kausikorttiSeats: KK_SEATS,
    kausikorttiSections: KK_SECTIONS,
    games,
  });

  assert.equal(derived.gamesUsed, MIN_GAMES_FOR_DERIVATION);
  assert.deepEqual(derived.seatIds, ["A1-1-001", "A1-1-002", "C3-2-001"]);
});

test("deriveSeasonBaseline returns null below the minimum game count or without kausikortti seats", () => {
  assert.equal(
    deriveSeasonBaseline({
      kausikorttiSeats: KK_SEATS,
      kausikorttiSections: KK_SECTIONS,
      games: makeGames(MIN_GAMES_FOR_DERIVATION - 1),
    }),
    null
  );
  assert.equal(
    deriveSeasonBaseline({
      kausikorttiSeats: null,
      kausikorttiSections: KK_SECTIONS,
      games: makeGames(MIN_GAMES_FOR_DERIVATION),
    }),
    null
  );
});

test("deriveSeasonBaseline freezes (returns null) when too few usable games have free capacity", () => {
  // Enough games to pass the MIN_GAMES floor, but all except
  // MIN_SLACK_GAMES - 1 of them are filled past MAX_TRUSTED_FILL: a
  // sellout tail must freeze the derivation, not creep toward capacity.
  const games = [
    ...Array.from({ length: MIN_SLACK_GAMES - 1 }, () => game({ sold: SEASON_SEATS })),
    ...Array.from({ length: MIN_GAMES_FOR_DERIVATION }, () => fullGame()),
  ];
  assert.equal(
    deriveSeasonBaseline({ kausikorttiSeats: KK_SEATS, kausikorttiSections: KK_SECTIONS, games }),
    null
  );
});

test("deriveSeasonBaseline derives with exactly the minimum number of slack games, and full games still count as evidence", () => {
  // MIN_SLACK_GAMES games with slack + full games on top: derivable, and
  // the full games still participate in the intersection (a full game that
  // does NOT include a seat is still proof it isn't a season ticket).
  const slack = Array.from({ length: MIN_SLACK_GAMES }, () =>
    game({ sold: [...SEASON_SEATS, "A1-1-003", "C3-2-002"] })
  );
  const full = Array.from({ length: MIN_GAMES_FOR_DERIVATION }, () => fullGame({ sold: SEASON_SEATS }));
  const derived = deriveSeasonBaseline({
    kausikorttiSeats: KK_SEATS,
    kausikorttiSections: KK_SECTIONS,
    games: [...slack, ...full],
  });

  assert.deepEqual(derived.seatIds, SEASON_SEATS); // extras excluded by the FULL games' sets
  assert.equal(derived.gamesUsed, MIN_SLACK_GAMES + MIN_GAMES_FOR_DERIVATION);
});

test("deriveSeasonBaseline treats a game with missing or zero totals as having no free capacity", () => {
  const noTotals = Array.from({ length: MIN_GAMES_FOR_DERIVATION }, () => {
    const g = game({ sold: SEASON_SEATS });
    delete g.latest.totals;
    return g;
  });
  assert.equal(
    deriveSeasonBaseline({ kausikorttiSeats: KK_SEATS, kausikorttiSections: KK_SECTIONS, games: noTotals }),
    null
  );
});

test("a fill exactly at MAX_TRUSTED_FILL does not count as slack", () => {
  const atThreshold = Array.from({ length: MIN_GAMES_FOR_DERIVATION }, () =>
    game({ sold: SEASON_SEATS, totals: { sold: MAX_TRUSTED_FILL * 1000, total: 1000 } })
  );
  assert.equal(
    deriveSeasonBaseline({ kausikorttiSeats: KK_SEATS, kausikorttiSections: KK_SECTIONS, games: atThreshold }),
    null
  );
});

test("appendSeasonBaselineHistoryPointIfChanged appends only on change, including gamesUsed-only changes", () => {
  const totals = { sold: 105, soldSeated: 3, soldStanding: 100 };
  const first = appendSeasonBaselineHistoryPointIfChanged([], { tISO: "t1", totals, gamesUsed: 30 });
  assert.equal(first.length, 1);

  const unchanged = appendSeasonBaselineHistoryPointIfChanged(first, { tISO: "t2", totals, gamesUsed: 30 });
  assert.equal(unchanged, first);

  const fewerGames = appendSeasonBaselineHistoryPointIfChanged(first, { tISO: "t3", totals, gamesUsed: 29 });
  assert.equal(fewerGames.length, 2);
  assert.equal(fewerGames[1].t, "t3");

  const soldChanged = appendSeasonBaselineHistoryPointIfChanged(first, {
    tISO: "t4",
    totals: { ...totals, sold: 106, soldSeated: 4 },
    gamesUsed: 30,
  });
  assert.equal(soldChanged.length, 2);
});

// --- updateSeasonBaselines against a seeded on-disk data dir ---

async function seedEvent(dataDir, dashId, { seats: seatsJson, latest }) {
  const dir = path.join(dataDir, "events", dashId);
  await mkdir(dir, { recursive: true });
  if (seatsJson) await writeFile(path.join(dir, "seats.json"), JSON.stringify(seatsJson));
  if (latest) await writeFile(path.join(dir, "latest.json"), JSON.stringify(latest));
}

function indexEntry(id, status = "upcoming") {
  return { id, name: id, start: "2026-09-01T15:30:00.000Z", status, firstSeen: "t0", lastSeen: "t1" };
}

const silentLog = { log() {}, warn() {}, error() {} };

async function seedDataDir({ kkStatus = "upcoming", gameStatuses } = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "season-baseline-test-"));
  const statuses = gameStatuses ?? Array.from({ length: MIN_GAMES_FOR_DERIVATION }, () => "upcoming");
  const gameCount = statuses.length;

  const overrides = { "90-000": { gameType: "kausikortti", season: "2026-27" } };
  const autoclass = {};
  const index = [indexEntry("90:000", kkStatus)];

  await seedEvent(dataDir, "90-000", {
    seats: KK_SEATS,
    latest: { sections: KK_SECTIONS, totals: { sold: 107 } },
  });

  const games = makeGames(gameCount);
  statuses.forEach((status, i) => {
    const id = `90:${String(i + 1).padStart(3, "0")}`;
    index.push(indexEntry(id, status));
    autoclass[`90-${String(i + 1).padStart(3, "0")}`] = { gameType: "runkosarja", season: "2026-27" };
  });
  await Promise.all(
    statuses.map((_, i) => seedEvent(dataDir, `90-${String(i + 1).padStart(3, "0")}`, games[i]))
  );

  return { dataDir, index, overrides, autoclass };
}

test("updateSeasonBaselines writes seasonBaseline.json and appends history for an upcoming kausikortti event", async () => {
  const { dataDir, index, overrides, autoclass } = await seedDataDir();

  await updateSeasonBaselines({ dataDir, index, overrides, autoclass, nowISO: "t1", log: silentLog });

  const baseline = JSON.parse(await readFile(path.join(dataDir, "events", "90-000", "seasonBaseline.json"), "utf8"));
  assert.equal(baseline.season, "2026-27");
  assert.deepEqual(baseline.seatIds, ["A1-1-001", "A1-1-002", "C3-2-001"]);
  assert.equal(baseline.totals.sold, 105);

  const history = JSON.parse(
    await readFile(path.join(dataDir, "events", "90-000", "seasonBaselineHistory.json"), "utf8")
  );
  assert.deepEqual(history, [{ t: "t1", sold: 105, soldSeated: 3, soldStanding: 100, gamesUsed: 5 }]);

  // Second run with unchanged data: both files byte-identical (no new point).
  await updateSeasonBaselines({ dataDir, index, overrides, autoclass, nowISO: "t2", log: silentLog });
  const historyAfter = JSON.parse(
    await readFile(path.join(dataDir, "events", "90-000", "seasonBaselineHistory.json"), "utf8")
  );
  assert.deepEqual(historyAfter, history);
});

test("updateSeasonBaselines excludes past games from the intersection", async () => {
  // One extra game so archiving one still leaves MIN_GAMES upcoming; the
  // archived game is the only one NOT selling seat C3-2-001, so including
  // it would wrongly drop that seat from the season set.
  const { dataDir, index, overrides, autoclass } = await seedDataDir({
    gameStatuses: Array.from({ length: MIN_GAMES_FOR_DERIVATION + 1 }, () => "upcoming"),
  });
  const archivedId = `90-${String(MIN_GAMES_FOR_DERIVATION + 1).padStart(3, "0")}`;
  await seedEvent(dataDir, archivedId, game({ sold: ["A1-1-001", "A1-1-002"] }));
  index[index.length - 1] = { ...index[index.length - 1], status: "past" };

  await updateSeasonBaselines({ dataDir, index, overrides, autoclass, nowISO: "t1", log: silentLog });

  const baseline = JSON.parse(await readFile(path.join(dataDir, "events", "90-000", "seasonBaseline.json"), "utf8"));
  assert.ok(baseline.seatIds.includes("C3-2-001"));
  assert.equal(baseline.gamesUsed, MIN_GAMES_FOR_DERIVATION);
});

test("updateSeasonBaselines leaves an existing derived file untouched when derivation is no longer possible", async () => {
  const { dataDir, index, overrides, autoclass } = await seedDataDir();
  await updateSeasonBaselines({ dataDir, index, overrides, autoclass, nowISO: "t1", log: silentLog });
  const before = await readFile(path.join(dataDir, "events", "90-000", "seasonBaseline.json"), "utf8");

  // Season winds down: all games archived → below MIN_GAMES → skip, keep file.
  const archivedIndex = index.map((e) => (e.id === "90:000" ? e : { ...e, status: "past" }));
  await updateSeasonBaselines({
    dataDir,
    index: archivedIndex,
    overrides,
    autoclass,
    nowISO: "t2",
    log: silentLog,
  });

  const after = await readFile(path.join(dataDir, "events", "90-000", "seasonBaseline.json"), "utf8");
  assert.equal(after, before);
});

test("updateSeasonBaselines keeps the last clean derivation when the remaining games sell out", async () => {
  const { dataDir, index, overrides, autoclass } = await seedDataDir();
  await updateSeasonBaselines({ dataDir, index, overrides, autoclass, nowISO: "t1", log: silentLog });
  const before = await readFile(path.join(dataDir, "events", "90-000", "seasonBaseline.json"), "utf8");

  // Every game still upcoming, but now filled past MAX_TRUSTED_FILL — the
  // playoff-race scenario. Without the slack floor, the intersection would
  // keep updating and creep toward full capacity.
  for (let i = 1; i <= MIN_GAMES_FOR_DERIVATION; i++) {
    await seedEvent(dataDir, `90-${String(i).padStart(3, "0")}`, fullGame());
  }
  await updateSeasonBaselines({ dataDir, index, overrides, autoclass, nowISO: "t2", log: silentLog });

  const after = await readFile(path.join(dataDir, "events", "90-000", "seasonBaseline.json"), "utf8");
  assert.equal(after, before);
  const history = JSON.parse(
    await readFile(path.join(dataDir, "events", "90-000", "seasonBaselineHistory.json"), "utf8")
  );
  assert.equal(history.length, 1, "no new history point while frozen");
});

test("updateSeasonBaselines never touches a kausikortti frozen via overrides.json, even when re-derivation would succeed", async () => {
  const { dataDir, index, overrides, autoclass } = await seedDataDir();
  await updateSeasonBaselines({ dataDir, index, overrides, autoclass, nowISO: "t1", log: silentLog });
  const before = await readFile(path.join(dataDir, "events", "90-000", "seasonBaseline.json"), "utf8");

  // A new seat becomes sold in every game — without the pin, the derived
  // set would legitimately grow on the next run.
  for (let i = 1; i <= MIN_GAMES_FOR_DERIVATION; i++) {
    await seedEvent(dataDir, `90-${String(i).padStart(3, "0")}`, game({ sold: [...SEASON_SEATS, "C3-2-002"] }));
  }

  const frozenOverrides = { ...overrides, "90-000": { ...overrides["90-000"], seasonBaselineFrozen: true } };
  await updateSeasonBaselines({
    dataDir,
    index,
    overrides: frozenOverrides,
    autoclass,
    nowISO: "t2",
    log: silentLog,
  });

  const after = await readFile(path.join(dataDir, "events", "90-000", "seasonBaseline.json"), "utf8");
  assert.equal(after, before, "pinned file must stay byte-identical");
  const history = JSON.parse(
    await readFile(path.join(dataDir, "events", "90-000", "seasonBaselineHistory.json"), "utf8")
  );
  assert.equal(history.length, 1, "no new history point while pinned");

  // Removing the flag re-derives on the next run and picks up the growth.
  await updateSeasonBaselines({ dataDir, index, overrides, autoclass, nowISO: "t3", log: silentLog });
  const rederived = JSON.parse(await readFile(path.join(dataDir, "events", "90-000", "seasonBaseline.json"), "utf8"));
  assert.ok(rederived.seatIds.includes("C3-2-002"));
});

test("updateSeasonBaselines skips an archived kausikortti listing entirely", async () => {
  const { dataDir, index, overrides, autoclass } = await seedDataDir({ kkStatus: "past" });

  await updateSeasonBaselines({ dataDir, index, overrides, autoclass, nowISO: "t1", log: silentLog });

  await assert.rejects(() => readFile(path.join(dataDir, "events", "90-000", "seasonBaseline.json"), "utf8"));
});
