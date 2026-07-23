import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeSeasons,
  filterBySeason,
  splitKausikortti,
  filterBySarja,
  computeSarjaAvailability,
  resolveSarja,
  extractOpponentDisplay,
  computeOpponents,
  resolveVastustaja,
  filterByVastustaja,
  filterByPelatut,
  buildTimeline,
  groupByMonth,
  gameTypeLabel,
  shouldAutoExpandKausikortti,
} from "../js/grouping.js";

function ev(overrides) {
  return {
    id: "id",
    name: "SaiPa - Tappara",
    gameType: "runkosarja",
    season: null,
    hidden: false,
    note: "",
    status: "upcoming",
    start: "2026-09-01T17:00:00.000Z",
    firstSeen: "2026-01-01T00:00:00.000Z",
    lastSeen: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("computeSeasons collects distinct seasons across overrides/autoclass/schedule, sorted", () => {
  const result = computeSeasons({
    overrides: { "1-1": { season: "2027-28" } },
    autoclass: { "2-2": { season: "2026-27" } },
    schedule: [{ season: "2026-27" }, { season: "2028-29" }],
  });
  assert.deepEqual(result.seasons, ["2026-27", "2027-28", "2028-29"]);
  assert.equal(result.hasMultipleSeasons, true);
});

test("computeSeasons reports hasMultipleSeasons=false with only one season", () => {
  const result = computeSeasons({ overrides: {}, autoclass: {}, schedule: [{ season: "2026-27" }] });
  assert.deepEqual(result.seasons, ["2026-27"]);
  assert.equal(result.hasMultipleSeasons, false);
});

test("filterBySeason keeps matching-season events and always keeps season=null events", () => {
  const events = [
    ev({ id: "a", season: "2026-27" }),
    ev({ id: "b", season: "2027-28" }),
    ev({ id: "c", season: null }),
  ];
  const filtered = filterBySeason(events, "2026-27");
  assert.deepEqual(
    filtered.map((e) => e.id),
    ["a", "c"]
  );
});

test("filterBySeason with 'kaikki' or no value returns everything", () => {
  const events = [ev({ id: "a", season: "2026-27" }), ev({ id: "b", season: "2027-28" })];
  assert.equal(filterBySeason(events, "kaikki").length, 2);
  assert.equal(filterBySeason(events, undefined).length, 2);
});

test("splitKausikortti separates kausikortti events from the rest, preserving order", () => {
  const events = [
    ev({ id: "a", gameType: "runkosarja" }),
    ev({ id: "b", gameType: "kausikortti" }),
    ev({ id: "c", gameType: "chl" }),
  ];
  const { kausikortti, rest } = splitKausikortti(events);
  assert.deepEqual(
    kausikortti.map((e) => e.id),
    ["b"]
  );
  assert.deepEqual(
    rest.map((e) => e.id),
    ["a", "c"]
  );
});

test("filterBySarja: 'kaikki'/unset passes everything through, including 'muu'", () => {
  const events = [ev({ id: "a", gameType: "runkosarja" }), ev({ id: "b", gameType: "muu" })];
  assert.equal(filterBySarja(events, "kaikki").length, 2);
  assert.equal(filterBySarja(events, undefined).length, 2);
});

test("filterBySarja: a specific sarja value does an exact match and excludes 'muu'", () => {
  const events = [
    ev({ id: "a", gameType: "runkosarja" }),
    ev({ id: "b", gameType: "muu" }),
    ev({ id: "c", gameType: "chl" }),
  ];
  const filtered = filterBySarja(events, "runkosarja");
  assert.deepEqual(
    filtered.map((e) => e.id),
    ["a"]
  );
});

test("computeSarjaAvailability: hasEvents reflects the kausi-filtered set, regardless of status", () => {
  const events = [ev({ id: "a", gameType: "runkosarja", status: "past" })];
  const availability = computeSarjaAvailability(events);
  assert.equal(availability.find((o) => o.value === "runkosarja").hasEvents, true);
  assert.equal(availability.find((o) => o.value === "chl").hasEvents, false);
  assert.equal(availability.find((o) => o.value === "kaikki").hasEvents, true);
});

test("computeSarjaAvailability: a 'muu'-only set marks every specific option unavailable", () => {
  const events = [ev({ id: "a", gameType: "muu" })];
  const availability = computeSarjaAvailability(events);
  for (const option of availability) {
    if (option.value === "kaikki") continue;
    assert.equal(option.hasEvents, false, `${option.value} should be unavailable`);
  }
});

test("resolveSarja: keeps an available requested value, resets unavailable/unknown/unset to 'kaikki'", () => {
  const availability = computeSarjaAvailability([ev({ id: "a", gameType: "runkosarja" })]);
  assert.equal(resolveSarja("runkosarja", availability), "runkosarja");
  assert.equal(resolveSarja("chl", availability), "kaikki"); // unavailable
  assert.equal(resolveSarja("not-a-real-value", availability), "kaikki");
  assert.equal(resolveSarja(undefined, availability), "kaikki");
});

test("extractOpponentDisplay parses 'SaiPa - X' variants, preserving original casing", () => {
  assert.equal(extractOpponentDisplay("SaiPa - Tappara"), "Tappara");
  assert.equal(extractOpponentDisplay("SaiPa-HIFK"), "HIFK");
  assert.equal(extractOpponentDisplay("SaiPa – Dynamo Pardubice"), "Dynamo Pardubice");
});

test("extractOpponentDisplay returns null for names that aren't 'SaiPa - X'", () => {
  assert.equal(extractOpponentDisplay("SaiPa kausikortit 2026-2027"), null);
});

test("computeOpponents dedupes, sorts alphabetically (fi collation), and excludes unparseable names", () => {
  const events = [
    ev({ id: "a", name: "SaiPa - Ässät" }),
    ev({ id: "b", name: "SaiPa - Tappara" }),
    ev({ id: "c", name: "SaiPa - Ässät" }), // duplicate opponent
    ev({ id: "d", name: "SaiPa kausikortit 2026-2027" }), // unparseable
  ];
  // Finnish alphabetical order places Ä/Ö after Z, so "Tappara" sorts before "Ässät".
  assert.deepEqual(computeOpponents(events), ["Tappara", "Ässät"]);
});

test("resolveVastustaja: keeps an available requested value, resets unavailable/unset to 'kaikki'", () => {
  const opponents = ["HIFK", "Tappara"];
  assert.equal(resolveVastustaja("HIFK", opponents), "HIFK");
  assert.equal(resolveVastustaja("KooKoo", opponents), "kaikki");
  assert.equal(resolveVastustaja(undefined, opponents), "kaikki");
});

test("filterByVastustaja: 'kaikki'/unset passes through; specific value does exact opponent match", () => {
  const events = [ev({ id: "a", name: "SaiPa - HIFK" }), ev({ id: "b", name: "SaiPa - Tappara" })];
  assert.equal(filterByVastustaja(events, "kaikki").length, 2);
  assert.deepEqual(
    filterByVastustaja(events, "HIFK").map((e) => e.id),
    ["a"]
  );
});

test("filterByPelatut: off excludes past events, on includes everything", () => {
  const events = [ev({ id: "a", status: "upcoming" }), ev({ id: "b", status: "past" })];
  assert.deepEqual(
    filterByPelatut(events, false).map((e) => e.id),
    ["a"]
  );
  assert.equal(filterByPelatut(events, true).length, 2);
});

test("buildTimeline sorts chronologically ascending, mixing past and upcoming", () => {
  const events = [
    ev({ id: "later", start: "2026-10-01T17:00:00.000Z", status: "upcoming" }),
    ev({ id: "earlier", start: "2026-08-01T17:00:00.000Z", status: "past" }),
  ];
  assert.deepEqual(
    buildTimeline(events).map((e) => e.id),
    ["earlier", "later"]
  );
});

test("groupByMonth groups consecutive same-month events and labels them in Finnish", () => {
  const events = [
    ev({ id: "a", start: "2026-09-05T17:00:00.000Z" }),
    ev({ id: "b", start: "2026-09-20T17:00:00.000Z" }),
    ev({ id: "c", start: "2026-10-03T17:00:00.000Z" }),
  ];
  const groups = groupByMonth(events);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].label, "Syyskuu 2026");
  assert.deepEqual(
    groups[0].events.map((e) => e.id),
    ["a", "b"]
  );
  assert.equal(groups[1].label, "Lokakuu 2026");
  assert.deepEqual(
    groups[1].events.map((e) => e.id),
    ["c"]
  );
});

test("groupByMonth: an event just after local midnight rolls into the next Helsinki month correctly", () => {
  // 2026-09-30T22:00:00.000Z is 2026-10-01 01:00 in Helsinki (UTC+3, DST still active).
  const events = [ev({ id: "a", start: "2026-09-30T22:00:00.000Z" })];
  const groups = groupByMonth(events);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, "Lokakuu 2026");
});

test("gameTypeLabel maps 'muu' to the unclassified label and passes through known types", () => {
  assert.equal(gameTypeLabel("muu"), "(luokittelematon)");
  assert.equal(gameTypeLabel("runkosarja"), "Runkosarja");
  assert.equal(gameTypeLabel("chl"), "CHL");
});

test("shouldAutoExpandKausikortti: expanded only when it's the sole strip and there are zero games", () => {
  assert.equal(shouldAutoExpandKausikortti(1, 0), true);
  assert.equal(shouldAutoExpandKausikortti(1, 5), false);
  assert.equal(shouldAutoExpandKausikortti(2, 0), false);
  assert.equal(shouldAutoExpandKausikortti(3, 4), false);
});
