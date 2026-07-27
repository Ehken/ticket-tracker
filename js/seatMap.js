// Seat map visualization, built lazily inside an expanded card. Not
// unit-tested (DOM assembly, same convention as card.js/dashboard.js) — the
// pure classification/viewBox math it depends on lives in
// seatMapClassify.js / seatMapViewBox.js and is unit-tested there.
import { getSeats, getCapacitiesSvg } from "./fetchData.js";
import { sectionLabel } from "./sectionLabels.js";
import { buildFillBar } from "./sectionTable.js";
import { formatThousands, formatPercent } from "./format.js";
import { irtoliput } from "./dashboardBaseline.js";
import { SEAT_STATE, AITIO_STATE, buildDisabledSectionSet, classifySeat, classifyAitio } from "./seatMapClassify.js";
import {
  parseViewBox,
  serializeViewBox,
  computeZoomedViewBox,
  computePannedViewBox,
  viewBoxesEqual,
  normalizeWheelDeltaY,
  expandViewBox,
} from "./seatMapViewBox.js";
import { computeStackedFillZones, clampZoneSpansToMinimum } from "./seatMapStackedFill.js";
import { computeSlotSplit, WHEELCHAIR_SLOT_COUNT } from "./seatMapSlots.js";
import { generateZoneCountPlacementCandidates } from "./seatMapZoneCountPlacement.js";

const INFO_ROW_PLACEHOLDER = "Kosketa katsomoa nähdäksesi tarkat luvut.";

const EI_MYYNNISSA_INFO =
  "Ei myynnissä: paikat on varattu esim. vieraskannattajille, ryhmille tai muuhun käyttöön. SaiPa voi vapauttaa niitä myyntiin lähempänä ottelua.";
const AITIO_INFO = "Aitiopaikat myydään pääosin erillisten sopimusten kautta, ei elippu.net-kaupasta.";

const TAP_MOVEMENT_THRESHOLD = 6; // px in screen space, disambiguates tap from drag-pan
const WHEEL_ZOOM_FACTOR = 0.001;
const MAX_ZOOM = 4;

const SEAT_RADIUS = "4";
const SEAT_RADIUS_EI_MYYNNISSA = "2.4"; // smaller, not just a different color — separates by shape too

// Keep in sync with .seatmap-svg-container's aspect-ratio in style.css
// (1780+70+55 / 1261+60+55) — the container's fixed aspect ratio must
// match the expanded canvas exactly, or the SVG letterboxes inside it.
// Sized to clear the fixed label bands computed in computeLabelBands (top
// needs the most vertical room — the C band sits above the WC icon box at
// the map's own y=0 — right slightly more than bottom for the D band's
// label text) plus the standing area's own rotated vertical name in the
// left margin (see addStandingAreaVerticalName).
const LABEL_CANVAS_MARGIN = { top: 60, bottom: 55, left: 70, right: 55 };

// Attribute-selector lookup, not getElementById: an SVG root's own
// getElementById support is inconsistent, and if two cards' seat maps are
// open at once they'd share colliding ids in one live document.
function findById(root, id) {
  return root.querySelector(`[id="${id}"]`);
}

export function buildSeatMapToggle(mergedEvent, latest, { kausikorttiEvents = [] } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "card__seatmap-wrapper";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "card__seatmap-toggle";
  toggle.textContent = "Näytä istumakartta";
  wrapper.append(toggle);

  const mapContainer = document.createElement("div");
  mapContainer.className = "card__seatmap-container";
  mapContainer.hidden = true;
  wrapper.append(mapContainer);

  let built = false;

  toggle.addEventListener("click", async () => {
    if (built) {
      mapContainer.hidden = !mapContainer.hidden;
      toggle.textContent = mapContainer.hidden ? "Näytä istumakartta" : "Piilota istumakartta";
      return;
    }
    built = true;
    toggle.disabled = true;
    toggle.textContent = "Ladataan…";
    // Shown (not hidden) before content loads: getBBox()-based overlay
    // placement below needs the container actually rendered/laid out.
    mapContainer.hidden = false;
    mapContainer.textContent = "Ladataan karttaa…";

    try {
      const seats = await getSeats(mergedEvent.id);
      if (!seats) {
        // Missing/old data — the toggle disappears, rest of the card is unaffected.
        wrapper.remove();
        return;
      }

      const baseline = await resolveBaseline(mergedEvent, seats, kausikorttiEvents);
      const svgText = await getCapacitiesSvg(seats.svgHash);
      renderSeatMap({ mapContainer, mergedEvent, latest, seats, baseline, svgText });

      toggle.disabled = false;
      toggle.textContent = "Piilota istumakartta";
    } catch (err) {
      console.error(`Failed to load seat map for ${mergedEvent.id}:`, err);
      const errorEl = document.createElement("p");
      errorEl.className = "card__error";
      errorEl.textContent = "Istumakarttaa ei voitu ladata.";
      mapContainer.replaceChildren(errorEl);
      toggle.remove();
    }
  });

  return wrapper;
}

async function resolveBaseline(mergedEvent, seats, kausikorttiEvents) {
  const NO_BASELINE = { soldSet: null, sectionSold: null };

  if (mergedEvent.gameType === "kausikortti") return NO_BASELINE; // self is the baseline

  // Require a truthy season on both sides — otherwise two events that are
  // both simply unclassified (season null/undefined) would spuriously
  // "match" each other as a season baseline pair.
  const kausikorttiEvent = mergedEvent.season
    ? kausikorttiEvents.find((k) => k.season === mergedEvent.season)
    : undefined;
  if (!kausikorttiEvent) return NO_BASELINE; // not tracked yet — normal case, no warning

  let baselineSeats;
  try {
    baselineSeats = await getSeats(kausikorttiEvent.id);
  } catch (err) {
    console.warn(`[seatmap] Failed to load baseline seats for ${kausikorttiEvent.id}:`, err);
    return NO_BASELINE;
  }
  if (!baselineSeats) return NO_BASELINE; // kausikortti has no seats.json yet — normal case, no warning

  if (baselineSeats.svgHash !== seats.svgHash) {
    console.warn(
      `[seatmap] ${mergedEvent.id}: svgHash differs from season baseline (${kausikorttiEvent.id}) — showing without kausikortti/irtolippu split.`
    );
    return NO_BASELINE;
  }

  const sectionSold = new Map(kausikorttiEvent.latest.sections.map((row) => [row.section, row.sold]));
  return { soldSet: new Set(baselineSeats.soldSeatIds), sectionSold };
}

