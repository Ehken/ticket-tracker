import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  normalizeName,
  extractOpponent,
  toHelsinkiDateString,
  findScheduleMatch,
  findNearMissCandidates,
} from "../scripts/lib/schedule.js";

test("normalizeName is case, whitespace, and hyphen-variant tolerant", () => {
  assert.equal(normalizeName("Tappara"), normalizeName("TAPPARA"));
  assert.equal(normalizeName("K-Espoo"), normalizeName("k-espoo"));
  assert.equal(normalizeName("SaiPa–Tappara"), normalizeName("SaiPa-Tappara")); // en dash
  assert.equal(normalizeName("SaiPa—Tappara"), normalizeName("SaiPa-Tappara")); // em dash
  // extractOpponent (not normalizeName) is what has to tolerate spacing around the hyphen:
  assert.equal(extractOpponent("SaiPa   -   Tappara"), extractOpponent("SaiPa-Tappara"));
});

test("normalizeName is diacritic-insensitive", () => {
  assert.equal(normalizeName("HC Plzeň"), normalizeName("HC Plzen"));
  assert.equal(normalizeName("HC Plzeň"), "hc plzen");
  assert.equal(normalizeName("Ässät"), normalizeName("Assat"));
});

test("extractOpponent parses 'SaiPa - X' tolerantly", () => {
  assert.equal(extractOpponent("SaiPa - Tappara"), "tappara");
  assert.equal(extractOpponent("SaiPa-Tappara"), "tappara");
  assert.equal(extractOpponent("saipa   -   TAPPARA"), "tappara");
  assert.equal(extractOpponent("SaiPa – Dynamo Pardubice"), "dynamo pardubice");
});

test("extractOpponent returns null for names that aren't 'SaiPa - X'", () => {
  assert.equal(extractOpponent("SaiPa kausikortit 2026-2027"), null);
  assert.equal(extractOpponent("Jokin muu tapahtuma"), null);
});

test("toHelsinkiDateString ignores time-of-day and converts to Europe/Helsinki calendar date", () => {
  assert.equal(toHelsinkiDateString("2026-10-08T17:30:00.000Z"), "2026-10-08");
  // 2026-10-08T22:30:00Z is already 2026-10-09 01:30 in Helsinki (UTC+3 in October, DST still active)
  assert.equal(toHelsinkiDateString("2026-10-08T22:30:00.000Z"), "2026-10-09");
});

test("findScheduleMatch resolves JYP's two October fixtures to the correct distinct entries", () => {
  const schedule = [
    { date: "2026-10-08", opponent: "JYP", gameType: "runkosarja", season: "2026-27" },
    { date: "2026-10-30", opponent: "JYP", gameType: "runkosarja", season: "2026-27" },
  ];

  assert.deepEqual(
    findScheduleMatch(schedule, { name: "SaiPa - JYP", startIso: "2026-10-08T17:30:00.000Z" }),
    { gameType: "runkosarja", season: "2026-27" }
  );
  assert.deepEqual(
    findScheduleMatch(schedule, { name: "SaiPa - JYP", startIso: "2026-10-30T17:30:00.000Z" }),
    { gameType: "runkosarja", season: "2026-27" }
  );
});

test("findScheduleMatch returns null when the event's date doesn't match any fixture for that opponent (date moved)", () => {
  const schedule = [{ date: "2026-10-08", opponent: "JYP", gameType: "runkosarja", season: "2026-27" }];
  assert.equal(
    findScheduleMatch(schedule, { name: "SaiPa - JYP", startIso: "2026-10-09T17:30:00.000Z" }),
    null
  );
});

test("findScheduleMatch returns null for an unmatched opponent", () => {
  const schedule = [{ date: "2026-10-08", opponent: "JYP", gameType: "runkosarja", season: "2026-27" }];
  assert.equal(
    findScheduleMatch(schedule, { name: "SaiPa - Espoo United", startIso: "2026-10-08T17:30:00.000Z" }),
    null
  );
});

test("findScheduleMatch matches diacritic-differing opponent names (HC Plzeň)", () => {
  const schedule = [{ date: "2026-10-14", opponent: "HC Plzeň", gameType: "chl", season: "2026-27" }];
  assert.deepEqual(
    findScheduleMatch(schedule, { name: "SaiPa - HC Plzen", startIso: "2026-10-14T17:30:00.000Z" }),
    { gameType: "chl", season: "2026-27" }
  );
});

