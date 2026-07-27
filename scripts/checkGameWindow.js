import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, eventsIndexPath, watchDatesPath } from "./lib/dataStore.js";
import { isGameDayWindowNow, warnOnPastWatchDates } from "./lib/gameWindow.js";

export async function decide(dataDir, now = new Date(), logger = console) {
  const index = await readJson(eventsIndexPath(dataDir), []);
  const watchDates = await readJson(watchDatesPath(dataDir), []);
  warnOnPastWatchDates(watchDates, now, logger);
  return isGameDayWindowNow(index, now, watchDates) ? "proceed" : "skip";
}

async function main() {
  const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
  // Always exits 0 — the decision is communicated entirely through what's
  // printed ("proceed" or "skip"), never through the exit code. A workflow
  // step reading this must never see "out of window" as a failure.
  console.log(await decide(dataDir));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
