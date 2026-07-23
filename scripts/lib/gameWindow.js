import { toHelsinkiDateString } from "./schedule.js";

const helsinkiHourFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Helsinki",
  hour: "2-digit",
  hourCycle: "h23",
});

export function getHelsinkiHour(date) {
  return Number(helsinkiHourFormatter.format(date));
}

export function isGameDayWindowNow(eventsIndex, now = new Date()) {
  const hour = getHelsinkiHour(now);
  if (hour < 15 || hour >= 21) return false;

  const today = toHelsinkiDateString(now);
  return eventsIndex.some(
    (event) => event.status === "upcoming" && toHelsinkiDateString(event.start) === today
  );
}
