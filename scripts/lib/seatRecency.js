// Pure diff/decay logic for "recently freed" / "recently sold" seat marks
// — no DOM, no filesystem. A single-run diff of previous vs. current
// soldSeatIds is deliberate, not a placeholder for a multi-run candidate
// system: for a buyer, "this seat is available right now" is true
// whether the cause was a cancellation or an expired cart, and any
// persistence-across-runs filter would delay exactly the marks that
// matter most. The always-a-few-marks consequence (measured against real
// history.json data: 37 of 76 points had `sold` decrease, typically by
// 1-4 seats) is accepted and handled visually/by an off switch, not here.
//
// Follow-up, recorded rather than built: if real-world use shows churn
// marks drowning out genuine cancellations, the next lever is requiring
// persistence across two consecutive runs before marking. Not built now
// — immediacy was chosen first on purpose.
//
// The 24h cap is measured in wall-clock time from detectedAtISO, not a
// run count — so it behaves asymmetrically around the intensive-scrape
// window: a mark from just before a quiet night persists through the
// whole night, while one from early on a game day (10-minute cadence)
// expires mid-evening. Accepted, not a bug.

export const RECENCY_CAP_MS = 24 * 60 * 60 * 1000;

// A mark's two timestamps answer different questions and must not be
// swapped: `detectedAtISO` is when WE first saw the transition (this
// run's own nowISO) — the honest anchor for the 24h cap, since it's our
// actual observation window, not an estimate. `sinceISO` is the
// *previous* run's own fetchedAt — the last confirmed moment before the
// transition, and the only truthful anchor for a user-facing "vapautunut
// X jälkeen" claim: the seat was already free AT that moment, whereas
// claiming it based on detectedAtISO would assert the opposite (that it
// froze up to and including the moment we happened to notice).
export function computeSeatRecency({
  previousSoldSeatIds,
  previousSvgHash,
  currentSvgHash,
  currentSoldSeatIds,
  previousFreed,
  previousSold,
  previousFetchedAtISO,
  nowISO,
}) {
  // A capacities-hash change means the two snapshots don't describe the
  // same map — seat ids can shift meaning or disappear entirely between
  // them. Treated as fully invalidating: skip the diff AND clear every
  // existing mark, rather than let the whole delta between two different
  // maps read as a burst of freed/sold activity (potentially hundreds of
  // phantom marks, each persisting 24h). Same reasoning
  // appendSectionHistoryPointIfChanged already applies to sectionHistory
  // generations on a capacitiesHash change. This single check also
  // covers "no prior recency file at all" (a brand-new event, or one
  // scraped before this feature existed) — previousSvgHash is null
  // there, which can never equal a real current hash.
  if (previousSvgHash !== currentSvgHash) {
    return { freed: {}, sold: {} };
  }

  const prevSoldSet = new Set(previousSoldSeatIds);
  const currSoldSet = new Set(currentSoldSeatIds);
  const now = new Date(nowISO).getTime();

  const freed = { ...previousFreed };
  const sold = { ...previousSold };

  for (const id of prevSoldSet) {
    if (!currSoldSet.has(id)) {
      delete sold[id]; // re-sold, then freed again within one diff step can't happen — this is the freed mirror
      if (!(id in freed)) freed[id] = { sinceISO: previousFetchedAtISO, detectedAtISO: nowISO };
    }
  }
  for (const id of currSoldSet) {
    if (!prevSoldSet.has(id)) {
      delete freed[id]; // re-sold — the mark drops from freed
      if (!(id in sold)) sold[id] = { sinceISO: previousFetchedAtISO, detectedAtISO: nowISO };
    }
  }

  function prune(map) {
    const result = {};
    for (const id of Object.keys(map).sort()) {
      const entry = map[id];
      if (now - new Date(entry.detectedAtISO).getTime() < RECENCY_CAP_MS) result[id] = entry;
    }
    return result;
  }

  return { freed: prune(freed), sold: prune(sold) };
}