test("findScheduleMatch returns null when the event name doesn't parse as 'SaiPa - X' at all", () => {
  const schedule = [{ date: "2026-08-27", opponent: "Jukurit", gameType: "harjoitusottelu", season: "2026-27" }];
  assert.equal(
    findScheduleMatch(schedule, { name: "SaiPa kausikortit 2026-2027", startIso: "2026-08-27T17:00:00.000Z" }),
    null
  );
});

test("findNearMissCandidates finds a same-date-different-opponent candidate (naming problem)", () => {
  const schedule = [{ date: "2026-10-08", opponent: "Jukurit", gameType: "runkosarja", season: "2026-27" }];
  const result = findNearMissCandidates(schedule, { name: "SaiPa - JYP", startIso: "2026-10-08T17:30:00.000Z" });
  assert.deepEqual(result.sameDateDifferentOpponent, [schedule[0]]);
  assert.deepEqual(result.sameOpponentDifferentDate, []);
});

test("findNearMissCandidates finds a same-opponent-different-date candidate (date problem)", () => {
  const schedule = [{ date: "2026-10-15", opponent: "JYP", gameType: "runkosarja", season: "2026-27" }];
  const result = findNearMissCandidates(schedule, { name: "SaiPa - JYP", startIso: "2026-10-08T17:30:00.000Z" });
  assert.deepEqual(result.sameDateDifferentOpponent, []);
  assert.deepEqual(result.sameOpponentDifferentDate, [schedule[0]]);
});

test("findNearMissCandidates can return both candidate lists at once", () => {
  const schedule = [
    { date: "2026-10-08", opponent: "Jukurit", gameType: "runkosarja", season: "2026-27" },
    { date: "2026-10-15", opponent: "JYP", gameType: "runkosarja", season: "2026-27" },
  ];
  const result = findNearMissCandidates(schedule, { name: "SaiPa - JYP", startIso: "2026-10-08T17:30:00.000Z" });
  assert.deepEqual(result.sameDateDifferentOpponent, [schedule[0]]);
  assert.deepEqual(result.sameOpponentDifferentDate, [schedule[1]]);
});

test("findNearMissCandidates returns empty lists for an actual match (nothing to diagnose)", () => {
  const schedule = [{ date: "2026-10-08", opponent: "JYP", gameType: "runkosarja", season: "2026-27" }];
  const result = findNearMissCandidates(schedule, { name: "SaiPa - JYP", startIso: "2026-10-08T17:30:00.000Z" });
  assert.deepEqual(result.sameDateDifferentOpponent, []);
  assert.deepEqual(result.sameOpponentDifferentDate, []);
});

test("findNearMissCandidates: same-date candidates still surface even when the event name doesn't parse as 'SaiPa - X'", () => {
  const schedule = [{ date: "2026-08-27", opponent: "Jukurit", gameType: "harjoitusottelu", season: "2026-27" }];
  const result = findNearMissCandidates(schedule, {
    name: "SaiPa kausikortit 2026-2027",
    startIso: "2026-08-27T17:00:00.000Z",
  });
  assert.deepEqual(result.sameDateDifferentOpponent, [schedule[0]]);
  assert.deepEqual(result.sameOpponentDifferentDate, []); // no opponent parsed, so this axis can't be searched
});

// scripts/lib/schedule.js is imported directly by js/dashboardUnclassified.js
// (a browser module, served statically — this repo has no build step) so
// the same near-miss diagnosis logic isn't duplicated between the Node
// scraper and the frontend. That only works as long as this file never
// gains a Node-only API; nothing else enforces that, so pin it down here
// rather than letting it become an assumption that silently breaks the
// dashboard at runtime with no test failing.
test("scripts/lib/schedule.js stays browser-safe (no node: imports, require(), or process.*)", () => {
  const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "lib", "schedule.js");
  const source = readFileSync(filePath, "utf8");
  assert.doesNotMatch(source, /\bnode:/);
  assert.doesNotMatch(source, /\brequire\(/);
  assert.doesNotMatch(source, /\bprocess\./);
});
