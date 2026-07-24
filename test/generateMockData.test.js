import { test } from "node:test";
import assert from "node:assert/strict";
import { pickSeats, assignSeatIds } from "../scripts/generateMockData.js";

// Simple deterministic rng (not mulberry32 — just needs to be a reproducible
// 0..1 stream for these unit tests).
function makeTestRng(seed) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

test("pickSeats returns exactly `count` items, all drawn from the pool, no duplicates, sorted", () => {
  const pool = ["A1-1-001", "A1-1-002", "A1-1-003", "A1-1-004", "A1-1-005"];
  const picked = pickSeats(makeTestRng(1), pool, 3);

  assert.equal(picked.length, 3);
  assert.equal(new Set(picked).size, 3);
  for (const id of picked) assert.ok(pool.includes(id));
  assert.deepEqual(picked, [...picked].sort());
});

test("pickSeats is deterministic for a given rng sequence", () => {
  const pool = ["A1-1-001", "A1-1-002", "A1-1-003", "A1-1-004", "A1-1-005"];
  const a = pickSeats(makeTestRng(42), pool, 3);
  const b = pickSeats(makeTestRng(42), pool, 3);
  assert.deepEqual(a, b);
});

test("pickSeats returns an empty array when count is 0", () => {
  assert.deepEqual(pickSeats(makeTestRng(1), ["A1-1-001", "A1-1-002"], 0), []);
});

const SEAT_POOL_BY_SECTION = {
  A1: ["A1-1-001", "A1-1-002", "A1-1-003", "A1-1-004", "A1-1-005"],
  C4: ["C4-1-001", "C4-1-002", "C4-1-003", "C4-1-004"],
};

test("assignSeatIds for a kausikortti event (no baseline) picks fresh seats matching each section's sold count", () => {
  const sections = [
    { section: "A1", sold: 3, available: 2, hold: 0, total: 5 },
    { section: "C4", sold: 2, available: 2, hold: 0, total: 4 },
    { section: "seisomakatsomo", sold: 50, available: 2088, hold: 0, total: 2138 },
  ];

  const bySection = assignSeatIds(makeTestRng(7), SEAT_POOL_BY_SECTION, sections, null);

  assert.equal(bySection.A1.length, 3);
  assert.equal(bySection.C4.length, 2);
  assert.equal(bySection.seisomakatsomo, undefined); // aggregate row — no individual seat IDs
  for (const id of bySection.A1) assert.ok(SEAT_POOL_BY_SECTION.A1.includes(id));
});

test("assignSeatIds for a match event returns a seat set that is a SUPERSET of the season's kausikortti baseline, per section", () => {
  const kausikorttiSections = [
    { section: "A1", sold: 2, available: 3, hold: 0, total: 5 },
    { section: "C4", sold: 1, available: 3, hold: 0, total: 4 },
  ];
  const baselineSeatsBySection = assignSeatIds(makeTestRng(3), SEAT_POOL_BY_SECTION, kausikorttiSections, null);

  // The match event sells more than the kausikortti baseline in both sections.
  const matchSections = [
    { section: "A1", sold: 4, available: 1, hold: 0, total: 5 },
    { section: "C4", sold: 3, available: 1, hold: 0, total: 4 },
  ];
  const matchSeatsBySection = assignSeatIds(
    makeTestRng(99),
    SEAT_POOL_BY_SECTION,
    matchSections,
    baselineSeatsBySection
  );

  assert.equal(matchSeatsBySection.A1.length, 4);
  assert.equal(matchSeatsBySection.C4.length, 3);

  for (const section of ["A1", "C4"]) {
    const baselineIds = baselineSeatsBySection[section];
    const matchIds = new Set(matchSeatsBySection[section]);
    for (const id of baselineIds) {
      assert.ok(matchIds.has(id), `expected ${section} match seats to be a superset containing ${id}`);
    }
  }
});

test("assignSeatIds superset invariant holds even when the match event sells the entire remaining pool", () => {
  const kausikorttiSections = [{ section: "C4", sold: 1, available: 3, hold: 0, total: 4 }];
  const baselineSeatsBySection = assignSeatIds(makeTestRng(11), SEAT_POOL_BY_SECTION, kausikorttiSections, null);

  const matchSections = [{ section: "C4", sold: 4, available: 0, hold: 0, total: 4 }]; // sold out
  const matchSeatsBySection = assignSeatIds(
    makeTestRng(12),
    SEAT_POOL_BY_SECTION,
    matchSections,
    baselineSeatsBySection
  );

  assert.deepEqual(matchSeatsBySection.C4.sort(), [...SEAT_POOL_BY_SECTION.C4].sort());
  for (const id of baselineSeatsBySection.C4) {
    assert.ok(matchSeatsBySection.C4.includes(id));
  }
});
