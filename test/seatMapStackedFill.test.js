import { test } from "node:test";
import assert from "node:assert/strict";
import { SEAT_STATE } from "../js/seatMapClassify.js";
import {
  computeStackedFillZones,
  clampZoneSpansToMinimum,
  buildGradientStopOffsets,
  SEPARATOR_STATE,
} from "../js/seatMapStackedFill.js";

function approxEqual(a, b, epsilon = 1e-6) {
  return Math.abs(a - b) < epsilon;
}

function assertSpansSumTo100(zones) {
  assert.ok(approxEqual(zones[zones.length - 1].end, 100), `expected zones to end at 100, got ${zones[zones.length - 1].end}`);
  assert.ok(approxEqual(zones[0].start, 0), `expected zones to start at 0, got ${zones[0].start}`);
}

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

test("computeStackedFillZones: disabled paints the remainder ei-myynnissa instead of vapaa (3-zone)", () => {
  const zones = computeStackedFillZones({ sold: 70, total: 100, kausikorttiSold: 40, disabled: true });
  assert.deepEqual(zones, [
    { state: SEAT_STATE.KAUSIKORTTI, start: 0, end: 40 },
    { state: SEAT_STATE.IRTOLIPPU, start: 40, end: 70 },
    { state: SEAT_STATE.EI_MYYNNISSA, start: 70, end: 100 },
  ]);
});

test("computeStackedFillZones: disabled paints the remainder ei-myynnissa instead of vapaa (2-zone, no baseline)", () => {
  const zones = computeStackedFillZones({ sold: 60, total: 100, disabled: true });
  assert.deepEqual(zones, [
    { state: SEAT_STATE.MYYTY, start: 0, end: 60 },
    { state: SEAT_STATE.EI_MYYNNISSA, start: 60, end: 100 },
  ]);
});

test("computeStackedFillZones: not disabled (default) still paints the remainder vapaa", () => {
  const zones = computeStackedFillZones({ sold: 70, total: 100, kausikorttiSold: 40 });
  assert.equal(zones[2].state, SEAT_STATE.VAPAA);
});

test("clampZoneSpansToMinimum: a single tiny zone is clamped to the minimum, others shrink to compensate", () => {
  // vapaa's true share is 2% — well under a 10% minimum.
  const zones = computeStackedFillZones({ sold: 98, total: 100, kausikorttiSold: 60 });
  const clamped = clampZoneSpansToMinimum(zones, 10);

  const vapaa = clamped.find((z) => z.state === SEAT_STATE.VAPAA);
  assert.ok(approxEqual(vapaa.end - vapaa.start, 10), `expected vapaa clamped to 10, got ${vapaa.end - vapaa.start}`);
  assertSpansSumTo100(clamped);

  // the two sold zones shrink proportionally (60:38 ratio) to fill the remaining 90%.
  const kausikortti = clamped.find((z) => z.state === SEAT_STATE.KAUSIKORTTI);
  const irtolippu = clamped.find((z) => z.state === SEAT_STATE.IRTOLIPPU);
  assert.ok(approxEqual(kausikortti.end - kausikortti.start, (60 / 98) * 90));
  assert.ok(approxEqual(irtolippu.end - irtolippu.start, (38 / 98) * 90));
});

test("clampZoneSpansToMinimum: multiple simultaneously-tiny zones are all clamped", () => {
  // kausikortti=1, irtolippu=1, vapaa=98 — both sold zones are tiny.
  const zones = computeStackedFillZones({ sold: 2, total: 100, kausikorttiSold: 1 });
  const clamped = clampZoneSpansToMinimum(zones, 10);

  const kausikortti = clamped.find((z) => z.state === SEAT_STATE.KAUSIKORTTI);
  const irtolippu = clamped.find((z) => z.state === SEAT_STATE.IRTOLIPPU);
  const vapaa = clamped.find((z) => z.state === SEAT_STATE.VAPAA);

  assert.ok(approxEqual(kausikortti.end - kausikortti.start, 10));
  assert.ok(approxEqual(irtolippu.end - irtolippu.start, 10));
  assert.ok(approxEqual(vapaa.end - vapaa.start, 80));
  assertSpansSumTo100(clamped);
});

