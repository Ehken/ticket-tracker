import { test } from "node:test";
import assert from "node:assert/strict";
import { sectionLabel, SECTION_LABELS } from "../js/sectionLabels.js";

test("sectionLabel translates the standing section to Kaukaan pääty", () => {
  assert.equal(sectionLabel("seisomakatsomo"), "Kaukaan pääty");
});

test("sectionLabel translates the other three aggregate keys", () => {
  assert.equal(sectionLabel("invalid"), "Pyörätuolipaikat");
  assert.equal(sectionLabel("aitiot"), "Aitiot");
  assert.equal(sectionLabel("press"), "Lehdistö");
});

test("sectionLabel passes seated sections through unchanged", () => {
  assert.equal(sectionLabel("A1"), "A1");
  assert.equal(sectionLabel("C4"), "C4");
});

test("sectionLabel falls back to the raw key for anything unmapped", () => {
  assert.equal(sectionLabel("unknown-key"), "unknown-key");
});

test("SECTION_LABELS does not use the old 'Seisomakatsomo' spelling anywhere", () => {
  assert.ok(!Object.values(SECTION_LABELS).includes("Seisomakatsomo"));
});
