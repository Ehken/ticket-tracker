import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWithRetry, delay } from "./lib/httpClient.js";
import { fetchListing } from "./lib/listing.js";
import { parseEventPage } from "./lib/eventParser.js";
import { resolveCapacities } from "./lib/seatmap.js";
import {
  countSoldPerSection,
  extractAggregateSold,
  buildSectionTable,
  computeTotals,
  warnOnOrphanRowLevelDisabled,
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
  schedulePath,
  autoclassPath,
  readJson,
  writeJsonIfChanged,
  upsertEventIndexEntry,
  archiveMissingEvents,
  assertListingNotSuspiciouslyEmpty,
  appendHistoryPointIfChanged,
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
      const soldCounts = countSoldPerSection(map.status.usages);
      const { standing, wheelchair } = extractAggregateSold(map.status.usages);

      const rows = buildSectionTable({
        soldCounts,
        capacities: mergedCapacities,
        disabled: map.disabled,
        standingSold: standing,
        wheelchairSold: wheelchair,
      });
      const totals = computeTotals(rows);

      const soldSeatIds = extractSoldSeatIds(map.status.usages);
      warnOnSeatCountMismatch(soldSeatIds, rows, log);
      await writeJsonIfChanged(seatsPath(dataDir, id), {
        fetchedAt: nowISO,
        svgHash: hash,
        soldSeatIds,
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
      });
      await writeJsonIfChanged(historyPath(dataDir, id), updatedHistory);

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
    console.error(`[fetch] Aborting run without writing any changes: ${err.message}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
