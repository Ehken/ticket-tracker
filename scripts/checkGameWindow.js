import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, eventsIndexPath, watchDatesPath, autoclassPath, overridesPath } from "./lib/dataStore.js";
import { isGameDayWindowNow, warnOnPastWatchDates } from "./lib/gameWindow.js";
import { mergeClassification } from "../js/classify.js";

export async function decide(dataDir, now = new Date(), logger = console) {
  const index = await readJson(eventsIndexPath(dataDir), []);
  const watchDates = await readJson(watchDatesPath(dataDir), []);
  // Merged in here, not read inside gameWindow.js — that keeps the gate
  // logic itself pure (it just receives events), matching how it already
  // receives the plain index. Needed so isGameDayWindowNow can tell a
  // kausikortti listing (whose "start" is a sales-window boundary, not a
  // puck drop) apart from an actual game.
  const autoclass = await readJson(autoclassPath(dataDir), {});
  const overrides = await readJson(overridesPath(dataDir), {});
  const classifiedIndex = index.map((event) => mergeClassification(event, { overrides, autoclass }));
  warnOnPastWatchDates(watchDates, now, logger);
  return isGameDayWindowNow(classifiedIndex, now, watchDates) ? "proceed" : "skip";
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
