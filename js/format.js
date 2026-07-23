export function formatThousands(n) {
  return n.toLocaleString("fi-FI");
}

export function formatPercent(sold, total) {
  if (!total) return "0 %";
  return `${Math.round((sold / total) * 100)} %`;
}

const dateFormatter = new Intl.DateTimeFormat("fi-FI", {
  timeZone: "Europe/Helsinki",
  day: "numeric",
  month: "numeric",
  year: "numeric",
});

// fi-FI's Intl output uses a period as the time separator (e.g. "14.25"),
// but the spec's own "Päivitetty HH:MM" wording is explicit about the colon,
// so time formatting uses en-GB (24h, colon-separated) instead.
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Helsinki",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const dateTimeFormatter = new Intl.DateTimeFormat("fi-FI", {
  timeZone: "Europe/Helsinki",
  day: "numeric",
  month: "numeric",
});

export function formatHelsinkiDate(iso) {
  return dateFormatter.format(new Date(iso));
}

export function formatHelsinkiTime(iso) {
  return timeFormatter.format(new Date(iso));
}

export function formatHelsinkiDateTime(iso) {
  const date = new Date(iso);
  return `${dateTimeFormatter.format(date)} klo ${timeFormatter.format(date)}`;
}
