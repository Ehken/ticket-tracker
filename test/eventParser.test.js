import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseEventPage, ParseError } from "../scripts/lib/eventParser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(
  path.join(__dirname, "fixtures", "event-page-sample.html"),
  "utf8"
);

test("parseEventPage extracts event fields correctly", () => {
  const { event } = parseEventPage(fixtureHtml);

  assert.equal(event.id, "53:575");
  assert.equal(event.name, "SaiPa kausikortit 2026-2027");
  assert.ok(event.start instanceof Date);
  assert.ok(event.stop instanceof Date);
  assert.equal(event.start.getTime(), 1785531600000);
  assert.equal(event.stop.getTime(), 1785542400000);
});

test("parseEventPage extracts map.status.usages, capacities, disabled and url", () => {
  const { map } = parseEventPage(fixtureHtml);

  assert.deepEqual(map.status.usages, {
    "A4-6-085": 1,
    "A4-1-001": 1,
    "C1-2-010": 1,
    "C1-2-011": 1,
    seisomakatsomo: 50,
    invalid: 3,
  });
  assert.equal(map.status.capacities.seisomakatsomo, 2138);
  assert.equal(map.status.capacities.invalid, 12);
  assert.equal(map.status.capacities.press, 24);
  assert.deepEqual(map.disabled, ["D2-1", "D2-2", "C7", "C8", "C2", "D2"]);
  assert.equal(map.url, "/seatmap.svg");
});

test("parseEventPage extracts map.prices as-is (priceGroups/productPrices/products)", () => {
  const { map } = parseEventPage(fixtureHtml);

  assert.deepEqual(map.prices.priceGroups, {
    seisomakatsomo: "8",
    A4: "5",
    C1: "6",
    invalid: "9",
  });
  assert.deepEqual(map.prices.productPrices["8"], { "959": 405, "960": 179 });
  assert.deepEqual(map.prices.products["959"], {
    id: "959",
    name: "Seisomakatsomo",
    vat: 13.5,
    bundle: false,
    type: "ticket",
    group: "Verkkomyyntipiste",
  });
});

test("parseEventPage throws ParseError when the kit.start anchor is missing", () => {
  assert.throws(() => parseEventPage("<html><body>no payload here</body></html>"), ParseError);
});

test("parseEventPage throws ParseError when map.prices is missing", () => {
  const brokenHtml = `
    <script>
      kit.start(app, element, {
        node_ids: [0],
        data: [null, null, { type: "data", data: {
          shopId: 53,
          event: { id: "53:575", name: "SaiPa kausikortit 2026-2027", start: new Date(1785531600000), stop: new Date(1785542400000) },
          map: {
            status: { usages: {}, capacities: {} },
            disabled: [],
            url: "/seatmap.svg"
          }
        } }]
      });
    </script>
  `;
  assert.throws(() => parseEventPage(brokenHtml), ParseError);
});

test("parseEventPage throws ParseError when the payload shape is incomplete", () => {
  const brokenHtml = `
    <script>
      kit.start(app, element, {
        node_ids: [0],
        data: [null, null, { type: "data", data: { shopId: 53, event: { id: "53:575" } } }]
      });
    </script>
  `;
  assert.throws(() => parseEventPage(brokenHtml), ParseError);
});