function renderSeatMap({ mapContainer, mergedEvent, latest, seats, baseline, svgText }) {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  if (doc.querySelector("parsererror")) throw new Error("Failed to parse seatmap SVG");

  const svg = doc.documentElement;
  svg.classList.add("seatmap-svg");
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  // Decorative-with-interaction: the section table elsewhere on the page is
  // the accessible data equivalent, so the map itself is announced as one
  // described image rather than read fragment-by-fragment — every text/
  // label drawn onto it (aggregate labels, seated-section labels, numeric
  // overlays) is individually aria-hidden for the same reason.
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Istumakartta: paikkatilanne katsomoittain — tarkat luvut taulukossa");
  // Grows the canvas beyond the persisted SVG's own bounds so seated-section
  // labels (see replaceSectionLabels) have room to render outside their
  // section instead of on top of the seat dots. Left gets no extra margin —
  // the standing-area wedge already provides room there. Setting this on the
  // attribute BEFORE attachInteraction reads it (via parseViewBox) makes the
  // expanded box the pan/zoom bounds' "original"/home state automatically —
  // no second, separate notion of "original" to keep in sync.
  svg.setAttribute(
    "viewBox",
    serializeViewBox(expandViewBox(parseViewBox(svg.getAttribute("viewBox")), LABEL_CANVAS_MARGIN))
  );

  const svgWrapper = document.createElement("div");
  svgWrapper.className = "seatmap-svg-container";
  svgWrapper.append(svg);

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "seatmap-reset-button";
  resetButton.textContent = "Palauta näkymä";

  const infoRow = document.createElement("div");
  infoRow.className = "seatmap-info-row";
  infoRow.setAttribute("aria-live", "polite"); // tap-to-inspect selection changes are announced for pointer users
  infoRow.textContent = INFO_ROW_PLACEHOLDER;

  const legend = buildLegend(mapContainer, {
    hasBaseline: baseline.soldSet !== null,
    hasAitioOccupancy: (seats.soldAitiot ?? []).length > 0,
  });

  const cta = buildCta(mergedEvent, latest);
  const children = [legend, svgWrapper, resetButton];
  if (cta) children.push(cta);
  children.push(infoRow);
  mapContainer.replaceChildren(...children);

  // The container is already visible (see buildSeatMapToggle) so getBBox()
  // below reflects real layout, not a display:none zero-box.
  addSectionHitAreas(svg);
  colorSeats(svg, mergedEvent, latest, seats, baseline);
  colorAitioBoxes(svg, seats);
  findById(svg, "press")?.classList.add("ei-myynnissa");

  const bands = computeLabelBands(svg);
  renderStandingWedge(svg, latest, baseline);
  renderWheelchairSlots(svg, latest, baseline, bands);
  replaceSectionLabels(svg, latest, bands);

  attachInteraction(svg, mapContainer, { latest, baseline, infoRow, resetButton });
}

// The standing area (seisomakatsomo) keeps the full stacked fill exactly as
// implemented in earlier rounds — a hard-stop gradient reflecting its real
// kausikortti/irtolippu/vapaa (or myyty/vapaa, no baseline) composition,
// same data source as the tap-to-inspect info row's irtoliput() split.
// What's new: the raw proportional zones (computeStackedFillZones) are run
// through clampZoneSpansToMinimum first, so a very small zone (e.g. 12
// remaining out of 2138) still gets a floor height with room for its own
// count number, at the cost of the OTHER zones renormalizing slightly —
// the gradient's stop offsets and each zone's count-text position both
// come from these same clamped zones, so the visible fill and the numbers
// drawn over it never disagree about where a zone's boundary is.
let stackedFillIdCounter = 0;

const STANDING_ZONE_FONT_SIZE = 26; // px — keep in sync with .seatmap-zone-count's font-size
const MIN_ZONE_HEIGHT_FACTOR = 2.4; // "~2.4x the count font size" — cap height + breathing room above/below
const STANDING_NAME_GAP = 10; // units between the wedge's left edge and the rotated name's own edge

const ZONE_TITLE_LABEL = {
  [SEAT_STATE.KAUSIKORTTI]: "Kausikortit",
  [SEAT_STATE.IRTOLIPPU]: "Irtoliput",
  [SEAT_STATE.VAPAA]: "Vapaana",
  [SEAT_STATE.MYYTY]: "Myyty",
  [SEAT_STATE.EI_MYYNNISSA]: "Ei myynnissä",
};

function renderStandingWedge(svg, latest, baseline) {
  const sectionKey = "seisomakatsomo";
  const row = latest.sections.find((r) => r.section === sectionKey);
  const shapeEl = findById(svg, sectionKey);
  if (!row || !shapeEl) return;

  hideBakedNameLabel(svg, shapeEl, sectionKey);

  const shapeBBox = shapeEl.getBBox();
  const baselineSold = baseline.sectionSold?.get(sectionKey) ?? null;
  const rawZones = computeStackedFillZones({
    sold: row.sold,
    total: row.total,
    kausikorttiSold: baselineSold,
    disabled: row.disabled,
  });
  const minSharePct = ((STANDING_ZONE_FONT_SIZE * MIN_ZONE_HEIGHT_FACTOR) / shapeBBox.height) * 100;
  const zones = clampZoneSpansToMinimum(rawZones, minSharePct);

  applyWedgeGradient(svg, shapeEl, zones);

  // The remainder's own zone.state is ei-myynnissa when the section is
  // closed (see computeStackedFillZones) — counts must be keyed the same
  // way, or its count silently fails to render (looks up a vapaa key that
  // isn't there).
  const remainderState = row.disabled ? SEAT_STATE.EI_MYYNNISSA : SEAT_STATE.VAPAA;
  const counts =
    baselineSold == null
      ? { [SEAT_STATE.MYYTY]: row.sold, [remainderState]: row.total - row.sold }
      : {
          [SEAT_STATE.KAUSIKORTTI]: baselineSold,
          [SEAT_STATE.IRTOLIPPU]: row.sold - baselineSold,
          [remainderState]: row.total - row.sold,
        };
  addZoneCountsAndHoverTitles(svg, sectionKey, shapeEl, shapeBBox, zones, counts);

  addStandingAreaVerticalName(svg, shapeBBox);
}

function applyWedgeGradient(svg, shapeEl, zones) {
  const svgNs = "http://www.w3.org/2000/svg";
  const gradientId = `seatmap-stacked-fill-${++stackedFillIdCounter}`;
  const gradient = document.createElementNS(svgNs, "linearGradient");
  gradient.setAttribute("id", gradientId);
  gradient.setAttribute("gradientUnits", "objectBoundingBox");
  // Bottom (offset 0%) -> top (offset 100%) in the shape's own bounding box —
  // vertical regardless of the shape's own rotation/tilt (the standing area
  // is a wedge, not a rectangle, so this is an approximation of share by
  // visual height; each zone's own count carries the exact figure).
  gradient.setAttribute("x1", "0");
  gradient.setAttribute("y1", "1");
  gradient.setAttribute("x2", "0");
  gradient.setAttribute("y2", "0");

  for (const zone of zones) {
    // Two stops at the same offset per zone boundary = a hard cut, no
    // blending — matches the section table's fill-bar convention.
    for (const offset of [zone.start, zone.end]) {
      const stop = document.createElementNS(svgNs, "stop");
      stop.setAttribute("offset", `${offset}%`);
      stop.setAttribute("class", `seatmap-standing-stop--${zone.state}`);
      gradient.append(stop);
    }
  }

  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS(svgNs, "defs");
    svg.prepend(defs);
  }
  defs.append(gradient);

  // Inline style (not setAttribute) so it beats the existing
  // ".seatmap-svg #seisomakatsomo { fill: var(--seat-vapaa); }" CSS rule,
  // which is left in place as a harmless fallback for the
  // shape-not-found case in renderStandingWedge above.
  shapeEl.style.fill = `url(#${gradientId})`;
}

