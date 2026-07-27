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
  appendSectionHistoryPointIfChanged,
  serializeSectionHistory,
  writeSectionHistoryIfChanged,
  setAutoclassIfAbsent,
} from "../scripts/lib/dataStore.js";

test("eventDirId replaces colons with dashes (Windows-safe)", () => {
  assert.equal(eventDirId("53:575"), "53-575");
});

test("eventDirId rejects ids that don't match the strict digits:digits shape", () => {
  for (const malformed of ["53-575", "../../etc/passwd", "", "53:575/x", undefined]) {
    assert.throws(() => eventDirId(malformed), /Refusing to build a data path from a malformed event id/);
  }
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
    available: 800,
    hold: 0,
    closed: [],
  });
  assert.deepEqual(history, [
    { t: "2026-06-01T10:00:00.000Z", sold: 1200, soldSeated: 1100, soldStanding: 100, available: 800, hold: 0, closed: [] },
  ]);
});

test("appendHistoryPointIfChanged skips a point when nothing (sold/available/hold/closed) changed", () => {
  const existing = [
    { t: "2026-06-01T10:00:00.000Z", sold: 1200, soldSeated: 1100, soldStanding: 100, available: 800, hold: 0, closed: ["C2"] },
  ];
  const history = appendHistoryPointIfChanged(existing, {
    tISO: "2026-06-01T11:00:00.000Z",
    sold: 1200,
    soldSeated: 1100,
    soldStanding: 100,
    available: 800,
    hold: 0,
    closed: ["C2"], // different array reference, same content — must not force an append
  });
  assert.equal(history, existing);
  assert.equal(history.length, 1);
});

test("appendHistoryPointIfChanged appends a point when sold changed", () => {
  const existing = [
    { t: "2026-06-01T10:00:00.000Z", sold: 1200, soldSeated: 1100, soldStanding: 100, available: 800, hold: 0, closed: [] },
  ];
  const history = appendHistoryPointIfChanged(existing, {
    tISO: "2026-06-01T11:00:00.000Z",
    sold: 1205,
    soldSeated: 1105,
    soldStanding: 100,
    available: 795,
    hold: 0,
    closed: [],
  });
  assert.equal(history.length, 2);
  assert.equal(history[1].sold, 1205);
});

test("appendHistoryPointIfChanged appends when sold is unchanged but available/hold changed (e.g. a quota release)", () => {
  const existing = [
    { t: "2026-06-01T10:00:00.000Z", sold: 1200, soldSeated: 1100, soldStanding: 100, available: 800, hold: 200, closed: [] },
  ];
  const history = appendHistoryPointIfChanged(existing, {
    tISO: "2026-06-01T11:00:00.000Z",
    sold: 1200,
    soldSeated: 1100,
    soldStanding: 100,
    available: 900,
    hold: 100,
    closed: [],
  });
  assert.equal(history.length, 2);
  assert.equal(history[1].available, 900);
  assert.equal(history[1].hold, 100);
});

test("appendHistoryPointIfChanged appends when only the closed-section list changed", () => {
  const existing = [
    { t: "2026-06-01T10:00:00.000Z", sold: 1200, soldSeated: 1100, soldStanding: 100, available: 800, hold: 0, closed: [] },
  ];
  const history = appendHistoryPointIfChanged(existing, {
    tISO: "2026-06-01T11:00:00.000Z",
    sold: 1200,
    soldSeated: 1100,
    soldStanding: 100,
    available: 800,
    hold: 0,
    closed: ["C2"],
  });
  assert.equal(history.length, 2);
  assert.deepEqual(history[1].closed, ["C2"]);
});

test("appendHistoryPointIfChanged appends once for a legacy point with no available/hold recorded", () => {
  const existing = [{ t: "2026-06-01T10:00:00.000Z", sold: 1200, soldSeated: 1100, soldStanding: 100 }];
  const history = appendHistoryPointIfChanged(existing, {
    tISO: "2026-06-01T11:00:00.000Z",
    sold: 1200,
    soldSeated: 1100,
    soldStanding: 100,
    available: 800,
    hold: 0,
    closed: [],
  });
  assert.equal(history.length, 2);
  assert.equal(history[1].available, 800);
  assert.equal(history[1].hold, 0);
});

test("appendSectionHistoryPointIfChanged starts the first generation on an empty file", () => {
  const generations = appendSectionHistoryPointIfChanged([], {
    capacitiesHash: "hash1",
    sections: ["A1", "A2"],
    tISO: "2026-08-01T10:00:00.000Z",
    sold: [1, 2],
    closed: [],
  });
  assert.deepEqual(generations, [
    {
      capacitiesHash: "hash1",
      sections: ["A1", "A2"],
      points: [{ t: "2026-08-01T10:00:00.000Z", sold: [1, 2], closed: [] }],
    },
  ]);
});

test("appendSectionHistoryPointIfChanged is a no-op when neither sold nor closed changed", () => {
  const existing = [
    {
      capacitiesHash: "hash1",
      sections: ["A1", "A2"],
      points: [{ t: "2026-08-01T10:00:00.000Z", sold: [1, 2], closed: [] }],
    },
  ];
  const result = appendSectionHistoryPointIfChanged(existing, {
    capacitiesHash: "hash1",
    sections: ["A1", "A2"],
    tISO: "2026-08-01T11:00:00.000Z",
    sold: [1, 2],
    closed: [],
  });
  assert.equal(result, existing); // same reference: no-op
});

