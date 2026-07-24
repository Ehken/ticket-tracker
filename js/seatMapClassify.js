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
// seats.json, or svgHash mismatch) — collapses to the 3-state MYYTY. The
// disabled-section check always wins, regardless of sold status, matching
// real-world "closed section, whatever its history" semantics.
export function classifySeat(seatId, { soldSet, baselineSet, disabledSectionSet }) {
  if (disabledSectionSet.has(sectionOfSeatId(seatId))) return SEAT_STATE.EI_MYYNNISSA;
  if (!soldSet.has(seatId)) return SEAT_STATE.VAPAA;
  if (baselineSet === null) return SEAT_STATE.MYYTY;
  return baselineSet.has(seatId) ? SEAT_STATE.KAUSIKORTTI : SEAT_STATE.IRTOLIPPU;
}

// Boxes (aitio_1..aitio_9) have no per-seat granularity — a box is either
// occupied (through a channel other than the public shop flow) or not.
export const AITIO_STATE = { MYYTY: "aitio-myyty", EI_MYYNNISSA: "ei-myynnissa" };

export function classifyAitio(aitioId, soldAitioSet) {
  return soldAitioSet.has(aitioId) ? AITIO_STATE.MYYTY : AITIO_STATE.EI_MYYNNISSA;
}
