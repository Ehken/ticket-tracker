import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { run } from "../scripts/fetch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const eventPageHtml = readFileSync(path.join(__dirname, "fixtures", "event-page-sample.html"), "utf8");
const seatmapSvg = readFileSync(path.join(__dirname, "fixtures", "seatmap-sample.svg"), "utf8");

async function seedDataDir(index) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "fetch-test-"));
  const eventsPath = path.join(dataDir, "events.json");
  await writeFile(eventsPath, JSON.stringify(index, null, 2) + "\n");
  return { dataDir, eventsPath };
}

test("run() aborts and writes nothing when the listing is empty but events.json has upcoming events", async () => {
  const priorIndex = [
    {
      id: "53:575",
      name: "SaiPa kausikortit 2026-2027",
      start: "2026-08-01T00:00:00.000Z",
      status: "upcoming",
      firstSeen: "2026-01-01T00:00:00.000Z",
      lastSeen: "2026-07-20T00:00:00.000Z",
    },
  ];
  const { dataDir, eventsPath } = await seedDataDir(priorIndex);
  const before = await readFile(eventsPath, "utf8");

  const emptyListingHttpClient = {
    fetchWithRetry: async () => ({ text: async () => "<html><body>no events</body></html>" }),
  };

  await assert.rejects(
    () =>
      run({
        dataDir,
        baseUrl: "https://elippu.net/saipa",
        httpClient: emptyListingHttpClient,
        log: { log() {}, warn() {}, error() {} },
      }),
    /Refusing to archive everything/
  );

  const after = await readFile(eventsPath, "utf8");
  assert.equal(after, before, "events.json must be byte-identical after an aborted run");

  await assert.rejects(() => readdir(path.join(dataDir, "events")));
});

test("run() completes end-to-end for a single healthy event using fixtures", async () => {
  const { dataDir } = await seedDataDir([]);

  const listingHtml = `<a href="/saipa/53:575">SaiPa kausikortit 2026-2027</a>`;
  const httpClient = {
    fetchWithRetry: async (url) => {
      if (url === "https://elippu.net/saipa") {
        return { text: async () => listingHtml };
      }
      if (url.includes("53:575")) {
        return { text: async () => eventPageHtml };
      }
      if (url.includes("seatmap.svg")) {
        return { text: async () => seatmapSvg };
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
  };

  const { hadFailure } = await run({
    dataDir,
    baseUrl: "https://elippu.net/saipa",
    httpClient,
    now: () => new Date("2026-07-23T18:00:00.000Z"),
    sleep: async () => {},
    log: { log() {}, warn() {}, error() {} },
  });

  assert.equal(hadFailure, false);

  const index = JSON.parse(await readFile(path.join(dataDir, "events.json"), "utf8"));
  assert.equal(index.length, 1);
  assert.equal(index[0].status, "upcoming");

  const latest = JSON.parse(await readFile(path.join(dataDir, "events", "53-575", "latest.json"), "utf8"));
  assert.equal(latest.eventId, "53:575");
  assert.equal(latest.totals.total > 0, true);

  const history = JSON.parse(await readFile(path.join(dataDir, "events", "53-575", "history.json"), "utf8"));
  assert.equal(history.length, 1);
});
