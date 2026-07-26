// Pure geometry helper for placing a zone's count text inside the standing
// wedge. The wedge is not a rectangle (it tapers to a point at one end and
// has a slanted edge at the other), so a count centered in its zone's
// rectangular vertical span can render outside the wedge's actual outline —
// reported for both the wedge's tapered-bottom tip (a small bottom zone)
// and its slanted top edge (a clamped top zone). The fix is to slide the
// count vertically within its own zone until it fits; this module only
// knows the zone's own rectangular span, not the wedge's real outline, so
// it produces an ORDERED list of candidate offsets to try — nearest to the
// original (centered) position first — leaving the actual "does this
// candidate fit inside the wedge" check to the caller (seatMap.js's
// isBoxFullyInsideShape, which needs a live DOM shape and
// SVGGeometryElement.isPointInFill).
//
// Offsets alternate direction (0, +step, -step, +2*step, ...) so "small
// steps" genuinely means trying the least amount of sliding first,
// regardless of which side of the zone turns out to have room. Every
// offset is clamped so the text's own padded box never leaves the zone's
// span — sliding to fix a geometry problem must never let a count intrude
// into a neighboring zone.
export function generateCandidateOffsets({ zoneHeight, boxHeight, step }) {
  const maxOffset = Math.max(0, (zoneHeight - boxHeight) / 2);
  if (maxOffset <= 1e-9 || !(step > 0)) return [0];

  const offsets = [0];
  let o = step;
  while (o < maxOffset - 1e-9) {
    offsets.push(o, -o);
    o += step;
  }
  offsets.push(maxOffset, -maxOffset);
  return offsets;
}
