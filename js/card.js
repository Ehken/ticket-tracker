import { formatHelsinkiDate, formatThousands, formatPercent } from "./format.js";
import { buildSectionTable, buildFillBar } from "./sectionTable.js";
import { buildChart } from "./chart.js";
import { getHistory } from "./fetchData.js";
import { gameTypeLabel } from "./grouping.js";
import { buildSeatMapToggle } from "./seatMap.js";
import { findCheapestAvailableSection, formatPrice } from "./prices.js";
import { sectionLabel } from "./sectionLabels.js";

// Omitted for kausikortti events: a season-ticket price (e.g. 852 €) shown
// in this same "Halvin vapaa paikka" phrasing could be misread as a
// per-match ticket price, and the line's value is mainly about match-day
// browsing anyway.
function buildCheapestAvailableLine(mergedEvent, latest) {
  if (mergedEvent.gameType === "kausikortti") return null;

  const cheapest = findCheapestAvailableSection(latest.sections, latest.prices);
  if (!cheapest) return null;

  const p = document.createElement("p");
  p.className = "card__cheapest-available";
  p.textContent = `Halvin vapaa paikka: ${sectionLabel(cheapest.section)}, ${formatPrice(cheapest.price)}`;
  return p;
}

function buildStat(label, value) {
  const span = document.createElement("span");
  span.className = "card__stat";

  const labelEl = document.createElement("span");
  labelEl.className = "card__stat-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("span");
  valueEl.className = "card__stat-value";
  valueEl.textContent = value;

  span.append(labelEl, valueEl);
  return span;
}

function buildChevron() {
  // Line-drawn chevron (CSS border trick), not a text glyph — glyph rendering
  // varies across fonts/platforms and stays visually small.
  const chevron = document.createElement("span");
  chevron.className = "card__chevron";
  chevron.setAttribute("aria-hidden", "true");
  return chevron;
}

// mergedEvent.gameType === "kausikortti" changes three things below, all
// derived from this single check rather than caller-supplied flags: a
// flag per difference would make an inconsistent state representable (a
// kausikortti card showing "Osuus kapasiteetista" but still displaying a
// raw date, because some future call site forgot to pass a flag) where
// deriving all three from one condition makes that unrepresentable.
function buildHeader(mergedEvent, totals, expanded, { showSeasonBadge = false, showGameTypeLabel = false } = {}) {
  const isKausikortti = mergedEvent.gameType === "kausikortti";

  const header = document.createElement("button");
  header.type = "button";
  header.className = "card__header";
  header.setAttribute("role", "button");
  header.setAttribute("tabindex", "0");
  header.setAttribute("aria-expanded", String(expanded));

  const title = document.createElement("div");
  title.className = "card__title";
  const nameSpan = document.createElement("span");
  nameSpan.className = "card__name";
  nameSpan.textContent = mergedEvent.name;
  title.append(nameSpan, buildChevron());

  if (mergedEvent.status === "past") {
    // For a match, "past" means played. For a kausikortti listing,
    // archiveMissingEvents (scripts/lib/dataStore.js) sets the same
    // status when it disappears from the shop listing — i.e. sales
    // closed, not "the date has passed".
    const pelattuTag = document.createElement("span");
    pelattuTag.className = "card__pelattu-tag";
    pelattuTag.textContent = isKausikortti ? "Myynti päättynyt" : "Pelattu";
    title.append(pelattuTag);
  }

  if (showGameTypeLabel) {
    const typeLabel = document.createElement("span");
    typeLabel.className = "card__game-type-label";
    typeLabel.textContent = gameTypeLabel(mergedEvent.gameType);
    title.append(typeLabel);
  }

  if (showSeasonBadge && mergedEvent.season) {
    const badge = document.createElement("span");
    badge.className = "card__season-badge";
    badge.textContent = mergedEvent.season;
    title.append(badge);
  }

  if (!isKausikortti) {
    // mergedEvent.start for a kausikortti listing is its sales-window
    // boundary, not a fixture date — showing it in this slot would read
    // as "season tickets happen on this date". Omitted rather than
    // replaced: the card's own name already carries the season, and so
    // does the season badge above when it's shown.
    const dateSpan = document.createElement("span");
    dateSpan.className = "card__date";
    dateSpan.textContent = formatHelsinkiDate(mergedEvent.start);
    title.append(dateSpan);
  }

  const headline = document.createElement("div");
  headline.className = "card__headline";
  headline.append(
    buildStat("Myyty", formatThousands(totals.sold)),
    buildStat("Ostettavissa", formatThousands(totals.available)),
    buildStat("Ei myynnissä", formatThousands(totals.hold)),
    buildStat("Kapasiteetti", formatThousands(totals.total)),
    // A match's "Täyttö" is arena fill for one game; a kausikortti
    // listing's is the share of a whole season's capacity committed —
    // two different quantities under one word would be compared as if
    // they were the same scale.
    buildStat(isKausikortti ? "Osuus kapasiteetista" : "Täyttö", formatPercent(totals.sold, totals.total))
  );

  header.append(title, headline, buildFillBar(totals));
  return header;
}

export function buildCard(
  mergedEvent,
  latest,
  {
    preExpanded = false,
    showSeasonBadge = false,
    showGameTypeLabel = false,
    kausikorttiEvents = [],
  } = {}
) {
  const article = document.createElement("article");
  article.className = mergedEvent.status === "past" ? "card card--past" : "card";

  let expanded = preExpanded;

  const header = buildHeader(mergedEvent, latest.totals, expanded, {
    showSeasonBadge,
    showGameTypeLabel,
  });

  const body = document.createElement("div");
  body.className = "card__body";
  body.hidden = !expanded;

  let bodyBuilt = false;
  async function ensureBodyBuilt() {
    if (bodyBuilt) return;
    bodyBuilt = true;

    body.append(buildSectionTable(latest));

    const chartWrapper = document.createElement("div");
    chartWrapper.className = "card__chart-wrapper";
    const canvas = document.createElement("canvas");
    canvas.className = "card__chart";
    chartWrapper.append(canvas);
    body.append(chartWrapper);

    try {
      const history = await getHistory(mergedEvent.id);
      buildChart(canvas, history);
    } catch (err) {
      const errorEl = document.createElement("p");
      errorEl.className = "card__error";
      errorEl.textContent = "Myyntikäyrää ei voitu ladata.";
      chartWrapper.replaceWith(errorEl);
      console.error(`Failed to load history for ${mergedEvent.id}:`, err);
    }

    body.append(buildSeatMapToggle(mergedEvent, latest, { kausikorttiEvents }));

    const cheapestLine = buildCheapestAvailableLine(mergedEvent, latest);
    if (cheapestLine) body.append(cheapestLine);
  }

  async function setExpanded(next) {
    expanded = next;
    header.setAttribute("aria-expanded", String(expanded));
    body.hidden = !expanded;
    if (expanded) await ensureBodyBuilt();
  }

  header.addEventListener("click", () => setExpanded(!expanded));

  article.append(header);

  if (mergedEvent.note) {
    const note = document.createElement("p");
    note.className = "card__note";
    note.textContent = mergedEvent.note;
    article.append(note);
  }

  article.append(body);

  if (preExpanded) {
    ensureBodyBuilt();
  }

  return article;
}