// Converts a zone's [start, end] (percent, 0 = bottom of the stack) into
// its vertical center in the shape's own coordinate space (SVG y grows
// downward, so a higher percent-from-bottom means a smaller y).
function zoneCenterY(shapeBBox, zone) {
  const topFraction = 1 - zone.end / 100;
  const bottomFraction = 1 - zone.start / 100;
  return shapeBBox.y + shapeBBox.height * ((topFraction + bottomFraction) / 2);
}

// The zone's own vertical extent (top/bottom y + height) in the shape's
// coordinate space — the rectangular span a count is allowed to slide
// within (see generateCandidateOffsets below), as opposed to the wedge's
// actual (non-rectangular) outline, which is checked separately via
// isBoxFullyInsideShape.
function zoneYExtent(shapeBBox, zone) {
  const topFraction = 1 - zone.end / 100;
  const bottomFraction = 1 - zone.start / 100;
  const top = shapeBBox.y + shapeBBox.height * topFraction;
  const bottom = shapeBBox.y + shapeBBox.height * bottomFraction;
  return { top, bottom, height: bottom - top };
}

// Samples a padded box's four corners plus its four edge midpoints against
// the shape's actual filled outline (not just its rectangular bbox) — the
// standing wedge tapers to a point at one end and has a slanted edge at the
// other, so a box that fits inside the zone's rectangular vertical span can
// still poke outside the wedge itself near either of those edges. The point
// coordinates are in the same coordinate space as shapeBBox/getBBox() — safe
// here because neither the wedge <path> nor its ancestor <g> carries a
// transform (confirmed against the persisted SVG), so "local" and "global"
// coordinates coincide. Engines without isPointInFill (older Safari) fall
// back to true — best-effort centering rather than blocking the count
// entirely over a feature-detection gap.
function isBoxFullyInsideShape(shapeEl, box) {
  if (typeof shapeEl.isPointInFill !== "function") return true;
  const svg = shapeEl.ownerSVGElement;
  const points = [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x, box.y + box.height],
    [box.x + box.width, box.y + box.height],
    [box.x + box.width / 2, box.y],
    [box.x + box.width / 2, box.y + box.height],
    [box.x, box.y + box.height / 2],
    [box.x + box.width, box.y + box.height / 2],
  ];
  return points.every(([x, y]) => {
    const pt = svg.createSVGPoint();
    pt.x = x;
    pt.y = y;
    return shapeEl.isPointInFill(pt);
  });
}

// Renders each nonzero zone's own count, centered in its (already clamped)
// span — solid, tabular-nums, no halo (these sit on the map's own light
// surface, not over dot clusters, so a halo is unnecessary — see
// .seatmap-zone-count). A zero-count zone renders no text at all: a
// sold-out wedge is pure black+yellow, an unsold one pure sand with only
// the vapaa count. Each zone also gets an invisible hoverable proxy rect
// (sized to just the count text's own glyph area, not the whole zone —
// see below) carrying a native <title> tooltip.
//
// Two things were tried here and rejected before landing on this shape:
// (1) giving the proxy rect the wedge's own "seisomakatsomo" id, reasoning
// that handleTap()'s unchanged `.closest(".section")` + `.id` lookup would
// then resolve it identically to tapping the wedge directly — but a
// duplicate id anywhere in the document turned out to make Chromium stop
// painting the wedge's own objectBoundingBox gradient entirely (confirmed
// by removing the duplicate and watching the fill reappear; a minimal
// standalone repro of just the gradient, with no duplicate id, rendered
// fine). (2) a unique id instead, but sized to the zone's FULL span — that
// avoided the gradient bug but meant a proxy rect the size of, say, the
// 88%-of-the-wedge vapaa zone sat on top of almost the entire shape,
// silently swallowing nearly every tap (no class="section"/matching id,
// so handleTap's `.closest(".section")` finds nothing there and no-ops).
// Sizing the rect to just the count text's own measured bbox (plus a
// small margin) shrinks that dead zone from "most of the wedge" down to a
// few dozen square units around each visible number — genuinely narrow,
// and still an intuitive hover target ("hover the number for the exact
// split"). tap-to-inspect on the rest of the wedge is unaffected.
const ZONE_HOVER_PADDING = 6;

// A count centered in its zone can render outside the wedge's own
// (non-rectangular) outline — reported for a small bottom zone poking past
// the tapered tip, and a clamped top zone poking over the slanted top edge.
// COUNT_GEOMETRY_PADDING is the clearance required on every side of the
// count's own rendered box for it to count as "inside" (not flush against
// the outline). COUNT_Y_SLIDE_STEP/COUNT_X_SLIDE_STEP are how far each
// retry moves along each axis — small enough that the count only drifts as
// far off-center as it has to. COUNT_MAX_X_OFFSET_FRACTION bounds how far
// horizontally a count may drift from the wedge's own x-center (relative to
// the wedge's own bbox width, not the zone — round 8: the slanted top edge
// means one side of a zone can be full-height while the other tapers away,
// so an off-center horizontal position, not a better vertical one, is what
// rescues it). COUNT_SHRINK_SCALE is the one-step font shrink tried only if
// every full-size position (both axes) fails.
const COUNT_GEOMETRY_PADDING = 4;
const COUNT_Y_SLIDE_STEP = 4;
const COUNT_X_SLIDE_STEP = 8;
const COUNT_MAX_X_OFFSET_FRACTION = 0.35;
const COUNT_SHRINK_SCALE = 0.75;

// The padded box a count of the given (unscaled) size would occupy if its
// center sat at (cx + xOffset, cy + yOffset) and it were rendered at
// `scale` — scaling around the box's own center, not the origin, so a
// shrunk candidate's box stays concentric with the full-size one rather
// than drifting toward (0, 0).
function paddedCandidateBox(baseBBox, { scale, xOffset, yOffset }) {
  const width = baseBBox.width * scale;
  const height = baseBBox.height * scale;
  const centerX = baseBBox.x + baseBBox.width / 2 + xOffset;
  const centerY = baseBBox.y + baseBBox.height / 2 + yOffset;
  return {
    x: centerX - width / 2 - COUNT_GEOMETRY_PADDING,
    y: centerY - height / 2 - COUNT_GEOMETRY_PADDING,
    width: width + COUNT_GEOMETRY_PADDING * 2,
    height: height + COUNT_GEOMETRY_PADDING * 2,
  };
}

