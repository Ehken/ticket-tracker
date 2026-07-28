import { SEAT_STATE } from "./seatMapClassify.js";

// Bottom-up zone list for a vertical hard-stop gradient, expressed as
// percentages of section capacity. `kausikorttiSold` null/undefined
// collapses to the 2-zone fallback (kausikortti event's own map, or a
// match event with no tracked season baseline) — the same "no baseline"
// condition seatMap.js's resolveBaseline/updateInfoRow already use for
// these same aggregate rows. `disabled` paints the unsold remainder
// ei-myynnissa instead of vapaa — mirrors how a closed seated section's
// unsold seats render, for the same reason (hold = total - sold, so a
// closed section's remainder is "not on sale", not "free").
export function computeStackedFillZones({ sold, total, kausikorttiSold = null, disabled = false }) {
  const soldPct = pct(sold, total);
  const remainderState = disabled ? SEAT_STATE.EI_MYYNNISSA : SEAT_STATE.VAPAA;

  if (kausikorttiSold == null) {
    return [
      { state: SEAT_STATE.MYYTY, start: 0, end: soldPct },
      { state: remainderState, start: soldPct, end: 100 },
    ];
  }

  const basePct = Math.min(pct(kausikorttiSold, total), soldPct); // defensive: never exceed sold
  return [
    { state: SEAT_STATE.KAUSIKORTTI, start: 0, end: basePct },
    { state: SEAT_STATE.IRTOLIPPU, start: basePct, end: soldPct },
    { state: remainderState, start: soldPct, end: 100 },
  ];
}

function pct(value, total) {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, value / total)) * 100;
}

// Enforces a minimum share (percent) for every zone whose raw share is
// nonzero, shrinking the others proportionally so the total still sums to
// 100 — used so a zone's own count (e.g. "12" remaining out of 2138) always
// has room to render instead of being squeezed into an unreadable sliver.
// Zero-share zones are left at zero (a sold-out or fully-unsold wedge has
// no "phantom" zone appearing out of nowhere).
//
// Iterative because clamping one zone changes how much space is left for
// the others, which can in turn push a previously-fine zone under the
// minimum too (two simultaneously-tiny zones) — each pass clamps whatever
// is still under the minimum and redistributes the remainder among the
// rest, converging in at most one pass per zone.
export function clampZoneSpansToMinimum(zones, minSharePct) {
  const shares = zones.map((z) => z.end - z.start);
  const nonZeroIdx = shares.reduce((acc, s, i) => (s > 1e-9 ? [...acc, i] : acc), []);

  if (nonZeroIdx.length === 0) return zones.map((z) => ({ ...z }));

  // Infeasible: more nonzero zones than the available space can give each
  // its minimum. Split what's there evenly instead of clamping to a
  // minimum that can't actually be honored.
  if (minSharePct * nonZeroIdx.length >= 100) {
    const evenShare = 100 / nonZeroIdx.length;
    return rebuildSpans(zones, shares.map((s, i) => (nonZeroIdx.includes(i) ? evenShare : 0)));
  }

  const clamped = new Set();
  let finalShares = [...shares];

  for (let pass = 0; pass < nonZeroIdx.length; pass++) {
    const remainingIdx = nonZeroIdx.filter((i) => !clamped.has(i));
    const remainingTotal = 100 - clamped.size * minSharePct;
    const remainingShareSum = remainingIdx.reduce((sum, i) => sum + shares[i], 0);

    for (const i of remainingIdx) {
      finalShares[i] = remainingShareSum > 0 ? (shares[i] / remainingShareSum) * remainingTotal : 0;
    }
    for (const i of clamped) finalShares[i] = minSharePct;

    let changed = false;
    for (const i of remainingIdx) {
      if (finalShares[i] < minSharePct - 1e-9) {
        clamped.add(i);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return rebuildSpans(zones, finalShares);
}

function rebuildSpans(zones, finalShares) {
  let cursor = 0;
  return zones.map((z, i) => {
    const start = cursor;
    cursor += finalShares[i];
    return { ...z, start, end: cursor };
  });
}

// Sentinel state for a gradient stop that belongs to a separator band,
// not a real zone — distinct from every SEAT_STATE value.
export const SEPARATOR_STATE = "separator";

// The wedge's hard-cut gradient (two stops at the same offset = an
// instant color change, no blend) produces zero *visible* boundary when
// the two adjacent zones are both pale — irtolippu/vapaa measure
// 1.19:1, well under the 3:1 non-text UI needs. Same problem as the
// fill bar's own zones, in gradient form, with the same fix: a thin
// separator band at every boundary between two zones that both
// genuinely have width, and none at the outer 0%/100% edges (already
// bounded by the shape's own outline) or next to a zero-share zone
// (nothing real to separate from — clampZoneSpansToMinimum already
// leaves those at zero rather than inventing a phantom span for them).
// Filtering zero-span zones out first and treating the survivors as
// simply adjacent handles every real shape uniformly: a single real
// zone (sold-out or fully-free) produces no separator at all; a
// zero-share zone sitting between two real ones (e.g. no irtolippu
// sold, all kausikortti) correctly makes its neighbors adjacent to each
// other instead of leaving a stray boundary around an invisible zone.
export function buildGradientStopOffsets(zones, separatorHalfBandPct) {
  const realZones = zones.filter((zone) => zone.end > zone.start);
  const stops = [];

  realZones.forEach((zone, i) => {
    const hasSeparatorBefore = i > 0;
    const hasSeparatorAfter = i < realZones.length - 1;
    const start = hasSeparatorBefore ? zone.start + separatorHalfBandPct : zone.start;
    const end = hasSeparatorAfter ? zone.end - separatorHalfBandPct : zone.end;

    if (hasSeparatorBefore) {
      stops.push({ offset: zone.start - separatorHalfBandPct, state: SEPARATOR_STATE });
      stops.push({ offset: zone.start + separatorHalfBandPct, state: SEPARATOR_STATE });
    }
    stops.push({ offset: start, state: zone.state });
    stops.push({ offset: end, state: zone.state });
  });

  return stops;
}
