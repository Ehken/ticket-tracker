import { toDashId } from "./classify.js";

// Mock mode is opt-in via ?mock=1 and reads from an entirely separate
// directory — production behavior is untouched and mock data never mixes
// with the real data/ files.
export const IS_MOCK = new URLSearchParams(window.location.search).get("mock") === "1";
const DATA_ROOT = IS_MOCK ? "data/mock" : "data";

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
  return fetchJson(`${DATA_ROOT}/events.json`);
}

export function getOverrides() {
  // overrides.json may not exist yet in a fresh checkout; treat that as "no overrides".
  return fetchJson(`${DATA_ROOT}/overrides.json`, { fallbackOn404: {} });
}

export function getAutoclass() {
  // autoclass.json is scraper-owned and only appears once a real match happens.
  return fetchJson(`${DATA_ROOT}/autoclass.json`, { fallbackOn404: {} });
}

export function getSchedule() {
  return fetchJson(`${DATA_ROOT}/schedule.json`, { fallbackOn404: [] });
}

export function getLatest(id) {
  return fetchJson(`${DATA_ROOT}/events/${toDashId(id)}/latest.json`);
}

export function getHistory(id) {
  return fetchJson(`${DATA_ROOT}/events/${toDashId(id)}/history.json`, { fallbackOn404: [] });
}

export function getSeats(id) {
  return fetchJson(`${DATA_ROOT}/events/${toDashId(id)}/seats.json`, { fallbackOn404: null });
}

const svgCache = new Map();

export async function getCapacitiesSvg(hash) {
  if (svgCache.has(hash)) return svgCache.get(hash);
  // Content-hash-addressed and immutable — default HTTP caching is correct
  // here (unlike the JSON endpoints above, which are live/mutable and need
  // no-store) and helps across page reloads, on top of the in-memory cache.
  const res = await fetch(`${DATA_ROOT}/capacities/${hash}.svg`);
  if (!res.ok) {
    throw new Error(`Failed to fetch capacities svg ${hash}: HTTP ${res.status}`);
  }
  const text = await res.text();
  svgCache.set(hash, text);
  return text;
}
