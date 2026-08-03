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
import { findScheduleMatch, findNearMissCandidates, toHelsinkiDateString } from "./lib/schedule.js";
import {
  eventDirId,
  eventsIndexPath,
  latestPath,
  historyPath,
  seatsPath,
  sectionHistoryPath,
  recentSeatActivityPath,
  schedulePath,
  autoclassPath,
  overridesPath,
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
import { computeSeatRecency } from "./lib/seatRecency.js";

const SHOP_BASE_URL = "https://elippu.net/saipa";
const EVENT_DELAY_MS = 1500;

// One line per unmatched event per run — this IS the whole diagnosis: the
// two candidate lists tell you immediately whether it's a naming problem
// (schedule.json has the right date, wrong opponent) or a date problem
// (right opponent, wrong date), without needing to open schedule.json
// yourself to check.
function logUnclassifiedWarning(event, schedule, logger) {
  const dateStr = toHelsinkiDateString(event.start.toISOString());
  const { sameDateDifferentOpponent, sameOpponentDifferentDate } = findNearMissCandidates(schedule, {
    name: event.name,
    startIso: event.start.toISOString(),
  });
  const sameDateStr = sameDateDifferentOpponent.map((f) => f.opponent).join(", ") || "none";
  const sameOpponentStr = sameOpponentDifferentDate.map((f) => f.date).join(", ") || "none";
  logger.warn(
    `[autoclass] ${event.id} "${event.name}" (${dateStr}) did not match any schedule.json fixture — ` +
      `same date, different opponent: [${sameDateStr}]; same opponent, different date: [${sameOpponentStr}]`
  );
}

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
  // Read-only — overrides.json is human-owned; nothing here ever writes to
  // it (CLAUDE.md). Needed to know whether a manual override already
  // supplies gameType, in which case a schedule-match retry is pointless.
  const overrides = await readJson(overridesPath(dataDir), {});

  // Must run before any writes: a suspiciously empty listing must never look
  // like "every event disappeared" and mass-archive the whole index.
  assertListingNotSuspiciouslyEmpty(index, presentIds);

  // Scoped to this run only (see resolveCapacities in lib/seatmap.js) —
  // every SaiPa home game shares the same arena map, so this takes a
  // ~40-event run's SVG requests from ~40 down to ~1.
  const svgCache = new Map();

  let hadFailure = false;

  for (let i = 0; i < presentEvents.length; i++) {
    const { id, url } = presentEvents[i];
    try {
      const res = await httpClient.fetchWithRetry(url, {});
      const html = await res.text();
      const { event, map } = parseEventPage(html);

      warnOnOrphanRowLevelDisabled(map.disabled, log);

      // Retried every run until classified, not just on the run where the
      // event first appears — a schedule.json naming/date mismatch on first
      // sight used to leave the event permanently "(luokittelematon)" with
      // no signal anywhere (the event is no longer "new" on the next run,
      // so the old guard skipped it forever). setAutoclassIfAbsent's
      // write-once semantics mean a *successful* match still never gets
      // overwritten — only a failed attempt gets retried.
      //
      // Skipped when overrides.json already sets gameType for this event: a
      // manual override is a deliberate human decision, and a schedule
      // match can never change what's displayed once gameType is
      // overridden (mergeClassification: override.gameType ?? auto.gameType
      // ?? "muu"). An override entry that sets some *other* field (note,
      // hidden, displayName) but not gameType does NOT count as classified
      // here — that event still needs (and gets) a retry.
      const dashId = eventDirId(event.id);
      const alreadyClassified = dashId in autoclass || overrides[dashId]?.gameType != null;
      if (!alreadyClassified) {
        const match = findScheduleMatch(schedule, {
          name: event.name,
          startIso: event.start.toISOString(),
        });
        if (match) {
          autoclass = setAutoclassIfAbsent(autoclass, dashId, match);
        } else {
          logUnclassifiedWarning(event, schedule, log);
        }
      }

      const { hash, capacities } = await resolveCapacities({
        mapUrl: map.url,
        eventBaseUrl: url,
        httpClient,
        dataDir,
        svgCache,
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

      // Read before this run's own overwrite below — the working tree
      // still holds the previous run's content at this point. See
      // scripts/lib/seatRecency.js for why recentSeatActivity.json is a
      // separate file from seats.json rather than fields on it.
      const previousSeats = await readJson(seatsPath(dataDir, id), null);
      const previousActivity = await readJson(recentSeatActivityPath(dataDir, id), null);
      const recency = computeSeatRecency({
        previousSoldSeatIds: previousSeats?.soldSeatIds ?? [],
        // The hash that gates the diff must be the hash the DIFFED ids
        // were captured against — previousSeats.svgHash, not whatever
        // hash the activity file happens to carry. The two agree on
        // every normal run, but a crash between this run's two writes
        // (or any future reordering) would leave the activity file's
        // hash describing a different snapshot than previousSeats'
        // soldSeatIds — comparing stale ids under a hash that no longer
        // describes them is exactly the mass-mark bug this guard exists
        // to prevent.
        //
        // The same crash window has a quieter failure mode this guard
        // does nothing about: if THIS run's seats.json write succeeds
        // but the recentSeatActivity.json write below never happens, the
        // transitions this run just computed are lost, not just delayed.
        // The next run diffs against a seats.json that already reflects
        // them (freed seats are already absent from its soldSeatIds), so
        // it sees no change for those ids and never re-detects the
        // transition — it never comes into existence at all. Accepted
        // deliberately: these marks are ephemeral display hints, not
        // records, and building recovery machinery (e.g. re-deriving a
        // lost diff from history.json, or making the two writes atomic)
        // would outweigh the cost of occasionally missing one.
        previousSvgHash: previousSeats?.svgHash ?? null,
        currentSvgHash: hash,
        currentSoldSeatIds: soldSeatIds,
        previousFreed: previousActivity?.freed ?? {},
        previousSold: previousActivity?.sold ?? {},
        previousFetchedAtISO: previousSeats?.fetchedAt ?? null,
        nowISO,
      });

      await writeJsonIfChanged(seatsPath(dataDir, id), {
        fetchedAt: nowISO,
        svgHash: hash,
        soldSeatIds,
        soldAitiot: soldAitioIds,
      });
      await writeJsonIfChanged(recentSeatActivityPath(dataDir, id), {
        svgHash: hash,
        freed: recency.freed,
        sold: recency.sold,
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
    await run({ dataDir });
    // Always exit with 0 (success) so the pipeline/cron doesn't fail
    // even if individual games failed and were skipped.
    process.exit(0); 
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