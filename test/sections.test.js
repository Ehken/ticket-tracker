import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countSoldPerSection,
  extractAggregateSold,
  extractAitioSold,
  isSectionDisabled,
  warnOnOrphanRowLevelDisabled,
  buildSectionTable,
  computeTotals,
  extractSoldSeatIds,
  warnOnSeatCountMismatch,
} from "../scripts/lib/sections.js";

test("countSoldPerSection counts keys by section prefix, ignoring aggregate keys", () => {
  const usages = {
    "A4-6-085": 1,
    "A4-1-001": 1,
    "C1-2-010": 1,
    seisomakatsomo: 50,
    invalid: 3,
    aitio_1: 2,
  };
  assert.deepEqual(countSoldPerSection(usages), { A4: 2, C1: 1 });
});

test("extractAggregateSold reads seisomakatsomo/invalid keys, defaulting to 0", () => {
  assert.deepEqual(extractAggregateSold({ seisomakatsomo: 50, invalid: 3 }), {
    standing: 50,
    wheelchair: 3,
  });
  assert.deepEqual(extractAggregateSold({}), { standing: 0, wheelchair: 0 });
});

test("isSectionDisabled checks whole-section membership only", () => {
  const disabled = ["D2-1", "D2-2", "C7", "C8", "C2", "D2"];
  assert.equal(isSectionDisabled("C7", disabled), true);
  assert.equal(isSectionDisabled("D2", disabled), true);
  assert.equal(isSectionDisabled("A1", disabled), false);
  // A row-level entry on its own (no whole-section entry) must not disable the section.
  assert.equal(isSectionDisabled("C7", ["C7-3"]), false);
});

test("warnOnOrphanRowLevelDisabled warns only for row entries without their whole section listed", () => {
  const warnings = [];
  const logger = { warn: (msg) => warnings.push(msg) };

  warnOnOrphanRowLevelDisabled(["D2-1", "D2-2", "D2"], logger);
  assert.equal(warnings.length, 0);

  warnOnOrphanRowLevelDisabled(["C7-3"], logger);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /C7-3/);
});

test("buildSectionTable: open seated section has available=total-sold, hold=0", () => {
  const rows = buildSectionTable({
    soldCounts: { A1: 100 },
    capacities: { A1: 171 },
    disabled: [],
    standingSold: 0,
    wheelchairSold: 0,
  });
  assert.deepEqual(rows, [{ section: "A1", sold: 100, available: 71, hold: 0, total: 171, disabled: false }]);
});

test("buildSectionTable: disabled seated section has available=0, hold=total-sold", () => {
  const rows = buildSectionTable({
    soldCounts: { C7: 20 },
    capacities: { C7: 94 },
    disabled: ["C7"],
    standingSold: 0,
    wheelchairSold: 0,
  });
  assert.deepEqual(rows, [{ section: "C7", sold: 20, available: 0, hold: 74, total: 94, disabled: true }]);
});

test("buildSectionTable: standing/wheelchair use aggregate sold, hold=0", () => {
  const rows = buildSectionTable({
    soldCounts: {},
    capacities: { seisomakatsomo: 2138, invalid: 12 },
    disabled: [],
    standingSold: 50,
    wheelchairSold: 3,
  });
  assert.deepEqual(rows, [
    { section: "seisomakatsomo", sold: 50, available: 2088, hold: 0, total: 2138 },
    { section: "invalid", sold: 3, available: 9, hold: 0, total: 12 },
  ]);
});

test("buildSectionTable: aitiot (merged) and press are always fully held", () => {
  const rows = buildSectionTable({
    soldCounts: {},
    capacities: { aitio_1: 16, aitio_2: 16, aitio_3: 18, press: 24 },
    disabled: [],
    standingSold: 0,
    wheelchairSold: 0,
  });
  assert.deepEqual(rows, [
    { section: "press", sold: 0, available: 0, hold: 24, total: 24 },
    { section: "aitiot", sold: 0, available: 0, hold: 50, total: 50 },
  ]);
});

test("buildSectionTable: aitiot row reflects aitioSold when boxes are occupied through another channel", () => {
  const rows = buildSectionTable({
    soldCounts: {},
    capacities: { aitio_1: 16, aitio_2: 16, aitio_3: 18, press: 24 },
    disabled: [],
    standingSold: 0,
    wheelchairSold: 0,
    aitioSold: 16,
  });
  assert.deepEqual(rows, [
    { section: "press", sold: 0, available: 0, hold: 24, total: 24 },
    { section: "aitiot", sold: 16, available: 0, hold: 34, total: 50 },
  ]);
});

test("extractAitioSold sums occupant counts for aitio_N keys with usage > 0, sorted IDs", () => {
  const usages = {
    aitio_2: 4,
    aitio_5: 6,
    aitio_9: 0, // present but zero occupancy — not "sold"
    seisomakatsomo: 50,
    "A1-1-001": 1,
  };
  assert.deepEqual(extractAitioSold(usages), { sold: 10, soldAitioIds: ["aitio_2", "aitio_5"] });
});

