import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeSeasons,
  filterBySeason,
  partitionByTabs,
  computeTabVisibility,
  resolveActiveTab,
  gameTypeLabel,
} from "../js/grouping.js";

function ev(overrides) {
  return {
    id: "id",
    name: "name",
    gameType: "muu",
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
    ev({ id: "c", season: null }), // e.g. kausikortti
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

test("partitionByTabs: every event appears in exactly one bucket (disjoint partitions)", () => {
  const events = [
    ev({ id: "kausikortti-1", gameType: "kausikortti" }),
    ev({ id: "runkosarja-1", gameType: "runkosarja", status: "upcoming" }),
    ev({ id: "muu-1", gameType: "muu", status: "upcoming" }),
    ev({ id: "chl-1", gameType: "chl", status: "upcoming" }),
    ev({ id: "harjoitusottelu-1", gameType: "harjoitusottelu", status: "upcoming" }),
    ev({ id: "playoffs-1", gameType: "playoffs", status: "upcoming" }),
    ev({ id: "past-runkosarja-1", gameType: "runkosarja", status: "past" }),
    ev({ id: "past-chl-1", gameType: "chl", status: "past" }),
    ev({ id: "past-muu-1", gameType: "muu", status: "past" }),
  ];

  const partitions = partitionByTabs(events);
  const allBucketed = [
    ...partitions.kausikortti,
    ...partitions.runkosarja,
    ...partitions.chl,
    ...partitions.harjoitusottelu,
    ...partitions.playoffs,
    ...partitions.pelatut,
  ].map((e) => e.id);

  const inputIds = events.map((e) => e.id);
  assert.equal(allBucketed.length, inputIds.length, "no event should be duplicated across buckets");
  assert.deepEqual([...allBucketed].sort(), [...inputIds].sort(), "every input event must appear exactly once");
});

test("partitionByTabs: runkosarja absorbs upcoming 'muu' events", () => {
  const events = [ev({ id: "muu-1", gameType: "muu", status: "upcoming" })];
  const partitions = partitionByTabs(events);
  assert.deepEqual(
    partitions.runkosarja.map((e) => e.id),
    ["muu-1"]
  );
  assert.equal(partitions.pelatut.length, 0);
});

test("partitionByTabs: a past event of any gameType lands only in pelatut, never its upcoming-type bucket", () => {
  const events = [
    ev({ id: "past-chl", gameType: "chl", status: "past" }),
    ev({ id: "past-playoffs", gameType: "playoffs", status: "past" }),
  ];
  const partitions = partitionByTabs(events);
  assert.equal(partitions.chl.length, 0);
  assert.equal(partitions.playoffs.length, 0);
  assert.deepEqual(
    partitions.pelatut.map((e) => e.id).sort(),
    ["past-chl", "past-playoffs"]
  );
});

test("partitionByTabs excludes hidden events entirely", () => {
  const events = [ev({ id: "hidden-1", hidden: true, gameType: "runkosarja" })];
  const partitions = partitionByTabs(events);
  assert.equal(partitions.runkosarja.length, 0);
});

test("computeTabVisibility: CHL/Harjoitusottelut/Playoffs are hidden when empty, visible when not", () => {
  const empty = computeTabVisibility({ runkosarja: [1], chl: [], harjoitusottelu: [], playoffs: [], pelatut: [] });
  const chlTab = empty.find((t) => t.tab === "chl");
  assert.equal(chlTab.visible, false);

  const withChl = computeTabVisibility({ runkosarja: [1], chl: [1], harjoitusottelu: [], playoffs: [], pelatut: [] });
  assert.equal(withChl.find((t) => t.tab === "chl").visible, true);
});

test("computeTabVisibility: Runkosarja hides when it alone is empty but other buckets have content", () => {
  const tabs = computeTabVisibility({ runkosarja: [], chl: [1], harjoitusottelu: [], playoffs: [], pelatut: [] });
  assert.equal(tabs.find((t) => t.tab === "runkosarja").visible, false);
});

test("computeTabVisibility: Runkosarja shows placeholder when every bucket is empty", () => {
  const tabs = computeTabVisibility({ runkosarja: [], chl: [], harjoitusottelu: [], playoffs: [], pelatut: [] });
  const runkosarjaTab = tabs.find((t) => t.tab === "runkosarja");
  assert.equal(runkosarjaTab.visible, true);
  assert.equal(runkosarjaTab.placeholder, true);
});

test("computeTabVisibility: Pelatut is always visible, disabled only while empty", () => {
  const emptyTabs = computeTabVisibility({ runkosarja: [1], chl: [], harjoitusottelu: [], playoffs: [], pelatut: [] });
  const emptyPelatut = emptyTabs.find((t) => t.tab === "pelatut");
  assert.equal(emptyPelatut.visible, true);
  assert.equal(emptyPelatut.disabled, true);

  const filledTabs = computeTabVisibility({ runkosarja: [1], chl: [], harjoitusottelu: [], playoffs: [], pelatut: [1] });
  const filledPelatut = filledTabs.find((t) => t.tab === "pelatut");
  assert.equal(filledPelatut.disabled, false);
});

test("resolveActiveTab: honors the requested tab when it's visible and enabled", () => {
  const tabs = computeTabVisibility({ runkosarja: [1], chl: [1], harjoitusottelu: [], playoffs: [], pelatut: [] });
  assert.equal(resolveActiveTab("chl", tabs), "chl");
});

test("resolveActiveTab: falls back to first-visible-with-content when requested tab is hidden/disabled", () => {
  const tabs = computeTabVisibility({ runkosarja: [1], chl: [], harjoitusottelu: [], playoffs: [], pelatut: [] });
  assert.equal(resolveActiveTab("chl", tabs), "runkosarja"); // chl hidden (empty) -> fallback
  assert.equal(resolveActiveTab("pelatut", tabs), "runkosarja"); // pelatut disabled (empty) -> fallback
});

test("resolveActiveTab: falls back to the Runkosarja placeholder when everything is empty, never Pelatut", () => {
  const tabs = computeTabVisibility({ runkosarja: [], chl: [], harjoitusottelu: [], playoffs: [], pelatut: [] });
  assert.equal(resolveActiveTab(undefined, tabs), "runkosarja");
  assert.equal(resolveActiveTab("pelatut", tabs), "runkosarja");
});

test("resolveActiveTab: does NOT fall back to Runkosarja when it alone is empty but another bucket has content", () => {
  const tabs = computeTabVisibility({ runkosarja: [], chl: [1], harjoitusottelu: [], playoffs: [], pelatut: [] });
  assert.equal(resolveActiveTab(undefined, tabs), "chl");
  assert.notEqual(resolveActiveTab("nonexistent-tab", tabs), "runkosarja");
});

test("gameTypeLabel maps 'muu' to the unclassified label and passes through known types", () => {
  assert.equal(gameTypeLabel("muu"), "(luokittelematon)");
  assert.equal(gameTypeLabel("runkosarja"), "Runkosarja");
  assert.equal(gameTypeLabel("chl"), "CHL");
});