test("clampZoneSpansToMinimum: a zero-share zone is left at zero, never clamped up", () => {
  // no baseline tracked and nothing sold — myyty=0, vapaa=100.
  const zones = computeStackedFillZones({ sold: 0, total: 100 });
  const clamped = clampZoneSpansToMinimum(zones, 10);

  const myyty = clamped.find((z) => z.state === SEAT_STATE.MYYTY);
  assert.equal(myyty.end - myyty.start, 0);
  assertSpansSumTo100(clamped);
});

test("clampZoneSpansToMinimum: sold-out (vapaa=0) leaves vapaa at zero and clamps only the two sold zones if needed", () => {
  const zones = computeStackedFillZones({ sold: 100, total: 100, kausikorttiSold: 99 });
  const clamped = clampZoneSpansToMinimum(zones, 10);

  const vapaa = clamped.find((z) => z.state === SEAT_STATE.VAPAA);
  assert.equal(vapaa.end - vapaa.start, 0);

  const kausikortti = clamped.find((z) => z.state === SEAT_STATE.KAUSIKORTTI);
  const irtolippu = clamped.find((z) => z.state === SEAT_STATE.IRTOLIPPU);
  assert.ok(approxEqual(irtolippu.end - irtolippu.start, 10)); // irtolippu's true share (1%) is tiny — clamped
  assert.ok(approxEqual(kausikortti.end - kausikortti.start, 90));
  assertSpansSumTo100(clamped);
});

test("clampZoneSpansToMinimum: unsold (only vapaa) needs no clamping — vapaa fills the whole span", () => {
  const zones = computeStackedFillZones({ sold: 0, total: 100, kausikorttiSold: 0 });
  const clamped = clampZoneSpansToMinimum(zones, 10);

  const vapaa = clamped.find((z) => z.state === SEAT_STATE.VAPAA);
  assert.equal(vapaa.start, 0);
  assert.equal(vapaa.end, 100);
  assertSpansSumTo100(clamped);
});

test("clampZoneSpansToMinimum: all zones comfortably above the minimum pass through unchanged", () => {
  const zones = computeStackedFillZones({ sold: 70, total: 100, kausikorttiSold: 40 });
  const clamped = clampZoneSpansToMinimum(zones, 10);
  assert.deepEqual(clamped, zones);
});

test("clampZoneSpansToMinimum: canonical scarcity case — total 2138, sold 2126, vapaa exactly 12 remaining", () => {
  const zones = computeStackedFillZones({ sold: 2126, total: 2138, kausikorttiSold: 1013 });
  const vapaaShare = zones.find((z) => z.state === SEAT_STATE.VAPAA);
  assert.ok(approxEqual(vapaaShare.end - vapaaShare.start, (12 / 2138) * 100)); // sanity: ~0.56% before clamping

  const clamped = clampZoneSpansToMinimum(zones, 5); // a clearly-enforced 5% minimum
  const vapaa = clamped.find((z) => z.state === SEAT_STATE.VAPAA);
  assert.ok(approxEqual(vapaa.end - vapaa.start, 5), `expected vapaa clamped to 5, got ${vapaa.end - vapaa.start}`);

  // the two sold zones (1013 kausikortti, 1113 irtolippu) renormalize
  // proportionally around the clamped vapaa zone, still summing to 100.
  const kausikortti = clamped.find((z) => z.state === SEAT_STATE.KAUSIKORTTI);
  const irtolippu = clamped.find((z) => z.state === SEAT_STATE.IRTOLIPPU);
  assert.ok(approxEqual(kausikortti.end - kausikortti.start, (1013 / 2126) * 95));
  assert.ok(approxEqual(irtolippu.end - irtolippu.start, (1113 / 2126) * 95));
  assertSpansSumTo100(clamped);
});

