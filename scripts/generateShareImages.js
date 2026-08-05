// Publishes an always-current share graphic for the NEXT home game to
// kuvat/ — so a forum post, a Discord embed or a blog sidebar can hotlink
// one stable URL and stay live all season without anyone touching it again.
// Runs at the end of each scrape (see .github/workflows/fetch.yml, which
// rasterises the SVG to PNG with the runner's preinstalled headless
// Chrome). The design itself lives in js/shareImage.js, shared verbatim
// with the browser's own "Lataa kuva" button.
//
// Git-growth gate: the raw numbers move every hour, but a marketing
// graphic that is 20 tickets stale is indistinguishable from a fresh one —
// and committing a ~40 KB PNG hourly would add hundreds of megabytes over
// a season. shouldRegenerate() below only rewrites when the change is
// visible in the graphic (a different game, a different whole-percent
// fill, or a meaningful jump in sold), which in practice is a handful of
// commits a day instead of 24.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile, mkdir } from "node:fs/promises";
import { buildShareSvg } from "../js/shareImage.js";
import { mergeClassification } from "../js/classify.js";
import { readJson, latestPath, historyPath, seasonBaselinePath } from "./lib/dataStore.js";
import { findValueAtOrBefore } from "../js/dashboardTrends.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

// One published format: the 1200x630 "wide" variant. It is what forums,
// chat apps and OG previews all want; the tall IG formats are generated
// on demand in the browser, where a bigger file costs nobody anything.
const PUBLISHED_FORMAT = "wide";
const SOLD_JUMP = 25;

export function shouldRegenerate(previous, next) {
  if (!previous) return true;
  if (previous.eventId !== next.eventId) return true;
  if (previous.fillPct !== next.fillPct) return true;
  if (Math.abs((previous.sold ?? 0) - next.sold) >= SOLD_JUMP) return true;
  return false;
}

const dateFormatter = new Intl.DateTimeFormat("fi-FI", {
  timeZone: "Europe/Helsinki",
  weekday: "short",
  day: "numeric",
  month: "numeric",
  year: "numeric",
});
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Helsinki",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatGameDate(iso) {
  return `${dateFormatter.format(new Date(iso))} klo ${timeFormatter.format(new Date(iso))}`;
}

// The next home game with sales data: earliest upcoming match event whose
// start is still ahead of `now`. Kausikortti listings are excluded — the
// graphic is about a game people can buy a ticket to.
export function findNextGame(index, { overrides, autoclass }, nowIso) {
  const nowMs = new Date(nowIso).getTime();
  return index
    .map((entry) => ({ entry, merged: mergeClassification(entry, { overrides, autoclass }) }))
    .filter(
      ({ entry, merged }) =>
        merged.gameType !== "kausikortti" &&
        !merged.hidden &&
        entry.status === "upcoming" &&
        new Date(entry.start).getTime() >= nowMs
    )
    .sort((a, b) => a.entry.start.localeCompare(b.entry.start))[0] ?? null;
}

// Serves two purposes from one file, which is why the SVG is sized in
// viewport units rather than pixels:
//   1. headless Chrome's --screenshot needs a page, and at
//      --window-size=1200,630 `width:100vw` makes the SVG exactly fill it
//      (no margin, no scrollbar, so no white bleed at the PNG edges);
//   2. the same page is directly iframe-embeddable at any width — it
//      scales with the frame instead of being pinned to 1200px — so a blog
//      or an editorial page can embed the live graphic without an image at
//      all. That's the reason for `overflow:hidden` staying off: an
//      embedder sizing the frame slightly short should letterbox, not clip
//      unpredictably.
function wrapperHtml(svg) {
  return (
    '<!doctype html>\n<html lang="fi"><head><meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    "<title>SaiPa — seuraavan ottelun lipputilanne</title>\n" +
    "<style>html,body{margin:0;padding:0;background:#111111}" +
    "svg{display:block;width:100vw;height:auto}</style></head>\n" +
    `<body>${svg}</body></html>\n`
  );
}

