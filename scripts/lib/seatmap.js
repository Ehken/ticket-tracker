import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fetchWithRetry } from "./httpClient.js";

const SEAT_CIRCLE_RE = /<circle\b[^>]*class="[^"]*\bseat\b[^"]*"[^>]*id="([^"]+)"[^>]*\/?>/g;
const SEAT_CIRCLE_RE_ID_FIRST = /<circle\b[^>]*id="([^"]+)"[^>]*class="[^"]*\bseat\b[^"]*"[^>]*\/?>/g;

export function parseSeatmapSvg(svgText) {
  const capacities = {};

  for (const re of [SEAT_CIRCLE_RE, SEAT_CIRCLE_RE_ID_FIRST]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(svgText)) !== null) {
      const seatId = match[1];
      const section = seatId.split("-")[0];
      capacities[section] = (capacities[section] ?? 0) + 1;
    }
  }

  return capacities;
}

export function sha1Hex(content) {
  return createHash("sha1").update(content).digest("hex");
}

function resolveUrl(mapUrl, eventBaseUrl) {
  return new URL(mapUrl, eventBaseUrl).toString();
}

export async function resolveCapacities({ mapUrl, eventBaseUrl, httpClient, dataDir }) {
  const fetchFn = httpClient?.fetchWithRetry ?? fetchWithRetry;
  const svgUrl = resolveUrl(mapUrl, eventBaseUrl);

  const res = await fetchFn(svgUrl, {});
  const svgText = await res.text();
  const hash = sha1Hex(svgText);

  const capacitiesDir = path.join(dataDir, "capacities");
  const cachePath = path.join(capacitiesDir, `${hash}.json`);

  try {
    const cached = await readFile(cachePath, "utf8");
    return { hash, capacities: JSON.parse(cached) };
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  const capacities = parseSeatmapSvg(svgText);
  await mkdir(capacitiesDir, { recursive: true });
  await writeFile(cachePath, JSON.stringify(capacities, null, 2) + "\n");

  return { hash, capacities };
}