function addZoneCountsAndHoverTitles(svg, sectionKey, shapeEl, shapeBBox, zones, counts) {
  const svgNs = "http://www.w3.org/2000/svg";
  const cx = shapeBBox.x + shapeBBox.width / 2;

  zones.forEach((zone, zoneIndex) => {
    const count = counts[zone.state] ?? 0;
    if (count <= 0) return;

    const cy = zoneCenterY(shapeBBox, zone);

    const text = document.createElementNS(svgNs, "text");
    text.setAttribute("class", `seatmap-zone-count seatmap-zone-count--${zone.state}`);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("x", String(cx));
    text.setAttribute("y", String(cy));
    text.setAttribute("pointer-events", "none");
    text.setAttribute("aria-hidden", "true");
    text.textContent = formatThousands(count);
    svg.append(text);

    // Measured once at the centered, full-size position — every candidate
    // below is derived mathematically from this single measurement
    // (translate for offsets, scale-around-center for the shrink step)
    // instead of re-querying the DOM per candidate.
    const baseBBox = text.getBBox();
    const zoneExtent = zoneYExtent(shapeBBox, zone);
    const candidates = generateZoneCountPlacementCandidates({
      zoneHeight: zoneExtent.height,
      boxHeight: baseBBox.height + COUNT_GEOMETRY_PADDING * 2,
      yStep: COUNT_Y_SLIDE_STEP,
      shapeWidth: shapeBBox.width,
      xStep: COUNT_X_SLIDE_STEP,
      maxXOffsetFraction: COUNT_MAX_X_OFFSET_FRACTION,
      shrinkScale: COUNT_SHRINK_SCALE,
    });

    const placed = candidates.find((candidate) => isBoxFullyInsideShape(shapeEl, paddedCandidateBox(baseBBox, candidate)));

    if (!placed) {
      // No position at either scale keeps the count fully within the
      // wedge's actual outline — omit it rather than let it poke over a
      // slanted/tapered edge. The hover title's own proxy rect would have
      // nothing to anchor to without a rendered count, so it's skipped too;
      // tap-to-inspect (unchanged) still carries the exact figure.
      text.remove();
      return;
    }

    if (placed.xOffset !== 0) text.setAttribute("x", String(cx + placed.xOffset));
    if (placed.yOffset !== 0) text.setAttribute("y", String(cy + placed.yOffset));
    if (placed.scale !== 1) text.style.fontSize = `${STANDING_ZONE_FONT_SIZE * placed.scale}px`;

    const textBBox = text.getBBox();
    const hoverRect = document.createElementNS(svgNs, "rect");
    hoverRect.setAttribute("id", `seatmap-zone-hover-${sectionKey}-${zoneIndex}`);
    hoverRect.setAttribute("x", String(textBBox.x - ZONE_HOVER_PADDING));
    hoverRect.setAttribute("y", String(textBBox.y - ZONE_HOVER_PADDING));
    hoverRect.setAttribute("width", String(textBBox.width + ZONE_HOVER_PADDING * 2));
    hoverRect.setAttribute("height", String(textBBox.height + ZONE_HOVER_PADDING * 2));
    hoverRect.setAttribute("fill", "transparent");
    hoverRect.style.pointerEvents = "all";
    const title = document.createElementNS(svgNs, "title");
    title.textContent = `${ZONE_TITLE_LABEL[zone.state]}: ${formatThousands(count)}`;
    hoverRect.append(title);
    svg.append(hoverRect);
  });
}

// Replaces the old in-wedge "KAUKAAN PÄÄTY" label with a name rendered
// vertically (rotated -90°, reading bottom-to-top) just outside the
// wedge's left edge, in the expanded left margin — solid, not halo-styled
// (nothing to blend into out there). Two-pass: the text is measured at a
// neutral position first (its rendered height, pre-rotation, becomes its
// horizontal footprint once rotated), then positioned so that footprint's
// outer edge clears the wedge by STANDING_NAME_GAP. dominant-baseline:
// central (see .seatmap-standing-name) keeps the rotation anchor centered
// in both axes, so this footprint math holds.
function addStandingAreaVerticalName(svg, shapeBBox) {
  const svgNs = "http://www.w3.org/2000/svg";
  const text = document.createElementNS(svgNs, "text");
  text.setAttribute("class", "seatmap-standing-name");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("pointer-events", "none");
  text.setAttribute("aria-hidden", "true");
  text.textContent = sectionLabel("seisomakatsomo");
  text.setAttribute("x", "0");
  text.setAttribute("y", "0");
  svg.append(text);

  const size = text.getBBox();
  const cy = shapeBBox.y + shapeBBox.height / 2;
  const cx = shapeBBox.x - STANDING_NAME_GAP - size.height / 2;

  text.setAttribute("x", String(cx));
  text.setAttribute("y", String(cy));
  text.setAttribute("transform", `rotate(-90, ${cx}, ${cy})`);
}

function isFullyContained(inner, outer) {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.width <= outer.x + outer.width + 0.5 &&
    inner.y + inner.height <= outer.y + outer.height + 0.5
  );
}

