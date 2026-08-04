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

export function sectionHistoryPath(dataDir, id) {
  return path.join(eventDir(dataDir, id), "sectionHistory.json");
}

// Deliberately separate from seats.json (see scripts/lib/seatRecency.js) —
// its own change-cadence includes pure 24h-decay pruning, which isn't a
// real change to seats.json's own soldSeatIds/soldAitiot. Carries its own
// svgHash (the hash the diff was computed against), making it
// self-contained for the cross-run hash-invalidation check.
export function recentSeatActivityPath(dataDir, id) {
  return path.join(eventDir(dataDir, id), "recentSeatActivity.json");
}

// Derived season-ticket baseline (see scripts/lib/seasonBaseline.js) — the
// true season set cross-derived from per-game seat data, because the
// kausikortti listing's own sold count inflates with single-game purchases.
export function seasonBaselinePath(dataDir, id) {
  return path.join(eventDir(dataDir, id), "seasonBaseline.json");
}

export function seasonBaselineHistoryPath(dataDir, id) {
  return path.join(eventDir(dataDir, id), "seasonBaselineHistory.json");
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

export function overridesPath(dataDir) {
  return path.join(dataDir, "overrides.json");
}

export function watchDatesPath(dataDir) {
  return path.join(dataDir, "watchDates.json");
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

// sectionHistory.json's own serializer, not writeJsonIfChanged's generic
// JSON.stringify(obj, null, 2) — that pretty-printer puts every element of a
// 20-number `sold` array on its own line, throwing away most of the
// compactness the column-oriented format exists for (~320 bytes/point vs
// ~150 with one point per line). Structure (generations, their
// capacitiesHash/sections fields) stays indented/readable; each point is one
// compact JSON line, so diffs stay strictly line-additive as the file grows
// across a season — the whole point of storing it this way.
export function serializeSectionHistory(generations) {
  if (generations.length === 0) return "[]\n";

  const genBlocks = generations.map((gen) => {
    const pointsBlock =
      gen.points.length === 0
        ? "[]"
        : "[\n" + gen.points.map((p) => "      " + JSON.stringify(p)).join(",\n") + "\n    ]";

    return (
      "  {\n" +
      `    "capacitiesHash": ${JSON.stringify(gen.capacitiesHash)},\n` +
      `    "sections": ${JSON.stringify(gen.sections)},\n` +
      `    "points": ${pointsBlock}\n` +
      "  }"
    );
  });

  return "[\n" + genBlocks.join(",\n") + "\n]\n";
}

export async function writeSectionHistoryIfChanged(filePath, generations) {
  const serialized = serializeSectionHistory(generations);

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

function sameArray(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// sectionHistory.json is a top-level array of generations, each keyed by the
// capacitiesHash it's relative to (see scripts/generateMockData.js's/
// scripts/fetch.js's callers for the file's full shape/rationale). A new
// generation starts whenever capacitiesHash or the section list itself
// (order-sensitive — sold[i] is only meaningful relative to sections[i])
// differs from the last one, instead of throwing: continuing to collect data
// matters more than refusing to append over a rare, unscheduled capacities
// change, and old generations are never touched, so nothing is lost. Within
// one generation, the same reasoning as appendHistoryPointIfChanged applies,
// adapted for the array shape: append only when something actually changed
// (any section's sold, or the closed list).
export function appendSectionHistoryPointIfChanged(
  generations,
  { capacitiesHash, sections, tISO, sold, closed = [] },
  logger = console
) {
  const point = { t: tISO, sold, closed };
  const last = generations[generations.length - 1];

  if (!last || last.capacitiesHash !== capacitiesHash || !sameArray(last.sections, sections)) {
    if (last) {
      const added = sections.filter((s) => !last.sections.includes(s));
      const removed = last.sections.filter((s) => !sections.includes(s));
      logger.warn(
        `[sectionHistory] capacities changed (hash ${last.capacitiesHash} -> ${capacitiesHash}, ` +
          `+[${added.join(", ")}] -[${removed.join(", ")}]) — starting a new generation, ` +
          "previous generation's data preserved"
      );
    }
    return [...generations, { capacitiesHash, sections, points: [point] }];
  }

  const prevPoint = last.points[last.points.length - 1];
  const changed = !prevPoint || !sameArray(prevPoint.sold, sold) || !sameClosedList(prevPoint.closed, closed);
  if (!changed) return generations;

  const updatedLast = { ...last, points: [...last.points, point] };
  return [...generations.slice(0, -1), updatedLast];
}

export function setAutoclassIfAbsent(autoclassMap, dashId, entry) {
  // Write-once: an existing entry is never touched, even by a different candidate.
  if (dashId in autoclassMap) return autoclassMap;
  return { ...autoclassMap, [dashId]: entry };
}
