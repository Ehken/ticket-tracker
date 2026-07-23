import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeName,
  extractOpponent,
  toHelsinkiDateString,
  findScheduleMatch,
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