export async function run({ dataDir, outDir, nowIso = new Date().toISOString(), log = console } = {}) {
  const index = await readJson(path.join(dataDir, "events.json"), []);
  const overrides = await readJson(path.join(dataDir, "overrides.json"), {});
  const autoclass = await readJson(path.join(dataDir, "autoclass.json"), {});

  const next = findNextGame(index, { overrides, autoclass }, nowIso);
  if (!next) {
    log.log("[shareImages] no upcoming game — leaving existing files untouched");
    return { written: false };
  }

  const id = next.entry.id;
  const latest = await readJson(latestPath(dataDir, id), null);
  if (!latest) {
    log.log(`[shareImages] ${id}: no latest.json yet — skipping`);
    return { written: false };
  }

  const totals = latest.totals;
  const fillPct = totals.total > 0 ? Math.round((totals.sold / totals.total) * 100) : 0;
  const signaturePath = path.join(outDir, "seuraava-ottelu.json");
  const previous = await readJson(signaturePath, null);
  const signature = { eventId: id, fillPct, sold: totals.sold, start: next.entry.start };

  if (!shouldRegenerate(previous, signature)) {
    log.log(`[shareImages] ${id}: no visible change (${fillPct} %, sold ${totals.sold}) — not rewriting`);
    return { written: false };
  }

  // Net 24h movement, for the momentum note — same derivation the
  // dashboard's own delta uses, so the two can never disagree.
  const history = await readJson(historyPath(dataDir, id), []);
  const cutoffIso = new Date(new Date(nowIso).getTime() - 24 * 3600 * 1000).toISOString();
  const dayAgo = findValueAtOrBefore(history, cutoffIso);
  const delta24h = dayAgo ? totals.sold - dayAgo.sold : null;

  // The season-ticket share, so the fill bar can show it as the darker
  // base rather than implying every sold seat is a single ticket.
  let kausikortti = 0;
  const season = next.merged.season;
  if (season) {
    const kkEntry = index.find(
      (entry) => mergeClassification(entry, { overrides, autoclass }).gameType === "kausikortti" &&
        mergeClassification(entry, { overrides, autoclass }).season === season
    );
    if (kkEntry) {
      const baseline = await readJson(seasonBaselinePath(dataDir, kkEntry.id), null);
      kausikortti = baseline?.totals?.sold ?? 0;
    }
  }

  const svg = buildShareSvg({
    opponent: next.merged.name,
    dateText: formatGameDate(next.entry.start),
    sold: totals.sold,
    available: totals.available,
    total: totals.total,
    sections: latest.sections,
    kausikortti,
    delta24h,
    format: PUBLISHED_FORMAT,
  });

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "seuraava-ottelu.svg"), svg + "\n");
  await writeFile(path.join(outDir, "seuraava-ottelu.html"), wrapperHtml(svg));
  await writeFile(signaturePath, JSON.stringify(signature, null, 2) + "\n");

  log.log(
    `[shareImages] ${id} (${next.merged.name}): wrote ${PUBLISHED_FORMAT} graphic — ${fillPct} %, ` +
      `${totals.available} available${delta24h === null ? "" : `, ${delta24h >= 0 ? "+" : ""}${delta24h}/24h`}`
  );
  return { written: true, eventId: id };
}

async function main() {
  const result = await run({
    dataDir: path.join(repoRoot, "data"),
    outDir: path.join(repoRoot, "kuvat"),
  });
  // Consumed by the workflow: only rasterise when there is something new.
  console.log(`shareImagesWritten=${result.written}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // Never fail the scrape over a marketing graphic — the data is what
    // matters, and the previous image stays valid.
    console.error(`[shareImages] FAILED (non-fatal): ${err.message}`);
    process.exit(0);
  });
}
