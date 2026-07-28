import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fetchWithRetry } from "./httpClient.js";

const SEAT_CIRCLE_RE = /<circle\b[^>]*class="[^"]*\bseat\b[^"]*"[^>]*id="([^"]+)"[^>]*\/?>/g;
const SEAT_CIRCLE_RE_ID_FIRST = /<circle\b[^>]*id="([^"]+)"[^>]*class="[^"]*\bseat\b[^"]*"[^>]*\/?>/g;

// Section -> full list of that section's individual seat IDs (e.g. "A1-1-001"),
// in SVG document order. The mock generator uses this to assign realistic,
// real-arena seat IDs to synthetic events.
export function parseSeatmapSeatIds(svgText) {
  const bySection = {};

  for (const re of [SEAT_CIRCLE_RE, SEAT_CIRCLE_RE_ID_FIRST]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(svgText)) !== null) {
      const seatId = match[1];
      const section = seatId.split("-")[0];
      (bySection[section] ??= []).push(seatId);
    }
  }

  return bySection;
}

export function parseSeatmapSvg(svgText) {
  const bySection = parseSeatmapSeatIds(svgText);
  const capacities = {};
  for (const [section, seatIds] of Object.entries(bySection)) {
    capacities[section] = seatIds.length;
  }
  return capacities;
}

export function sha1Hex(content) {
  return createHash("sha1").update(content).digest("hex");
}

function resolveUrl(mapUrl, eventBaseUrl) {
  return new URL(mapUrl, eventBaseUrl).toString();
}

async function writeFileIfAbsent(filePath, content) {
  try {
    await writeFile(filePath, content, { flag: "wx" });
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }
}

// svgCache: an optional Map, scoped to a single fetch.js run (created once
// per `run()` call, never persisted across runs — a genuine map change
// must still be detected on the next run). Every SaiPa home game uses the
// same arena map, so without this, a run with ~40 events downloads the
// identical SVG 40 times before the content-addressed cache below is even
// consulted — the hash that cache is keyed by can only be computed from
// the bytes, so the network fetch always had to happen first. Keyed by
// the resolved svgUrl, not the hash (the hash isn't known until after the
// fetch this is trying to avoid).
export async function resolveCapacities({ mapUrl, eventBaseUrl, httpClient, dataDir, svgCache }) {
  const fetchFn = httpClient?.fetchWithRetry ?? fetchWithRetry;
  const svgUrl = resolveUrl(mapUrl, eventBaseUrl);

  if (svgCache?.has(svgUrl)) {
    return svgCache.get(svgUrl);
  }

  const res = await fetchFn(svgUrl, {});
  const svgText = await res.text();
  const hash = sha1Hex(svgText);

  const capacitiesDir = path.join(dataDir, "capacities");
  const cachePath = path.join(capacitiesDir, `${hash}.json`);
  const svgPath = path.join(capacitiesDir, `${hash}.svg`);

  await mkdir(capacitiesDir, { recursive: true });
  // Raw SVG, for a future seat-map feature — content-addressed like the
  // capacities cache, so re-fetching an unchanged map never rewrites it.
  await writeFileIfAbsent(svgPath, svgText);

  let result;
  try {
    const cached = await readFile(cachePath, "utf8");
    result = { hash, capacities: JSON.parse(cached) };
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    const capacities = parseSeatmapSvg(svgText);
    await writeFile(cachePath, JSON.stringify(capacities, null, 2) + "\n");
    result = { hash, capacities };
  }

  svgCache?.set(svgUrl, result);
  return result;
}
