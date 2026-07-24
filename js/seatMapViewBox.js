// Pure viewBox math for hand-rolled pan/zoom — no DOM, no library. `bounds`
// describes the zoomed-out limit (the SVG's own original viewBox) and how
// far in you're allowed to zoom (`maxZoom`, a factor on width/height).

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function parseViewBox(viewBoxAttr) {
  const [x, y, width, height] = viewBoxAttr.trim().split(/\s+/).map(Number);
  return { x, y, width, height };
}

export function serializeViewBox(viewBox) {
  return `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`;
}

function clampPosition(viewBox, bounds) {
  const { x: ox, y: oy, width: ow, height: oh } = bounds.original;
  const maxX = ox + ow - viewBox.width;
  const maxY = oy + oh - viewBox.height;
  return {
    x: clamp(viewBox.x, ox, Math.max(ox, maxX)),
    y: clamp(viewBox.y, oy, Math.max(oy, maxY)),
    width: viewBox.width,
    height: viewBox.height,
  };
}

// Zooms so `focalPoint` (SVG user-space coords, e.g. the pointer position
// translated into the current viewBox) stays visually fixed — its relative
// position within the viewBox is preserved before and after.
export function computeZoomedViewBox(viewBox, focalPoint, scaleFactor, bounds) {
  const { width: ow, height: oh } = bounds.original;
  const minWidth = ow / bounds.maxZoom;
  const minHeight = oh / bounds.maxZoom;

  const newWidth = clamp(viewBox.width * scaleFactor, minWidth, ow);
  const newHeight = clamp(viewBox.height * scaleFactor, minHeight, oh);

  const relX = (focalPoint.x - viewBox.x) / viewBox.width;
  const relY = (focalPoint.y - viewBox.y) / viewBox.height;

  const newX = focalPoint.x - relX * newWidth;
  const newY = focalPoint.y - relY * newHeight;

  return clampPosition({ x: newX, y: newY, width: newWidth, height: newHeight }, bounds);
}

// Translates by (dx, dy) in SVG user-space, clamped so the viewBox can never
// fully leave the original canvas extent.
export function computePannedViewBox(viewBox, dx, dy, bounds) {
  return clampPosition({ x: viewBox.x + dx, y: viewBox.y + dy, width: viewBox.width, height: viewBox.height }, bounds);
}
