import {
  getEventsIndex,
  getOverrides,
  getAutoclass,
  getSchedule,
  getLatest,
  getSeasonBaseline,
  IS_MOCK,
} from "./fetchData.js";
import { mergeClassification } from "./classify.js";
import {
  computeSeasons,
  filterBySeason,
  splitKausikortti,
  filterBySarja,
  computeSarjaAvailability,
  resolveSarja,
  resolveKausi,
  computeOpponents,
  resolveVastustaja,
  filterByVastustaja,
  filterByPelatut,
  buildTimeline,
  groupByMonth,
  NO_GAMES_YET_TEXT,
} from "./grouping.js";
import { buildCard } from "./card.js";
import { buildFilterBar } from "./filterBar.js";
import { readUrlState, writeUrlState, IS_DASHBOARD } from "./urlState.js";
import { renderDashboard } from "./dashboard.js";
import { buildSummaryStrip } from "./summaryStrip.js";
import { formatHelsinkiTime } from "./format.js";

async function attachLatest(mergedEvents) {
  const withLatest = await Promise.all(
    mergedEvents.map(async (event) => {
      try {
        const latest = await getLatest(event.id);
        return { ...event, latest };
      } catch (err) {
        console.error(`Failed to load latest.json for ${event.id}:`, err);
        return null;
      }
    })
  );
  return withLatest.filter(Boolean);
}

function renderUpdatedAt(events) {
  const el = document.getElementById("updated-at");
  if (events.length === 0) {
    el.textContent = "";
    return;
  }
  const latestSeen = events.reduce((max, e) => (e.lastSeen > max ? e.lastSeen : max), events[0].lastSeen);
  el.textContent = `Päivitetty ${formatHelsinkiTime(latestSeen)}`;
}

// One-way navigation: the dashboard gets a link back to the front page, the
// front page has no link to the dashboard. The front page's own "Kauden
// luvut" strip is what a reader is meant to find there, and a second link
// to a fuller version of the same numbers competed with it; ?dashboard=1 is
// reachable by URL for anyone who wants the rest of the panels.
//
// Built in JS rather than as a static href so the link carries the CURRENT
// query params (kausi, mock, …) across — a link that dropped ?mock=1 would
// silently flip the viewer from test data to production.
function renderSiteNav() {
  if (!IS_DASHBOARD) return;
  const nav = document.getElementById("site-nav");
  if (!nav) return;

  const params = new URLSearchParams(window.location.search);
  params.delete("dashboard");
  params.delete("forecast");
  params.delete("sarja"); // dashboard-scoped; the front page resolves its own

  const link = document.createElement("a");
  link.className = "site-nav__link";
  link.textContent = "← Lipputilanne";
  const query = params.toString();
  link.href = `${window.location.pathname}${query ? `?${query}` : ""}`;
  nav.append(link);
}

function renderMockBanner() {
  if (!IS_MOCK) return;
  const banner = document.createElement("p");
  banner.className = "mock-banner";
  banner.textContent = "TESTIDATA-TILA (?mock=1) — ei oikeaa myyntidataa";
  document.body.prepend(banner);
}

