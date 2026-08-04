import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeClassification, toDashId } from "../js/classify.js";

const baseEvent = {
  id: "53:575",
  name: "SaiPa kausikortit 2026-2027",
  status: "upcoming",
  start: "2026-08-01T00:00:00.000Z",
  firstSeen: "t0",
  lastSeen: "t1",
};

test("toDashId converts colon ids to the directory-safe dash form", () => {
  assert.equal(toDashId("53:575"), "53-575");
});

test("mergeClassification precedence: overrides > autoclass > defaults", () => {
  const merged = mergeClassification(baseEvent, {
    overrides: { "53-575": { gameType: "kausikortti" } },
    autoclass: { "53-575": { gameType: "runkosarja", season: "2026-27" } },
  });
  assert.equal(merged.gameType, "kausikortti"); // override wins
  assert.equal(merged.season, "2026-27"); // autoclass fills what the override doesn't set

  const unclassified = mergeClassification(baseEvent, { overrides: {}, autoclass: {} });
  assert.equal(unclassified.gameType, "muu");
  assert.equal(unclassified.season, null);
});

test("mergeClassification passes seasonBaselineFrozen through from overrides only, defaulting false", () => {
  const frozen = mergeClassification(baseEvent, {
    overrides: { "53-575": { gameType: "kausikortti", season: "2026-27", seasonBaselineFrozen: true } },
    autoclass: {},
  });
  assert.equal(frozen.seasonBaselineFrozen, true);

  const notFrozen = mergeClassification(baseEvent, {
    overrides: { "53-575": { gameType: "kausikortti" } },
    autoclass: {},
  });
  assert.equal(notFrozen.seasonBaselineFrozen, false);

  // autoclass can never set the pin — it's a human-owned decision.
  const autoclassTriesToFreeze = mergeClassification(baseEvent, {
    overrides: {},
    autoclass: { "53-575": { gameType: "kausikortti", seasonBaselineFrozen: true } },
  });
  assert.equal(autoclassTriesToFreeze.seasonBaselineFrozen, false);
});
