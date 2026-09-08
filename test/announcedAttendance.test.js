import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeAnnounced,
  joinAnnouncedToEvents,
  findUnmatchedAnnounced,
  computeAnnouncedRatio,
  MIN_RATIO_GAMES,
} from "../js/announcedAttendance.js";

function ev({ id = "53:611", name = "SaiPa - Tappara", start = "2026-09-01T15:30:00.000Z", gameType = "runkosarja", sold = 3864, status = "past" }) {
  return { id, name, start, gameType, status, latest: { totals: { sold } } };
}

function fetched(games, source = "liiga.fi/api/v2/schedule") {
  return { source, games };
}

test("mergeAnnounced keys fetched games by date", () => {
  const byDate = mergeAnnounced({
    fetched: fetched([{ date: "2026-09-01", opponent: "Tappara", attendance: 3342 }]),
    manual: [],
  });
  assert.equal(byDate.size, 1);
  assert.equal(byDate.get("2026-09-01").attendance, 3342);
  assert.equal(byDate.get("2026-09-01").origin, "liiga");
});

test("mergeAnnounced: a manual entry wins over a fetched one for the same date", () => {
  const byDate = mergeAnnounced({
    fetched: fetched([{ date: "2026-09-01", opponent: "Tappara", attendance: 3342 }]),
    manual: [{ date: "2026-09-01", opponent: "Tappara", attendance: 3400, source: "seura" }],
  });
  assert.equal(byDate.get("2026-09-01").attendance, 3400);
  assert.equal(byDate.get("2026-09-01").origin, "manual");
  assert.equal(byDate.get("2026-09-01").source, "seura");
});

test("mergeAnnounced: a fetch that returns nothing does not erase manual entries", () => {
  const manual = [{ date: "2026-09-10", opponent: "HC Dynamo Pardubice", attendance: 4102, source: "chl.hockey" }];
  assert.equal(mergeAnnounced({ fetched: fetched([]), manual }).get("2026-09-10").attendance, 4102);
  assert.equal(mergeAnnounced({ fetched: null, manual }).get("2026-09-10").attendance, 4102);
  assert.equal(mergeAnnounced({ manual }).get("2026-09-10").attendance, 4102);
});

test("mergeAnnounced skips entries without a usable attendance number", () => {
  const byDate = mergeAnnounced({
    fetched: fetched([
      { date: "2026-09-01", attendance: null },
      { date: "2026-09-15", attendance: 3000 },
    ]),
    manual: [{ date: "2026-09-10", attendance: "4102" }],
  });
  assert.deepEqual([...byDate.keys()], ["2026-09-15"]);
});

test("joinAnnouncedToEvents pairs a played game with its announced figure", () => {
  const byDate = mergeAnnounced({ fetched: fetched([{ date: "2026-09-01", opponent: "Tappara", attendance: 3342 }]) });
  const [row] = joinAnnouncedToEvents([ev({})], byDate);
  assert.equal(row.state, "compared");
  assert.equal(row.sold, 3864);
  assert.equal(row.announced, 3342);
  assert.equal(row.difference, 522);
  assert.ok(Math.abs(row.ratio - 0.8649) < 0.001);
  assert.equal(row.nameMismatch, null);
});

test("joinAnnouncedToEvents matches on date despite a name mismatch, and records the warning", () => {
  const byDate = mergeAnnounced({
    fetched: fetched([{ date: "2026-09-10", opponent: "Dynamo Pardubice", attendance: 4102 }]),
  });
  const event = ev({ id: "53:576", name: "SaiPa - HC Dynamo Pardubice", start: "2026-09-10T16:30:00.000Z", gameType: "chl", sold: 4500 });
  const [row] = joinAnnouncedToEvents([event], byDate);
  assert.equal(row.state, "compared");
  assert.equal(row.announced, 4102);
  assert.deepEqual(row.nameMismatch, { ours: "SaiPa - HC Dynamo Pardubice", theirs: "Dynamo Pardubice" });
});

test("joinAnnouncedToEvents normalizes diacritics before warning about a name", () => {
  const byDate = mergeAnnounced({ fetched: fetched([{ date: "2026-10-14", opponent: "HC Plzeň", attendance: 3900 }]) });
  const event = ev({ id: "53:578", name: "SaiPa - HC Plzen", start: "2026-10-14T16:30:00.000Z", gameType: "chl", sold: 4200 });
  assert.equal(joinAnnouncedToEvents([event], byDate)[0].nameMismatch, null);
});

