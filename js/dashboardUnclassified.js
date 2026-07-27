// ?dashboard=1's surface for classify.js's own admin-UI aspiration: today
// there's no admin UI, so an unclassified event ("muu") is otherwise only
// ever signalled by a fetch.js log line nobody opens. This lists every
// unclassified event with the same near-miss diagnosis the log line gets,
// reusing findNearMissCandidates directly rather than re-deriving it —
// scripts/lib/schedule.js has no Node-only APIs (guarded by a test in
// test/schedule.test.js), so it's safe to import here as-is.
import { findNearMissCandidates } from "../scripts/lib/schedule.js";

export function computeUnclassifiedEvents(events, schedule) {
  return events
    .filter((e) => e.gameType === "muu")
    .map((e) => ({
      event: e,
      ...findNearMissCandidates(schedule, { name: e.name, startIso: e.start }),
    }));
}
