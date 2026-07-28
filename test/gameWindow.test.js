import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getHelsinkiHour, isGameDayWindowNow, warnOnPastWatchDates } from "../scripts/lib/gameWindow.js";
import { decide } from "../scripts/checkGameWindow.js";

const UPCOMING_JYP_OCT8 = [
  { id: "53:601", status: "upcoming", start: "2026-10-08T17:30:00.000Z" },
];

test("getHelsinkiHour returns the local Helsinki hour (DST-aware)", () => {
  assert.equal(getHelsinkiHour(new Date("2026-10-08T14:00:00.000Z")), 17); // UTC+3 in October
  assert.equal(getHelsinkiHour(new Date("2027-01-16T15:00:00.000Z")), 17); // UTC+2 in January
});

test("isGameDayWindowNow is true when in-window (15-21 Helsinki) and an upcoming event starts today", () => {
  const now = new Date("2026-10-08T14:00:00.000Z"); // 17:00 Helsinki, 2026-10-08
  assert.equal(isGameDayWindowNow(UPCOMING_JYP_OCT8, now), true);
});

test("isGameDayWindowNow is false when in-window but no upcoming event matches today", () => {
  const now = new Date("2026-10-08T14:00:00.000Z"); // 17:00 Helsinki
  assert.equal(isGameDayWindowNow([], now), false);

  const wrongDate = [{ id: "53:602", status: "upcoming", start: "2026-10-09T17:30:00.000Z" }];
  assert.equal(isGameDayWindowNow(wrongDate, now), false);
});

test("isGameDayWindowNow is false when it's a game day but outside the hour window", () => {
  const now = new Date("2026-10-08T07:00:00.000Z"); // 10:00 Helsinki — before 15:00
  assert.equal(isGameDayWindowNow(UPCOMING_JYP_OCT8, now), false);
});

test("isGameDayWindowNow ignores non-'upcoming' events (e.g. already archived to past)", () => {
  const past = [{ id: "53:601", status: "past", start: "2026-10-08T17:30:00.000Z" }];
  const now = new Date("2026-10-08T14:00:00.000Z");
  assert.equal(isGameDayWindowNow(past, now), false);
});

test("isGameDayWindowNow boundary: exactly 15:00 Helsinki is inside the window (inclusive)", () => {
  const now = new Date("2026-10-08T12:00:00.000Z"); // 15:00 Helsinki exactly
  assert.equal(isGameDayWindowNow(UPCOMING_JYP_OCT8, now), true);
});

test("isGameDayWindowNow boundary: exactly 21:00 Helsinki is outside the window (exclusive)", () => {
  const now = new Date("2026-10-08T18:00:00.000Z"); // 21:00 Helsinki exactly
  assert.equal(isGameDayWindowNow(UPCOMING_JYP_OCT8, now), false);
});

test("isGameDayWindowNow near-midnight DST case: Helsinki date has already rolled to the next day", () => {
  // Same timestamp as the DST boundary case in test/schedule.test.js:
  // 2026-10-08T22:30:00.000Z is 2026-10-09 01:30 in Helsinki (UTC+3, DST still active).
  // Hour is 01 (well outside 15-21), so this is false regardless of which date an
  // event is on — but it still exercises the same Helsinki hour/date computation.
  const now = new Date("2026-10-08T22:30:00.000Z");
  assert.equal(getHelsinkiHour(now), 1);
  const eventOnRolledOverDate = [{ id: "53:603", status: "upcoming", start: "2026-10-09T17:00:00.000Z" }];
  assert.equal(isGameDayWindowNow(eventOnRolledOverDate, now), false);
});

test("isGameDayWindowNow excludes a kausikortti-classified event even when its start falls on today", () => {
  // A real case: 53:575's start is its sales-window boundary
  // (2026-07-31T21:00:00Z = 2026-08-01 00:00 Helsinki), not a puck drop.
  const now = new Date("2026-08-01T12:00:00.000Z"); // 15:00 Helsinki
  const kausikortti = [{ id: "53:575", status: "upcoming", start: "2026-07-31T21:00:00.000Z", gameType: "kausikortti" }];
  assert.equal(isGameDayWindowNow(kausikortti, now), false);
});

test("isGameDayWindowNow: the same event classified as a real game type still opens the window", () => {
  const now = new Date("2026-08-01T12:00:00.000Z");
  const runkosarja = [{ id: "53:575", status: "upcoming", start: "2026-07-31T21:00:00.000Z", gameType: "runkosarja" }];
  assert.equal(isGameDayWindowNow(runkosarja, now), true);
});

