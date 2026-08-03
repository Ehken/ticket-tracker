import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSeatRecency, RECENCY_CAP_MS } from "../scripts/lib/seatRecency.js";

const HASH = "abc123";
const T0 = "2026-07-31T09:00:00.000Z";
const T1 = "2026-07-31T09:47:00.000Z";

test("a seat sold last run and absent now appears in freed, with sinceISO from the PREVIOUS run and detectedAtISO from THIS run (FIX 2)", () => {
  const result = computeSeatRecency({
    previousSoldSeatIds: ["A1-1-001"],
    previousSvgHash: HASH,
    currentSvgHash: HASH,
    currentSoldSeatIds: [],
    previousFreed: {},
    previousSold: {},
    previousFetchedAtISO: T0,
    nowISO: T1,
  });
  assert.deepEqual(result.freed, { "A1-1-001": { sinceISO: T0, detectedAtISO: T1 } });
  assert.deepEqual(result.sold, {});
});

test("the mirror: a seat absent last run and sold now appears in sold", () => {
  const result = computeSeatRecency({
    previousSoldSeatIds: [],
    previousSvgHash: HASH,
    currentSvgHash: HASH,
    currentSoldSeatIds: ["A1-1-001"],
    previousFreed: {},
    previousSold: {},
    previousFetchedAtISO: T0,
    nowISO: T1,
  });
  assert.deepEqual(result.sold, { "A1-1-001": { sinceISO: T0, detectedAtISO: T1 } });
  assert.deepEqual(result.freed, {});
});

test("persists unchanged (both timestamps) while the seat stays free across a no-op run", () => {
  const original = { sinceISO: T0, detectedAtISO: T0 };
  const result = computeSeatRecency({
    previousSoldSeatIds: [], // already free going into this run
    previousSvgHash: HASH,
    currentSvgHash: HASH,
    currentSoldSeatIds: [], // still free
    previousFreed: { "A1-1-001": original },
    previousSold: {},
    previousFetchedAtISO: T0,
    nowISO: T1,
  });
  assert.deepEqual(result.freed, { "A1-1-001": original });
});

test("re-sold drops the freed mark", () => {
  const result = computeSeatRecency({
    previousSoldSeatIds: [], // was free
    previousSvgHash: HASH,
    currentSvgHash: HASH,
    currentSoldSeatIds: ["A1-1-001"], // now sold again
    previousFreed: { "A1-1-001": { sinceISO: T0, detectedAtISO: T0 } },
    previousSold: {},
    previousFetchedAtISO: T0,
    nowISO: T1,
  });
  assert.deepEqual(result.freed, {});
  assert.deepEqual(result.sold, { "A1-1-001": { sinceISO: T0, detectedAtISO: T1 } });
});

test("re-freed drops the sold mark (mirror of re-sold)", () => {
  const result = computeSeatRecency({
    previousSoldSeatIds: ["A1-1-001"], // was sold
    previousSvgHash: HASH,
    currentSvgHash: HASH,
    currentSoldSeatIds: [], // now free again
    previousFreed: {},
    previousSold: { "A1-1-001": { sinceISO: T0, detectedAtISO: T0 } },
    previousFetchedAtISO: T0,
    nowISO: T1,
  });
  assert.deepEqual(result.sold, {});
  assert.deepEqual(result.freed, { "A1-1-001": { sinceISO: T0, detectedAtISO: T1 } });
});

test("expires at exactly the 24h boundary, measured from detectedAtISO", () => {
  const detectedAt = new Date(T1).getTime();
  const justUnder = new Date(detectedAt + RECENCY_CAP_MS - 1).toISOString();
  const justOver = new Date(detectedAt + RECENCY_CAP_MS).toISOString();

  const stillThere = computeSeatRecency({
    previousSoldSeatIds: [],
    previousSvgHash: HASH,
    currentSvgHash: HASH,
    currentSoldSeatIds: [],
    previousFreed: { "A1-1-001": { sinceISO: T0, detectedAtISO: T1 } },
    previousSold: {},
    previousFetchedAtISO: T0,
    nowISO: justUnder,
  });
  assert.deepEqual(stillThere.freed, { "A1-1-001": { sinceISO: T0, detectedAtISO: T1 } });

  const expired = computeSeatRecency({
    previousSoldSeatIds: [],
    previousSvgHash: HASH,
    currentSvgHash: HASH,
    currentSoldSeatIds: [],
    previousFreed: { "A1-1-001": { sinceISO: T0, detectedAtISO: T1 } },
    previousSold: {},
    previousFetchedAtISO: T0,
    nowISO: justOver,
  });
  assert.deepEqual(expired.freed, {});
});

test("survives a gap of several runs — aging is wall-clock from the stored timestamp, not a run count", () => {
  const longAfter = new Date(new Date(T1).getTime() + RECENCY_CAP_MS - 60_000).toISOString();
  const result = computeSeatRecency({
    previousSoldSeatIds: [],
    previousSvgHash: HASH,
    currentSvgHash: HASH,
    currentSoldSeatIds: [],
    previousFreed: { "A1-1-001": { sinceISO: T0, detectedAtISO: T1 } },
    previousSold: {},
    previousFetchedAtISO: T1,
    nowISO: longAfter, // one run, but a long time later — still within the cap
  });
  assert.deepEqual(result.freed, { "A1-1-001": { sinceISO: T0, detectedAtISO: T1 } });
});

test("a brand-new event (no prior recency file, previousSvgHash null) produces no marks even with seats already sold", () => {
  const result = computeSeatRecency({
    previousSoldSeatIds: [],
    previousSvgHash: null,
    currentSvgHash: HASH,
    currentSoldSeatIds: ["A1-1-001", "A1-1-002"],
    previousFreed: {},
    previousSold: {},
    previousFetchedAtISO: null,
    nowISO: T1,
  });
  assert.deepEqual(result, { freed: {}, sold: {} });
});

test("a svgHash mismatch clears ALL existing marks and skips diffing, even with real previousFreed/previousSold data (FIX 1)", () => {
  const result = computeSeatRecency({
    previousSoldSeatIds: ["A1-1-001"],
    previousSvgHash: "old-hash",
    currentSvgHash: "new-hash",
    currentSoldSeatIds: [], // would look like a mass-freeing event if diffed
    previousFreed: { "A2-1-001": { sinceISO: T0, detectedAtISO: T0 } },
    previousSold: { "A3-1-001": { sinceISO: T0, detectedAtISO: T0 } },
    previousFetchedAtISO: T0,
    nowISO: T1,
  });
  assert.deepEqual(result, { freed: {}, sold: {} });
});

test("keys are sorted in the output", () => {
  const result = computeSeatRecency({
    previousSoldSeatIds: ["C4-1-003", "C4-1-001", "C4-1-002"],
    previousSvgHash: HASH,
    currentSvgHash: HASH,
    currentSoldSeatIds: [],
    previousFreed: {},
    previousSold: {},
    previousFetchedAtISO: T0,
    nowISO: T1,
  });
  assert.deepEqual(Object.keys(result.freed), ["C4-1-001", "C4-1-002", "C4-1-003"]);
});
