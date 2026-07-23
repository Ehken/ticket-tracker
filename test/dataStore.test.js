import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  eventDirId,
  writeJsonIfChanged,
  upsertEventIndexEntry,
  archiveMissingEvents,
  assertListingNotSuspiciouslyEmpty,
  appendHistoryPointIfChanged,
  setAutoclassIfAbsent,
} from "../scripts/lib/dataStore.js";

test("eventDirId replaces colons with dashes (Windows-safe)", () => {
  assert.equal(eventDirId("53:575"), "53-575");
});

test("writeJsonIfChanged writes a new file and reports it changed", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "datastore-test-"));
  const file = path.join(dir, "sub", "events.json");

  const changed = await writeJsonIfChanged(file, { a: 1 });
  assert.equal(changed, true);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { a: 1 });
});

test("writeJsonIfChanged is a no-op when content is unchanged", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "datastore-test-"));
  const file = path.join(dir, "events.json");

  await writeJsonIfChanged(file, { a: 1 });
  const before = await readFile(file, "utf8");

  const changed = await writeJsonIfChanged(file, { a: 1 });
  const after = await readFile(file, "utf8");

  assert.equal(changed, false);
  assert.equal(before, after);
});

test("writeJsonIfChanged rewrites the file when content differs", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "datastore-test-"));
  const file = path.join(dir, "events.json");

  await writeJsonIfChanged(file, { a: 1 });
  const changed = await writeJsonIfChanged(file, { a: 2 });

  assert.equal(changed, true);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { a: 2 });
});

test("upsertEventIndexEntry adds a brand new event as upcoming", () => {
  const index = upsertEventIndexEntry([], {
    id: "53:575",
    name: "SaiPa kausikortit 2026-2027",
    start: "2026-08-01T00:00:00.000Z",
    lastSeenISO: "2026-07-23T10:00:00.000Z",
  });

  assert.deepEqual(index, [
    {
      id: "53:575",
      name: "SaiPa kausikortit 2026-2027",
      start: "2026-08-01T00:00:00.000Z",
      status: "upcoming",
      firstSeen: "2026-07-23T10:00:00.000Z",
      lastSeen: "2026-07-23T10:00:00.000Z",
    },
  ]);
});

test("upsertEventIndexEntry updates lastSeen/name/start but preserves firstSeen", () => {
  const existing = [
    {
      id: "53:575",
      name: "Old name",
      start: "2026-08-01T00:00:00.000Z",
      status: "upcoming",
      firstSeen: "2026-01-01T00:00:00.000Z",
      lastSeen: "2026-01-02T00:00:00.000Z",
    },
  ];

  const index = upsertEventIndexEntry(existing, {
    id: "53:575",
    name: "New name",
    start: "2026-08-02T00:00:00.000Z",
    lastSeenISO: "2026-07-23T10:00:00.000Z",
  });

  assert.deepEqual(index, [
    {
      id: "53:575",
      name: "New name",
      start: "2026-08-02T00:00:00.000Z",
      status: "upcoming",
      firstSeen: "2026-01-01T00:00:00.000Z",
      lastSeen: "2026-07-23T10:00:00.000Z",
    },
  ]);
});

test("upsertEventIndexEntry flips a reappearing 'past' event back to 'upcoming', keeping firstSeen", () => {
  const existing = [
    {
      id: "53:601",
      name: "SaiPa - KooKoo",
      start: "2026-09-01T18:00:00.000Z",
      status: "past",
      firstSeen: "2026-06-01T00:00:00.000Z",
      lastSeen: "2026-06-15T00:00:00.000Z",
    },
  ];

  const index = upsertEventIndexEntry(existing, {
    id: "53:601",
    name: "SaiPa - KooKoo",
    start: "2026-09-01T18:00:00.000Z",
    lastSeenISO: "2026-07-23T10:00:00.000Z",
  });

  assert.equal(index[0].status, "upcoming");
  assert.equal(index[0].firstSeen, "2026-06-01T00:00:00.000Z");
  assert.equal(index[0].lastSeen, "2026-07-23T10:00:00.000Z");
});

