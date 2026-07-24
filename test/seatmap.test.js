import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseSeatmapSvg, parseSeatmapSeatIds, sha1Hex, resolveCapacities } from "../scripts/lib/seatmap.js";

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

test("parseSeatmapSeatIds groups actual seat IDs by section, matching the verified per-section counts", () => {
  const bySection = parseSeatmapSeatIds(fixtureSvg);
  for (const [section, count] of Object.entries(VERIFIED_CAPACITIES)) {
    assert.equal(bySection[section].length, count, `section ${section}`);
  }
});

test("parseSeatmapSeatIds returns each section's real seat IDs (SECTION-ROW-SEAT), not just counts", () => {
  const bySection = parseSeatmapSeatIds(fixtureSvg);
  assert.ok(bySection.A1.includes("A1-1-001"));
  for (const seatId of bySection.A1) {
    assert.match(seatId, /^A1-\d+-\d+$/);
  }
});

test("parseSeatmapSeatIds returns an empty object for an SVG with no seat circles", () => {
  assert.deepEqual(parseSeatmapSeatIds("<svg></svg>"), {});
});

test("sha1Hex is deterministic and content-sensitive", () => {
  const a = sha1Hex("hello");
  const b = sha1Hex("hello");
  const c = sha1Hex("hello!");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{40}$/);
});

test("resolveCapacities persists the raw SVG alongside the capacities JSON, content-addressed by hash", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "seatmap-test-"));
  const httpClient = { fetchWithRetry: async () => ({ text: async () => fixtureSvg }) };

  const { hash, capacities } = await resolveCapacities({
    mapUrl: "/seatmap.svg",
    eventBaseUrl: "https://elippu.net/saipa/53:575",
    httpClient,
    dataDir,
  });

  assert.deepEqual(capacities, VERIFIED_CAPACITIES);

  const svgPath = path.join(dataDir, "capacities", `${hash}.svg`);
  const persisted = await readFile(svgPath, "utf8");
  assert.equal(persisted, fixtureSvg);
});

test("resolveCapacities never overwrites an already-persisted SVG for the same hash", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "seatmap-test-"));
  const httpClient = { fetchWithRetry: async () => ({ text: async () => fixtureSvg }) };

  const { hash } = await resolveCapacities({
    mapUrl: "/seatmap.svg",
    eventBaseUrl: "https://elippu.net/saipa/53:575",
    httpClient,
    dataDir,
  });
  const svgPath = path.join(dataDir, "capacities", `${hash}.svg`);

  // Tamper with the persisted file, then fetch again — a real re-fetch of an
  // unchanged map must never touch the already-written file.
  await writeFile(svgPath, "TAMPERED");
  await resolveCapacities({
    mapUrl: "/seatmap.svg",
    eventBaseUrl: "https://elippu.net/saipa/53:575",
    httpClient,
    dataDir,
  });

  assert.equal(await readFile(svgPath, "utf8"), "TAMPERED");
});
