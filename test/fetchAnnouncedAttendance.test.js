import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { run, apiSeasonFromLabel, latestSeasonLabel, extractHomeGames } from "../scripts/fetchAnnouncedAttendance.js";

const silentLog = { log() {}, warn() {}, error() {} };
const NOW = () => new Date("2026-09-08T06:40:00.000Z");

async function seedDataDir({ schedule = [{ date: "2026-09-01", opponent: "Tappara", gameType: "runkosarja", season: "2026-27" }], announced } = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "announced-test-"));
  await writeFile(path.join(dataDir, "schedule.json"), JSON.stringify(schedule, null, 2) + "\n");
  if (announced !== undefined) {
    await writeFile(path.join(dataDir, "announcedAttendance.json"), JSON.stringify(announced, null, 2) + "\n");
  }
  return dataDir;
}

async function readOut(dataDir) {
  return JSON.parse(await readFile(path.join(dataDir, "announcedAttendance.json"), "utf8"));
}

function game({ home = "SaiPa", away = "Tappara", start = "2026-09-01T15:30:00Z", spectators = 3342, ended = true }) {
  return { homeTeamName: home, awayTeamName: away, start, spectators, ended };
}

// Answers every tournament with its own list; anything unexpected throws, so
// an unstubbed URL fails loudly rather than reaching the network.
function httpClientFor(byTournament) {
  return {
    fetchWithRetry: async (url) => {
      const tournament = new URL(url).searchParams.get("tournament");
      if (!(tournament in byTournament)) throw new Error(`unexpected fetch: ${url}`);
      const answer = byTournament[tournament];
      if (answer instanceof Error) throw answer;
      return { json: async () => answer };
    },
  };
}

const ALL_EMPTY = { runkosarja: [], playoffs: [], playout: [], valmistavat_ottelut: [] };

test("apiSeasonFromLabel inverts the season label", () => {
  assert.equal(apiSeasonFromLabel("2026-27"), 2027);
  assert.equal(apiSeasonFromLabel("2025-26"), 2026);
  assert.throws(() => apiSeasonFromLabel("2026"), /Unrecognised season label/);
  assert.throws(() => apiSeasonFromLabel(undefined), /Unrecognised season label/);
});

test("latestSeasonLabel takes the newest season in schedule.json", () => {
  assert.equal(latestSeasonLabel([{ season: "2025-26" }, { season: "2026-27" }, { season: "2025-26" }]), "2026-27");
  assert.throws(() => latestSeasonLabel([]), /no season labels/);
});

test("extractHomeGames keeps only played SaiPa home games with a real crowd", () => {
  const rows = extractHomeGames(
    [
      game({}),
      game({ home: "TPS", away: "SaiPa" }),
      game({ away: "JYP", start: "2026-09-15T15:30:00Z", ended: false, spectators: null }),
      game({ away: "K-Espoo", start: "2025-08-09T12:00:00Z", spectators: 0 }),
    ],
    { season: "2026-27", tournament: "runkosarja" }
  );
  assert.deepEqual(rows, [
    {
      date: "2026-09-01",
      start: "2026-09-01T15:30:00Z",
      opponent: "Tappara",
      tournament: "runkosarja",
      attendance: 3342,
      season: "2026-27",
    },
  ]);
});

test("run() unions all four tournaments and derives the season from schedule.json", async () => {
  const dataDir = await seedDataDir();
  const seen = [];
  const httpClient = {
    fetchWithRetry: async (url) => {
      seen.push(url);
      const tournament = new URL(url).searchParams.get("tournament");
      return {
        json: async () =>
          tournament === "runkosarja"
            ? [game({})]
            : tournament === "playoffs"
              ? [game({ away: "Ässät", start: "2027-03-28T15:00:00Z", spectators: 4750 })]
              : [],
      };
    },
  };

  const result = await run({ dataDir, httpClient, now: NOW, log: silentLog });

  assert.deepEqual(seen.map((u) => new URL(u).searchParams.get("tournament")), [
    "runkosarja",
    "playoffs",
    "playout",
    "valmistavat_ottelut",
  ]);
  assert.ok(seen.every((u) => u.includes("season=2027")), seen[0]);
  assert.equal(result.season, "2026-27");

  const out = await readOut(dataDir);
  assert.deepEqual(out.games.map((g) => [g.date, g.tournament, g.attendance]), [
    ["2026-09-01", "runkosarja", 3342],
    ["2027-03-28", "playoffs", 4750],
  ]);
  assert.equal(out.season, "2026-27");
  assert.equal(out.fetchedAt, "2026-09-08T06:40:00.000Z");
});

