import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getHelsinkiHour, isGameDayWindowNow } from "../scripts/lib/gameWindow.js";
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

async function seedDataDir(index) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "gamewindow-test-"));
  await writeFile(path.join(dataDir, "events.json"), JSON.stringify(index, null, 2) + "\n");
  return dataDir;
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

test("decide() treats a missing events.json as no events (skip), rather than throwing", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "gamewindow-test-empty-"));
  const result = await decide(dataDir, new Date("2026-10-08T14:00:00.000Z"));
  assert.equal(result, "skip");
});