test("clampZoneSpansToMinimum: infeasible minimum (too many nonzero zones for the space) splits evenly instead of crashing", () => {
  const zones = computeStackedFillZones({ sold: 70, total: 100, kausikorttiSold: 40 });
  const clamped = clampZoneSpansToMinimum(zones, 40); // 3 zones * 40% > 100%
  for (const zone of clamped) {
    assert.ok(approxEqual(zone.end - zone.start, 100 / 3));
  }
  assertSpansSumTo100(clamped);
});

test("buildGradientStopOffsets: two real zones produce exactly one separator band at their shared boundary", () => {
  const zones = [
    { state: SEAT_STATE.MYYTY, start: 0, end: 40 },
    { state: SEAT_STATE.VAPAA, start: 40, end: 100 },
  ];
  const stops = buildGradientStopOffsets(zones, 0.5);
  const separatorOffsets = stops.filter((s) => s.state === SEPARATOR_STATE).map((s) => s.offset);
  assert.deepEqual(separatorOffsets, [39.5, 40.5]);

  const myytyOffsets = stops.filter((s) => s.state === SEAT_STATE.MYYTY).map((s) => s.offset);
  assert.deepEqual(myytyOffsets, [0, 39.5]); // shrunk on its own separator-adjacent edge, untouched at the outer 0% edge

  const vapaaOffsets = stops.filter((s) => s.state === SEAT_STATE.VAPAA).map((s) => s.offset);
  assert.deepEqual(vapaaOffsets, [40.5, 100]); // same, at the outer 100% edge
});

test("buildGradientStopOffsets: three real zones produce two separator bands", () => {
  const zones = [
    { state: SEAT_STATE.KAUSIKORTTI, start: 0, end: 30 },
    { state: SEAT_STATE.IRTOLIPPU, start: 30, end: 60 },
    { state: SEAT_STATE.VAPAA, start: 60, end: 100 },
  ];
  const stops = buildGradientStopOffsets(zones, 0.5);
  const separatorOffsets = stops.filter((s) => s.state === SEPARATOR_STATE).map((s) => s.offset);
  assert.deepEqual(separatorOffsets, [29.5, 30.5, 59.5, 60.5]);

  // The middle zone is shrunk on both edges — it has a real neighbor on either side.
  const irtolippuOffsets = stops.filter((s) => s.state === SEAT_STATE.IRTOLIPPU).map((s) => s.offset);
  assert.deepEqual(irtolippuOffsets, [30.5, 59.5]);
});

test("buildGradientStopOffsets: a single real zone (sold-out or fully-free) produces no separator at all", () => {
  const soldOut = buildGradientStopOffsets([{ state: SEAT_STATE.MYYTY, start: 0, end: 100 }], 0.5);
  assert.equal(soldOut.filter((s) => s.state === SEPARATOR_STATE).length, 0);
  assert.deepEqual(soldOut, [{ offset: 0, state: SEAT_STATE.MYYTY }, { offset: 100, state: SEAT_STATE.MYYTY }]);

  const fullyFree = buildGradientStopOffsets(
    [
      { state: SEAT_STATE.MYYTY, start: 0, end: 0 },
      { state: SEAT_STATE.VAPAA, start: 0, end: 100 },
    ],
    0.5
  );
  assert.equal(fullyFree.filter((s) => s.state === SEPARATOR_STATE).length, 0);
});

test("buildGradientStopOffsets: a zero-share zone between two real ones makes its neighbors adjacent, not stray-bounded", () => {
  // No irtolippu at all — every sold seat is kausikortti.
  const zones = [
    { state: SEAT_STATE.KAUSIKORTTI, start: 0, end: 40 },
    { state: SEAT_STATE.IRTOLIPPU, start: 40, end: 40 },
    { state: SEAT_STATE.VAPAA, start: 40, end: 100 },
  ];
  const stops = buildGradientStopOffsets(zones, 0.5);
  assert.equal(stops.filter((s) => s.state === SEAT_STATE.IRTOLIPPU).length, 0); // the zero-share zone contributes nothing
  const separatorOffsets = stops.filter((s) => s.state === SEPARATOR_STATE).map((s) => s.offset);
  assert.deepEqual(separatorOffsets, [39.5, 40.5]); // exactly one band, between the two real survivors
});
