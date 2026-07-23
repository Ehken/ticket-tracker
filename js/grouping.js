export const TAB_ORDER = ["runkosarja", "chl", "harjoitusottelu", "playoffs", "pelatut"];

const TAB_LABELS = {
  runkosarja: "Runkosarja",
  chl: "CHL",
  harjoitusottelu: "Harjoitusottelut",
  playoffs: "Playoffs",
  pelatut: "Pelatut",
};

const GAME_TYPE_LABELS = {
  runkosarja: "Runkosarja",
  chl: "CHL",
  harjoitusottelu: "Harjoitusottelut",
  playoffs: "Playoffs",
  muu: "(luokittelematon)",
};

const RUNKOSARJA_GAME_TYPES = new Set(["runkosarja", "muu"]);

export const RUNKOSARJA_PLACEHOLDER_TEXT =
  "Otteluliput eivät ole vielä myynnissä — runkosarjan ottelut ilmestyvät tähän kun myynti alkaa.";

export function gameTypeLabel(gameType) {
  return GAME_TYPE_LABELS[gameType] ?? gameType;
}

function byStartAsc(a, b) {
  return new Date(a.start) - new Date(b.start);
}

function byStartDesc(a, b) {
  return new Date(b.start) - new Date(a.start);
}

export function computeSeasons({ overrides, autoclass, schedule }) {
  const seasons = new Set();
  for (const v of Object.values(overrides)) if (v.season) seasons.add(v.season);
  for (const v of Object.values(autoclass)) if (v.season) seasons.add(v.season);
  for (const row of schedule) if (row.season) seasons.add(row.season);

  const sorted = [...seasons].sort();
  return { seasons: sorted, hasMultipleSeasons: sorted.length >= 2 };
}

export function filterBySeason(mergedEvents, kausi) {
  // No season set on an event means "always shown regardless of selection" —
  // this is what makes the kausikortti event behave as always-visible without
  // any special-casing, since it never has a `season`.
  if (!kausi || kausi === "kaikki") return mergedEvents;
  return mergedEvents.filter((e) => e.season === kausi || e.season == null);
}

export function partitionByTabs(mergedEvents) {
  const visible = mergedEvents.filter((e) => !e.hidden);
  const kausikortti = visible.filter((e) => e.gameType === "kausikortti");
  const rest = visible.filter((e) => e.gameType !== "kausikortti");

  const partitions = {
    kausikortti,
    runkosarja: [],
    chl: [],
    harjoitusottelu: [],
    playoffs: [],
    pelatut: [],
  };

  for (const event of rest) {
    if (event.status === "past") {
      partitions.pelatut.push(event);
    } else if (RUNKOSARJA_GAME_TYPES.has(event.gameType)) {
      partitions.runkosarja.push(event);
    } else if (event.gameType === "chl") {
      partitions.chl.push(event);
    } else if (event.gameType === "harjoitusottelu") {
      partitions.harjoitusottelu.push(event);
    } else if (event.gameType === "playoffs") {
      partitions.playoffs.push(event);
    } else {
      // Unknown future gameType, upcoming: fail safe into Runkosarja rather
      // than vanish (mergeClassification should never actually produce this).
      partitions.runkosarja.push(event);
    }
  }

  partitions.runkosarja.sort(byStartAsc);
  partitions.chl.sort(byStartAsc);
  partitions.harjoitusottelu.sort(byStartAsc);
  partitions.playoffs.sort(byStartAsc);
  partitions.pelatut.sort(byStartDesc);

  return partitions;
}

export function computeTabVisibility(partitions) {
  const counts = {
    runkosarja: partitions.runkosarja.length,
    chl: partitions.chl.length,
    harjoitusottelu: partitions.harjoitusottelu.length,
    playoffs: partitions.playoffs.length,
    pelatut: partitions.pelatut.length,
  };
  const allEmpty = Object.values(counts).every((n) => n === 0);

  return TAB_ORDER.map((tab) => {
    if (tab === "pelatut") {
      return {
        tab,
        label: TAB_LABELS.pelatut,
        count: counts.pelatut,
        visible: true,
        disabled: counts.pelatut === 0,
        placeholder: false,
      };
    }

    if (tab === "runkosarja") {
      return {
        tab,
        label: TAB_LABELS.runkosarja,
        count: counts.runkosarja,
        visible: counts.runkosarja > 0 || allEmpty,
        disabled: false,
        placeholder: allEmpty,
      };
    }

    // chl / harjoitusottelu / playoffs: hidden entirely when empty.
    return {
      tab,
      label: TAB_LABELS[tab],
      count: counts[tab],
      visible: counts[tab] > 0,
      disabled: false,
      placeholder: false,
    };
  });
}

export function resolveActiveTab(requestedTab, tabs) {
  const requested = tabs.find((t) => t.tab === requestedTab);
  if (requested && requested.visible && !requested.disabled) return requested.tab;

  const firstWithContent = tabs.find((t) => t.visible && !t.disabled && t.count > 0);
  if (firstWithContent) return firstWithContent.tab;

  // Nothing anywhere has content: Runkosarja is always the fallback home
  // (rendered as the "ei vielä myynnissä" placeholder in that state).
  return "runkosarja";
}