test("archiveMissingEvents archives only ids absent from presentIds", () => {
  const index = [
    { id: "53:575", status: "upcoming" },
    { id: "53:601", status: "upcoming" },
  ];

  const result = archiveMissingEvents(index, ["53:575"]);

  assert.equal(result.find((e) => e.id === "53:575").status, "upcoming");
  assert.equal(result.find((e) => e.id === "53:601").status, "past");
});

test("archiveMissingEvents never archives an id merely because it failed to parse this run (it's still present)", () => {
  // A failed-to-parse event is still returned by discoverEvents/listing, so its id
  // is still in presentIds even though fetch.js skipped updating its files this run.
  const index = [{ id: "53:575", status: "upcoming" }];
  const result = archiveMissingEvents(index, ["53:575"]);
  assert.equal(result[0].status, "upcoming");
});

test("archiveMissingEvents leaves already-past events untouched", () => {
  const index = [{ id: "53:575", status: "past" }];
  const result = archiveMissingEvents(index, []);
  assert.equal(result[0].status, "past");
  assert.equal(result[0], index[0]); // same reference, no unnecessary copy
});

test("assertListingNotSuspiciouslyEmpty throws when listing is empty but upcoming events exist", () => {
  const index = [{ id: "53:575", status: "upcoming" }];
  assert.throws(() => assertListingNotSuspiciouslyEmpty(index, []));
});

test("assertListingNotSuspiciouslyEmpty does not throw on genuine first-run empty state", () => {
  assert.doesNotThrow(() => assertListingNotSuspiciouslyEmpty([], []));
});

test("assertListingNotSuspiciouslyEmpty does not throw when the listing is non-empty", () => {
  const index = [{ id: "53:575", status: "upcoming" }];
  assert.doesNotThrow(() => assertListingNotSuspiciouslyEmpty(index, ["53:575"]));
});

test("assertListingNotSuspiciouslyEmpty does not throw when index has only past events", () => {
  const index = [{ id: "53:575", status: "past" }];
  assert.doesNotThrow(() => assertListingNotSuspiciouslyEmpty(index, []));
});

test("appendHistoryPointIfChanged always keeps the first point", () => {
  const history = appendHistoryPointIfChanged([], {
    tISO: "2026-06-01T10:00:00.000Z",
    sold: 1200,
    soldSeated: 1100,
    soldStanding: 100,
  });
  assert.deepEqual(history, [
    { t: "2026-06-01T10:00:00.000Z", sold: 1200, soldSeated: 1100, soldStanding: 100 },
  ]);
});

test("appendHistoryPointIfChanged skips a point when sold is unchanged", () => {
  const existing = [{ t: "2026-06-01T10:00:00.000Z", sold: 1200, soldSeated: 1100, soldStanding: 100 }];
  const history = appendHistoryPointIfChanged(existing, {
    tISO: "2026-06-01T11:00:00.000Z",
    sold: 1200,
    soldSeated: 1100,
    soldStanding: 100,
  });
  assert.equal(history, existing);
  assert.equal(history.length, 1);
});

test("appendHistoryPointIfChanged appends a point when sold changed", () => {
  const existing = [{ t: "2026-06-01T10:00:00.000Z", sold: 1200, soldSeated: 1100, soldStanding: 100 }];
  const history = appendHistoryPointIfChanged(existing, {
    tISO: "2026-06-01T11:00:00.000Z",
    sold: 1205,
    soldSeated: 1105,
    soldStanding: 100,
  });
  assert.equal(history.length, 2);
  assert.equal(history[1].sold, 1205);
});

test("setAutoclassIfAbsent inserts a new entry when the key is absent", () => {
  const result = setAutoclassIfAbsent({}, "53-601", { gameType: "runkosarja", season: "2026-27" });
  assert.deepEqual(result, { "53-601": { gameType: "runkosarja", season: "2026-27" } });
});

test("setAutoclassIfAbsent never overwrites an existing entry, even with a different candidate", () => {
  const existing = { "53-601": { gameType: "runkosarja", season: "2026-27" } };
  const result = setAutoclassIfAbsent(existing, "53-601", { gameType: "harjoitusottelu", season: "2027-28" });
  assert.equal(result, existing); // same reference: no-op
  assert.deepEqual(result["53-601"], { gameType: "runkosarja", season: "2026-27" });
});
