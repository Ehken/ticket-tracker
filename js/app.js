import { getEventsIndex, getOverrides, getAutoclass, getSchedule, getLatest } from "./fetchData.js";
import { mergeClassification } from "./classify.js";
import {
  computeSeasons,
  filterBySeason,
  partitionByTabs,
  computeTabVisibility,
  resolveActiveTab,
  RUNKOSARJA_PLACEHOLDER_TEXT,
} from "./grouping.js";
import { buildCard } from "./card.js";
import { buildSeasonSelector } from "./seasonSelector.js";
import { buildTabBar } from "./tabs.js";
import { readUrlState } from "./urlState.js";
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

async function main() {
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

  function resolveKausi(requested) {
    if (requested === "kaikki") return "kaikki";
    if (requested && seasons.includes(requested)) return requested;
    return seasons[seasons.length - 1] ?? "kaikki"; // newest season with data
  }

  function render() {
    const { kausi: requestedKausi, tab: requestedTab } = readUrlState();
    const kausi = resolveKausi(requestedKausi);
    const showSeasonBadge = kausi === "kaikki";

    const filtered = filterBySeason(withLatest, kausi);
    const partitions = partitionByTabs(filtered);
    const tabsInfo = computeTabVisibility(partitions);
    const activeTab = resolveActiveTab(requestedTab, tabsInfo);

    const kausikorttiContainer = document.getElementById("kausikortit-cards");
    kausikorttiContainer.replaceChildren();
    for (const event of partitions.kausikortti) {
      kausikorttiContainer.append(
        buildCard(event, event.latest, { preExpanded: true, compactSummary: true, showSeasonBadge })
      );
    }

    const selectorContainer = document.getElementById("season-selector-container");
    selectorContainer.replaceChildren(
      buildSeasonSelector({ seasons, hasMultipleSeasons, currentKausi: kausi, onChange: render })
    );

    const tabBarContainer = document.getElementById("tab-bar-container");
    tabBarContainer.replaceChildren(buildTabBar({ tabs: tabsInfo, activeTab, onSelect: render }));

    const eventsListContainer = document.getElementById("events-list");
    eventsListContainer.replaceChildren();

    const activeTabInfo = tabsInfo.find((t) => t.tab === activeTab);
    if (activeTabInfo?.placeholder) {
      const placeholder = document.createElement("p");
      placeholder.className = "empty-state";
      placeholder.textContent = RUNKOSARJA_PLACEHOLDER_TEXT;
      eventsListContainer.append(placeholder);
    } else {
      for (const event of partitions[activeTab] ?? []) {
        eventsListContainer.append(
          buildCard(event, event.latest, {
            showSeasonBadge,
            showGameTypeLabel: activeTab === "pelatut",
          })
        );
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
