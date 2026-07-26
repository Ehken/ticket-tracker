// Pure geometry helper for placing a zone's count text inside the standing
// wedge. The wedge is not a rectangle (it tapers to a point at one end and
// has a slanted edge at the other), so a count centered in its zone's
// rectangular vertical span can render outside the wedge's actual outline —
// reported for both the wedge's tapered-bottom tip (a small bottom zone)
// and its slanted top edge (a clamped top zone). This module only knows the
// zone's own rectangular span and the shape's overall bbox width, not the
// wedge's real outline, so it produces an ORDERED list of candidates to
// try — nearest to the original (centered) position first — leaving the
// actual "does this candidate fit inside the wedge" check to the caller
// (seatMap.js's isBoxFullyInsideShape, which needs a live DOM shape and
// SVGGeometryElement.isPointInFill).

// Ordered list of offsets from 0 outward, alternating direction (0, +step,
// -step, +2*step, ...), capped at ±maxOffset — shared building block for
// both the vertical (zone-bound) and horizontal (fixed-fraction-of-width)
// candidate axes. "Small steps" means trying the least amount of sliding
// first, regardless of which side turns out to have room.
function generateLinearOffsets(maxOffset, step) {
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

// Vertical-only offsets within a zone's own span. Clamped so the text's own
// padded box never leaves the zone's span — sliding to fix a geometry
// problem must never let a count intrude into a neighboring zone.
export function generateCandidateOffsets({ zoneHeight, boxHeight, step }) {
  const maxOffset = Math.max(0, (zoneHeight - boxHeight) / 2);
  return generateLinearOffsets(maxOffset, step);
}

// Round 8: vertical-only sliding left a real case unrescued — the "12
// remaining" clamped zone sits right at the wedge's slanted top edge, where
// one side of the zone is full-height and the other tapers away, so the fix
// isn't a better vertical position, it's an off-center horizontal one. Full
// candidate search, in escalating order:
//   1. scale 1×, every (yOffset, xOffset) pair — y outer (nearest-to-center
//      first, as before), x inner (nearest-to-center first) — so a small
//      horizontal nudge at the original y is tried well before a large
//      vertical slide is.
//   2. only if every 1× candidate fails: the whole pass repeats at
//      shrinkScale (a smaller box has more room in both axes).
// xOffset is capped at maxXOffsetFraction of the shape's own bbox width
// (not the box width — this is an exploration bound, "how far off-center is
// still reasonable," not a fit constraint the way the zone's height is for
// yOffset) and is otherwise independent of scale, since it isn't bounded by
// the zone the way vertical room is.
export function generateZoneCountPlacementCandidates({
  zoneHeight,
  boxHeight,
  yStep,
  shapeWidth,
  xStep,
  maxXOffsetFraction = 0.35,
  shrinkScale = 0.75,
}) {
  const maxXOffset = Math.max(0, shapeWidth * maxXOffsetFraction);
  const xOffsets = generateLinearOffsets(maxXOffset, xStep);

  const candidates = [];
  for (const scale of [1, shrinkScale]) {
    const yOffsets = generateCandidateOffsets({ zoneHeight, boxHeight: boxHeight * scale, step: yStep });
    for (const yOffset of yOffsets) {
      for (const xOffset of xOffsets) {
        candidates.push({ scale, yOffset, xOffset });
      }
    }
  }
  return candidates;
}
