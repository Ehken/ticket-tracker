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

function buildMatchEventHtml({ id, name, startMs, stopMs }) {
  return `
    <script>
      kit.start(app, element, {
        node_ids: [0],
        data: [
          null,
          null,
          {
            type: "data",
            data: {
              shopId: 53,
              event: {
                id: "${id}",
                name: "${name}",
                start: new Date(${startMs}),
                stop: new Date(${stopMs})
              },
              map: {
                status: {
                  usages: { "A1-1-001": 1, seisomakatsomo: 10, invalid: 1 },
                  capacities: { seisomakatsomo: 2138, invalid: 12, aitio_1: 156, press: 24 }
                },
                disabled: [],
                url: "/seatmap.svg",
                prices: {
                  priceGroups: { A1: "7", seisomakatsomo: "8", invalid: "9" },
                  productPrices: { "7": { "956": 852 }, "8": { "959": 405 }, "9": { "961": 405 } },
                  products: {
                    "956": { id: "956", name: "Kategoria 2", vat: 13.5, bundle: false, type: "ticket", group: "Verkkomyyntipiste" },
                    "959": { id: "959", name: "Seisomakatsomo", vat: 13.5, bundle: false, type: "ticket", group: "Verkkomyyntipiste" },
                    "961": { id: "961", name: "Pyörätuoli", vat: 13.5, bundle: false, type: "ticket", group: "Verkkomyyntipiste" }
                  }
                }
              }
            }
          }
        ]
      });
    </script>
  `;
}

function httpClientFor({ listingHtml, eventUrlFragment, eventHtml }) {
  return {
    fetchWithRetry: async (url) => {
      if (url === "https://elippu.net/saipa") return { text: async () => listingHtml };
      if (url.includes(eventUrlFragment)) return { text: async () => eventHtml };
      if (url.includes("seatmap.svg")) return { text: async () => seatmapSvg };
      throw new Error(`unexpected fetch: ${url}`);
    },
  };
}

const silentLog = { log() {}, warn() {}, error() {} };

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
  assert.equal(latest.prices.priceGroups.A4, "5");
  assert.deepEqual(latest.prices.products["959"], {
    id: "959",
    name: "Seisomakatsomo",
    vat: 13.5,
    bundle: false,
    type: "ticket",
    group: "Verkkomyyntipiste",
  });

  const history = JSON.parse(await readFile(path.join(dataDir, "events", "53-575", "history.json"), "utf8"));
  assert.equal(history.length, 1);

  const seats = JSON.parse(await readFile(path.join(dataDir, "events", "53-575", "seats.json"), "utf8"));
  assert.equal(seats.fetchedAt, "2026-07-23T18:00:00.000Z");
  assert.equal(seats.svgHash, latest.capacitiesHash);
  assert.deepEqual(seats.soldSeatIds, ["A4-1-001", "A4-6-085", "C1-2-010", "C1-2-011"]);

  const svgPath = path.join(dataDir, "capacities", `${latest.capacitiesHash}.svg`);
  assert.equal(await readFile(svgPath, "utf8"), seatmapSvg);
});

test("run() writes an autoclass.json entry when a first-seen event matches a schedule.json fixture", async () => {
  const { dataDir } = await seedDataDir([]);
  await writeFile(
    path.join(dataDir, "schedule.json"),
    JSON.stringify([{ date: "2026-10-08", opponent: "JYP", gameType: "runkosarja", season: "2026-27" }], null, 2) + "\n"
  );

  const eventHtml = buildMatchEventHtml({
    id: "53:601",
    name: "SaiPa - JYP",
    startMs: Date.parse("2026-10-08T17:30:00.000Z"),
    stopMs: Date.parse("2026-10-08T20:00:00.000Z"),
  });
  const httpClient = httpClientFor({
    listingHtml: `<a href="/saipa/53:601">SaiPa - JYP</a>`,
    eventUrlFragment: "53:601",
    eventHtml,
  });

  await run({
    dataDir,
    baseUrl: "https://elippu.net/saipa",
    httpClient,
    now: () => new Date("2026-08-01T10:00:00.000Z"),
    sleep: async () => {},
    log: silentLog,
  });

  const autoclass = JSON.parse(await readFile(path.join(dataDir, "autoclass.json"), "utf8"));
  assert.deepEqual(autoclass, { "53-601": { gameType: "runkosarja", season: "2026-27" } });
});

test("run() never rewrites an existing autoclass.json entry on a later run, even if schedule.json changes", async () => {
  const { dataDir } = await seedDataDir([]);
  const scheduleJsonPath = path.join(dataDir, "schedule.json");
  await writeFile(
    scheduleJsonPath,
    JSON.stringify([{ date: "2026-10-08", opponent: "JYP", gameType: "runkosarja", season: "2026-27" }], null, 2) + "\n"
  );

  const eventHtml = buildMatchEventHtml({
    id: "53:601",
    name: "SaiPa - JYP",
    startMs: Date.parse("2026-10-08T17:30:00.000Z"),
    stopMs: Date.parse("2026-10-08T20:00:00.000Z"),
  });
  const httpClient = httpClientFor({
    listingHtml: `<a href="/saipa/53:601">SaiPa - JYP</a>`,
    eventUrlFragment: "53:601",
    eventHtml,
  });

  // First run: "53:601" is first-seen, matches, and gets classified.
  await run({
    dataDir,
    baseUrl: "https://elippu.net/saipa",
    httpClient,
    now: () => new Date("2026-08-01T10:00:00.000Z"),
    sleep: async () => {},
    log: silentLog,
  });

  // Someone edits schedule.json afterward — must not affect what's already written.
  await writeFile(
    scheduleJsonPath,
    JSON.stringify([{ date: "2026-10-08", opponent: "JYP", gameType: "harjoitusottelu", season: "2027-28" }], null, 2) + "\n"
  );

  // Second run: "53:601" is now present in events.json, so it's no longer first-seen.
  await run({
    dataDir,
    baseUrl: "https://elippu.net/saipa",
    httpClient,
    now: () => new Date("2026-08-02T10:00:00.000Z"),
    sleep: async () => {},
    log: silentLog,
  });

  const autoclass = JSON.parse(await readFile(path.join(dataDir, "autoclass.json"), "utf8"));
  assert.deepEqual(autoclass, { "53-601": { gameType: "runkosarja", season: "2026-27" } });
});
