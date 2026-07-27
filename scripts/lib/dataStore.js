import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const EVENT_ID_RE = /^\d+:\d+$/;

// Real ids come from listing.js's own /\d+:\d+/ regex, so this is
// defence-in-depth (a malformed id must never reach path.join), not a live
// exploit — but every path-building helper below funnels through here.
export function eventDirId(id) {
  if (typeof id !== "string" || !EVENT_ID_RE.test(id)) {
    throw new Error(`Refusing to build a data path from a malformed event id: ${JSON.stringify(id)}`);
  }
  return id.replace(/:/g, "-");
}

export function eventsIndexPath(dataDir) {
  return path.join(dataDir, "events.json");
}

export function eventDir(dataDir, id) {
  return path.join(dataDir, "events", eventDirId(id));
}

export function latestPath(dataDir, id) {
  return path.join(eventDir(dataDir, id), "latest.json");
}

export function historyPath(dataDir, id) {
  return path.join(eventDir(dataDir, id), "history.json");
}

export function seatsPath(dataDir, id) {
  return path.join(eventDir(dataDir, id), "seats.json");
}

export function capacitiesPath(dataDir, hash) {
  return path.join(dataDir, "capacities", `${hash}.json`);
}

export function schedulePath(dataDir) {
  return path.join(dataDir, "schedule.json");
}

export function autoclassPath(dataDir) {
  return path.join(dataDir, "autoclass.json");
}

export async function readJson(filePath, fallback) {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

export async function writeJsonIfChanged(filePath, obj) {
  const serialized = JSON.stringify(obj, null, 2) + "\n";

  let existing;
  try {
    existing = await readFile(filePath, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  if (existing === serialized) return false;

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, serialized);
  return true;
}

export function upsertEventIndexEntry(index, { id, name, start, lastSeenISO }) {
  const existingIndex = index.findIndex((entry) => entry.id === id);

  if (existingIndex === -1) {
    return [
      ...index,
      { id, name, start, status: "upcoming", firstSeen: lastSeenISO, lastSeen: lastSeenISO },
    ];
  }

  const existing = index[existingIndex];
  const updated = {
    ...existing,
    name,
    start,
    // A previously-archived event reappearing in the listing means it's active
    // again; firstSeen (and its history.json) must NOT be reset.
    status: "upcoming",
    lastSeen: lastSeenISO,
  };

  return [...index.slice(0, existingIndex), updated, ...index.slice(existingIndex + 1)];
}

export function archiveMissingEvents(index, presentIds) {
  const present = new Set(presentIds);
  return index.map((entry) =>
    present.has(entry.id) || entry.status === "past" ? entry : { ...entry, status: "past" }
  );
}

export function assertListingNotSuspiciouslyEmpty(index, presentIds) {
  const hasUpcoming = index.some((entry) => entry.status === "upcoming");
  if (presentIds.length === 0 && hasUpcoming) {
    throw new Error(
      "Shop listing page returned zero events while events.json has upcoming events on record. " +
        "Refusing to archive everything — this looks like a broken/empty fetch, not a real shop state."
    );
  }
}

// For an open section, available = total - sold, so available/hold move in
// lockstep with sold and add no new signal on their own. When sold is
// unchanged, available/hold can only move on a release, a closure, or a
// capacity change — exactly the events worth a data point, which is why the
// gate widens to all four fields instead of just sold. A legacy point with
// no available/hold recorded yet (undefined) naturally compares unequal to
// a real number, so the first run after this field lands appends once
// without needing a special case.
export function appendHistoryPointIfChanged(
  history,
  { tISO, sold, soldSeated, soldStanding, available, hold, closed = [] }
) {
  const point = { t: tISO, sold, soldSeated, soldStanding, available, hold, closed };

  if (history.length === 0) return [point];

  const prev = history[history.length - 1];
  const changed =
    prev.sold !== sold || prev.available !== available || prev.hold !== hold || !sameClosedList(prev.closed, closed);

  return changed ? [...history, point] : history;
}

function sameClosedList(a, b) {
  const arrA = a ?? [];
  const arrB = b ?? [];
  return arrA.length === arrB.length && arrA.every((v, i) => v === arrB[i]);
}

export function setAutoclassIfAbsent(autoclassMap, dashId, entry) {
  // Write-once: an existing entry is never touched, even by a different candidate.
  if (dashId in autoclassMap) return autoclassMap;
  return { ...autoclassMap, [dashId]: entry };
}
