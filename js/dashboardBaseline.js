// Season-ticket holders occupy specific seats for every game that season —
// their seat shows "sold" in each match event's own data, not just once.
// Raw per-game sold/fill % is therefore dominated by a constant season-
// ticket floor (~51% today) and doesn't reflect actual single-game
// ("irtolippu") demand. Every dashboard aggregation is built on this one
// subtraction, applied both at the whole-event level and per-section.

export function getSeasonBaseline(kausikorttiEvents, season) {
  // Uses the CURRENT kausikortti sold count, never a historical
  // reconstruction at some past instant. Accepted nuance: for a game
  // archived mid-season while season tickets were still selling, this can
  // slightly understate that game's historical irtolippu count at the time
  // it archived — it self-heals once that season's own kausikortti event
  // archives too and its frozen sold count becomes the stable baseline.
  const match = kausikorttiEvents.find((e) => e.season === season);
  return match ? match.latest.totals.sold : 0;
}

export function buildBaselineIndex(kausikorttiEvents) {
  const index = new Map();
  for (const event of kausikorttiEvents) {
    if (event.season == null) continue;
    const sections = new Map();
    for (const row of event.latest.sections) {
      sections.set(row.section, row.sold);
    }
    index.set(event.season, { totalSold: event.latest.totals.sold, sections });
  }
  return index;
}

export function irtoliput(sold, baseline) {
  return Math.max(0, sold - baseline);
}

export function irtolippuFillPct(sold, total, baseline) {
  const denominator = total - baseline;
  if (denominator <= 0) return null;
  const value = (sold - baseline) / denominator;
  return Math.max(0, Math.min(1, value));
}

export function irtolippuSections(gameSections, baselineSectionMap) {
  return gameSections.map((row) => {
    const baselineSold = baselineSectionMap?.get(row.section) ?? 0;
    return {
      section: row.section,
      irtoliput: irtoliput(row.sold, baselineSold),
      irtolippuFillPct: irtolippuFillPct(row.sold, row.total, baselineSold),
    };
  });
}

const EMPTY_BASELINE = { totalSold: 0, sections: new Map() };

// Looks up an event's baseline entry from a pre-built index. Callers are
// expected to have already resolved each event's effective season (via
// seasonForEvent) onto `event.season` before using this — keeps every
// downstream aggregation function simple (just a season-keyed lookup).
export function baselineForEvent(event, baselineIndex) {
  return baselineIndex.get(event.season) ?? EMPTY_BASELINE;
}

export function seasonForEvent(mergedEvent, kausikorttiEvents) {
  if (mergedEvent.season != null) return mergedEvent.season;

  const eventStart = new Date(mergedEvent.start).getTime();
  const match = kausikorttiEvents.find((k) => {
    const start = new Date(k.start).getTime();
    const stop = new Date(k.latest.stop).getTime();
    return eventStart >= start && eventStart <= stop;
  });
  return match ? match.season : null;
}
