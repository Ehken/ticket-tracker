import { formatHelsinkiDate, formatThousands, formatPercent } from "./format.js";
import { buildSectionTable, buildFillBar } from "./sectionTable.js";
import { buildChart } from "./chart.js";
import { getHistory } from "./fetchData.js";
import { gameTypeLabel } from "./grouping.js";
import { buildSeatMapToggle } from "./seatMap.js";

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

function buildHeader(mergedEvent, totals, expanded, { showSeasonBadge = false, showGameTypeLabel = false } = {}) {
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
    const pelattuTag = document.createElement("span");
    pelattuTag.className = "card__pelattu-tag";
    pelattuTag.textContent = "Pelattu";
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

  const dateSpan = document.createElement("span");
  dateSpan.className = "card__date";
  dateSpan.textContent = formatHelsinkiDate(mergedEvent.start);
  title.append(dateSpan);

  const headline = document.createElement("div");
  headline.className = "card__headline";
  headline.append(
    buildStat("Myyty", formatThousands(totals.sold)),
    buildStat("Ostettavissa", formatThousands(totals.available)),
    buildStat("Ei myynnissä", formatThousands(totals.hold)),
    buildStat("Kapasiteetti", formatThousands(totals.total)),
    buildStat("Täyttö", formatPercent(totals.sold, totals.total))
  );

  header.append(title, headline, buildFillBar(totals));
  return header;
}

function buildCompactHeader(mergedEvent, totals) {
  const header = document.createElement("button");
  header.type = "button";
  header.className = "card__header card__header--compact";
  header.setAttribute("role", "button");
  header.setAttribute("tabindex", "0");
  header.setAttribute("aria-expanded", "false");

  const line = document.createElement("div");
  line.className = "card__compact-line";
  const text = `Kausikortit: ${formatThousands(totals.sold)} / ${formatThousands(totals.total)} · ${formatPercent(totals.sold, totals.total)}`;
  line.append(document.createTextNode(text));

  if (mergedEvent.status === "past") {
    const pelattuTag = document.createElement("span");
    pelattuTag.className = "card__pelattu-tag";
    pelattuTag.textContent = "Pelattu";
    line.append(pelattuTag);
  }

  line.append(buildChevron());

  header.append(line, buildFillBar(totals));
  return header;
}

export function buildCard(
  mergedEvent,
  latest,
  {
    preExpanded = false,
    compactSummary = false,
    showSeasonBadge = false,
    showGameTypeLabel = false,
    kausikorttiEvents = [],
  } = {}
) {
  const article = document.createElement("article");
  article.className = mergedEvent.status === "past" ? "card card--past" : "card";

  let expanded = preExpanded;

  const standardHeader = buildHeader(mergedEvent, latest.totals, expanded, {
    showSeasonBadge,
    showGameTypeLabel,
  });
  const compactHeader = compactSummary ? buildCompactHeader(mergedEvent, latest.totals) : null;

  const body = document.createElement("div");
  body.className = "card__body";
  body.hidden = !expanded;

  function syncHeaderVisibility() {
    if (!compactSummary) return;
    standardHeader.hidden = !expanded;
    compactHeader.hidden = expanded;
  }
  syncHeaderVisibility();

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
  }

  async function setExpanded(next) {
    expanded = next;
    standardHeader.setAttribute("aria-expanded", String(expanded));
    if (compactHeader) compactHeader.setAttribute("aria-expanded", String(expanded));
    body.hidden = !expanded;
    syncHeaderVisibility();
    if (expanded) await ensureBodyBuilt();
  }

  standardHeader.addEventListener("click", () => setExpanded(!expanded));
  if (compactHeader) {
    // The compact strip only ever expands (collapsing back happens via the
    // standard header, once it's showing).
    compactHeader.addEventListener("click", () => setExpanded(true));
  }

  if (compactHeader) article.append(compactHeader);
  article.append(standardHeader);

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
