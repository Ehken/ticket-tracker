import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseSeatmapSvg, sha1Hex } from "../scripts/lib/seatmap.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureSvg = readFileSync(path.join(__dirname, "fixtures", "seatmap-sample.svg"), "utf8");

// Verified totals from saipa-lipputilanne-prompt.md — sanity check, not hardcoded runtime values.
const VERIFIED_CAPACITIES = {
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
};

test("parseSeatmapSvg matches the verified per-section capacity numbers", () => {
  const capacities = parseSeatmapSvg(fixtureSvg);
  assert.deepEqual(capacities, VERIFIED_CAPACITIES);
});

test("parseSeatmapSvg's seated total matches the verified 2646 total", () => {
  const capacities = parseSeatmapSvg(fixtureSvg);
  const total = Object.values(capacities).reduce((sum, n) => sum + n, 0);
  assert.equal(total, 2646);
});

test("parseSeatmapSvg returns an empty object for an SVG with no seat circles", () => {
  assert.deepEqual(parseSeatmapSvg("<svg></svg>"), {});
});

test("sha1Hex is deterministic and content-sensitive", () => {
  const a = sha1Hex("hello");
  const b = sha1Hex("hello");
  const c = sha1Hex("hello!");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{40}$/);
});
