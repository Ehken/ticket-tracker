import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBaselineIndex } from "../js/dashboardBaseline.js";
import {
  computeKiirehdiRanking,
  computeOpponentDemand,
  computeOpponentTiers,
  computeSectionSelloutRank,
} from "../js/dashboardRankings.js";

const BASELINE_INDEX = buildBaselineIndex([
  {
    season: "2026-27",
    latest: {
      totals: { sold: 2552, available: 1828, hold: 596, total: 4976 },
      sections: [
        { section: "C4", sold: 100, total: 120 },
        { section: "A1", sold: 90, total: 171 },
        { section: "seisomakatsomo", sold: 1000, total: 2138 },
      ],
    },
  },
]);

function game({ id = "id", name = "SaiPa - Tappara", gameType = "runkosarja", sold, total = 4976, sections = [] }) {
  return {
    id,
    name,
    gameType,
    season: "2026-27",
    latest: {
      totals: { sold, available: total - sold, hold: 0, total },
      sections: sections.length
        ? sections
        : [
            { section: "C4", sold: 100, total: 120 },
            { section: "A1", sold: 90, total: 171 },
            { section: "seisomakatsomo", sold: 1000, total: 2138 },
          ],
    },
  };
}

test("computeKiirehdiRanking includes an event via the overall fill-threshold trigger", () => {
  // baseline=2552, total=4976 -> non-baseline capacity=2424; sold=4200 -> irtoliput=1648 -> fillPct ~0.68... need >=0.7
  const highFill = game({ id: "high", sold: 4230 }); // irtoliput=1678/2424=0.692 -> bump higher
  const veryHighFill = game({ id: "very-high", sold: 4300 }); // irtoliput=1748/2424=0.721 -> qualifies
  const lowFill = game({ id: "low", sold: 2600 }); // irtoliput=48/2424=0.02 -> doesn't qualify

  const ranking = computeKiirehdiRanking([veryHighFill, lowFill], BASELINE_INDEX);
  assert.deepEqual(
    ranking.map((r) => r.event.id),
    ["very-high"]
  );
});

test("computeKiirehdiRanking includes an event via the premium-section trigger even with modest overall fill", () => {
  // Overall fill stays low, but C4 (premium) is nearly sold out on its own.
  const premiumNearSoldOut = game({
    id: "premium-scarce",
    sold: 2600, // overall irtoliput fillPct ~0.02, well under threshold
    sections: [
      { section: "C4", sold: 118, total: 120 }, // baseline 100 -> irtoliput=18/(120-100)=0.9 -> exactly at threshold
      { section: "A1", sold: 91, total: 171 },
      { section: "seisomakatsomo", sold: 1001, total: 2138 },
    ],
  });

  const ranking = computeKiirehdiRanking([premiumNearSoldOut], BASELINE_INDEX);
  assert.equal(ranking.length, 1);
  assert.deepEqual(ranking[0].premiumTriggers, ["C4"]);
});

test("computeKiirehdiRanking excludes an event that triggers neither condition", () => {
  const boring = game({ id: "boring", sold: 2600 });
  assert.deepEqual(computeKiirehdiRanking([boring], BASELINE_INDEX), []);
});

test("computeKiirehdiRanking sorts qualifying events by overall irtolippu fill % descending", () => {
  const a = game({ id: "a", sold: 4300 }); // ~0.72
  const b = game({ id: "b", sold: 4700 }); // ~0.887
  const ranking = computeKiirehdiRanking([a, b], BASELINE_INDEX);
  assert.deepEqual(
    ranking.map((r) => r.event.id),
    ["b", "a"]
  );
});

test("computeOpponentDemand groups by opponent, averages fill %, sums irtoliput, tags gameType", () => {
  const g1 = game({ id: "g1", name: "SaiPa - Tappara", gameType: "runkosarja", sold: 3000 });
  const g2 = game({ id: "g2", name: "SaiPa - Tappara", gameType: "runkosarja", sold: 3400 });
  const g3 = game({ id: "g3", name: "SaiPa - Dynamo Pardubice", gameType: "chl", sold: 2600 });

  const demand = computeOpponentDemand([g1, g2, g3], BASELINE_INDEX);
  const tappara = demand.find((d) => d.opponent === "Tappara");
  assert.equal(tappara.gameCount, 2);
  assert.deepEqual(tappara.gameTypes, ["runkosarja"]);

  const pardubice = demand.find((d) => d.opponent === "Dynamo Pardubice");
  assert.equal(pardubice.gameCount, 1);
  assert.deepEqual(pardubice.gameTypes, ["chl"]);
});

test("computeOpponentTiers splits top-third into 'big', rest into 'small'", () => {
  const opponents = [
    { opponent: "A", avgIrtolippuFillPct: 0.9 },
    { opponent: "B", avgIrtolippuFillPct: 0.7 },
    { opponent: "C", avgIrtolippuFillPct: 0.5 },
    { opponent: "D", avgIrtolippuFillPct: 0.3 },
    { opponent: "E", avgIrtolippuFillPct: 0.1 },
    { opponent: "F", avgIrtolippuFillPct: 0.05 },
  ];
  const tiers = computeOpponentTiers(opponents);
  assert.deepEqual(
    tiers.filter((t) => t.tier === "big").map((t) => t.opponent),
    ["A", "B"]
  );
  assert.deepEqual(
    tiers.filter((t) => t.tier === "small").map((t) => t.opponent),
    ["C", "D", "E", "F"]
  );
});

test("computeOpponentTiers treats a single opponent as trivially 'big'", () => {
  const tiers = computeOpponentTiers([{ opponent: "Solo", avgIrtolippuFillPct: 0.4 }]);
  assert.equal(tiers[0].tier, "big");
});

test("computeSectionSelloutRank requires at least 2 match events", () => {
  assert.equal(computeSectionSelloutRank([game({ id: "only-one", sold: 3000 })], BASELINE_INDEX), null);
});

test("computeSectionSelloutRank averages irtolippu fill % per section across games, sorted descending", () => {
  const g1 = game({
    id: "g1",
    sold: 3000,
    sections: [
      { section: "C4", sold: 119, total: 120 }, // near-full -> high irtolippu fillPct
      { section: "A1", sold: 91, total: 171 },
    ],
  });
  const g2 = game({
    id: "g2",
    sold: 3200,
    sections: [
      { section: "C4", sold: 105, total: 120 },
      { section: "A1", sold: 130, total: 171 }, // A1 sells better here
    ],
  });

  const rank = computeSectionSelloutRank([g1, g2], BASELINE_INDEX);
  assert.ok(rank[0].avgIrtolippuFillPct >= rank[1].avgIrtolippuFillPct);
  assert.deepEqual(
    rank.map((r) => r.section).sort(),
    ["A1", "C4"]
  );
});
