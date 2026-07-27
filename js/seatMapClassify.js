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