test("appendSectionHistoryPointIfChanged appends within the same generation when a section's sold changed", () => {
  const existing = [
    {
      capacitiesHash: "hash1",
      sections: ["A1", "A2"],
      points: [{ t: "2026-08-01T10:00:00.000Z", sold: [1, 2], closed: [] }],
    },
  ];
  const result = appendSectionHistoryPointIfChanged(existing, {
    capacitiesHash: "hash1",
    sections: ["A1", "A2"],
    tISO: "2026-08-01T11:00:00.000Z",
    sold: [1, 3],
    closed: [],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].points.length, 2);
  assert.deepEqual(result[0].points[1], { t: "2026-08-01T11:00:00.000Z", sold: [1, 3], closed: [] });
});

test("appendSectionHistoryPointIfChanged appends within the same generation when only the closed list changed", () => {
  const existing = [
    {
      capacitiesHash: "hash1",
      sections: ["A1", "A2"],
      points: [{ t: "2026-08-01T10:00:00.000Z", sold: [1, 2], closed: [] }],
    },
  ];
  const result = appendSectionHistoryPointIfChanged(existing, {
    capacitiesHash: "hash1",
    sections: ["A1", "A2"],
    tISO: "2026-08-01T11:00:00.000Z",
    sold: [1, 2],
    closed: ["A1"],
  });
  assert.equal(result[0].points.length, 2);
  assert.deepEqual(result[0].points[1].closed, ["A1"]);
});

test("appendSectionHistoryPointIfChanged starts a new generation when capacitiesHash changes, preserving the old generation untouched", () => {
  const existing = [
    {
      capacitiesHash: "hash1",
      sections: ["A1", "A2"],
      points: [{ t: "2026-08-01T10:00:00.000Z", sold: [1, 2], closed: [] }],
    },
  ];
  const warnings = [];
  const result = appendSectionHistoryPointIfChanged(
    existing,
    {
      capacitiesHash: "hash2",
      sections: ["A1", "A2"],
      tISO: "2026-09-01T10:00:00.000Z",
      sold: [5, 6],
      closed: [],
    },
    { warn: (msg) => warnings.push(msg) }
  );

  assert.equal(result.length, 2);
  assert.equal(result[0], existing[0]); // untouched, same reference
  assert.deepEqual(result[1], {
    capacitiesHash: "hash2",
    sections: ["A1", "A2"],
    points: [{ t: "2026-09-01T10:00:00.000Z", sold: [5, 6], closed: [] }],
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /hash1 -> hash2/);
});

test("appendSectionHistoryPointIfChanged starts a new generation when the section list changes, logging added/removed names", () => {
  const existing = [
    {
      capacitiesHash: "hash1",
      sections: ["A1", "A2"],
      points: [{ t: "2026-08-01T10:00:00.000Z", sold: [1, 2], closed: [] }],
    },
  ];
  const warnings = [];
  const result = appendSectionHistoryPointIfChanged(
    existing,
    {
      capacitiesHash: "hash1",
      sections: ["A1", "A3"],
      tISO: "2026-09-01T10:00:00.000Z",
      sold: [5, 6],
      closed: [],
    },
    { warn: (msg) => warnings.push(msg) }
  );

  assert.equal(result.length, 2);
  assert.equal(result[0], existing[0]);
  assert.match(warnings[0], /\+\[A3\] -\[A2\]/);
});

test("appendSectionHistoryPointIfChanged does not warn on the very first generation (nothing to compare against)", () => {
  const warnings = [];
  appendSectionHistoryPointIfChanged(
    [],
    { capacitiesHash: "hash1", sections: ["A1"], tISO: "2026-08-01T10:00:00.000Z", sold: [1], closed: [] },
    { warn: (msg) => warnings.push(msg) }
  );
  assert.equal(warnings.length, 0);
});

test("serializeSectionHistory renders each point as a single compact JSON line, structure indented", () => {
  const generations = [
    {
      capacitiesHash: "hash1",
      sections: ["A1", "A2"],
      points: [
        { t: "2026-08-01T10:00:00.000Z", sold: [1, 2], closed: [] },
        { t: "2026-08-02T10:00:00.000Z", sold: [3, 4], closed: ["A1"] },
      ],
    },
  ];
  const serialized = serializeSectionHistory(generations);

  assert.deepEqual(JSON.parse(serialized), generations); // valid JSON round-trip
  const lines = serialized.split("\n");
  assert.ok(lines.some((l) => l.trim() === '{"t":"2026-08-01T10:00:00.000Z","sold":[1,2],"closed":[]},'));
  assert.ok(lines.some((l) => l.trim() === '{"t":"2026-08-02T10:00:00.000Z","sold":[3,4],"closed":["A1"]}'));
});

test("serializeSectionHistory renders an empty generations array as a plain empty array", () => {
  assert.equal(serializeSectionHistory([]), "[]\n");
});

test("writeSectionHistoryIfChanged writes a new file and is a no-op on an unchanged rewrite", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "section-history-test-"));
  const filePath = path.join(dir, "sub", "sectionHistory.json");
  const generations = [{ capacitiesHash: "hash1", sections: ["A1"], points: [{ t: "t1", sold: [1], closed: [] }] }];

  assert.equal(await writeSectionHistoryIfChanged(filePath, generations), true);
  const written = await readFile(filePath, "utf8");
  assert.deepEqual(JSON.parse(written), generations);

  assert.equal(await writeSectionHistoryIfChanged(filePath, generations), false);
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