function buildEmptyStateAction(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "empty-state__action";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

async function main() {
  renderMockBanner();
  renderSiteNav();

  const [eventsIndex, overrides, autoclass, schedule] = await Promise.all([
    getEventsIndex(),
    getOverrides(),
    getAutoclass(),
    getSchedule(),
  ]);

  const merged = eventsIndex.map((event) => mergeClassification(event, { overrides, autoclass }));
  const visible = merged.filter((e) => !e.hidden);

  renderUpdatedAt(visible);

  const withLatest = await attachLatest(visible);
  const { seasons, hasMultipleSeasons } = computeSeasons({ overrides, autoclass, schedule });
  // Kausikortti events are never rendered as listings of their own (no card
  // on the front page, no tile on the dashboard). They are still split out
  // and loaded because every match view derives its season-ticket baseline
  // from them: the seat map's kausikortti/irtolippu split, the share
  // graphic's fill bar and the dashboard's whole irtolippu calculation.
  const { kausikortti, rest } = splitKausikortti(withLatest);

  // Only kausikortti events carry a derived baseline; a fetch failure (as
  // opposed to a clean 404, which resolves to null) degrades to the raw
  // listing data rather than dropping the event the way attachLatest does —
  // every consumer falls back to the listing's own numbers.
  await Promise.all(
    kausikortti.map(async (event) => {
      try {
        event.seasonBaseline = await getSeasonBaseline(event.id);
      } catch (err) {
        event.seasonBaseline = null;
        console.error(`Failed to load seasonBaseline.json for ${event.id}:`, err);
      }
    })
  );

  if (IS_DASHBOARD) {
    // Same data-source resolution as the normal view (incl. ?mock=1), but
    // renders a completely separate page instead. Reachable from the header
    // link and from the front page's summary strip, both of which carry the
    // current query params across.
    const kausi = resolveKausi(readUrlState().kausi, seasons, rest);
    await renderDashboard({ kausikortti, matchEvents: rest, kausi, schedule });
    return;
  }

  // Built once, not per render(): it owns its open/closed state and its
  // per-season history cache, both of which a rebuild would throw away.
  const summaryStrip = buildSummaryStrip({ kausikortti, matchEvents: rest });
  const summaryStripContainer = document.getElementById("summary-strip-container");
  summaryStripContainer.append(summaryStrip.element);

  function render() {
    const raw = readUrlState();
    const kausi = resolveKausi(raw.kausi, seasons, rest);

    let sarja = "kaikki";
    let vastustaja = "kaikki";
    const pelatut = raw.pelatut;
    let sarjaOptions = computeSarjaAvailability([]);
    let opponents = [];
    let afterVastustaja = [];
    let finalEvents = [];

    if (rest.length > 0) {
      const afterKausi = filterBySeason(rest, kausi);
      sarjaOptions = computeSarjaAvailability(afterKausi);
      sarja = resolveSarja(raw.sarja, sarjaOptions);

      const afterSarja = filterBySarja(afterKausi, sarja);
      opponents = computeOpponents(afterSarja);
      vastustaja = resolveVastustaja(raw.vastustaja, opponents);

      afterVastustaja = filterByVastustaja(afterSarja, vastustaja);
      finalEvents = filterByPelatut(afterVastustaja, pelatut);
    }

    // Keep the URL consistent with what's actually shown: a raw value only
    // ever differs from its resolved value when it was invalid/unavailable
    // and got reset to the default — in that case, drop the stale param
    // rather than writing the resolved default explicitly (clean URLs).
    const corrections = {};
    if (raw.kausi !== undefined && raw.kausi !== kausi) corrections.kausi = undefined;
    if (raw.sarja !== undefined && raw.sarja !== sarja) corrections.sarja = undefined;
    if (raw.vastustaja !== undefined && raw.vastustaja !== vastustaja) corrections.vastustaja = undefined;
    if (Object.keys(corrections).length > 0) writeUrlState(corrections);

    const filterBarContainer = document.getElementById("filter-bar-container");
    const timelineContainer = document.getElementById("timeline");

    if (rest.length === 0) {
      // True empty-shop state (today's real production reality): hide the
      // filter bar and the numbers strip entirely and show the "not on sale
      // yet" placeholder.
      summaryStripContainer.hidden = true;
      filterBarContainer.hidden = true;
      filterBarContainer.replaceChildren();
      timelineContainer.replaceChildren();
      const placeholder = document.createElement("p");
      placeholder.className = "empty-state";
      placeholder.textContent = NO_GAMES_YET_TEXT;
      timelineContainer.append(placeholder);
      return;
    }

    summaryStripContainer.hidden = false;
    filterBarContainer.hidden = false;
    filterBarContainer.replaceChildren(
      buildFilterBar({
        seasons,
        hasMultipleSeasons,
        kausi,
        sarjaOptions,
        sarja,
        opponents,
        vastustaja,
        pelatut,
        onChange: render,
      })
    );

    timelineContainer.replaceChildren();

    if (finalEvents.length === 0) {
      const wouldPelatutHelp = !pelatut && filterByPelatut(afterVastustaja, true).length > 0;

      const wrapper = document.createElement("div");
      wrapper.className = "empty-state";

      const message = document.createElement("p");
      message.textContent = wouldPelatutHelp
        ? "Kaudella on vain pelattuja otteluita."
        : "Ei otteluita valituilla suodattimilla.";
      wrapper.append(message);

      if (wouldPelatutHelp) {
        wrapper.append(
          buildEmptyStateAction("Näytä pelatut", () => {
            writeUrlState({ pelatut: "1" });
            render();
          })
        );
      }

      wrapper.append(
        buildEmptyStateAction("Tyhjennä suodattimet", () => {
          writeUrlState({ kausi: undefined, sarja: undefined, vastustaja: undefined, pelatut: undefined });
          render();
        })
      );

      timelineContainer.append(wrapper);
    } else {
      for (const group of groupByMonth(buildTimeline(finalEvents))) {
        const heading = document.createElement("h3");
        heading.className = "month-separator";
        heading.textContent = group.label;
        timelineContainer.append(heading);

        for (const event of group.events) {
          timelineContainer.append(
            buildCard(event, event.latest, {
              showSeasonBadge: kausi === "kaikki",
              showGameTypeLabel: sarja === "kaikki",
              kausikorttiEvents: kausikortti,
            })
          );
        }
      }
    }

    // Last, and deliberately not awaited: the cards above are already in the
    // DOM by the time this can touch the network, so the strip's own data
    // never delays them. A closed strip fetches nothing at all.
    void summaryStrip.update({ kausi, sarja });
  }

  render();
}

main().catch((err) => {
  console.error("Failed to load lipputilanne:", err);
  const el = document.getElementById("app-error");
  if (el) {
    el.hidden = false;
    el.textContent = "Tietojen lataaminen epäonnistui. Yritä myöhemmin uudelleen.";
  }
});
