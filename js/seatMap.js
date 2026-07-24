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
} from "./seatMapViewBox.js";

const INFO_ROW_PLACEHOLDER = "Kosketa katsomoa nähdäksesi tarkat luvut.";

const EI_MYYNNISSA_INFO =
  "Ei myynnissä: paikat on varattu esim. vieraskannattajille, ryhmille tai muuhun käyttöön. SaiPa voi vapauttaa niitä myyntiin lähempänä ottelua.";
const AITIO_INFO = "Aitiopaikat myydään pääosin erillisten sopimusten kautta, ei elippu.net-kaupasta.";

const TAP_MOVEMENT_THRESHOLD = 6; // px in screen space, disambiguates tap from drag-pan
const WHEEL_ZOOM_FACTOR = 0.001;
const MAX_ZOOM = 4;

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

  const svgWrapper = document.createElement("div");
  svgWrapper.className = "seatmap-svg-container";
  svgWrapper.append(svg);

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "seatmap-reset-button";
  resetButton.textContent = "Palauta näkymä";

  const infoRow = document.createElement("div");
  infoRow.className = "seatmap-info-row";
  infoRow.textContent = INFO_ROW_PLACEHOLDER;

  const legend = buildLegend({
    hasBaseline: baseline.soldSet !== null,
    hasAitioOccupancy: (seats.soldAitiot ?? []).length > 0,
  });

  mapContainer.replaceChildren(legend, svgWrapper, resetButton, infoRow);

  // The container is already visible (see buildSeatMapToggle) so getBBox()
  // below reflects real layout, not a display:none zero-box.
  addSectionHitAreas(svg);
  colorSeats(svg, mergedEvent, latest, seats, baseline);
  colorAitioBoxes(svg, seats);
  findById(svg, "press")?.classList.add("ei-myynnissa");
  addAggregateOverlay(svg, latest, "seisomakatsomo", legend);
  addAggregateOverlay(svg, latest, "invalid", legend);

  attachInteraction(svg, mapContainer, { latest, baseline, infoRow, resetButton });
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
  // DOM size)). classifySeat already checks disabled-section status first,
  // so a single classification per seat replaces the earlier two-pass
  // approach (color sold seats, then re-walk disabled sections to force
  // ei-myynnissa) entirely.
  let matchedSoldCount = 0;
  for (const el of svg.querySelectorAll(".seat")) {
    const id = el.id;
    // The persisted SVG has no inline r — this attribute is the baseline
    // (CSS `r` in style.css is Safari 16+ only; without the attribute,
    // older engines render every seat at r=0, i.e. invisible).
    el.setAttribute("r", "4");

    if (soldSet.has(id)) matchedSoldCount++;
    const state = classifySeat(id, { soldSet, baselineSet: baseline.soldSet, disabledSectionSet });
    if (state !== SEAT_STATE.VAPAA) el.classList.add(state); // vapaa is the CSS default; skip the no-op write
  }

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

// Places a numeric "sold / total" overlay directly on a shape's own SVG
// region (seisomakatsomo/invalid — real, addressable geometry). The SVG has
// no <text> elements of its own: every section name is baked in as an
// outlined <path> label centered in the shape, so a naive centered overlay
// would collide with it — placed in the lower part of the bbox instead,
// with a background rect so it stays legible over the seat-dot grid too.
function addAggregateOverlay(svg, latest, sectionKey, legendEl) {
  const row = latest.sections.find((r) => r.section === sectionKey);
  if (!row) return;

  const shapeEl = findById(svg, sectionKey);
  if (!shapeEl) {
    // No usable region in this SVG version — surface the numbers in the
    // legend instead of inventing overlay coordinates.
    const fallback = document.createElement("div");
    fallback.className = "seatmap-legend__fallback-numbers";
    fallback.textContent = `${sectionLabel(sectionKey)}: ${formatThousands(row.sold)} / ${formatThousands(row.total)}`;
    legendEl.append(fallback);
    return;
  }

  const svgNs = "http://www.w3.org/2000/svg";
  const bbox = shapeEl.getBBox();

  const text = document.createElementNS(svgNs, "text");
  text.setAttribute("class", "seatmap-overlay-text");
  text.setAttribute("x", String(bbox.x + bbox.width / 2));
  text.setAttribute("y", String(bbox.y + bbox.height * 0.8));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("pointer-events", "none");
  text.textContent = `${formatThousands(row.sold)} / ${formatThousands(row.total)}`;
  svg.append(text);

  const textBBox = text.getBBox();
  const pad = 4;
  const bg = document.createElementNS(svgNs, "rect");
  bg.setAttribute("class", "seatmap-overlay-bg");
  bg.setAttribute("x", String(textBBox.x - pad));
  bg.setAttribute("y", String(textBBox.y - pad));
  bg.setAttribute("width", String(textBBox.width + pad * 2));
  bg.setAttribute("height", String(textBBox.height + pad * 2));
  bg.setAttribute("rx", "3");
  bg.setAttribute("pointer-events", "none");
  text.before(bg);
}

let legendInfoIdCounter = 0;

function buildLegend({ hasBaseline, hasAitioOccupancy }) {
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

  legend.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeOpenPopover();
  });
  document.addEventListener("click", (event) => {
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