test("run() survives one tournament failing and still records the others", async () => {
  const dataDir = await seedDataDir();
  const httpClient = httpClientFor({
    runkosarja: [game({})],
    playoffs: new Error("HTTP 500"),
    playout: [],
    valmistavat_ottelut: [],
  });

  await run({ dataDir, httpClient, now: NOW, log: silentLog });
  assert.equal((await readOut(dataDir)).games.length, 1);
});

test("run() throws and writes nothing when no tournament returns a usable array", async () => {
  const dataDir = await seedDataDir();
  const httpClient = httpClientFor({
    runkosarja: new Error("ETIMEDOUT"),
    playoffs: new Error("ETIMEDOUT"),
    playout: { error: "gone" },
    valmistavat_ottelut: new Error("ETIMEDOUT"),
  });

  await assert.rejects(run({ dataDir, httpClient, now: NOW, log: silentLog }), /API shape may have changed/);
  await assert.rejects(readFile(path.join(dataDir, "announcedAttendance.json"), "utf8"), { code: "ENOENT" });
});

test("run() writes a legitimately empty file before the season's first game", async () => {
  const dataDir = await seedDataDir();
  await run({ dataDir, httpClient: httpClientFor(ALL_EMPTY), now: NOW, log: silentLog });
  assert.deepEqual((await readOut(dataDir)).games, []);
});

test("run() refuses to erase recorded games with an empty result", async () => {
  const prior = {
    source: "liiga.fi/api/v2/schedule",
    season: "2026-27",
    fetchedAt: "2026-09-07T06:40:00.000Z",
    games: [{ date: "2026-09-01", start: "2026-09-01T15:30:00Z", opponent: "Tappara", tournament: "runkosarja", attendance: 3342, season: "2026-27" }],
  };
  const dataDir = await seedDataDir({ announced: prior });

  await assert.rejects(
    run({ dataDir, httpClient: httpClientFor(ALL_EMPTY), now: NOW, log: silentLog }),
    /Refusing to overwrite/
  );
  assert.deepEqual(await readOut(dataDir), prior);
});

test("run() leaves fetchedAt alone when the games have not changed", async () => {
  const dataDir = await seedDataDir();
  const httpClient = httpClientFor({ ...ALL_EMPTY, runkosarja: [game({})] });

  await run({ dataDir, httpClient, now: NOW, log: silentLog });
  const first = await readOut(dataDir);

  const later = await run({ dataDir, httpClient, now: () => new Date("2026-09-09T06:40:00.000Z"), log: silentLog });
  assert.equal(later.changed, false);
  assert.equal((await readOut(dataDir)).fetchedAt, first.fetchedAt);
});

test("run() never touches attendanceHistory.json or attendanceManual.json", async () => {
  const dataDir = await seedDataDir();
  const manual = [{ date: "2026-09-10", opponent: "HC Dynamo Pardubice", season: "2026-27", attendance: 4102, source: "chl.hockey" }];
  await writeFile(path.join(dataDir, "attendanceManual.json"), JSON.stringify(manual, null, 2) + "\n");
  await writeFile(path.join(dataDir, "attendanceHistory.json"), JSON.stringify({ games: [] }, null, 2) + "\n");

  await run({ dataDir, httpClient: httpClientFor({ ...ALL_EMPTY, runkosarja: [game({})] }), now: NOW, log: silentLog });

  assert.deepEqual(JSON.parse(await readFile(path.join(dataDir, "attendanceManual.json"), "utf8")), manual);
  assert.deepEqual(JSON.parse(await readFile(path.join(dataDir, "attendanceHistory.json"), "utf8")), { games: [] });
});
