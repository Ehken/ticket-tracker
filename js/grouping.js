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
