import { test } from "node:test";
import assert from "node:assert/strict";
import { computeUnclassifiedEvents } from "../js/dashboardUnclassified.js";

function ev({ id, name, gameType, start = "2026-10-08T17:30:00.000Z" }) {
  return { id, name, gameType, start };
}

test("computeUnclassifiedEvents keeps only gameType 'muu' events", () => {
  const events = [
    ev({ id: "1", name: "SaiPa - JYP", gameType: "runkosarja" }),
    ev({ id: "2", name: "SaiPa - Yllätysvastustaja", gameType: "muu" }),
  ];
  const result = computeUnclassifiedEvents(events, []);
  assert.equal(result.length, 1);
  assert.equal(result[0].event.id, "2");
});

test("computeUnclassifiedEvents attaches both near-miss candidate lists per event", () => {
  const events = [ev({ id: "1", name: "SaiPa - JYP", gameType: "muu" })];
  const schedule = [
    { date: "2026-10-08", opponent: "Jukurit", gameType: "runkosarja", season: "2026-27" },
    { date: "2026-10-15", opponent: "JYP", gameType: "runkosarja", season: "2026-27" },
  ];
  const result = computeUnclassifiedEvents(events, schedule);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].sameDateDifferentOpponent, [schedule[0]]);
  assert.deepEqual(result[0].sameOpponentDifferentDate, [schedule[1]]);
});

test("computeUnclassifiedEvents returns an empty list when nothing is unclassified", () => {
  const events = [ev({ id: "1", name: "SaiPa - JYP", gameType: "runkosarja" })];
  assert.deepEqual(computeUnclassifiedEvents(events, []), []);
});

test("computeUnclassifiedEvents: an event that isn't a schedule.json fixture at all gets empty candidate lists", () => {
  const events = [ev({ id: "1", name: "SaiPa - Yllätysvastustaja", gameType: "muu", start: "2026-12-15T17:00:00.000Z" })];
  const schedule = [{ date: "2026-10-08", opponent: "JYP", gameType: "runkosarja", season: "2026-27" }];
  const result = computeUnclassifiedEvents(events, schedule);
  assert.deepEqual(result[0].sameDateDifferentOpponent, []);
  assert.deepEqual(result[0].sameOpponentDifferentDate, []);
});
