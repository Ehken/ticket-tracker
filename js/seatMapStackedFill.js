import { SEAT_STATE } from "./seatMapClassify.js";

// Bottom-up zone list for a vertical hard-stop gradient, expressed as
// percentages of section capacity. `kausikorttiSold` null/undefined
// collapses to the 2-zone fallback (kausikortti event's own map, or a
// match event with no tracked season baseline) — the same "no baseline"
// condition seatMap.js's resolveBaseline/updateInfoRow already use for
// these same aggregate rows.
export function computeStackedFillZones({ sold, total, kausikorttiSold = null }) {
  const soldPct = pct(sold, total);

  if (kausikorttiSold == null) {
    return [
      { state: SEAT_STATE.MYYTY, start: 0, end: soldPct },
      { state: SEAT_STATE.VAPAA, start: soldPct, end: 100 },
    ];
  }

  const basePct = Math.min(pct(kausikorttiSold, total), soldPct); // defensive: never exceed sold
  return [
    { state: SEAT_STATE.KAUSIKORTTI, start: 0, end: basePct },
    { state: SEAT_STATE.IRTOLIPPU, start: basePct, end: soldPct },
    { state: SEAT_STATE.VAPAA, start: soldPct, end: 100 },
  ];
}

function pct(value, total) {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, value / total)) * 100;
}
