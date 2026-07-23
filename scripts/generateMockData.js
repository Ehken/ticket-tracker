// Generates a rich, realistic-looking fake dataset under data/mock/ for
// frontend design/testing work (loaded only via ?mock=1). Never touches
// data/ (production). Deterministic (seeded PRNG) so re-running this after
// editing it reproduces the same output unless the generation logic itself
// changed — run with: node scripts/generateMockData.js
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile, readFile } from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const mockDir = path.join(repoRoot, "data", "mock");

const SEATED_CAPACITIES = {
  A1: 171,
  A2: 268,
  A3: 246,
  A4: 244,
  A5: 247,
  A6: 120,
  C1: 108,
  C2: 120,
  C3: 150,
  C4: 120,
  C5: 120,
  C6: 113,
  C7: 94,
  C8: 105,
  D1: 205,
  D2: 215,
};
const STANDING_CAPACITY = 2138;
const WHEELCHAIR_CAPACITY = 12;
const AITIOT_CAPACITY = 156;
const PRESS_CAPACITY = 24;

// mulberry32: tiny seeded PRNG, deterministic per seed.
function makeRng(seedStr) {
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (Math.imul(31, seed) + seedStr.charCodeAt(i)) | 0;
  return function rng() {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function toDashId(id) {
  return id.replace(/:/g, "-");
}

// Rough Helsinki UTC offset by month — fine for synthetic display timestamps.
function helsinkiOffsetHours(month) {
  return month >= 4 && month <= 10 ? 3 : 2;
}

function helsinkiLocalToUtcIso(dateStr, hour, minute) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const offset = helsinkiOffsetHours(m);
  const utc = new Date(Date.UTC(y, m - 1, d, hour - offset, minute, 0));
  return utc.toISOString();
}

function buildSections(rng, popularity, disabledSections) {
  const sections = [];

  for (const [section, total] of Object.entries(SEATED_CAPACITIES)) {
    const disabled = disabledSections.includes(section);
    const fill = clamp(popularity + (rng() - 0.5) * 0.35, 0.02, 0.99);
    const sold = Math.round(total * fill);
    sections.push({
      section,
      sold,
      available: disabled ? 0 : total - sold,
      hold: disabled ? total - sold : 0,
      total,
      disabled,
    });
  }

  const standingFill = clamp(popularity + (rng() - 0.5) * 0.3, 0.02, 0.99);
  const standingSold = Math.round(STANDING_CAPACITY * standingFill);
  sections.push({
    section: "seisomakatsomo",
    sold: standingSold,
    available: STANDING_CAPACITY - standingSold,
    hold: 0,
    total: STANDING_CAPACITY,
  });

  const wheelchairFill = clamp(popularity + (rng() - 0.5) * 0.3, 0, 1);
  const wheelchairSold = Math.round(WHEELCHAIR_CAPACITY * wheelchairFill);
  sections.push({
    section: "invalid",
    sold: wheelchairSold,
    available: WHEELCHAIR_CAPACITY - wheelchairSold,
    hold: 0,
    total: WHEELCHAIR_CAPACITY,
  });

  sections.push({ section: "press", sold: 0, available: 0, hold: PRESS_CAPACITY, total: PRESS_CAPACITY });
  sections.push({ section: "aitiot", sold: 0, available: 0, hold: AITIOT_CAPACITY, total: AITIOT_CAPACITY });

  return sections;
}

function computeTotals(sections) {
  return sections.reduce(
    (acc, s) => ({
      sold: acc.sold + s.sold,
      available: acc.available + s.available,
      hold: acc.hold + s.hold,
      total: acc.total + s.total,
    }),
    { sold: 0, available: 0, hold: 0, total: 0 }
  );
}

function buildHistory(rng, { finalSold, finalStanding, firstSeenIso, lastPointIso, pointCount }) {
  const startTime = new Date(firstSeenIso).getTime();
  const endTime = new Date(lastPointIso).getTime();
  const points = [];
  let prevSold = 0;

  for (let i = 0; i < pointCount; i++) {
    const progress = i / (pointCount - 1);
    const t = startTime + (endTime - startTime) * progress;
    let sold = Math.round(finalSold * progress * (0.85 + rng() * 0.3));
    sold = clamp(sold, prevSold, finalSold);
    if (i === pointCount - 1) sold = finalSold;
    prevSold = sold;
    const standingShare = finalSold > 0 ? finalStanding / finalSold : 0;
    const soldStanding = Math.round(sold * standingShare);
    points.push({
      t: new Date(t).toISOString(),
      sold,
      soldSeated: sold - soldStanding,
      soldStanding,
    });
  }

  // Same "only append when sold changed" rule as production's real history.json.
  return points.filter((p, i) => i === 0 || p.sold !== points[i - 1].sold);
}

async function main() {
  const schedule = JSON.parse(await readFile(path.join(repoRoot, "data", "schedule.json"), "utf8"));

  const events = [];
  const latestById = new Map();
  const historyById = new Map();
  const overrides = {};
  const autoclass = {};

  function addEvent({
    id,
    name,
    gameType,
    season,
    dateStr,
    hour = 18,
    minute = 30,
    durationHours = 2.5,
    stopIsoOverride, // e.g. kausikortti's "stop" is end-of-season, not start+durationHours
    status,
    firstSeenDaysBefore = 45,
    nowIso, // override for events whose "current snapshot" isn't close to `start` (e.g. kausikortti)
    popularity,
    disabledSections = [],
    historyPoints = 10,
  }) {
    const startIso = helsinkiLocalToUtcIso(dateStr, hour, minute);
    const stopIso = stopIsoOverride ?? new Date(new Date(startIso).getTime() + durationHours * 3600 * 1000).toISOString();
    const firstSeenIso = new Date(new Date(startIso).getTime() - firstSeenDaysBefore * 86400 * 1000).toISOString();
    const lastPointIso =
      status === "past" ? new Date(new Date(stopIso).getTime() + 3600 * 1000).toISOString() : nowIso ?? startIso;

    const rng = makeRng(id);
    const sections = buildSections(rng, popularity, disabledSections);
    const totals = computeTotals(sections);

    events.push({
      id,
      name,
      start: startIso,
      status,
      firstSeen: firstSeenIso,
      lastSeen: lastPointIso,
    });

    latestById.set(id, {
      eventId: id,
      name,
      start: startIso,
      stop: stopIso,
      fetchedAt: lastPointIso,
      capacitiesHash: "mock-fixture",
      sections,
      totals,
    });

    const standingRow = sections.find((s) => s.section === "seisomakatsomo");
    historyById.set(
      id,
      buildHistory(rng, {
        finalSold: totals.sold,
        finalStanding: standingRow.sold,
        firstSeenIso,
        lastPointIso,
        pointCount: historyPoints,
      })
    );

    return { gameType, season };
  }

  // --- Kausikortit: one per season, each its own strip. Tests the multi-strip
  // "newest season first" ordering, an archived (past) strip's frozen data,
  // and the season selector picking up a 3rd season.
  addEvent({
    id: "90:900",
    name: "SaiPa kausikortit 2025-2026",
    gameType: "kausikortti",
    season: "2025-26",
    dateStr: "2025-08-01",
    hour: 0,
    minute: 0,
    stopIsoOverride: "2026-03-15T22:00:00.000Z",
    status: "past",
    firstSeenDaysBefore: 0,
    popularity: 0.92,
    historyPoints: 10,
  });
  overrides["90-900"] = { gameType: "kausikortti", season: "2025-26" };

  const kausikorttiId = "90:000";
  addEvent({
    id: kausikorttiId,
    name: "SaiPa kausikortit 2026-2027",
    gameType: "kausikortti",
    season: "2026-27",
    dateStr: "2026-07-31",
    hour: 0,
    minute: 0,
    stopIsoOverride: "2027-03-15T22:00:00.000Z",
    status: "upcoming",
    firstSeenDaysBefore: 0,
    nowIso: "2026-10-25T12:00:00.000Z", // sales opened 07-31; "now" is ~3 months into the season
    popularity: 0.55,
    historyPoints: 14,
  });
  overrides[toDashId(kausikorttiId)] = { gameType: "kausikortti", season: "2026-27" };

  addEvent({
    id: "90:901",
    name: "SaiPa kausikortit 2027-2028",
    gameType: "kausikortti",
    season: "2027-28",
    dateStr: "2027-07-31",
    hour: 0,
    minute: 0,
    stopIsoOverride: "2028-03-15T22:00:00.000Z",
    status: "upcoming",
    firstSeenDaysBefore: 0,
    nowIso: "2027-08-10T12:00:00.000Z", // sales just opened
    popularity: 0.08,
    historyPoints: 3,
  });
  overrides["90-901"] = { gameType: "kausikortti", season: "2027-28" };

  // --- All 36 real schedule.json fixtures become mock games (id range 90:001-90:036) ---
  const PAST_OPPONENTS_BY_ORDER = 4; // first 4 fixtures (chronologically earliest) are archived
  schedule.forEach((fixture, index) => {
    const num = String(index + 1).padStart(3, "0");
    const id = `90:${num}`;
    const isPast = index < PAST_OPPONENTS_BY_ORDER;
    const popularity = isPast ? 0.85 + (index % 3) * 0.05 : 0.15 + ((index * 37) % 60) / 100;
    const disabledSections = !isPast && index % 6 === 0 ? ["C7", "C2"] : [];

    addEvent({
      id,
      name: `SaiPa - ${fixture.opponent}`,
      gameType: fixture.gameType,
      season: fixture.season,
      dateStr: fixture.date,
      status: isPast ? "past" : "upcoming",
      popularity,
      disabledSections,
      historyPoints: isPast ? 12 : 8,
    });

    autoclass[toDashId(id)] = { gameType: fixture.gameType, season: fixture.season };
  });

  // --- A couple of manual-override test cases layered on top of the auto-classified games ---
  const hifkDerby = events.find((e) => e.name === "SaiPa - HIFK" && e.start.startsWith("2026-10-17"));
  overrides[toDashId(hifkDerby.id)] = { displayName: "SaiPa - HIFK (derby)" };

  const jokeritGame = events.find((e) => e.name === "SaiPa - Jokerit" && e.start.startsWith("2026-11-28"));
  overrides[toDashId(jokeritGame.id)] = { note: "Ottelu saattaa siirtyä TV-aikataulun vuoksi." };

  const kalpaGame = events.find((e) => e.name === "SaiPa - KalPa" && e.start.startsWith("2027-01-05"));
  overrides[toDashId(kalpaGame.id)] = { hidden: true };

  // --- Synthetic playoffs games (not in schedule.json — playoffs aren't pre-scheduled) ---
  addEvent({
    id: "90:037",
    name: "SaiPa - Tappara",
    gameType: "playoffs",
    season: "2026-27",
    dateStr: "2027-04-05",
    status: "upcoming",
    firstSeenDaysBefore: 10,
    popularity: 0.4,
    historyPoints: 5,
  });
  autoclass["90-037"] = { gameType: "playoffs", season: "2026-27" };

  addEvent({
    id: "90:038",
    name: "SaiPa - Ilves",
    gameType: "playoffs",
    season: "2026-27",
    dateStr: "2027-04-08",
    status: "upcoming",
    firstSeenDaysBefore: 7,
    popularity: 0.25,
    historyPoints: 4,
  });
  autoclass["90-038"] = { gameType: "playoffs", season: "2026-27" };

  // --- Synthetic next-season games (season 2027-28), so the season selector + "kaikki" + badges have real data to show ---
  addEvent({
    id: "90:039",
    name: "SaiPa - HIFK",
    gameType: "runkosarja",
    season: "2027-28",
    dateStr: "2027-09-05",
    status: "upcoming",
    firstSeenDaysBefore: 30,
    popularity: 0.08,
    historyPoints: 3,
  });
  autoclass["90-039"] = { gameType: "runkosarja", season: "2027-28" };

  addEvent({
    id: "90:040",
    name: "SaiPa - Frölunda",
    gameType: "chl",
    season: "2027-28",
    dateStr: "2027-09-16",
    status: "upcoming",
    firstSeenDaysBefore: 25,
    popularity: 0.05,
    historyPoints: 2,
  });
  autoclass["90-040"] = { gameType: "chl", season: "2027-28" };

  addEvent({
    id: "90:041",
    name: "SaiPa - Jukurit",
    gameType: "harjoitusottelu",
    season: "2027-28",
    dateStr: "2027-08-20",
    status: "upcoming",
    firstSeenDaysBefore: 15,
    popularity: 0.03,
    historyPoints: 2,
  });
  autoclass["90-041"] = { gameType: "harjoitusottelu", season: "2027-28" };

  // --- One deliberately unclassified event: no override, no autoclass entry.
  // Exercises the "muu" default -> "(luokittelematon)" label under Runkosarja.
  addEvent({
    id: "90:042",
    name: "SaiPa - Yllätysvastustaja",
    gameType: "muu",
    season: null,
    dateStr: "2026-12-15",
    status: "upcoming",
    firstSeenDaysBefore: 5,
    popularity: 0.2,
    historyPoints: 3,
  });
  // Intentionally: no overrides["90-042"], no autoclass["90-042"].

  // --- Write everything out ---
  await mkdir(mockDir, { recursive: true });
  await writeFile(path.join(mockDir, "events.json"), JSON.stringify(events, null, 2) + "\n");
  await writeFile(path.join(mockDir, "overrides.json"), JSON.stringify(overrides, null, 2) + "\n");
  await writeFile(path.join(mockDir, "autoclass.json"), JSON.stringify(autoclass, null, 2) + "\n");

  for (const event of events) {
    const dir = path.join(mockDir, "events", toDashId(event.id));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "latest.json"), JSON.stringify(latestById.get(event.id), null, 2) + "\n");
    await writeFile(path.join(dir, "history.json"), JSON.stringify(historyById.get(event.id), null, 2) + "\n");
  }

  console.log(`Generated ${events.length} mock events under ${path.relative(repoRoot, mockDir)}/`);
}

main();
