import { SEAT_STATE } from "./seatMapClassify.js";

// The wheelchair area's real capacity is exactly 12 in this arena (every
// screenshot of it has read "N / 12") — a count visualization of 12
// discrete slots, not proportional scaling, so this is a fixed constant
// rather than a derived value.
export const WHEELCHAIR_SLOT_COUNT = 12;

// Splits sold/kausikorttiSold into WHEELCHAIR_SLOT_COUNT discrete slot
// states, one per physical spot: kausikortti-black first, then
// irtolippu-yellow, then vapaa-sand (or ei-myynnissa-grey when the area is
// disabled) — same bottom-up state semantics as computeStackedFillZones,
// just as a fixed count instead of a proportional share. kausikorttiSold
// null/undefined collapses to the 2-state myyty/vapaa fallback (no season
// baseline tracked).
export function computeSlotSplit({ sold, kausikorttiSold = null, disabled = false }) {
  const soldSlots = Math.max(0, Math.min(WHEELCHAIR_SLOT_COUNT, sold));
  const remainderState = disabled ? SEAT_STATE.EI_MYYNNISSA : SEAT_STATE.VAPAA;

  if (kausikorttiSold == null) {
    return Array.from({ length: WHEELCHAIR_SLOT_COUNT }, (_, i) => (i < soldSlots ? SEAT_STATE.MYYTY : remainderState));
  }

  const baseSlots = Math.max(0, Math.min(soldSlots, kausikorttiSold)); // defensive: never exceed sold slots
  return Array.from({ length: WHEELCHAIR_SLOT_COUNT }, (_, i) => {
    if (i < baseSlots) return SEAT_STATE.KAUSIKORTTI;
    if (i < soldSlots) return SEAT_STATE.IRTOLIPPU;
    return remainderState;
  });
}
