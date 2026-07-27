import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickSeats,
  assignSeatIds,
  groupSeatIdsBySection,
  buildPinnedKausikorttiSections,
  assertBaselineSnapshotValid,
} from "../scripts/generateMockData.js";

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

test("groupSeatIdsBySection groups a flat seat-id list by its section prefix, sorted within each section", () => {
  const grouped = groupSeatIdsBySection(["C4-1-003", "A1-1-002", "C4-1-001", "A1-1-005"]);
  assert.deepEqual(grouped, {
    A1: ["A1-1-002", "A1-1-005"],
    C4: ["C4-1-001", "C4-1-003"],
  });
});

test("groupSeatIdsBySection returns an empty object for an empty seat-id list", () => {
  assert.deepEqual(groupSeatIdsBySection([]), {});
});

test("buildPinnedKausikorttiSections sources sold from the pinned map, hold always 0 when not disabled", () => {
  const pinned = new Map([
    ["A1", { sold: 42, disabled: false }],
    ["seisomakatsomo", { sold: 1015, disabled: false }],
    ["invalid", { sold: 5, disabled: false }],
  ]);
  const sections = buildPinnedKausikorttiSections(pinned);

  const a1 = sections.find((s) => s.section === "A1");
  assert.deepEqual(a1, { section: "A1", sold: 42, available: a1.total - 42, hold: 0, total: a1.total, disabled: false });

  const standing = sections.find((s) => s.section === "seisomakatsomo");
  assert.equal(standing.sold, 1015);
  assert.equal(standing.disabled, false);
  assert.equal(standing.available, standing.total - 1015);

  const wheelchair = sections.find((s) => s.section === "invalid");
  assert.equal(wheelchair.sold, 5);

  // Sections absent from the pinned map (every seated section wasn't listed
  // here) default to sold: 0, not undefined/NaN.
  const c1 = sections.find((s) => s.section === "C1");
  assert.equal(c1.sold, 0);
  assert.equal(c1.available, c1.total);
});

test("buildPinnedKausikorttiSections: a disabled section gets available 0, hold = total - sold, mirroring buildSections/sections.js", () => {
  const pinned = new Map([
    ["C2", { sold: 4, disabled: true }],
    ["A1", { sold: 42, disabled: false }],
  ]);
  const sections = buildPinnedKausikorttiSections(pinned);

  const c2 = sections.find((s) => s.section === "C2");
  assert.deepEqual(c2, { section: "C2", sold: 4, available: 0, hold: c2.total - 4, total: c2.total, disabled: true });

  const a1 = sections.find((s) => s.section === "A1");
  assert.equal(a1.disabled, false);
  assert.equal(a1.hold, 0);
  assert.equal(a1.available, a1.total - 42);
});

test("buildPinnedKausikorttiSections always includes press (0 sold) and aitiot (0 sold) at their fixed capacities", () => {
  const sections = buildPinnedKausikorttiSections(new Map());
  const press = sections.find((s) => s.section === "press");
  const aitiot = sections.find((s) => s.section === "aitiot");
  assert.equal(press.sold, 0);
  assert.equal(press.hold, press.total);
  assert.equal(aitiot.sold, 0);
  assert.equal(aitiot.hold, aitiot.total);
});

test("assertBaselineSnapshotValid passes for a matching hash and in-bounds sold counts", () => {
  const snapshot = { svgHash: "abc123", sections: [{ section: "A1", sold: 42 }] };
  assert.doesNotThrow(() => assertBaselineSnapshotValid(snapshot, "abc123"));
});

test("assertBaselineSnapshotValid throws when the snapshot's svgHash doesn't match the current capacities SVG", () => {
  const snapshot = { svgHash: "stale-hash", sections: [] };
  assert.throws(() => assertBaselineSnapshotValid(snapshot, "current-hash"), /svgHash/);
});

test("assertBaselineSnapshotValid throws when a section's baseline sold exceeds mock's hardcoded capacity", () => {
  const snapshot = { svgHash: "abc123", sections: [{ section: "seisomakatsomo", sold: 999999 }] };
  assert.throws(() => assertBaselineSnapshotValid(snapshot, "abc123"), /exceeds mock's hardcoded capacity/);
});
