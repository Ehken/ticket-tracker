// Refreshes scripts/mockKausikorttiBaseline.json — a pinned snapshot of the
// real 2026-27 season-ticket event's per-section sold counts and sold seat
// IDs, used by generateMockData.js as the 2026-27 mock season's baseline.
//
// Lives under scripts/, not data/ (machine-owned/scraper-written, per
// CLAUDE.md) and not data/mock/ (generateMockData.js's own output, which
// this file is an *input* to — committing it there would eventually get it
// mistaken for generated output and deleted). Deliberately not refreshed
// automatically: season tickets keep selling, so re-running this whenever
// convenient would make every mock-data regeneration diff mix real baseline
// drift in with actual generator-logic changes. Run explicitly:
//   npm run refresh-mock-baseline
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { mergeClassification } from "../js/classify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

const TARGET_SEASON = "2026-27";

async function main() {
  const [events, overrides, autoclass] = await Promise.all([
    readJson(path.join(repoRoot, "data", "events.json")),
    readJson(path.join(repoRoot, "data", "overrides.json")),
    readJson(path.join(repoRoot, "data", "autoclass.json")),
  ]);

  const merged = events.map((event) => mergeClassification(event, { overrides, autoclass }));
  const matches = merged.filter((e) => e.gameType === "kausikortti" && e.season === TARGET_SEASON);

  if (matches.length !== 1) {
    throw new Error(
      `refreshMockBaseline: expected exactly one kausikortti event for season ${TARGET_SEASON}, ` +
        `found ${matches.length}: [${matches.map((e) => e.id).join(", ")}]`
    );
  }

  const dashId = matches[0].id.replace(/:/g, "-");
  const [latest, seats] = await Promise.all([
    readJson(path.join(repoRoot, "data", "events", dashId, "latest.json")),
    readJson(path.join(repoRoot, "data", "events", dashId, "seats.json")),
  ]);

  // press is always 0 with no baseline concept; aitiot is driven per-event
  // by soldAitioIds, not a season baseline — neither is ever read via
  // baseline.get(...) in generateMockData.js's buildSections, so neither
  // belongs in the snapshot.
  const sections = latest.sections
    .filter((s) => s.section !== "press" && s.section !== "aitiot")
    .map((s) => ({ section: s.section, sold: s.sold }));

  const snapshot = {
    sourceEventId: dashId,
    season: TARGET_SEASON,
    sourceFetchedAt: seats.fetchedAt,
    capturedAt: new Date().toISOString(),
    svgHash: seats.svgHash,
    sections,
    soldSeatIds: seats.soldSeatIds,
  };

  await writeFile(
    path.join(repoRoot, "scripts", "mockKausikorttiBaseline.json"),
    JSON.stringify(snapshot, null, 2) + "\n"
  );

  console.log(
    `Refreshed scripts/mockKausikorttiBaseline.json from ${dashId} ` +
      `(${sections.reduce((sum, s) => sum + s.sold, 0)} sold across ${sections.length} sections, ` +
      `${seats.soldSeatIds.length} seat ids)`
  );
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
