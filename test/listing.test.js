import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { discoverEvents, fetchListing } from "../scripts/lib/listing.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(path.join(__dirname, "fixtures", "listing-sample.html"), "utf8");

test("discoverEvents finds both event links and builds absolute URLs", () => {
  const events = discoverEvents(fixtureHtml, "https://elippu.net/saipa");

  assert.deepEqual(events, [
    { id: "53:575", url: "https://elippu.net/saipa/53:575" },
    { id: "53:601", url: "https://elippu.net/saipa/53:601" },
  ]);
});

test("discoverEvents deduplicates repeated links to the same event", () => {
  const html = `
    <a href="/saipa/53:575">SaiPa kausikortit</a>
    <a href="/saipa/53:575">SaiPa kausikortit (again)</a>
  `;
  const events = discoverEvents(html, "https://elippu.net/saipa");
  assert.equal(events.length, 1);
});

test("discoverEvents returns an empty array when the listing has no event links", () => {
  assert.deepEqual(discoverEvents("<html><body>no events</body></html>", "https://elippu.net/saipa"), []);
});

test("fetchListing fetches the base URL and discovers events from the response body", async () => {
  const stub = {
    fetchWithRetry: async (url) => {
      assert.equal(url, "https://elippu.net/saipa");
      return { text: async () => fixtureHtml };
    },
  };

  const events = await fetchListing("https://elippu.net/saipa", stub);
  assert.equal(events.length, 2);
  assert.equal(events[0].id, "53:575");
});
