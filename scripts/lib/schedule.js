const SAIPA_OPPONENT_RE = /^saipa\s*-\s*(.+)$/;

// Unicode combining marks (U+0300-U+036F), built from numeric char codes
// rather than literal escapes to avoid any source-encoding ambiguity.
const COMBINING_MARKS_RE = new RegExp(
  `[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`,
  "g"
);

export function normalizeName(str) {
  return str
    .normalize("NFD")
    .replace(COMBINING_MARKS_RE, "") // strip diacritics (e.g. n-with-caron -> n)
    .toLowerCase()
    .replace(/[-–—]/g, "-") // -, en dash, em dash -> "-"
    .replace(/\s+/g, " ")
    .trim();
}

export function extractOpponent(eventName) {
  const match = normalizeName(eventName).match(SAIPA_OPPONENT_RE);
  return match ? match[1] : null;
}

const helsinkiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Helsinki",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function toHelsinkiDateString(isoString) {
  return helsinkiDateFormatter.format(new Date(isoString));
}

export function findScheduleMatch(schedule, { name, startIso }) {
  const opponent = extractOpponent(name);
  if (opponent === null) return null;

  const dateStr = toHelsinkiDateString(startIso);
  const fixture = schedule.find(
    (row) => row.date === dateStr && normalizeName(row.opponent) === opponent
  );

  return fixture ? { gameType: fixture.gameType, season: fixture.season } : null;
}
