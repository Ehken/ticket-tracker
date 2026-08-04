import { formatHelsinkiDate, formatThousands, formatPercent } from "./format.js";
import { buildSectionTable, buildFillBar } from "./sectionTable.js";
import { buildChart } from "./chart.js";
import { getHistory, getSeasonBaselineHistory } from "./fetchData.js";
import { gameTypeLabel } from "./grouping.js";
import { buildSeatMapPanel } from "./seatMap.js";
import { findCheapestAvailableSection, formatPrice } from "./prices.js";
import { sectionLabel } from "./sectionLabels.js";
import { nextTabIndex } from "./tabs.js";

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

// The shop's capacity (4976) is not the arena's official spectator
// capacity (4820): the shop data additionally lists the 9 aitio boxes'
// 156 seats as sellable inventory, and 4976 - 156 = 4820 exactly. Shown
// as an ⓘ popover on every card's Kapasiteetti stat so the mismatch
// against publicly quoted figures doesn't read as a data error.
const CAPACITY_INFO =
  "Kapasiteetti on laskettu lippukaupan (elippu.net) paikkadatasta, ja siihen sisältyvät myös " +
  "aitiopaikat (156). Kisapuiston virallinen katsojakapasiteetti on 4 820.";

let statInfoIdCounter = 0;

// Same interaction pattern as the seat-map legend's ⓘ (js/seatMap.js's
// buildLegendItem): a click-toggled popover, not a title attribute —
// title tooltips never open on touch, and phones are this site's main
// audience. Self-contained per stat (one button, one popover, its own
// outside-click/Escape close) since stats don't share a coordinating
// parent the way legend items do.
function buildStat(label, value, { info } = {}) {
  const span = document.createElement("span");
  span.className = "card__stat";

  const labelEl = document.createElement("span");
  labelEl.className = "card__stat-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("span");
  valueEl.className = "card__stat-value";
  valueEl.textContent = value;

  span.append(labelEl, valueEl);

  if (info) {
    const popoverId = `card-stat-info-${++statInfoIdCounter}`;

    const infoButton = document.createElement("button");
    infoButton.type = "button";
    infoButton.className = "card__stat-info-toggle";
    infoButton.textContent = "ⓘ";
    infoButton.setAttribute("aria-expanded", "false");
    infoButton.setAttribute("aria-controls", popoverId);

    const popover = document.createElement("p");
    popover.id = popoverId;
    popover.className = "card__stat-info-popover";
    popover.textContent = info;
    popover.hidden = true;

    // The document-level close listener exists only WHILE the popover is
    // open — added on open, removed on close — so re-rendering cards on
    // every filter change can't accumulate permanent global listeners
    // (the exact leak the seat-map legend's scoping comment warns about).
    // Capture-phase so a click landing anywhere (including the card
    // header, which stops nothing) closes the popover before it acts.
    function onDocumentClick(event) {
      if (!span.contains(event.target)) setOpen(false);
    }

    function setOpen(open) {
      popover.hidden = !open;
      infoButton.setAttribute("aria-expanded", String(open));
      if (open) document.addEventListener("click", onDocumentClick, { capture: true });
      else document.removeEventListener("click", onDocumentClick, { capture: true });
    }

    infoButton.addEventListener("click", (event) => {
      // The stat lives inside the card header, whose own click listener
      // toggles card expansion — opening an explanation must not also
      // expand/collapse the card.
      event.stopPropagation();
      setOpen(popover.hidden);
    });
    span.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setOpen(false);
    });

    labelEl.append(" ");
    labelEl.append(infoButton);
    span.append(popover);
  }

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

  const derived = isKausikortti ? mergedEvent.seasonBaseline : null;
  if (derived) {
    // The listing's own sold/available/hold stop describing season tickets
    // once match tickets are on sale (a single-game purchase blocks the
    // seat here too), so the card shows only the derived season-ticket
    // count — see scripts/lib/seasonBaseline.js. Ostettavissa/Ei myynnissä
    // are dropped rather than shown next to a derived Myyty they no longer
    // sum with; the note appended in buildCard explains the derivation.
    const fillRow = {
      sold: derived.totals.sold,
      available: totals.total - derived.totals.sold,
      hold: 0,
      total: totals.total,
    };
    headline.append(
      buildStat("Myyty", formatThousands(derived.totals.sold)),
      buildStat("Kapasiteetti", formatThousands(totals.total), { info: CAPACITY_INFO }),
      buildStat("Osuus kapasiteetista", formatPercent(derived.totals.sold, totals.total))
    );
    header.append(title, headline, buildFillBar(fillRow));
    return header;
  }

  headline.append(
    buildStat("Myyty", formatThousands(totals.sold)),
    buildStat("Ostettavissa", formatThousands(totals.available)),
    buildStat("Ei myynnissä", formatThousands(totals.hold)),
    buildStat("Kapasiteetti", formatThousands(totals.total), { info: CAPACITY_INFO }),
    // A match's "Täyttö" is arena fill for one game; a kausikortti
    // listing's is the share of a whole season's capacity committed —
    // two different quantities under one word would be compared as if
    // they were the same scale.
    buildStat(isKausikortti ? "Osuus kapasiteetista" : "Täyttö", formatPercent(totals.sold, totals.total))
  );

  header.append(title, headline, buildFillBar(totals));
  return header;
}

