export const SEAT_STATE = {
  KAUSIKORTTI: "kausikortti",
  IRTOLIPPU: "irtolippu",
  MYYTY: "myyty", // 3-state fallback (no baseline available)
  VAPAA: "vapaa",
  EI_MYYNNISSA: "ei-myynnissa",
};

export function sectionOfSeatId(seatId) {
  return seatId.slice(0, seatId.indexOf("-"));
}

// Seat ids are "section-row-seat" (e.g. "A1-6-123"), row/seat not
// fixed-width (verified against real data: row "1"/"10", seat zero-padded
// to 3 digits in the sample checked but not assumed elsewhere) — Number()
// both strips any zero-padding for display and gives the caller real
// numbers to format with, rather than raw substrings.
export function parseSeatId(seatId) {
  const [section, row, seat] = seatId.split("-");
  return { section, row: Number(row), seat: Number(seat) };
}

// Nearest seat to `point` (SVG user-space, same space as each seat's own
// cx/cy) among `seatPositions` — a plain linear scan, not spatially
// indexed: cheap enough at ~2,600 seats for a single tap event (not run on
// every pointermove). `maxDistance` (user units) is the touch fingertip
// disambiguation cap — a genuinely nearest seat that's still farther than
// this (a walkway, the rink edge, an empty corner) isn't a plausible match
// for the tap and returns null, rather than picking something arbitrarily
// far from where the finger actually landed.
export function nearestSeatId(seatPositions, point, maxDistance = Infinity) {
  let bestId = null;
  let bestDist = Infinity;
  for (const { id, cx, cy } of seatPositions) {
    const dist = Math.hypot(cx - point.x, cy - point.y);
    if (dist < bestDist) {
      bestDist = dist;
      bestId = id;
    }
  }
  return bestDist <= maxDistance ? bestId : null;
}

export function buildDisabledSectionSet(sections) {
  return new Set(sections.filter((row) => row.disabled).map((row) => row.section));
}

// baselineSet === null means "no baseline available" (missing kausikortti
// seats.json, or svgHash mismatch) — collapses to the 3-state MYYTY. Sold
// status wins over disabled: hold is defined as total - sold precisely so
// the two never overlap, so a closed section's sold seats are still real
// occupied seats (a season-ticket holder sitting there, or a single
// ticket sold before the section closed). disabled only ever applies to
// the section's unsold remainder.
export function classifySeat(seatId, { soldSet, baselineSet, disabledSectionSet }) {
  if (soldSet.has(seatId)) {
    if (baselineSet === null) return SEAT_STATE.MYYTY;
    return baselineSet.has(seatId) ? SEAT_STATE.KAUSIKORTTI : SEAT_STATE.IRTOLIPPU;
  }
  if (disabledSectionSet.has(sectionOfSeatId(seatId))) return SEAT_STATE.EI_MYYNNISSA;
  return SEAT_STATE.VAPAA;
}

// Boxes (aitio_1..aitio_9) have no per-seat granularity — a box is either
// occupied (through a channel other than the public shop flow) or not.
export const AITIO_STATE = { MYYTY: "aitio-myyty", EI_MYYNNISSA: "ei-myynnissa" };

export function classifyAitio(aitioId, soldAitioSet) {
  return soldAitioSet.has(aitioId) ? AITIO_STATE.MYYTY : AITIO_STATE.EI_MYYNNISSA;
}
