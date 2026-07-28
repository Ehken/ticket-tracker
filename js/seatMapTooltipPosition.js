// Pure geometry for anchoring the seat map's hover/pin tooltips — no DOM.
// All inputs/outputs are plain numbers in CSS pixels, relative to the
// clipping container's own top-left (js/seatMap.js does the DOM-to-pixel
// conversion via getScreenCTM before calling in here).
//
// sectionRect may extend outside the container — that's the normal case at
// any real zoom, not an edge case: MAX_ZOOM is 4 in seatMap.js, so a
// section's on-screen rect routinely exceeds the container in one or both
// axes once zoomed in, and a panned section can have a negative top and a
// bottom past the container's own height at the same time. It's also true
// unzoomed for at least one real section: the standing wedge's actual
// getBBox() spans roughly 77% of the map's own height, leaving too little
// room above or below for a tooltip at rest, no zoom involved. Feeding a
// raw rect into a plain below/else-flip-above/else-clamp chain means the
// clamp branch runs far more often than "rarely" — and its result can sit
// directly on top of the section it describes, which is exactly backwards
// from the one rule this feature cares most about. The escape sequence
// below tries, in order: below the section, above it, beside it (right,
// then left — a section too tall to clear vertically is often narrow
// enough to clear horizontally, as the wedge is), and only once none of
// those work, anchors to the pointer instead — which can no longer promise
// clearing the section, only the exact cursor/finger point.

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function intersectRect(rect, bounds) {
  const left = Math.max(rect.left, bounds.left);
  const top = Math.max(rect.top, bounds.top);
  const right = Math.min(rect.right, bounds.right);
  const bottom = Math.min(rect.bottom, bounds.bottom);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function clampedLeft(centerX, tooltipWidth, containerWidth) {
  return clamp(centerX - tooltipWidth / 2, 0, Math.max(0, containerWidth - tooltipWidth));
}

function clampedTop(centerY, tooltipHeight, containerHeight) {
  return clamp(centerY - tooltipHeight / 2, 0, Math.max(0, containerHeight - tooltipHeight));
}

export function computeTooltipPosition({ sectionRect, tooltipSize, containerSize, gap, pointer }) {
  const containerBounds = { left: 0, top: 0, right: containerSize.width, bottom: containerSize.height };
  // Describes the VISIBLE part of the section, not wherever it might extend
  // to off-screen — a no-op when the section is already fully inside the
  // container, and what makes the zoomed/panned case tractable otherwise.
  const visible = intersectRect(sectionRect, containerBounds);
  const hasVisibleArea = visible.width > 0 && visible.height > 0;

  if (hasVisibleArea) {
    const belowTop = visible.bottom + gap;
    if (belowTop + tooltipSize.height <= containerSize.height) {
      return {
        left: clampedLeft(visible.left + visible.width / 2, tooltipSize.width, containerSize.width),
        top: belowTop,
        placement: "below",
        anchor: "section",
      };
    }
    const aboveTop = visible.top - gap - tooltipSize.height;
    if (aboveTop >= 0) {
      return {
        left: clampedLeft(visible.left + visible.width / 2, tooltipSize.width, containerSize.width),
        top: aboveTop,
        placement: "above",
        anchor: "section",
      };
    }

    // Neither above nor below fits — real for a section that's tall
    // relative to the container (the standing wedge spans roughly 77% of
    // the map's own height even unzoomed). A section too tall to clear
    // vertically is often narrow enough to clear beside instead, so try
    // that before giving up on the section entirely and anchoring to the
    // pointer, which can no longer promise clearing the section itself,
    // only the exact cursor/finger point (see below).
    const rightLeft = visible.right + gap;
    if (rightLeft + tooltipSize.width <= containerSize.width) {
      return {
        left: rightLeft,
        top: clampedTop(visible.top + visible.height / 2, tooltipSize.height, containerSize.height),
        placement: "right",
        anchor: "section",
      };
    }
    const leftLeft = visible.left - gap - tooltipSize.width;
    if (leftLeft >= 0) {
      return {
        left: leftLeft,
        top: clampedTop(visible.top + visible.height / 2, tooltipSize.height, containerSize.height),
        placement: "left",
        anchor: "section",
      };
    }
  }

  // Nothing anchored to the section works — it's too large in every
  // direction relative to the container (or entirely off-screen). Anchor
  // to the pointer instead: it's inside the container by definition, so
  // there's always somewhere valid to go, though the guarantee narrows
  // from "clear of the section" to "clear of the exact cursor/finger
  // point," which is all that's left to promise once the section fills
  // most of the view. Prefers ABOVE the pointer — on touch the pointer
  // coordinate is under the finger itself, so below-the-pointer risks the
  // tooltip landing right where the hand already is. Above-first avoids
  // that regardless of input type, and is harmless for mouse.
  if (pointer) {
    const aboveTop = pointer.y - gap - tooltipSize.height;
    if (aboveTop >= 0) {
      return {
        left: clampedLeft(pointer.x, tooltipSize.width, containerSize.width),
        top: aboveTop,
        placement: "above",
        anchor: "pointer",
      };
    }
    const belowTop = pointer.y + gap;
    if (belowTop + tooltipSize.height <= containerSize.height) {
      return {
        left: clampedLeft(pointer.x, tooltipSize.width, containerSize.width),
        top: belowTop,
        placement: "below",
        anchor: "pointer",
      };
    }
    return {
      left: clampedLeft(pointer.x, tooltipSize.width, containerSize.width),
      top: clamp(belowTop, 0, Math.max(0, containerSize.height - tooltipSize.height)),
      placement: "below",
      anchor: "pointer",
    };
  }

  // No pointer given either — a genuine last resort (every real caller in
  // seatMap.js passes one). Deterministic: clamp into the container,
  // preferring "below" as the reported placement.
  const fallbackCenterX = hasVisibleArea ? visible.left + visible.width / 2 : containerSize.width / 2;
  const fallbackTop = hasVisibleArea ? visible.bottom + gap : containerSize.height / 2;
  return {
    left: clampedLeft(fallbackCenterX, tooltipSize.width, containerSize.width),
    top: clamp(fallbackTop, 0, Math.max(0, containerSize.height - tooltipSize.height)),
    placement: "below",
    anchor: "section",
  };
}
