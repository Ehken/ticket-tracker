import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findValueAtOrBefore,
  computeDelta,
  computeTopMovers,
  computeSelloutEstimate,
} from "../js/dashboardTrends.js";

const NOW = "2026-10-15T12:00:00.000Z";

const HISTORY = [
  { t: "2026-09-01T12:00:00.000Z", sold: 100 },
  { t: "2026-10-08T12:00:00.000Z", sold: 300 }, // ~7 days before NOW
  { t: "2026-10-14T12:00:00.000Z", sold: 340 }, // ~24h before NOW
  { t: "2026-10-15T12:00:00.000Z", sold: 350 }, // NOW itself
];

test("findValueAtOrBefore returns the latest point at or before the cutoff", () => {
  const point = findValueAtOrBefore(HISTORY, "2026-10-14T12:00:00.000Z");
  assert.equal(point.sold, 340);
});

test("findValueAtOrBefore returns null when history doesn't reach that far back", () => {
  const point = findValueAtOrBefore(HISTORY, "2026-08-01T00:00:00.000Z");
  assert.equal(point, null);
});

test("computeDelta returns latestSold minus the value at the cutoff", () => {
  const delta24h = computeDelta(HISTORY, 350, 24, NOW);
  assert.equal(delta24h, 350 - 340);

  const delta7d = computeDelta(HISTORY, 350, 7 * 24, NOW);
  assert.equal(delta7d, 350 - 300);
});

test("computeDelta returns null when there's no data far enough back", () => {
  const shortHistory = [{ t: "2026-10-15T06:00:00.000Z", sold: 349 }];
  assert.equal(computeDelta(shortHistory, 350, 7 * 24, NOW), null);
});

test("computeDelta correctly produces a non-positive value for a small mid-window sold dip", () => {
  // Cart-reservation noise: sold briefly dips before recovering.
  const dipHistory = [
    { t: "2026-10-14T00:00:00.000Z", sold: 355 },
    { t: "2026-10-14T18:00:00.000Z", sold: 350 }, // dip
  ];
  const delta = computeDelta(dipHistory, 350, 24, NOW);
  assert.equal(delta, 350 - 355);
  assert.ok(delta <= 0);
});

test("computeTopMovers sorts descending and excludes zero/negative/null deltas", () => {
  const events = [
    { id: "flat", history: [{ t: "2026-10-08T12:00:00.000Z", sold: 350 }], latest: { totals: { sold: 350 } } },
    { id: "riser", history: [{ t: "2026-10-08T12:00:00.000Z", sold: 100 }], latest: { totals: { sold: 350 } } },
    {
      // At the 7-day-ago cutoff (2026-10-08T12:00:00.000Z), sold was already
      // 355 — higher than today's 350 — a genuine dip over this window.
      id: "dip",
      history: [{ t: "2026-10-08T12:00:00.000Z", sold: 355 }],
      latest: { totals: { sold: 350 } },
    },
    { id: "no-data", history: [], latest: { totals: { sold: 350 } } },
    { id: "small-riser", history: [{ t: "2026-10-08T12:00:00.000Z", sold: 340 }], latest: { totals: { sold: 350 } } },
  ];

  const movers = computeTopMovers(events, 7 * 24, NOW);
  assert.deepEqual(
    movers.map((m) => m.event.id),
    ["riser", "small-riser"]
  );
  assert.equal(movers[0].delta, 250);
  assert.equal(movers[1].delta, 10);
});

test("computeSelloutEstimate returns a labeled estimate when velocity > 0 and available > 0", () => {
  const estimate = computeSelloutEstimate({ available: 100, historyPoints: HISTORY, latestSold: 350, nowIso: NOW });
  assert.ok(estimate);
  assert.equal(estimate.isEstimate, true);
  // velocity7d = 50 sold / 7 days -> ~7.14/day -> 100 available / 7.14 ≈ 14 days
  assert.ok(estimate.daysToSellout > 13 && estimate.daysToSellout < 15);
  assert.ok(new Date(estimate.estimatedDate).getTime() > new Date(NOW).getTime());
});

test("computeSelloutEstimate returns null when velocity <= 0 (incl. the dip case)", () => {
  const flatHistory = [{ t: "2026-10-08T12:00:00.000Z", sold: 350 }];
  assert.equal(computeSelloutEstimate({ available: 100, historyPoints: flatHistory, latestSold: 350, nowIso: NOW }), null);

  const dipHistory = [{ t: "2026-10-08T12:00:00.000Z", sold: 360 }];
  assert.equal(computeSelloutEstimate({ available: 100, historyPoints: dipHistory, latestSold: 350, nowIso: NOW }), null);
});

test("computeSelloutEstimate returns null when available <= 0, even with positive velocity", () => {
  assert.equal(computeSelloutEstimate({ available: 0, historyPoints: HISTORY, latestSold: 350, nowIso: NOW }), null);
});

test("computeSelloutEstimate uses `available`, not `total - sold` — proven with hold > 0", () => {
  // total=500, sold=350, hold=140 (disabled sections), available=10.
  // Using (total - sold) = 150 would give a wildly different (wrong) estimate
  // than using the real `available` = 10.
  const estimate = computeSelloutEstimate({ available: 10, historyPoints: HISTORY, latestSold: 350, nowIso: NOW });
  // velocity7d/day ≈ 7.14 -> 10 available / 7.14 ≈ 1.4 days
  assert.ok(estimate.daysToSellout > 1 && estimate.daysToSellout < 2);
});
