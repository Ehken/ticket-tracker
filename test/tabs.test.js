import { test } from "node:test";
import assert from "node:assert/strict";
import { nextTabIndex } from "../js/tabs.js";

test("ArrowRight moves to the next index", () => {
  assert.equal(nextTabIndex(0, "ArrowRight", 2), 1);
});

test("ArrowRight wraps from the last index to the first", () => {
  assert.equal(nextTabIndex(1, "ArrowRight", 2), 0);
});

test("ArrowLeft moves to the previous index", () => {
  assert.equal(nextTabIndex(1, "ArrowLeft", 2), 0);
});

test("ArrowLeft wraps from the first index to the last", () => {
  assert.equal(nextTabIndex(0, "ArrowLeft", 2), 1);
});

test("Home always selects the first index", () => {
  assert.equal(nextTabIndex(1, "Home", 3), 0);
});

test("End always selects the last index", () => {
  assert.equal(nextTabIndex(0, "End", 3), 2);
});

test("an unrecognized key leaves the current index unchanged", () => {
  assert.equal(nextTabIndex(1, "Enter", 3), 1);
});
