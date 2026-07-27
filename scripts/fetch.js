import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWithRetry, delay } from "./lib/httpClient.js";
import { fetchListing } from "./lib/listing.js";
import { parseEventPage } from "./lib/eventParser.js";
import { resolveCapacities } from "./lib/seatmap.js";
import {
  countSoldPerSection,
  extractAggregateSold,
  extractAitioSold,
  buildSectionTable,
  computeTotals,
  warnOnOrphanRowLevelDisabled,
  warnOnUnmatchedDisabledSection,
  extractSoldSeatIds,
  warnOnSeatCountMismatch,
} from "./lib/sections.js";
import { findScheduleMatch } from "./lib/schedule.js";
import {
  eventDirId,
  eventsIndexPath,
  latestPath,
  historyPath,
  seatsPath,
  sectionHistoryPath,
  schedulePath,
  autoclassPath,
  readJson,
  writeJsonIfChanged,
  writeSectionHistoryIfChanged,
  upsertEventIndexEntry,
  archiveMissingEvents,
  assertListingNotSuspiciouslyEmpty,
  appendHistoryPointIfChanged,
  appendSectionHistoryPointIfChanged,
  setAutoclassIfAbsent,
} from "./lib/dataStore.js";

const SHOP_BASE_URL = "https://elippu.net/saipa";
const EVENT_DELAY_MS = 1500;

export async function run({
  dataDir,
  baseUrl = SHOP_BASE_URL,
  httpClient = { fetchWithRetry },
  now = () => new Date(),
  log = console,
  sleep = delay,
} = {}) {
  const nowISO = now().toISOString();

  const presentEvents = await fetchListing(baseUrl, httpClient);
  const presentIds = presentEvents.map((e) => e.id);

  let index = await readJson(eventsIndexPath(dataDir), []);
  const schedule = await readJson(schedulePath(dataDir), []);
  let autoclass = await readJson(autoclassPath(dataDir), {});

  // Must run before any writes: a suspiciously empty listing must never look
  // like "every event disappeared" and mass-archive the whole index.
  assertListingNotSuspiciouslyEmpty(index, presentIds);

  // Ids known before this run's upserts — the "first seen ever" signal for
  // auto-classification. Must be captured before the loop mutates `index`.
  const existingIds = new Set(index.map((e) => e.id));

  let hadFailure = false;

  for (let i = 0; i < presentEvents.length; i++) {
    const { id, url } = presentEvents[i];
    try {
      const res = await httpClient.fetchWithRetry(url, {});
      const html = await res.text();
      const { event, map } = parseEventPage(html);

      warnOnOrphanRowLevelDisabled(map.disabled, log);

      if (!existingIds.has(event.id)) {
        const match = findScheduleMatch(schedule, {
          name: event.name,
          startIso: event.start.toISOString(),
        });
        if (match) {
          autoclass = setAutoclassIfAbsent(autoclass, eventDirId(event.id), match);
        }
      }

      const { hash, capacities } = await resolveCapacities({
        mapUrl: map.url,
        eventBaseUrl: url,
        httpClient,
        dataDir,
      });

      const mergedCapacities = { ...capacities, ...map.status.capacities };
      warnOnUnmatchedDisabledSection(map.disabled, mergedCapacities, log);
      const soldCounts = countSoldPerSection(map.status.usages);
      const { standing, wheelchair } = extractAggregateSold(map.status.usages);
      const { sold: aitioSold, soldAitioIds } = extractAitioSold(map.status.usages);

      const rows = buildSectionTable({
        soldCounts,
        capacities: mergedCapacities,
        disabled: map.disabled,
        standingSold: standing,
        wheelchairSold: wheelchair,
        aitioSold,
      });
      const totals = computeTotals(rows);

      const soldSeatIds = extractSoldSeatIds(map.status.usages);
      warnOnSeatCountMismatch(soldSeatIds, rows, log);
      await writeJsonIfChanged(seatsPath(dataDir, id), {
        fetchedAt: nowISO,
        svgHash: hash,
        soldSeatIds,
        soldAitiot: soldAitioIds,
      });

      const latest = {
        eventId: event.id,
        name: event.name,
        start: event.start.toISOString(),
        stop: event.stop.toISOString(),
        fetchedAt: nowISO,
        capacitiesHash: hash,
        sections: rows,
        totals,
        prices: map.prices, // persisted as-is; no calculations done on it yet
      };

      await writeJsonIfChanged(latestPath(dataDir, id), latest);

      const history = await readJson(historyPath(dataDir, id), []);
      const updatedHistory = appendHistoryPointIfChanged(history, {
        tISO: nowISO,
        sold: totals.sold,
        soldSeated: totals.sold - standing - wheelchair,
        soldStanding: standing,
        available: totals.available,
        hold: totals.hold,
        // Deterministic order matters both for the content comparison above
        // and for clean git diffs. seisomakatsomo/invalid participate here
        // too now (buildSectionTable sets disabled: true/false on them the
        // same as seated sections) — a closed standing/wheelchair area
        // correctly shows up in this list. press/aitiot are the only rows
        // with no `disabled` flag at all, so they're the only ones excluded.
        closed: rows.filter((r) => r.disabled).map((r) => r.section).sort(),
      });
      await writeJsonIfChanged(historyPath(dataDir, id), updatedHistory);

      // Per-section sold history — a separate file from history.json (which
      // stays a light, chart-hot-path totals series) so it can grow without a
      // ceiling. See appendSectionHistoryPointIfChanged for the generations
      // format. closed is duplicated here from history.json on purpose: the
      // two files have different change gates and their timestamps won't line
      // up, so joining them by timestamp would be fragile — this file must be
      // self-contained and authoritative for per-section analysis on its own.
      const sectionHistoryGenerations = await readJson(sectionHistoryPath(dataDir, id), []);
      const updatedSectionHistory = appendSectionHistoryPointIfChanged(
        sectionHistoryGenerations,
        {
          capacitiesHash: hash,
          sections: rows.map((r) => r.section),
          tISO: nowISO,
          sold: rows.map((r) => r.sold),
          closed: rows.filter((r) => r.disabled).map((r) => r.section).sort(),
        },
        log
      );
      await writeSectionHistoryIfChanged(sectionHistoryPath(dataDir, id), updatedSectionHistory);

      index = upsertEventIndexEntry(index, {
        id: event.id,
        name: event.name,
        start: event.start.toISOString(),
        lastSeenISO: nowISO,
      });

      log.log(`[fetch] ${id}: ok (sold=${totals.sold}/${totals.total})`);
    } catch (err) {
      // Per-event isolation: log and skip this event only. Its existing
      // events.json entry / latest.json / history.json are left untouched,
      // and archiving below never triggers for it since it's still present
      // in `presentIds`.
      hadFailure = true;
      log.error(`[fetch] ${id}: FAILED — ${err.message}`);
    }

    if (i < presentEvents.length - 1) {
      await sleep(EVENT_DELAY_MS);
    }
  }

  index = archiveMissingEvents(index, presentIds);
  await writeJsonIfChanged(eventsIndexPath(dataDir), index);
  await writeJsonIfChanged(autoclassPath(dataDir), autoclass);

  return { hadFailure };
}

async function main() {
  const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
  try {
    const { hadFailure } = await run({ dataDir });
    process.exit(hadFailure ? 1 : 0);
  } catch (err) {
    // Doesn't promise "nothing was written" — an error thrown after the
    // per-event loop (e.g. while writing events.json/autoclass.json) can
    // land after some other write has already succeeded.
    console.error(`[fetch] Aborting run: ${err.message}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
