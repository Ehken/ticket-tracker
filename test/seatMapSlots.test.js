import { test } from "node:test";
import assert from "node:assert/strict";
import { SEAT_STATE } from "../js/seatMapClassify.js";
import { computeSlotSplit, WHEELCHAIR_SLOT_COUNT } from "../js/seatMapSlots.js";

test("computeSlotSplit: 3-state split — kausikortti slots, then irtolippu, then vapaa", () => {
  const slots = computeSlotSplit({ sold: 7, kausikorttiSold: 4 });
  assert.deepEqual(slots, [
    SEAT_STATE.KAUSIKORTTI,
    SEAT_STATE.KAUSIKORTTI,
    SEAT_STATE.KAUSIKORTTI,
    SEAT_STATE.KAUSIKORTTI,
    SEAT_STATE.IRTOLIPPU,
    SEAT_STATE.IRTOLIPPU,
    SEAT_STATE.IRTOLIPPU,
    SEAT_STATE.VAPAA,
    SEAT_STATE.VAPAA,
    SEAT_STATE.VAPAA,
    SEAT_STATE.VAPAA,
    SEAT_STATE.VAPAA,
  ]);
  assert.equal(slots.length, WHEELCHAIR_SLOT_COUNT);
});

test("computeSlotSplit: no baseline collapses to the 2-state myyty/vapaa fallback", () => {
  const slots = computeSlotSplit({ sold: 6 });
  assert.equal(slots.filter((s) => s === SEAT_STATE.MYYTY).length, 6);
  assert.equal(slots.filter((s) => s === SEAT_STATE.VAPAA).length, 6);
  assert.ok(slots.every((s) => s === SEAT_STATE.MYYTY || s === SEAT_STATE.VAPAA));
});

test("computeSlotSplit: 0 sold is all vapaa, with or without a baseline", () => {
  assert.ok(computeSlotSplit({ sold: 0, kausikorttiSold: 0 }).every((s) => s === SEAT_STATE.VAPAA));
  assert.ok(computeSlotSplit({ sold: 0 }).every((s) => s === SEAT_STATE.VAPAA));
});

test("computeSlotSplit: 12 sold (fully sold out) leaves no vapaa slots", () => {
  const slots = computeSlotSplit({ sold: 12, kausikorttiSold: 8 });
  assert.equal(slots.filter((s) => s === SEAT_STATE.KAUSIKORTTI).length, 8);
  assert.equal(slots.filter((s) => s === SEAT_STATE.IRTOLIPPU).length, 4);
  assert.equal(slots.filter((s) => s === SEAT_STATE.VAPAA).length, 0);
});

test("computeSlotSplit: kausikorttiSold > sold is defensively clamped, never producing negative irtolippu slots", () => {
  const slots = computeSlotSplit({ sold: 5, kausikorttiSold: 10 });
  assert.equal(slots.filter((s) => s === SEAT_STATE.KAUSIKORTTI).length, 5);
  assert.equal(slots.filter((s) => s === SEAT_STATE.IRTOLIPPU).length, 0);
  assert.equal(slots.filter((s) => s === SEAT_STATE.VAPAA).length, 7);
});

test("computeSlotSplit: sold beyond capacity is defensively clamped to 12", () => {
  const slots = computeSlotSplit({ sold: 999, kausikorttiSold: 999 });
  assert.equal(slots.length, WHEELCHAIR_SLOT_COUNT);
  assert.ok(slots.every((s) => s === SEAT_STATE.KAUSIKORTTI));
});

test("computeSlotSplit: disabled paints the remainder slots ei-myynnissa instead of vapaa (3-state)", () => {
  const slots = computeSlotSplit({ sold: 7, kausikorttiSold: 4, disabled: true });
  assert.equal(slots.filter((s) => s === SEAT_STATE.KAUSIKORTTI).length, 4);
  assert.equal(slots.filter((s) => s === SEAT_STATE.IRTOLIPPU).length, 3);
  assert.equal(slots.filter((s) => s === SEAT_STATE.EI_MYYNNISSA).length, 5);
  assert.equal(slots.filter((s) => s === SEAT_STATE.VAPAA).length, 0);
});

test("computeSlotSplit: disabled paints the remainder slots ei-myynnissa instead of vapaa (2-state, no baseline)", () => {
  const slots = computeSlotSplit({ sold: 6, disabled: true });
  assert.equal(slots.filter((s) => s === SEAT_STATE.MYYTY).length, 6);
  assert.equal(slots.filter((s) => s === SEAT_STATE.EI_MYYNNISSA).length, 6);
  assert.equal(slots.filter((s) => s === SEAT_STATE.VAPAA).length, 0);
});

test("computeSlotSplit: not disabled (default) still leaves the remainder vapaa", () => {
  const slots = computeSlotSplit({ sold: 7, kausikorttiSold: 4 });
  assert.equal(slots.filter((s) => s === SEAT_STATE.VAPAA).length, 5);
});
