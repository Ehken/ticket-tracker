import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSectionPrice, findCheapestAvailableSection, formatPrice } from "../js/prices.js";

// Shapes taken from the real event, data/events/53-575/latest.json.
const REAL_PRICES = {
  priceGroups: {
    seisomakatsomo: "8",
    D1: "7",
    C1: "6",
    A1: "7",
    invalid: "9",
  },
  productPrices: {
    "6": { "956": 852 },
    "7": { "956": 852, "957": 577 },
    "8": { "959": 405, "960": 179 },
    "9": { "961": 405, "1195": 179 },
  },
  products: {
    "956": { id: "956", name: "Kategoria 2" },
    "957": { id: "957", name: "Eläk., Opiskelija, Lapsi 7-15v" },
    "959": { id: "959", name: "Seisomakatsomo" },
    "960": { id: "960", name: "Junnukatsomo 7-18v" },
    "961": { id: "961", name: "Pyörätuoli" },
    "1195": { id: "1195", name: "Pyörätuoli Lapset" },
  },
};

test("resolveSectionPrice headlines the max (unrestricted adult) price, not the min", () => {
  const result = resolveSectionPrice("A1", REAL_PRICES);
  assert.equal(result.headlinePrice, 852);
  assert.deepEqual(
    result.products.sort((a, b) => b.price - a.price),
    [
      { name: "Kategoria 2", price: 852 },
      { name: "Eläk., Opiskelija, Lapsi 7-15v", price: 577 },
    ]
  );
});

test("resolveSectionPrice: a single-product group headlines that product", () => {
  const result = resolveSectionPrice("C1", REAL_PRICES);
  assert.equal(result.headlinePrice, 852);
  assert.deepEqual(result.products, [{ name: "Kategoria 2", price: 852 }]);
});

test("resolveSectionPrice returns null for a section with no priceGroups entry (aitiot/press)", () => {
  assert.equal(resolveSectionPrice("aitiot", REAL_PRICES), null);
  assert.equal(resolveSectionPrice("press", REAL_PRICES), null);
});

test("resolveSectionPrice returns null (never throws) for a group id with no productPrices entry", () => {
  const prices = { priceGroups: { A1: "99" }, productPrices: {}, products: {} };
  assert.equal(resolveSectionPrice("A1", prices), null);
});

test("resolveSectionPrice returns null (never throws) for a group with an empty product list", () => {
  const prices = { priceGroups: { A1: "6" }, productPrices: { "6": {} }, products: {} };
  assert.equal(resolveSectionPrice("A1", prices), null);
});

test("resolveSectionPrice falls back to the product id when products[id].name is missing", () => {
  const prices = { priceGroups: { A1: "6" }, productPrices: { "6": { "956": 852 } }, products: {} };
  assert.deepEqual(resolveSectionPrice("A1", prices).products, [{ name: "956", price: 852 }]);
});

test("resolveSectionPrice never throws on a fully empty prices object", () => {
  assert.equal(resolveSectionPrice("A1", {}), null);
});

function row({ section, available, disabled = false }) {
  return { section, available, disabled, sold: 0, hold: 0, total: 100 };
}

test("findCheapestAvailableSection picks the lowest headline price among available, non-disabled sections", () => {
  const sections = [row({ section: "seisomakatsomo", available: 10 }), row({ section: "A1", available: 5 })];
  assert.deepEqual(findCheapestAvailableSection(sections, REAL_PRICES), {
    section: "seisomakatsomo",
    price: 405,
  });
});

test("findCheapestAvailableSection skips sections with available: 0", () => {
  const sections = [row({ section: "seisomakatsomo", available: 0 }), row({ section: "A1", available: 5 })];
  assert.deepEqual(findCheapestAvailableSection(sections, REAL_PRICES), { section: "A1", price: 852 });
});

test("findCheapestAvailableSection skips disabled sections even when available > 0", () => {
  // available > 0 alongside disabled: true shouldn't happen in practice, but
  // the function must not recommend a closed section under any input.
  const sections = [row({ section: "seisomakatsomo", available: 10, disabled: true }), row({ section: "A1", available: 5 })];
  assert.deepEqual(findCheapestAvailableSection(sections, REAL_PRICES), { section: "A1", price: 852 });
});

test("findCheapestAvailableSection excludes invalid (wheelchair spaces) even when it's the cheapest", () => {
  const sections = [row({ section: "invalid", available: 5 }), row({ section: "A1", available: 5 })];
  assert.deepEqual(findCheapestAvailableSection(sections, REAL_PRICES), { section: "A1", price: 852 });
});

test("findCheapestAvailableSection skips sections with no price data (aitiot/press)", () => {
  const sections = [row({ section: "aitiot", available: 5 }), row({ section: "A1", available: 5 })];
  assert.deepEqual(findCheapestAvailableSection(sections, REAL_PRICES), { section: "A1", price: 852 });
});

test("findCheapestAvailableSection returns null when nothing qualifies", () => {
  assert.equal(findCheapestAvailableSection([row({ section: "aitiot", available: 5 })], REAL_PRICES), null);
  assert.equal(findCheapestAvailableSection([row({ section: "A1", available: 0 })], REAL_PRICES), null);
  assert.equal(findCheapestAvailableSection([], REAL_PRICES), null);
});

test("formatPrice renders an integer with no decimals", () => {
  assert.equal(formatPrice(25), "25 €");
  assert.equal(formatPrice(1026), "1 026 €");
  assert.equal(formatPrice(0), "0 €");
});

test("formatPrice renders a non-integer with exactly two decimals, Finnish comma separator", () => {
  assert.equal(formatPrice(24.5), "24,50 €");
  assert.equal(formatPrice(24.567), "24,57 €"); // rounds, doesn't truncate or throw
});
