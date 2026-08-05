import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { shouldRegenerate, findNextGame, run } from "../scripts/generateShareImages.js";

const NOW = "2026-08-20T09:00:00.000Z";

test("shouldRegenerate: first run, new game, whole-percent move, or a meaningful sold jump", () => {
  const base = { eventId: "53:611", fillPct: 52, sold: 2607 };
  assert.equal(shouldRegenerate(null, base), true); // nothing published yet
  assert.equal(shouldRegenerate(base, { ...base }), false); // identical
  assert.equal(shouldRegenerate(base, { ...base, sold: 2612 }), false); // +5: invisible in the graphic
  assert.equal(shouldRegenerate(base, { ...base, sold: 2632 }), true); // +25: worth republishing
  assert.equal(shouldRegenerate(base, { ...base, fillPct: 53 }), true); // headline number moved
  assert.equal(shouldRegenerate(base, { ...base, eventId: "53:612" }), true); // next game changed
});

test("findNextGame picks the earliest upcoming match event, never a kausikortti listing or a hidden one", () => {
  const index = [
    { id: "53:575", name: "SaiPa kausikortit", start: "2026-08-01T00:00:00.000Z", status: "upcoming" },
    { id: "53:611", name: "SaiPa - Tappara", start: "2026-09-01T15:30:00.000Z", status: "upcoming" },
    { id: "53:610", name: "SaiPa - HIFK", start: "2026-08-25T15:30:00.000Z", status: "upcoming" },
    { id: "53:609", name: "SaiPa - JYP", start: "2026-08-22T15:30:00.000Z", status: "upcoming" },
    { id: "53:608", name: "SaiPa - Ilves", start: "2026-08-10T15:30:00.000Z", status: "past" },
  ];
  const overrides = { "53-575": { gameType: "kausikortti" }, "53-609": { hidden: true } };
  const autoclass = {
    "53-611": { gameType: "runkosarja" },
    "53-610": { gameType: "runkosarja" },
    "53-609": { gameType: "runkosarja" },
  };

  // 53:609 is earliest but hidden; 53:608 already played -> 53:610 wins
  assert.equal(findNextGame(index, { overrides, autoclass }, NOW).entry.id, "53:610");
  assert.equal(findNextGame([], { overrides, autoclass }, NOW), null);
});

test("run() writes svg/html/signature for the next game and no-ops on an unchanged rerun", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "share-data-"));
  const outDir = await mkdtemp(path.join(tmpdir(), "share-out-"));
  const silent = { log() {}, warn() {}, error() {} };

  await writeFile(
    path.join(dataDir, "events.json"),
    JSON.stringify([{ id: "53:611", name: "SaiPa - Tappara", start: "2026-09-01T15:30:00.000Z", status: "upcoming" }])
  );
  await writeFile(path.join(dataDir, "overrides.json"), "{}");
  await writeFile(path.join(dataDir, "autoclass.json"), JSON.stringify({ "53-611": { gameType: "runkosarja" } }));
  await mkdir(path.join(dataDir, "events", "53-611"), { recursive: true });
  await writeFile(
    path.join(dataDir, "events", "53-611", "latest.json"),
    JSON.stringify({
      name: "SaiPa - Tappara",
      fetchedAt: NOW,
      totals: { sold: 2607, available: 1774, hold: 595, total: 4976 },
      sections: [{ section: "A4", sold: 232, available: 12, total: 244 }],
    })
  );

  const first = await run({ dataDir, outDir, nowIso: NOW, log: silent });
  assert.equal(first.written, true);
  const svg = await readFile(path.join(outDir, "seuraava-ottelu.svg"), "utf8");
  assert.match(svg, /^<svg /);
  assert.ok(svg.includes("SaiPa - Tappara"));
  const html = await readFile(path.join(outDir, "seuraava-ottelu.html"), "utf8");
  assert.ok(html.includes("width:100vw")); // responsive, so the same file embeds in an iframe
  const signature = JSON.parse(await readFile(path.join(outDir, "seuraava-ottelu.json"), "utf8"));
  assert.equal(signature.eventId, "53:611");
  assert.equal(signature.fillPct, 52);

  const second = await run({ dataDir, outDir, nowIso: NOW, log: silent });
  assert.equal(second.written, false, "an unchanged rerun must not rewrite (git-growth gate)");
});

test("run() no-ops cleanly when there is no upcoming game at all", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "share-data-empty-"));
  const outDir = await mkdtemp(path.join(tmpdir(), "share-out-empty-"));
  await writeFile(path.join(dataDir, "events.json"), "[]");
  const result = await run({ dataDir, outDir, nowIso: NOW, log: { log() {}, warn() {}, error() {} } });
  assert.equal(result.written, false);
});
