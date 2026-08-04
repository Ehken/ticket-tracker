import { test } from "node:test";
import assert from "node:assert/strict";
import { heatColor } from "../js/dashboardHeatmap.js";

test("heatColor endpoints and clamping", () => {
  assert.equal(heatColor(0), "#f3ead1"); // vapaa sand
  assert.equal(heatColor(0.85), "#ffd400"); // irtolippu yellow
  assert.equal(heatColor(1), "#f5a600"); // sold-out amber
  assert.equal(heatColor(-1), heatColor(0));
  assert.equal(heatColor(2), heatColor(1));
});

test("heatColor interpolates monotonically toward yellow", () => {
  // green channel: d1 (209) at 0 -> d4 (212) at 0.85; red rises f3 -> ff
  const mid = heatColor(0.425);
  assert.match(mid, /^#[0-9a-f]{6}$/);
  assert.notEqual(mid, heatColor(0));
  assert.notEqual(mid, heatColor(0.85));
});

test("heatColor handles missing data", () => {
  assert.equal(heatColor(null), "#e4e4e4");
  assert.equal(heatColor(undefined), "#e4e4e4");
  assert.equal(heatColor(NaN), "#e4e4e4");
});
