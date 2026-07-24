import { getEventsIndex, getOverrides, getAutoclass, getSchedule, getLatest, IS_MOCK } from "./fetchData.js";
import { mergeClassification } from "./classify.js";
import {
  computeSeasons,
  filterBySeason,
  splitKausikortti,
  filterBySarja,
  computeSarjaAvailability,
  resolveSarja,
  computeOpponents,
  resolveVastustaja,
  filterByVastustaja,
  filterByPelatut,
  buildTimeline,
  groupByMonth,
  NO_GAMES_YET_TEXT,
  shouldAutoExpandKausikortti,
} from "./grouping.js";
import { buildCard } from "./card.js";
import { buildFilterBar } from "./filterBar.js";
import { readUrlState, writeUrlState, IS_DASHBOARD } from "./urlState.js";
import { renderDashboard } from "./dashboard.js";
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
  const { kausikortti, rest } = splitKausikortti(withLatest);

  function resolveKausi(requested) {
    if (requested === "kaikki") return "kaikki";
    if (requested && seasons.includes(requested)) return requested;
    return seasons[seasons.length - 1] ?? "kaikki"; // newest season with data
  }

  if (IS_DASHBOARD) {
    // Unreleased private preview — same data-source resolution as the
    // normal view (incl. ?mock=1), but renders a completely separate page
    // instead. No visible link to it from the normal UI.
    const kausi = resolveKausi(readUrlState().kausi);
    await renderDashboard({ kausikortti, matchEvents: rest, kausi });
    return;
  }

  function render() {
    const raw = readUrlState();
    const kausi = resolveKausi(raw.kausi);

    const kausikorttiForSeason = filterBySeason(kausikortti, kausi).sort((a, b) =>
      (b.season ?? "").localeCompare(a.season ?? "")
    );

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

    // Kausikortti strip(s) — expanded by default only when it's the sole
    // visible content on the page (required fix: no longer always-expanded).
    const kausikorttiContainer = document.getElementById("kausikortit-cards");
    kausikorttiContainer.replaceChildren();
    const autoExpand = shouldAutoExpandKausikortti(kausikorttiForSeason.length, finalEvents.length);
    for (const event of kausikorttiForSeason) {
      kausikorttiContainer.append(
        buildCard(event, event.latest, {
          preExpanded: autoExpand,
          compactSummary: true,
          showSeasonBadge: kausi === "kaikki",
          kausikorttiEvents: kausikortti,
        })
      );
    }

    const filterBarContainer = document.getElementById("filter-bar-container");
    const timelineContainer = document.getElementById("timeline");

    if (rest.length === 0) {
      // True empty-shop state (today's real production reality): hide the
      // filter bar entirely and show the "not on sale yet" placeholder.
      filterBarContainer.hidden = true;
      filterBarContainer.replaceChildren();
      timelineContainer.replaceChildren();
      const placeholder = document.createElement("p");
      placeholder.className = "empty-state";
      placeholder.textContent = NO_GAMES_YET_TEXT;
      timelineContainer.append(placeholder);
      return;
    }

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
