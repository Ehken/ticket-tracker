export function findValueAtOrBefore(historyPoints, cutoffIso) {
  const cutoff = new Date(cutoffIso).getTime();
  let best = null;
  let bestTime = -Infinity;

  for (const point of historyPoints) {
    const t = new Date(point.t).getTime();
    if (t <= cutoff && t > bestTime) {
      best = point;
      bestTime = t;
    }
  }

  return best;
}

export function computeDelta(historyPoints, latestSold, hoursAgo, nowIso) {
  const cutoffIso = new Date(new Date(nowIso).getTime() - hoursAgo * 3600 * 1000).toISOString();
  const point = findValueAtOrBefore(historyPoints, cutoffIso);
  if (!point) return null;
  return latestSold - point.sold;
}

export function computeTopMovers(matchEventsWithHistory, hoursAgo, nowIso) {
  return matchEventsWithHistory
    .map((event) => ({
      event,
      delta: computeDelta(event.history, event.latest.totals.sold, hoursAgo, nowIso),
    }))
    .filter((entry) => entry.delta !== null && entry.delta > 0)
    .sort((a, b) => b.delta - a.delta);
}

export function computeSelloutEstimate({ available, historyPoints, latestSold, nowIso }) {
  // Deliberately uses `available` (ostettavissa), not `total - sold` — total
  // includes seats that can never sell (disabled sections, aitiot, press),
  // which would make the estimate far too optimistic.
  //
  // Note: `available` can jump upward in one step if SaiPa releases a held
  // block (e.g. unused away-fan quota) into sale on game day — a section
  // leaves `disabled`, hold drops, available rises, sold is unchanged. The
  // estimate is based on current inventory and pace, and self-corrects on
  // the next fetch after such a release.
  if (available <= 0) return null;

  const velocity7d = computeDelta(historyPoints, latestSold, 7 * 24, nowIso);
  if (velocity7d === null || velocity7d <= 0) return null;

  const dailyVelocity = velocity7d / 7;
  const daysToSellout = available / dailyVelocity;
  const estimatedDate = new Date(new Date(nowIso).getTime() + daysToSellout * 86400 * 1000).toISOString();

  return { estimatedDate, daysToSellout, isEstimate: true };
}