test("isGameDayWindowNow: an event with no gameType at all still opens the window (unclassified, or a plain unmerged index)", () => {
  const now = new Date("2026-08-01T12:00:00.000Z");
  const unclassified = [{ id: "53:575", status: "upcoming", start: "2026-07-31T21:00:00.000Z" }];
  assert.equal(isGameDayWindowNow(unclassified, now), true);
});

test("isGameDayWindowNow: a watch date still opens the window on its own, even alongside a kausikortti-only event list", () => {
  const now = new Date("2026-08-01T06:00:00.000Z"); // 09:00 Helsinki — inside the default watch window
  const kausikortti = [{ id: "53:575", status: "upcoming", start: "2026-07-31T21:00:00.000Z", gameType: "kausikortti" }];
  const watchDates = [{ date: "2026-08-01" }];
  assert.equal(isGameDayWindowNow(kausikortti, now, watchDates), true);
});

test("isGameDayWindowNow is true for a matching watch date within its default window (8-20 Helsinki)", () => {
  const watchDates = [{ date: "2026-08-03" }];
  const now = new Date("2026-08-03T06:00:00.000Z"); // 09:00 Helsinki (UTC+3 in August)
  assert.equal(isGameDayWindowNow([], now, watchDates), true);
});

test("isGameDayWindowNow is false for an unrelated date, even inside the default watch window's hours", () => {
  const watchDates = [{ date: "2026-08-03" }];
  const now = new Date("2026-08-04T06:00:00.000Z"); // same hour, wrong date
  assert.equal(isGameDayWindowNow([], now, watchDates), false);
});

test("isGameDayWindowNow is false for a watch date outside its default window's hours", () => {
  const watchDates = [{ date: "2026-08-03" }];
  const tooEarly = new Date("2026-08-03T04:00:00.000Z"); // 07:00 Helsinki — before the 8-20 default
  const tooLate = new Date("2026-08-03T18:00:00.000Z"); // 21:00 Helsinki — after the 8-20 default
  assert.equal(isGameDayWindowNow([], tooEarly, watchDates), false);
  assert.equal(isGameDayWindowNow([], tooLate, watchDates), false);
});

test("isGameDayWindowNow respects a watch date entry's own startHour/endHour override", () => {
  const watchDates = [{ date: "2026-08-03", startHour: 6, endHour: 9 }];
  const insideCustomWindow = new Date("2026-08-03T04:30:00.000Z"); // 07:30 Helsinki
  const outsideDefaultButInsideCustom = insideCustomWindow;
  assert.equal(isGameDayWindowNow([], outsideDefaultButInsideCustom, watchDates), true);

  const afterCustomWindowButInsideDefault = new Date("2026-08-03T07:00:00.000Z"); // 10:00 Helsinki
  assert.equal(isGameDayWindowNow([], afterCustomWindowButInsideDefault, watchDates), false);
});

test("isGameDayWindowNow: a watch date and the evening game-day window combine with OR, not AND", () => {
  // A watch date's own window doesn't need an upcoming event, and an
  // upcoming event's evening window doesn't need a watch date entry.
  const watchDates = [{ date: "2026-08-03" }];
  const watchDateMorning = new Date("2026-08-03T06:00:00.000Z"); // 09:00 Helsinki, no events at all
  assert.equal(isGameDayWindowNow([], watchDateMorning, watchDates), true);

  const gameDayEvening = new Date("2026-10-08T14:00:00.000Z"); // 17:00 Helsinki, no watch dates at all
  assert.equal(isGameDayWindowNow(UPCOMING_JYP_OCT8, gameDayEvening, []), true);
});

test("warnOnPastWatchDates warns naming every stale entry, and only stale entries", () => {
  const watchDates = [{ date: "2026-07-01" }, { date: "2026-08-03" }];
  const warnings = [];
  warnOnPastWatchDates(watchDates, new Date("2026-08-03T06:00:00.000Z"), { warn: (msg) => warnings.push(msg) });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /2026-07-01/);
  assert.doesNotMatch(warnings[0], /2026-08-03/);
});

test("warnOnPastWatchDates does not warn when no entry is in the past", () => {
  const watchDates = [{ date: "2026-08-03" }];
  const warnings = [];
  warnOnPastWatchDates(watchDates, new Date("2026-08-03T06:00:00.000Z"), { warn: (msg) => warnings.push(msg) });
  assert.equal(warnings.length, 0);
});

