import { fetchWithRetry } from "./httpClient.js";

const EVENT_LINK_RE = /href="(\/saipa\/(\d+:\d+))"/g;

export function discoverEvents(html, baseUrl) {
  const seen = new Map();

  EVENT_LINK_RE.lastIndex = 0;
  let match;
  while ((match = EVENT_LINK_RE.exec(html)) !== null) {
    const [, relativePath, id] = match;
    if (seen.has(id)) continue;
    seen.set(id, { id, url: new URL(relativePath, baseUrl).toString() });
  }

  return [...seen.values()];
}

export async function fetchListing(baseUrl, httpClient = { fetchWithRetry }) {
  const res = await httpClient.fetchWithRetry(baseUrl, {});
  const html = await res.text();
  return discoverEvents(html, baseUrl);
}
