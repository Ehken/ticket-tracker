import { test } from "node:test";
import assert from "node:assert/strict";
import { SEAT_STATE } from "../js/seatMapClassify.js";
import { computeStackedFillZones } from "../js/seatMapStackedFill.js";

test("computeStackedFillZones: 3-zone split reflects kausikortti/irtolippu/vapaa shares of capacity", () => {
  const zones = computeStackedFillZones({ sold: 70, total: 100, kausikorttiSold: 40 });
  assert.deepEqual(zones, [
    { state: SEAT_STATE.KAUSIKORTTI, start: 0, end: 40 },
    { state: SEAT_STATE.IRTOLIPPU, start: 40, end: 70 },
    { state: SEAT_STATE.VAPAA, start: 70, end: 100 },
  ]);
});

test("computeStackedFillZones: 0% sold collapses kausikortti/irtolippu zones to zero width", () => {
  const zones = computeStackedFillZones({ sold: 0, total: 100, kausikorttiSold: 0 });
  assert.deepEqual(zones, [
    { state: SEAT_STATE.KAUSIKORTTI, start: 0, end: 0 },
    { state: SEAT_STATE.IRTOLIPPU, start: 0, end: 0 },
    { state: SEAT_STATE.VAPAA, start: 0, end: 100 },
  ]);
});

test("computeStackedFillZones: 100% sold collapses the vapaa zone to zero width", () => {
  const zones = computeStackedFillZones({ sold: 100, total: 100, kausikorttiSold: 40 });
  assert.deepEqual(zones, [
    { state: SEAT_STATE.KAUSIKORTTI, start: 0, end: 40 },
    { state: SEAT_STATE.IRTOLIPPU, start: 40, end: 100 },
    { state: SEAT_STATE.VAPAA, start: 100, end: 100 },
  ]);
});

test("computeStackedFillZones: fractional shares are not pre-rounded", () => {
  const zones = computeStackedFillZones({ sold: 33, total: 70, kausikorttiSold: 10 });
  assert.equal(zones[0].end, (10 / 70) * 100);
  assert.equal(zones[1].end, (33 / 70) * 100);
  assert.equal(zones[2].start, (33 / 70) * 100);
  assert.equal(zones[2].end, 100);
});

test("computeStackedFillZones: kausikorttiSold defensively clamped to never exceed sold", () => {
  // Shouldn't happen with real data, but must never produce a negative irtolippu zone.
  const zones = computeStackedFillZones({ sold: 20, total: 100, kausikorttiSold: 999 });
  assert.equal(zones[0].end, 20);
  assert.equal(zones[1].start, 20);
  assert.equal(zones[1].end, 20);
});

test("computeStackedFillZones: no baseline (null) collapses to the 2-zone myyty/vapaa fallback", () => {
  const zones = computeStackedFillZones({ sold: 60, total: 100, kausikorttiSold: null });
  assert.deepEqual(zones, [
    { state: SEAT_STATE.MYYTY, start: 0, end: 60 },
    { state: SEAT_STATE.VAPAA, start: 60, end: 100 },
  ]);
});

test("computeStackedFillZones: no baseline is also the default when kausikorttiSold is omitted", () => {
  const zones = computeStackedFillZones({ sold: 60, total: 100 });
  assert.equal(zones.length, 2);
  assert.equal(zones[0].state, SEAT_STATE.MYYTY);
});

test("computeStackedFillZones: total of 0 is handled without dividing by zero", () => {
  const zones = computeStackedFillZones({ sold: 0, total: 0, kausikorttiSold: 0 });
  assert.deepEqual(zones, [
    { state: SEAT_STATE.KAUSIKORTTI, start: 0, end: 0 },
    { state: SEAT_STATE.IRTOLIPPU, start: 0, end: 0 },
    { state: SEAT_STATE.VAPAA, start: 0, end: 100 },
  ]);
});