async function seedDataDir(index) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "gamewindow-test-"));
  await writeFile(path.join(dataDir, "events.json"), JSON.stringify(index, null, 2) + "\n");
  return dataDir;
}

async function seedWatchDates(dataDir, watchDates) {
  await writeFile(path.join(dataDir, "watchDates.json"), JSON.stringify(watchDates, null, 2) + "\n");
}

async function seedClassification(dataDir, { autoclass = {}, overrides = {} } = {}) {
  await writeFile(path.join(dataDir, "autoclass.json"), JSON.stringify(autoclass, null, 2) + "\n");
  await writeFile(path.join(dataDir, "overrides.json"), JSON.stringify(overrides, null, 2) + "\n");
}

test("decide() returns the literal string 'proceed' for an in-window game day", async () => {
  const dataDir = await seedDataDir(UPCOMING_JYP_OCT8);
  const result = await decide(dataDir, new Date("2026-10-08T14:00:00.000Z")); // 17:00 Helsinki
  assert.equal(result, "proceed");
});

test("decide() returns the literal string 'skip' outside the window or on a non-game day", async () => {
  const dataDirNoEvents = await seedDataDir([]);
  assert.equal(await decide(dataDirNoEvents, new Date("2026-10-08T14:00:00.000Z")), "skip");

  const dataDirGameDay = await seedDataDir(UPCOMING_JYP_OCT8);
  assert.equal(await decide(dataDirGameDay, new Date("2026-10-08T07:00:00.000Z")), "skip"); // 10:00 Helsinki
});

test("decide() merges classification and skips a kausikortti event's sales-window boundary date", async () => {
  const kausikorttiEvent = [
    { id: "53:575", status: "upcoming", start: "2026-07-31T21:00:00.000Z", firstSeen: "x", lastSeen: "x" },
  ];
  const dataDir = await seedDataDir(kausikorttiEvent);
  await seedClassification(dataDir, { autoclass: { "53-575": { gameType: "kausikortti", season: "2026-27" } } });

  const result = await decide(dataDir, new Date("2026-08-01T12:00:00.000Z")); // 15:00 Helsinki
  assert.equal(result, "skip");
});

test("decide() still proceeds for an unclassified event on the same date/hour (classification hasn't caught up yet)", async () => {
  const unclassifiedEvent = [
    { id: "53:575", status: "upcoming", start: "2026-07-31T21:00:00.000Z", firstSeen: "x", lastSeen: "x" },
  ];
  const dataDir = await seedDataDir(unclassifiedEvent);
  await seedClassification(dataDir); // no autoclass/overrides entry at all

  const result = await decide(dataDir, new Date("2026-08-01T12:00:00.000Z"));
  assert.equal(result, "proceed");
});

test("decide() proceeds for the same event once overrides.json reclassifies it as a real game type", async () => {
  const event = [{ id: "53:575", status: "upcoming", start: "2026-07-31T21:00:00.000Z", firstSeen: "x", lastSeen: "x" }];
  const dataDir = await seedDataDir(event);
  await seedClassification(dataDir, { overrides: { "53-575": { gameType: "harjoitusottelu" } } });

  const result = await decide(dataDir, new Date("2026-08-01T12:00:00.000Z"));
  assert.equal(result, "proceed");
});

test("decide() treats a missing events.json as no events (skip), rather than throwing", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "gamewindow-test-empty-"));
  const result = await decide(dataDir, new Date("2026-10-08T14:00:00.000Z"));
  assert.equal(result, "skip");
});

test("decide() proceeds on a watch date with no upcoming events at all", async () => {
  const dataDir = await seedDataDir([]);
  await seedWatchDates(dataDir, [{ date: "2026-08-03" }]);
  const result = await decide(dataDir, new Date("2026-08-03T06:00:00.000Z")); // 09:00 Helsinki
  assert.equal(result, "proceed");
});

test("decide() treats a missing watchDates.json as no watch dates (skip on a non-game day), rather than throwing", async () => {
  const dataDir = await seedDataDir([]);
  const result = await decide(dataDir, new Date("2026-08-03T06:00:00.000Z"));
  assert.equal(result, "skip");
});

test("decide() warns via the passed-in logger when watchDates.json has a stale entry", async () => {
  const dataDir = await seedDataDir([]);
  await seedWatchDates(dataDir, [{ date: "2026-07-01" }, { date: "2026-08-03" }]);
  const warnings = [];
  await decide(dataDir, new Date("2026-08-03T06:00:00.000Z"), { warn: (msg) => warnings.push(msg) });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /2026-07-01/);
});
