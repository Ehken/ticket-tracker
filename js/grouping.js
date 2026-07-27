export const SARJA_OPTIONS = ["kaikki", "runkosarja", "chl", "harjoitusottelu", "playoffs"];

const SARJA_LABELS = {
  kaikki: "Kaikki",
  runkosarja: "Runkosarja",
  chl: "CHL",
  harjoitusottelu: "Harjoitusottelut",
  playoffs: "Playoffs",
};

const GAME_TYPE_LABELS = {
  runkosarja: "Runkosarja",
  chl: "CHL",
  harjoitusottelu: "Harjoitusottelut",
  playoffs: "Playoffs",
  muu: "(luokittelematon)",
};

export const NO_GAMES_YET_TEXT =
  "Otteluliput eivät ole vielä myynnissä — runkosarjan ottelut ilmestyvät tähän kun myynti alkaa.";

export function gameTypeLabel(gameType) {
  return GAME_TYPE_LABELS[gameType] ?? gameType;
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
  // No season set on an event means "always shown regardless of selection".
  if (!kausi || kausi === "kaikki") return mergedEvents;
  return mergedEvents.filter((e) => e.season === kausi || e.season == null);
}

export function splitKausikortti(mergedEvents) {
  const kausikortti = mergedEvents.filter((e) => e.gameType === "kausikortti");
  const rest = mergedEvents.filter((e) => e.gameType !== "kausikortti");
  return { kausikortti, rest };
}

export function filterBySarja(events, sarja) {
  // "kaikki" (or unset) passes everything through, including "muu" — muu is
  // only ever visible under "kaikki", never absorbed into a specific sarja.
  if (!sarja || sarja === "kaikki") return events;
  return events.filter((e) => e.gameType === sarja);
}

export function computeSarjaAvailability(eventsAfterKausi) {
  return SARJA_OPTIONS.map((value) => {
    if (value === "kaikki") return { value, label: SARJA_LABELS[value], hasEvents: true };
    return {
      value,
      label: SARJA_LABELS[value],
      hasEvents: eventsAfterKausi.some((e) => e.gameType === value),
    };
  });
}

export function resolveSarja(requested, availability) {
  if (!requested || requested === "kaikki") return "kaikki";
  const option = availability.find((o) => o.value === requested);
  return option && option.hasEvents ? requested : "kaikki";
}

// The season "currently being played or sold": the nearest upcoming
// event's season, or (if nothing is upcoming) the most recent past
// event's season. `events` must be match events only (not kausikortti
// strips) — a kausikortti event stays status "upcoming" for its entire
// sale window regardless of the season's own start date, so including it
// would pick a season by kausikortti sale-open date rather than by actual
// game availability. Returns null when there's nothing to go on (no
// events at all, or none carrying a season), leaving the caller to fall
// back to its own default.
export function resolveDefaultSeason(events) {
  const upcoming = events.filter((e) => e.status === "upcoming" && e.season);
  if (upcoming.length > 0) {
    return [...upcoming].sort((a, b) => a.start.localeCompare(b.start))[0].season;
  }
  const past = events.filter((e) => e.status === "past" && e.season);
  if (past.length > 0) {
    return [...past].sort((a, b) => b.start.localeCompare(a.start))[0].season;
  }
  return null;
}

// requested === "kaikki" and an explicit, still-valid requested season are
// both kept as-is; only the no-selection fallback changes: previously
// "newest season with data" (lexically last), which picks a future season
// with nothing on sale yet as soon as one exists. Now: the season actually
// being played/sold (see resolveDefaultSeason), falling back to the old
// lexically-last behavior only when that can't be determined.
export function resolveKausi(requested, seasons, events) {
  if (requested === "kaikki") return "kaikki";
  if (requested && seasons.includes(requested)) return requested;
  const defaultSeason = resolveDefaultSeason(events);
  if (defaultSeason && seasons.includes(defaultSeason)) return defaultSeason;
  return seasons[seasons.length - 1] ?? "kaikki";
}

const OPPONENT_PREFIX_RE = /^saipa\s*[-–—]\s*/i;

export function extractOpponentDisplay(name) {
  if (!OPPONENT_PREFIX_RE.test(name)) return null;
  return name.replace(OPPONENT_PREFIX_RE, "").trim();
}

export function computeOpponents(events) {
  const opponents = new Set();
  for (const event of events) {
    const opponent = extractOpponentDisplay(event.name);
    if (opponent) opponents.add(opponent);
  }
  return [...opponents].sort((a, b) => a.localeCompare(b, "fi"));
}

export function resolveVastustaja(requested, opponents) {
  if (!requested || requested === "kaikki") return "kaikki";
  return opponents.includes(requested) ? requested : "kaikki";
}

export function filterByVastustaja(events, vastustaja) {
  if (!vastustaja || vastustaja === "kaikki") return events;
  return events.filter((e) => extractOpponentDisplay(e.name) === vastustaja);
}

export function filterByPelatut(events, pelatutOn) {
  if (pelatutOn) return events;
  return events.filter((e) => e.status !== "past");
}

export function buildTimeline(events) {
  return [...events].sort((a, b) => new Date(a.start) - new Date(b.start));
}

const FI_MONTHS = [
  "Tammikuu",
  "Helmikuu",
  "Maaliskuu",
  "Huhtikuu",
  "Toukokuu",
  "Kesäkuu",
  "Heinäkuu",
  "Elokuu",
  "Syyskuu",
  "Lokakuu",
  "Marraskuu",
  "Joulukuu",
];

const helsinkiPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Helsinki",
  year: "numeric",
  month: "2-digit",
});

function helsinkiYearMonth(iso) {
  const parts = helsinkiPartsFormatter.formatToParts(new Date(iso));
  const year = Number(parts.find((p) => p.type === "year").value);
  const month = Number(parts.find((p) => p.type === "month").value); // 1-12
  return { year, month };
}

export function groupByMonth(sortedEvents) {
  const groups = [];
  let currentKey = null;

  for (const event of sortedEvents) {
    const { year, month } = helsinkiYearMonth(event.start);
    const key = `${year}-${month}`;
    if (key !== currentKey) {
      groups.push({ key, label: `${FI_MONTHS[month - 1]} ${year}`, events: [] });
      currentKey = key;
    }
    groups[groups.length - 1].events.push(event);
  }

  return groups;
}

export function shouldAutoExpandKausikortti(stripCount, finalEventsCount) {
  return stripCount === 1 && finalEventsCount === 0;
}