test("joinAnnouncedToEvents distinguishes awaitingFetch from awaitingManual", () => {
  const liiga = ev({ id: "53:612", name: "SaiPa - JYP", start: "2026-10-08T15:30:00.000Z", gameType: "runkosarja" });
  const chl = ev({ id: "53:576", name: "SaiPa - HC Dynamo Pardubice", start: "2026-09-10T16:30:00.000Z", gameType: "chl" });
  const rows = joinAnnouncedToEvents([liiga, chl], new Map());
  assert.deepEqual(rows.map((r) => [r.event.id, r.state]), [
    ["53:576", "awaitingManual"],
    ["53:612", "awaitingFetch"],
  ]);
  assert.equal(rows[0].announced, null);
  assert.equal(rows[0].difference, null);
});

test("joinAnnouncedToEvents leaves out unplayed games, the kausikortti listing and events with no sold count", () => {
  const events = [
    ev({ id: "53:700", start: "2027-01-01T15:30:00.000Z", status: "upcoming" }),
    { id: "53:575", name: "SaiPa kausikortit 2026-2027", start: "2026-07-31T21:00:00.000Z", gameType: "kausikortti", status: "past", latest: { totals: { sold: 2000 } } },
    { id: "53:701", name: "SaiPa - Ässät", start: "2026-09-23T15:30:00.000Z", gameType: "runkosarja", status: "past", latest: null },
  ];
  assert.deepEqual(joinAnnouncedToEvents(events, new Map()), []);
});

test("joinAnnouncedToEvents includes a still-listed game once its figure is out", () => {
  // Played, but the shop has not dropped the listing yet — status lags puck
  // drop by hours. The announced figure is itself proof the game happened.
  const event = ev({ status: "upcoming" });
  const byDate = mergeAnnounced({ fetched: fetched([{ date: "2026-09-01", opponent: "Tappara", attendance: 3342 }]) });
  const rows = joinAnnouncedToEvents([event], byDate);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "compared");
});

test("joinAnnouncedToEvents leaves out a still-listed game with no figure", () => {
  // A past date that the shop still considers sellable is not evidence the
  // game was played, and must not produce a row claiming to await a figure.
  assert.deepEqual(joinAnnouncedToEvents([ev({ status: "upcoming" })], new Map()), []);
});

test("findUnmatchedAnnounced reports figures for games we never sold", () => {
  const byDate = mergeAnnounced({
    fetched: fetched([
      { date: "2026-08-27", opponent: "Jukurit", attendance: 1438 },
      { date: "2026-09-01", opponent: "Tappara", attendance: 3342 },
    ]),
  });
  const unmatched = findUnmatchedAnnounced([ev({})], byDate);
  assert.deepEqual(unmatched.map((u) => u.date), ["2026-08-27"]);
  assert.equal(unmatched[0].attendance, 1438);
});

function rowsWithRatios(ratios) {
  return ratios.map((ratio, i) => ({
    state: "compared",
    ratio,
    event: { id: `e${i}`, start: `2026-09-${String(i + 1).padStart(2, "0")}T15:30:00.000Z` },
  }));
}

test("computeAnnouncedRatio publishes nothing from a single game", () => {
  const result = computeAnnouncedRatio(rowsWithRatios([0.865]));
  assert.equal(result.gameCount, 1);
  assert.equal(result.published, false);
  assert.equal(result.ratio, 0.865);
});

test("computeAnnouncedRatio publishes nothing below the game floor, however tight the agreement", () => {
  const result = computeAnnouncedRatio(rowsWithRatios([0.87, 0.87, 0.87, 0.87]));
  assert.equal(result.gameCount, MIN_RATIO_GAMES - 1);
  assert.equal(result.halfWidth, 0);
  assert.equal(result.published, false);
});

test("computeAnnouncedRatio publishes when the floor is met and the spread is tight", () => {
  const result = computeAnnouncedRatio(rowsWithRatios([0.86, 0.87, 0.865, 0.875, 0.855]));
  assert.equal(result.gameCount, 5);
  assert.ok(result.halfWidth < 0.03, `halfWidth ${result.halfWidth}`);
  assert.equal(result.published, true);
  assert.ok(Math.abs(result.ratio - 0.865) < 0.001);
});

test("computeAnnouncedRatio withholds a ratio that is too noisy even past the floor", () => {
  const result = computeAnnouncedRatio(rowsWithRatios([0.70, 0.95, 0.80, 1.0, 0.75, 0.99]));
  assert.equal(result.gameCount, 6);
  assert.ok(result.halfWidth > 0.03, `halfWidth ${result.halfWidth}`);
  assert.equal(result.published, false);
});

test("computeAnnouncedRatio ignores rows that have no announced figure", () => {
  const rows = [...rowsWithRatios([0.86, 0.87]), { state: "awaitingFetch", ratio: null }, { state: "awaitingManual", ratio: null }];
  assert.equal(computeAnnouncedRatio(rows).gameCount, 2);
  assert.deepEqual(computeAnnouncedRatio([]), { ratio: null, gameCount: 0, halfWidth: null, published: false });
});