let tabsIdCounter = 0;

// Minimal WAI-ARIA APG tabs pattern for the map/table pair below — a
// generic { label, panel, onShow? } array (not hardcoded to two) so a
// future third tab (e.g. per-section history) is a one-line addition, not
// a rewrite. Automatic activation (arrow-key focus also selects): cheap
// here since switching to an already-built tab is just a `hidden` flip.
// onShow fires every time a tab is selected, not just once — buildSeatMapPanel
// relies on that to run its deferred, visibility-dependent layout work on
// first (and only) actual display. The returned notifyShown re-fires the
// currently active entry's onShow on demand — needed because selecting a
// tab isn't the only way a panel can go from hidden back to visible: the
// whole card can be collapsed and re-expanded while a panel's own load is
// still in flight, and nothing about that touches the tablist at all.
function buildTabs(entries) {
  const instanceId = ++tabsIdCounter;

  const wrapper = document.createElement("div");
  wrapper.className = "card__tabs";

  const tablist = document.createElement("div");
  tablist.className = "card__tablist";
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", "Näkymä");

  const tabButtons = entries.map((entry, index) => {
    const tabId = `card-tab-${instanceId}-${index}`;
    const panelId = `card-tabpanel-${instanceId}-${index}`;

    const tab = document.createElement("button");
    tab.type = "button";
    tab.id = tabId;
    tab.className = "card__tab";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", panelId);
    tab.textContent = entry.label;
    tablist.append(tab);

    entry.panel.id = panelId;
    entry.panel.setAttribute("role", "tabpanel");
    entry.panel.setAttribute("aria-labelledby", tabId);

    return tab;
  });

  let selectedIndex = 0;

  function selectTab(index) {
    selectedIndex = index;
    entries.forEach((entry, i) => {
      const selected = i === index;
      tabButtons[i].setAttribute("aria-selected", String(selected));
      tabButtons[i].tabIndex = selected ? 0 : -1;
      entry.panel.hidden = !selected;
    });
    entries[index].onShow?.();
  }

  tabButtons.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(index));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = nextTabIndex(index, event.key, entries.length);
      selectTab(next);
      tabButtons[next].focus();
    });
  });

  selectTab(0);

  wrapper.append(tablist, ...entries.map((entry) => entry.panel));
  return { wrapper, notifyShown: () => entries[selectedIndex].onShow?.() };
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
  let notifyTabsShown = null;
  async function ensureBodyBuilt() {
    if (bodyBuilt) return;
    bodyBuilt = true;

    // Map first, table secondary (see buildTabs) — built before the chart
    // below so the map's own fetches start immediately rather than waiting
    // behind the chart's getHistory() call.
    const tablePanel = buildSectionTable(latest);
    const { panel: mapPanel, onShow: mapOnShow } = buildSeatMapPanel(mergedEvent, latest, { kausikorttiEvents });
    const tabs = buildTabs([
      { label: "Kartta", panel: mapPanel, onShow: mapOnShow },
      { label: "Taulukko", panel: tablePanel },
    ]);
    notifyTabsShown = tabs.notifyShown;
    body.append(tabs.wrapper);

    const chartWrapper = document.createElement("div");
    chartWrapper.className = "card__chart-wrapper";
    const canvas = document.createElement("canvas");
    canvas.className = "card__chart";
    chartWrapper.append(canvas);
    body.append(chartWrapper);

    try {
      // A kausikortti card with a derived baseline charts the derived
      // series: the raw history.json curve climbs with single-game sales
      // once match tickets open (the very distortion the derivation
      // removes), so plotting it under a derived headline number would
      // contradict the card's own stats. Empty until the first scrape
      // after the derivation feature landed — fall back to raw until then.
      let history = [];
      if (mergedEvent.gameType === "kausikortti" && mergedEvent.seasonBaseline) {
        history = await getSeasonBaselineHistory(mergedEvent.id);
      }
      if (history.length === 0) {
        history = await getHistory(mergedEvent.id);
      }
      buildChart(canvas, history);
    } catch (err) {
      const errorEl = document.createElement("p");
      errorEl.className = "card__error";
      errorEl.textContent = "Myyntikäyrää ei voitu ladata.";
      chartWrapper.replaceWith(errorEl);
      console.error(`Failed to load history for ${mergedEvent.id}:`, err);
    }

    const cheapestLine = buildCheapestAvailableLine(mergedEvent, latest);
    if (cheapestLine) body.append(cheapestLine);
  }

  async function setExpanded(next) {
    expanded = next;
    header.setAttribute("aria-expanded", String(expanded));
    body.hidden = !expanded;
    if (expanded) {
      await ensureBodyBuilt();
      // Re-expanding is also how a card recovers from having been
      // collapsed while the map's own load was still in flight — that
      // load may have resolved while hidden and parked its layout work
      // rather than run it (see isVisible in seatMap.js). Selecting a tab
      // isn't the only way back to visible, so re-fire the active tab's
      // onShow here too; it's a no-op if there's nothing pending.
      notifyTabsShown?.();
    }
  }

  header.addEventListener("click", () => setExpanded(!expanded));

  article.append(header);

  if (mergedEvent.note) {
    const note = document.createElement("p");
    note.className = "card__note";
    note.textContent = mergedEvent.note;
    article.append(note);
  }

  if (mergedEvent.gameType === "kausikortti" && mergedEvent.seasonBaseline) {
    // Automatic companion to the derived headline number above (not an
    // overrides.json note): without it, anyone comparing the card against
    // the shop's own listing would see a smaller number here and assume
    // the tracker lags.
    const derivedNote = document.createElement("p");
    derivedNote.className = "card__note";
    derivedNote.textContent =
      "Kausikorttimäärä on päätelty ottelukohtaisista paikkatiedoista: kausikortiksi lasketaan paikka, " +
      "joka on myyty kauden jokaiseen otteluun." +
      // The pin is a display-relevant fact, not just scraper plumbing: a
      // visitor comparing the card against the shop needs to know this
      // number is deliberately held still, not lagging.
      (mergedEvent.seasonBaselineFrozen
        ? " Luku on lukittu eikä päivity automaattisesti; se tarkistetaan käsin kauden aikana."
        : "") +
      " Lippukaupan oma luku olisi suurempi, koska yksittäisen ottelulipun osto varaa paikan myös " +
      "kausikorttilistauksesta.";
    article.append(derivedNote);
  }

  article.append(body);

  if (preExpanded) {
    ensureBodyBuilt();
  }

  return article;
}