function unionBBox(boxes) {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

// The persisted SVG has no <text> elements — every section name (A1..D2,
// seisomakatsomo, invalid) is baked in as an outlined <path fill="black">,
// with no id/class of its own, so none of them can be targeted by a static
// CSS selector. Identified here by geometry instead: bare (no id, no
// class), solid-black paths whose bbox sits fully inside the target
// section's own bbox — called once per section (see replaceSectionLabels
// below), so a match is always scoped to that one section's own region and
// can never pick up another section's label. Returns the union bbox of
// whatever it hid (or null if nothing matched), so the caller can center
// its own replacement text on the label's actual former position rather
// than the whole section's bbox center.
//
// D1/D2's own bbox turned out to also contain that column's row-number
// ruler ("1 2 3 ... 9", ~9-10 units tall each digit) — geometrically inside
// the section's bbox but not part of its name label. Every real section
// name label measured 26-30 units tall, so a minimum-height filter cleanly
// excludes those digits without needing per-section special-casing.
//
// "invalid" (wheelchair) turned out to contain a second kind of false
// match: a bare black wheelchair icon pictogram (~29x33 units — roughly
// square, actually slightly *taller* than wide). Every genuine name label
// measured here (even 2-character ones like "A1", let alone full words) is
// noticeably *wider* than it is tall, since they're horizontal text — an
// icon glyph isn't. Requiring width > height excludes it without needing
// to special-case "invalid" by id.
//
// If more than 2 paths still match after both filters, something
// unexpected is being swept up — warn rather than silently mis-hiding it.
const MIN_LABEL_HEIGHT = 18;

function hideBakedNameLabel(svg, shapeEl, sectionKey) {
  const bbox = shapeEl.getBBox();
  const matches = [];
  for (const el of svg.querySelectorAll("path")) {
    if (el.id || el.getAttribute("class") || el.getAttribute("fill") !== "black") continue;
    const b = el.getBBox();
    if (b.width === 0 || b.height < MIN_LABEL_HEIGHT || b.width <= b.height) continue;
    if (isFullyContained(b, bbox)) matches.push({ el, bbox: b });
  }

  if (matches.length === 0) return null; // nothing found — caller falls back to the section's own bbox center

  if (matches.length > 2) {
    console.warn(
      `[seatmap] ${sectionKey}: ${matches.length} candidate name-label paths matched (expected ≤2) — hiding all, but this may be over-matching.`
    );
  }
  matches.forEach(({ el }) => el.classList.add("seatmap-baked-label--hidden"));
  return unionBBox(matches.map((m) => m.bbox));
}

// Aitio boxes and press already read as labeled chips (small colored rects
// with their own baked short names); seisomakatsomo and invalid now get
// their own bespoke treatment (renderStandingWedge, renderWheelchairSlots)
// — only the seated sections go through this generic band-label path.
const LABEL_EXCLUDED_SECTIONS = new Set(["press", "aitiot", "seisomakatsomo", "invalid"]);

const C_SECTION_IDS = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"];
const A_SECTION_IDS = ["A1", "A2", "A3", "A4", "A5", "A6"];
const D_SECTION_IDS = ["D1", "D2"];

const LABEL_BAND_GAP = 10; // units between a band and the obstacle geometry it clears
const LABEL_HALF_HEIGHT = 15; // approx half the rendered height of a single-line .seatmap-label-text glyph

function maxRight(boxes) {
  return Math.max(...boxes.map((b) => b.x + b.width));
}
function minTop(boxes) {
  return Math.min(...boxes.map((b) => b.y));
}
function maxBottom(boxes) {
  return Math.max(...boxes.map((b) => b.y + b.height));
}

// Round 3 gave each seated section its own collision-avoiding placement;
// the owner's round-4 verdict was that the result was "inconsistent,
// unaligned" even though nothing overlapped. Replaced with three fixed,
// shared coordinates instead — one straight row per side — computed once
// from real measured obstacle geometry (not hardcoded), so it still holds
// if the persisted SVG's own content ever shifts slightly:
//   - C band (top): must clear the topmost edge across the aitio chip row,
//     the press ("Lehdistö") chip, the K18 outline, AND the WC icon that
//     sits directly above C1/C2 — that icon (y=0) turns out to be the
//     actual topmost obstacle, not K18 or the chips.
//   - A band (bottom): must clear the deepest bottom edge across all six
//     A sections. The WC icon near A1 is beside it (a different x range
//     entirely), not below, so it's deliberately excluded from this
//     calculation — verified visually, not by including it defensively.
//   - D band (right): must clear D1/D2's own right edge, which already
//     includes their row-number ruler digits (nested inside the same
//     group, so already part of the section's own bbox).
function computeLabelBands(svg) {
  const cBoxes = C_SECTION_IDS.map((id) => findById(svg, id)?.getBBox()).filter(Boolean);
  const aBoxes = A_SECTION_IDS.map((id) => findById(svg, id)?.getBBox()).filter(Boolean);
  const dBoxes = D_SECTION_IDS.map((id) => findById(svg, id)?.getBBox()).filter(Boolean);

  const aitioBoxes = Array.from(svg.querySelectorAll('[id^="aitio_"]')).map((el) => el.getBBox());
  const pressBox = findById(svg, "press")?.getBBox();
  const k18Box = svg.querySelector('path[stroke="#CC0088"]')?.getBBox();
  const wcIconBoxes = Array.from(svg.querySelectorAll('rect[fill="#B8B8B8"]')).map((el) => el.getBBox());

  const cTopObstacles = [...aitioBoxes, pressBox, k18Box, ...wcIconBoxes].filter(Boolean);

  return {
    cLabelY: minTop(cTopObstacles) - LABEL_BAND_GAP - LABEL_HALF_HEIGHT,
    aLabelY: maxBottom(aBoxes) + LABEL_BAND_GAP + LABEL_HALF_HEIGHT,
    dLabelX: maxRight(dBoxes) + LABEL_BAND_GAP,
  };
}

// Places a seated section's own replacement label on its side's shared
// band: C sections centered on their own x, all sharing bands.cLabelY; A
// sections the same but sharing bands.aLabelY; D1/D2 left-aligned at the
// shared bands.dLabelX, vertically centered on their own section.
function addSeatedSectionLabel(svg, sectionKey, sectionBBox, bands) {
  const svgNs = "http://www.w3.org/2000/svg";
  const text = document.createElementNS(svgNs, "text");
  text.setAttribute("class", "seatmap-halo-text seatmap-label-text");
  text.setAttribute("pointer-events", "none");
  text.setAttribute("aria-hidden", "true");
  text.textContent = sectionLabel(sectionKey);

  if (D_SECTION_IDS.includes(sectionKey)) {
    text.setAttribute("text-anchor", "start");
    text.setAttribute("x", String(bands.dLabelX));
    text.setAttribute("y", String(sectionBBox.y + sectionBBox.height / 2));
  } else {
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("x", String(sectionBBox.x + sectionBBox.width / 2));
    text.setAttribute("y", String(C_SECTION_IDS.includes(sectionKey) ? bands.cLabelY : bands.aLabelY));
  }

  // Appended directly to the svg root — after everything already in the
  // document, incl. #seats — so it always paints on top regardless of
  // nesting depth.
  svg.append(text);
}

function replaceSectionLabels(svg, latest, bands) {
  for (const row of latest.sections) {
    if (LABEL_EXCLUDED_SECTIONS.has(row.section)) continue;
    const shapeEl = findById(svg, row.section);
    if (!shapeEl) continue;
    hideBakedNameLabel(svg, shapeEl, row.section);
    addSeatedSectionLabel(svg, row.section, shapeEl.getBBox(), bands);
  }
}

const CTA_LINK_TEXT = "Osta liput";

// Kausikortti events have their own sales flow (season-ticket renewal, not
// the public elippu.net shop), and there's nothing to promote once a match
// is sold out — so this only ever renders for a match event with real
// availability left.
function buildCta(mergedEvent, latest) {
  if (mergedEvent.gameType === "kausikortti") return null;
  const available = latest.totals.available;
  if (available <= 0) return null;

  const cta = document.createElement("p");
  cta.className = "seatmap-cta";
  cta.append(`Auta tekemään Kisapuistosta keltamusta — vapaita paikkoja ${formatThousands(available)} `);

  const link = document.createElement("a");
  link.className = "seatmap-cta__link";
  link.href = `https://elippu.net/saipa/${mergedEvent.id}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = CTA_LINK_TEXT;
  cta.append(link);

  return cta;
}

// Seated sections are sparse individual circles with real gaps between
// them (rows/aisles) — a tap landing in a gap hits nothing at all and
// falls through to the SVG root. An invisible full-bbox rect behind the
// seats gives every seated section a solid tap target, matching how the
// aggregate areas (single filled shapes) already behave naturally.
function addSectionHitAreas(svg) {
  const svgNs = "http://www.w3.org/2000/svg";
  for (const sectionGroup of svg.querySelectorAll("g.section")) {
    const bbox = sectionGroup.getBBox();
    const hitArea = document.createElementNS(svgNs, "rect");
    hitArea.setAttribute("x", String(bbox.x));
    hitArea.setAttribute("y", String(bbox.y));
    hitArea.setAttribute("width", String(bbox.width));
    hitArea.setAttribute("height", String(bbox.height));
    hitArea.setAttribute("fill", "transparent");
    hitArea.setAttribute("class", "section-hit-area");
    hitArea.style.pointerEvents = "all"; // transparent fill can be ambiguous for hit-testing otherwise
    sectionGroup.prepend(hitArea);
  }
}

function colorSeats(svg, mergedEvent, latest, seats, baseline) {
  const disabledSectionSet = buildDisabledSectionSet(latest.sections);
  const soldSet = new Set(seats.soldSeatIds);

  // One walk over the seats actually present in the SVG (not one
  // querySelector per sold seat id, which was effectively O(sold count ×
  // DOM size)). classifySeat checks sold status first — sold always wins,
  // even in a disabled section, since hold is defined as total - sold so
  // the two never overlap — and disabled-section status only for the
  // unsold remainder, so a single classification per seat still replaces
  // the earlier two-pass approach (color sold seats, then re-walk disabled
  // sections to force ei-myynnissa) entirely.
  let matchedSoldCount = 0;
  for (const el of svg.querySelectorAll(".seat")) {
    const id = el.id;
    if (soldSet.has(id)) matchedSoldCount++;
    const state = classifySeat(id, { soldSet, baselineSet: baseline.soldSet, disabledSectionSet });

    // The persisted SVG has no inline r — this attribute is the baseline
    // (CSS `r` in style.css is Safari 16+ only; without the attribute,
    // older engines render every seat at r=0, i.e. invisible). Ei-myynnissä
    // seats render smaller so that state separates by shape, not just color.
    el.setAttribute("r", state === SEAT_STATE.EI_MYYNNISSA ? SEAT_RADIUS_EI_MYYNNISSA : SEAT_RADIUS);

    if (state !== SEAT_STATE.VAPAA) el.classList.add(state); // vapaa is the CSS default; skip the no-op write
  }

  // Assumes every sold id genuinely present in the SVG is a .seat element —
  // true for real seat ids (the only thing soldSeatIds ever contains), so
  // this walk-and-diff correctly stands in for the old per-id existence check.
  const missingCount = soldSet.size - matchedSoldCount;
  if (missingCount > 0) {
    console.warn(
      `[seatmap] ${mergedEvent.id}: ${missingCount} sold seat ID(s) from seats.json were not found in the SVG (svgHash=${seats.svgHash}).`
    );
  }
}

function colorAitioBoxes(svg, seats) {
  const soldAitioSet = new Set(seats.soldAitiot ?? []);
  for (const el of svg.querySelectorAll('[id^="aitio_"]')) {
    el.classList.add(classifyAitio(el.id, soldAitioSet));
  }
}

// The wheelchair area has its own small icon pictogram baked into the SVG
// (a bare, no-id/no-class path — the same kind hideBakedNameLabel already
// hides when it's mistaken for a name label) sitting on top of the
// invisible hit rect and, since round 6, directly under the 12 discrete
// slots. Round 6 kept it visible but pointer-neutralized (taps landing on
// it were silently swallowed otherwise, since default pointer-events
// hit-tests any painted shape regardless of what's logically
// "underneath"). Round 7: "PYÖRÄTUOLIPAIKAT" already names the area and
// the icon now sits confusingly under the slots, so it's hidden outright —
// display:none removes it from hit-testing too, so the pointer-events
// override is no longer needed. Scoped strictly to this section's own
// bbox (the same containment check as before), so the WC/restroom
// pictograms elsewhere on the map (a different icon, a different region)
// are untouched.
function neutralizeDecorativeIcons(svg, shapeBBox) {
  for (const el of svg.querySelectorAll("path")) {
    if (el.id || el.getAttribute("class") || el.getAttribute("fill") !== "black") continue;
    if (isFullyContained(el.getBBox(), shapeBBox)) el.classList.add("seatmap-baked-icon--hidden");
  }
}

// Replaces the wheelchair area's stacked-fill rect with WHEELCHAIR_SLOT_COUNT
// discrete, individually-colored slots in the same footprint — a count
// visualization (this data has no individual seat ids to color one-by-one,
// unlike the seated sections), not proportional scaling: the area's real
// capacity is exactly 12 in this arena. The underlying rect stays as an
// invisible hit target (see the ".seatmap-svg #invalid { fill: transparent; }"
// CSS rule) — the slots are purely visual, pointer-events: none, so tapping
// anywhere in the area still resolves to it via the unchanged tap handler.
// The numeral overlay is gone; exact figures live in tap-to-inspect and the
// table, same as every other section.
function renderWheelchairSlots(svg, latest, baseline, bands) {
  const sectionKey = "invalid";
  const row = latest.sections.find((r) => r.section === sectionKey);
  const shapeEl = findById(svg, sectionKey);
  if (!row || !shapeEl) return;

  hideBakedNameLabel(svg, shapeEl, sectionKey); // no-op today (no baked label found here), kept for consistency

  const shapeBBox = shapeEl.getBBox();
  neutralizeDecorativeIcons(svg, shapeBBox);

  const baselineSold = baseline.sectionSold?.get(sectionKey) ?? null;
  const slots = computeSlotSplit({ sold: row.sold, kausikorttiSold: baselineSold, disabled: row.disabled });

  const svgNs = "http://www.w3.org/2000/svg";
  const gap = 3;
  const slotWidth = (shapeBBox.width - gap * (WHEELCHAIR_SLOT_COUNT - 1)) / WHEELCHAIR_SLOT_COUNT;

  slots.forEach((state, i) => {
    const rect = document.createElementNS(svgNs, "rect");
    rect.setAttribute("class", `seatmap-wheelchair-slot seatmap-wheelchair-slot--${state}`);
    rect.setAttribute("x", String(shapeBBox.x + i * (slotWidth + gap)));
    rect.setAttribute("y", String(shapeBBox.y));
    rect.setAttribute("width", String(slotWidth));
    rect.setAttribute("height", String(shapeBBox.height));
    rect.setAttribute("rx", "2");
    rect.setAttribute("pointer-events", "none");
    svg.append(rect);
  });

  addWheelchairLabel(svg, shapeBBox, bands);
}

// "Pyörätuolipaikat" sits on the A-section band's shared y, centered on the
// slot row — but the wheelchair area happens to share its exact x-range
// with A1 (both are centered at the same x in this arena), so without an
// offset the two labels would land on the exact same point. Nudged down by
// a fixed gap from the shared band instead: still visually "on the A row",
// clear of A1's own label above it. A smaller font (--word modifier) since
// it's a word, not a peer section code.
const WHEELCHAIR_LABEL_Y_OFFSET = 24;

function addWheelchairLabel(svg, shapeBBox, bands) {
  const svgNs = "http://www.w3.org/2000/svg";
  const text = document.createElementNS(svgNs, "text");
  text.setAttribute("class", "seatmap-halo-text seatmap-label-text seatmap-label-text--word");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("pointer-events", "none");
  text.setAttribute("aria-hidden", "true");
  text.setAttribute("x", String(shapeBBox.x + shapeBBox.width / 2));
  text.setAttribute("y", String(bands.aLabelY + WHEELCHAIR_LABEL_Y_OFFSET));
  text.textContent = sectionLabel("invalid");
  svg.append(text);
}

let legendInfoIdCounter = 0;

function buildLegend(mapContainer, { hasBaseline, hasAitioOccupancy }) {
  const legend = document.createElement("div");
  legend.className = "seatmap-legend";

  const entries = hasBaseline
    ? [
        { cls: SEAT_STATE.KAUSIKORTTI, label: "Kausikorttipaikka" },
        { cls: SEAT_STATE.IRTOLIPPU, label: "Irtolippu" },
        { cls: SEAT_STATE.VAPAA, label: "Vapaa" },
      ]
    : [
        { cls: SEAT_STATE.MYYTY, label: "Myyty" },
        { cls: SEAT_STATE.VAPAA, label: "Vapaa" },
      ];
  entries.push({ cls: SEAT_STATE.EI_MYYNNISSA, label: "Ei myynnissä", info: EI_MYYNNISSA_INFO });
  if (hasAitioOccupancy) {
    entries.push({ cls: AITIO_STATE.MYYTY, label: "Myyty (muu kanava)", info: AITIO_INFO });
  }

  // Shared across every info toggle in this legend: only one popover open
  // at a time, closable via outside click or Escape.
  let openPopover = null; // { button, popover } | null

  function closeOpenPopover() {
    if (!openPopover) return;
    openPopover.button.setAttribute("aria-expanded", "false");
    openPopover.popover.hidden = true;
    openPopover = null;
  }

  function togglePopover(button, popover) {
    const wasOpen = openPopover?.button === button;
    closeOpenPopover();
    if (!wasOpen) {
      button.setAttribute("aria-expanded", "true");
      popover.hidden = false;
      openPopover = { button, popover };
    }
  }

  for (const entry of entries) legend.append(buildLegendItem(entry, togglePopover));

  // Scoped to the legend, so Escape only closes a popover while focus is
  // inside it (e.g. right after clicking the ⓘ button) — pressing Escape
  // with focus elsewhere on the page won't reach this listener at all.
  legend.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeOpenPopover();
  });
  // Scoped to this card's own map container (bubbling), not `document` —
  // a document-level listener here would never be removed and would
  // accumulate one permanent global listener per card ever expanded.
  // Clicks on the map itself (tapping a section) also count as "outside
  // the legend" and correctly close an open popover.
  mapContainer.addEventListener("click", (event) => {
    if (openPopover && !legend.contains(event.target)) closeOpenPopover();
  });

  return legend;
}

function buildLegendItem({ cls, label, info }, togglePopover) {
  const item = document.createElement("div");
  item.className = "seatmap-legend__item";

  const swatch = document.createElement("span");
  swatch.className = `seatmap-legend__swatch seatmap-legend__swatch--${cls}`;
  item.append(swatch);

  const text = document.createElement("span");
  text.textContent = label;
  item.append(text);

  if (info) {
    const popoverId = `seatmap-legend-info-${++legendInfoIdCounter}`;

    const infoButton = document.createElement("button");
    infoButton.type = "button";
    infoButton.className = "seatmap-legend__info-toggle";
    infoButton.textContent = "ⓘ";
    infoButton.setAttribute("aria-expanded", "false");
    infoButton.setAttribute("aria-controls", popoverId);

    const popover = document.createElement("p");
    popover.id = popoverId;
    popover.className = "seatmap-legend__info-popover";
    popover.textContent = info;
    popover.hidden = true;

    infoButton.addEventListener("click", (event) => {
      event.stopPropagation(); // defensive: keep this click from reaching unrelated document-level listeners
      togglePopover(infoButton, popover);
    });

    item.append(infoButton, popover);
  }

  return item;
}

function updateInfoRow(infoRow, sectionId, latest, baseline) {
  const lookupKey = sectionId.startsWith("aitio_") ? "aitiot" : sectionId;
  const row = latest.sections.find((r) => r.section === lookupKey);
  if (!row) return;

  const title = document.createElement("strong");
  title.textContent = sectionLabel(lookupKey);

  const numbers = document.createElement("p");
  numbers.textContent =
    `Myyty ${formatThousands(row.sold)} · Ostettavissa ${formatThousands(row.available)} · ` +
    `Ei myynnissä ${formatThousands(row.hold)} · Kapasiteetti ${formatThousands(row.total)} ` +
    `(${formatPercent(row.sold, row.total)})`;

  const children = [title, buildFillBar(row), numbers];

  if (baseline.sectionSold) {
    const baselineSold = baseline.sectionSold.get(lookupKey) ?? 0;
    const split = document.createElement("p");
    split.className = "seatmap-info-row__split";
    split.textContent = `josta irtolippuja: ${formatThousands(irtoliput(row.sold, baselineSold))}`;
    children.push(split);
  }

  infoRow.replaceChildren(...children);
}

function attachInteraction(svg, mapContainer, { latest, baseline, infoRow, resetButton }) {
  const originalViewBox = parseViewBox(svg.getAttribute("viewBox"));
  const bounds = { original: originalViewBox, maxZoom: MAX_ZOOM };
  let currentViewBox = { ...originalViewBox };

  function applyViewBox(vb) {
    currentViewBox = vb;
    svg.setAttribute("viewBox", serializeViewBox(vb));
  }

  // Capture can throw (e.g. NotFoundError if the pointer was already
  // released by the time this runs) — a failure here shouldn't abort the
  // rest of gesture-state setup, just fall back to less robust tracking
  // for that pointer if it strays outside the element's bounds.
  function tryCapturePointer(pointerId) {
    try {
      svg.setPointerCapture(pointerId);
    } catch {
      // ignore
    }
  }

  // getScreenCTM (not a linear rect-based mapping) is required here: the
  // container can letterbox the SVG (mobile forces aspect-ratio: 4/3,
  // desktop clamps max-height) since preserveAspectRatio defaults to
  // "xMidYMid meet" — a rect-based mapping assumes the rendered box fills
  // the element exactly and drifts off-finger whenever it doesn't.
  function svgPointFromClient(referenceCtm, clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    return pt.matrixTransform(referenceCtm.inverse());
  }

  function clientToSvgPoint(clientX, clientY) {
    return svgPointFromClient(svg.getScreenCTM(), clientX, clientY);
  }

  // Only zoomed in beyond the original (fully-zoomed-out) view engages our
  // own single-finger drag-pan / pointer capture — at min zoom, a single
  // finger is left entirely to the browser's native vertical scroll
  // (touch-action: pan-y on the container).
  function isZoomedIn() {
    // A coarser epsilon than viewBoxesEqual's (1e-6): this only needs to
    // reject the same-frame floating-point jitter a single applyViewBox
    // round-trip can introduce, not detect "is this wheel tick a no-op"
    // (which does need 1e-6, to not treat a genuine tiny zoom as settled).
    return currentViewBox.width < bounds.original.width - 0.01;
  }

  svg.addEventListener(
    "wheel",
    (event) => {
      const focal = clientToSvgPoint(event.clientX, event.clientY);
      const deltaY = normalizeWheelDeltaY(event.deltaY, event.deltaMode);
      const scaleFactor = 1 + deltaY * WHEEL_ZOOM_FACTOR;
      const nextViewBox = computeZoomedViewBox(currentViewBox, focal, scaleFactor, bounds);
      if (viewBoxesEqual(nextViewBox, currentViewBox)) return; // clamped no-op — let the page scroll instead
      event.preventDefault();
      applyViewBox(nextViewBox);
    },
    { passive: false }
  );

  const activePointers = new Map(); // pointerId -> {x, y}
  let dragStart = null; // {x, y, viewBox, ctm} for single-pointer pan — only set when zoomed in
  let downStart = null; // {x, y} for the primary pointer — always set, tap-vs-scroll measurement
  let pinchStart = null; // {distance, viewBox, midpoint} for two-pointer pinch
  let downPointerId = null;
  let totalMovement = 0;

  function distanceBetween(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  svg.addEventListener("pointerdown", (event) => {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointers.size === 1) {
      downPointerId = event.pointerId;
      totalMovement = 0;
      downStart = { x: event.clientX, y: event.clientY };
      if (isZoomedIn()) {
        tryCapturePointer(event.pointerId);
        // Freeze the CTM for the whole gesture — pointermove recomputes the
        // *total* delta from this start point on every event (not an
        // incremental step), so it must be measured against a fixed
        // reference, not the live CTM, which shifts mid-drag as soon as the
        // first pointermove calls applyViewBox.
        dragStart = { x: event.clientX, y: event.clientY, viewBox: currentViewBox, ctm: svg.getScreenCTM() };
      } else {
        dragStart = null; // at min zoom, defer to native scroll for this finger
      }
      pinchStart = null;
    } else if (activePointers.size === 2) {
      // Capture both fingers here — the first one may not have been
      // captured yet if the pinch started from min zoom (pointerdown for a
      // single finger only captures when already zoomed in). Re-capturing
      // an already-captured pointer is a harmless no-op.
      for (const id of activePointers.keys()) tryCapturePointer(id);
      dragStart = null;
      const [p1, p2] = [...activePointers.values()];
      pinchStart = {
        distance: distanceBetween(p1, p2),
        viewBox: currentViewBox,
        midpoint: clientToSvgPoint((p1.x + p2.x) / 2, (p1.y + p2.y) / 2),
      };
    }
  });

  svg.addEventListener("pointermove", (event) => {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointers.size === 2 && pinchStart) {
      const [p1, p2] = [...activePointers.values()];
      const newDistance = distanceBetween(p1, p2);
      if (newDistance > 0) {
        const scaleFactor = pinchStart.distance / newDistance;
        applyViewBox(computeZoomedViewBox(pinchStart.viewBox, pinchStart.midpoint, scaleFactor, bounds));
      }
      return;
    }

    // Tracked independently of whether we're actively panning, so a genuine
    // scroll swipe at min zoom (dragStart null, native scroll handling it)
    // still correctly fails the tap-movement-threshold check on release.
    if (event.pointerId === downPointerId && downStart) {
      totalMovement = Math.hypot(event.clientX - downStart.x, event.clientY - downStart.y);
    }

    if (dragStart && event.pointerId === downPointerId) {
      const startPt = svgPointFromClient(dragStart.ctm, dragStart.x, dragStart.y);
      const curPt = svgPointFromClient(dragStart.ctm, event.clientX, event.clientY);
      const dx = curPt.x - startPt.x;
      const dy = curPt.y - startPt.y;
      applyViewBox(computePannedViewBox(dragStart.viewBox, -dx, -dy, bounds));
    }
  });

  let selectedEl = null;
  function handleTap(clientX, clientY) {
    // setPointerCapture retargets event.target to the capturing element on
    // subsequent events, so hit-test by screen position rather than trust
    // the pointer event's own target/closest chain.
    const el = document.elementFromPoint(clientX, clientY);
    const sectionEl = el?.closest(".section");
    if (!sectionEl || !mapContainer.contains(sectionEl)) return;

    if (selectedEl) selectedEl.classList.remove("section--selected");
    sectionEl.classList.add("section--selected");
    selectedEl = sectionEl;

    updateInfoRow(infoRow, sectionEl.id, latest, baseline);
  }

  function endPointer(event) {
    const wasTap =
      activePointers.size === 1 && event.pointerId === downPointerId && totalMovement < TAP_MOVEMENT_THRESHOLD;
    const wasPinching = pinchStart !== null;

    activePointers.delete(event.pointerId);

    if (wasPinching && activePointers.size === 1) {
      // Two-finger pinch dropped to one — reseat pan from the surviving
      // pointer so it continues seamlessly instead of requiring a full
      // lift-and-repress to resume.
      pinchStart = null;
      const [survivorId, survivorPos] = [...activePointers.entries()][0];
      downPointerId = survivorId;
      downStart = { x: survivorPos.x, y: survivorPos.y };
      totalMovement = 0;
      dragStart = isZoomedIn()
        ? { x: survivorPos.x, y: survivorPos.y, viewBox: currentViewBox, ctm: svg.getScreenCTM() }
        : null;
    } else {
      if (activePointers.size < 2) pinchStart = null;
      if (event.pointerId === downPointerId) {
        dragStart = null;
        downStart = null;
      }
    }

    if (wasTap) handleTap(event.clientX, event.clientY);
  }

  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);

  resetButton.addEventListener("click", () => {
    applyViewBox(originalViewBox);
    if (selectedEl) {
      selectedEl.classList.remove("section--selected");
      selectedEl = null;
    }
    infoRow.textContent = INFO_ROW_PLACEHOLDER;
  });
}
