import { toDashId } from "./classify.js";

async function fetchJson(url, { fallbackOn404 } = {}) {
  const res = await fetch(url, { cache: "no-store" });

  if (res.status === 404 && fallbackOn404 !== undefined) {
    return fallbackOn404;
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }

  return res.json();
}

export function getEventsIndex() {
  return fetchJson("data/events.json");
}

export function getOverrides() {
  // overrides.json may not exist yet in a fresh checkout; treat that as "no overrides".
  return fetchJson("data/overrides.json", { fallbackOn404: {} });
}

export function getAutoclass() {
  // autoclass.json is scraper-owned and only appears once a real match happens.
  return fetchJson("data/autoclass.json", { fallbackOn404: {} });
}

export function getSchedule() {
  return fetchJson("data/schedule.json", { fallbackOn404: [] });
}

export function getLatest(id) {
  return fetchJson(`data/events/${toDashId(id)}/latest.json`);
}

export function getHistory(id) {
  return fetchJson(`data/events/${toDashId(id)}/history.json`, { fallbackOn404: [] });
}
