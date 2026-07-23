import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, eventsIndexPath } from "./lib/dataStore.js";
import { isGameDayWindowNow } from "./lib/gameWindow.js";

export async function decide(dataDir, now = new Date()) {
  const index = await readJson(eventsIndexPath(dataDir), []);
  return isGameDayWindowNow(index, now) ? "proceed" : "skip";
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