test("extractAitioSold returns zero/empty when usages has no aitio_N keys (today's real-world case)", () => {
  const usages = { seisomakatsomo: 50, invalid: 3, "A1-1-001": 1 };
  assert.deepEqual(extractAitioSold(usages), { sold: 0, soldAitioIds: [] });
});

test("extractSoldSeatIds returns only individual seat-ID keys, sorted alphabetically", () => {
  const usages = {
    "A4-6-085": 1,
    "A4-1-001": 1,
    "C1-2-010": 1,
    seisomakatsomo: 50,
    invalid: 3,
    aitio_1: 2,
  };
  assert.deepEqual(extractSoldSeatIds(usages), ["A4-1-001", "A4-6-085", "C1-2-010"]);
});

test("extractSoldSeatIds returns an empty array when usages has only aggregate keys", () => {
  assert.deepEqual(extractSoldSeatIds({ seisomakatsomo: 50, invalid: 3, aitio_1: 2, press: 0 }), []);
});

test("warnOnSeatCountMismatch is silent when seat-ID counts agree with each section's sold count", () => {
  const warnings = [];
  const logger = { warn: (msg) => warnings.push(msg) };
  const soldSeatIds = ["A4-1-001", "A4-6-085", "C1-2-010"];
  const sections = [
    { section: "A4", sold: 2, available: 242, hold: 0, total: 244 },
    { section: "C1", sold: 1, available: 107, hold: 0, total: 108 },
    { section: "seisomakatsomo", sold: 50, available: 2088, hold: 0, total: 2138 },
  ];
  warnOnSeatCountMismatch(soldSeatIds, sections, logger);
  assert.equal(warnings.length, 0);
});

test("warnOnSeatCountMismatch warns per section when seat-ID count disagrees with the computed sold count", () => {
  const warnings = [];
  const logger = { warn: (msg) => warnings.push(msg) };
  const soldSeatIds = ["A4-1-001"]; // only 1 seat ID, but the section row claims 2 sold
  const sections = [{ section: "A4", sold: 2, available: 242, hold: 0, total: 244 }];
  warnOnSeatCountMismatch(soldSeatIds, sections, logger);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /A4/);
  assert.match(warnings[0], /\(1\)/);
  assert.match(warnings[0], /\(2\)/);
});

test("warnOnSeatCountMismatch never checks aggregate sections (seisomakatsomo/invalid/press/aitiot)", () => {
  const warnings = [];
  const logger = { warn: (msg) => warnings.push(msg) };
  // No seat IDs at all, yet every aggregate row has a nonzero sold count —
  // must not warn, since aggregate usage keys have no individual seat IDs.
  const sections = [
    { section: "seisomakatsomo", sold: 50, available: 2088, hold: 0, total: 2138 },
    { section: "invalid", sold: 3, available: 9, hold: 0, total: 12 },
    { section: "press", sold: 0, available: 0, hold: 24, total: 24 },
    { section: "aitiot", sold: 0, available: 0, hold: 156, total: 156 },
  ];
  warnOnSeatCountMismatch([], sections, logger);
  assert.equal(warnings.length, 0);
});

test("computeTotals reproduces the spec's reference arena totals (2552/1828/596/4976)", () => {
  const capacities = {
    A1: 171,
    A2: 268,
    A3: 246,
    A4: 244,
    A5: 247,
    A6: 120,
    C1: 108,
    C2: 120,
    C3: 150,
    C4: 120,
    C5: 120,
    C6: 113,
    C7: 94,
    C8: 105,
    D1: 205,
    D2: 215,
    seisomakatsomo: 2138,
    invalid: 12,
    aitio_1: 16,
    aitio_2: 16,
    aitio_3: 18,
    aitio_4: 18,
    aitio_5: 18,
    aitio_6: 18,
    aitio_7: 18,
    aitio_8: 18,
    aitio_9: 16,
    press: 24,
  };
  const totalCapacity = Object.values(capacities).reduce((s, n) => s + n, 0);
  assert.equal(totalCapacity, 4976, "sanity: our fixture capacities must sum to the spec's 4976 total");

  const soldCounts = {
    A1: 50,
    A2: 50,
    A3: 50,
    A4: 50,
    A5: 50,
    A6: 50,
    C1: 50,
    C3: 24,
    C4: 0,
    C5: 0,
    C6: 0,
    D1: 50,
    C7: 20,
    C8: 30,
    C2: 40,
    D2: 28,
  };
  const disabled = ["C7", "C8", "C2", "D2"];

  const rows = buildSectionTable({
    soldCounts,
    capacities,
    disabled,
    standingSold: 2000,
    wheelchairSold: 10,
  });
  const totals = computeTotals(rows);

  assert.deepEqual(totals, { sold: 2552, available: 1828, hold: 596, total: 4976 });
});
