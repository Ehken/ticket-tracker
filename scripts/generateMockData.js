// Generates a rich, realistic-looking fake dataset under data/mock/ for
// frontend design/testing work (loaded only via ?mock=1). Never touches
// data/ (production). Deterministic (seeded PRNG) so re-running this after
// editing it reproduces the same output unless the generation logic itself
// changed — run with: node scripts/generateMockData.js
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { parseSeatmapSeatIds } from "./lib/seatmap.js";

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

// Shared "as of" reference instants, one per season — each season's own
// kausikortti event is generated as of this same moment, and every match
// event within that season shares it too (when the guard below allows it),
// so a single dashboard render has a coherent "today" to compute 24h/7d
// deltas and sellout velocity against, instead of every event carrying its
// own disconnected "now".
const SEASON_2026_27_NOW = "2026-10-25T12:00:00.000Z";
const SEASON_2027_28_NOW = "2027-08-10T12:00:00.000Z";

// Real map.prices shape from the live shop (product catalog + prices are
// effectively static across events) — reused verbatim for every mock event.
const MOCK_PRICES = {
  priceGroups: {
    seisomakatsomo: "8",
    D1: "7",
    C1: "6",
    D2: "7",
    C2: "5",
    A1: "7",
    C3: "5",
    A2: "6",
    C4: "5",
    A3: "5",
    C5: "5",
    A4: "5",
    C6: "5",
    A5: "6",
    C7: "6",
    A6: "10",
    C8: "6",
    invalid: "9",
  },
  productPrices: {
    "5": { "955": 1026 },
    "6": { "956": 852 },
    "7": { "956": 852, "957": 577 },
    "8": { "959": 405, "960": 179 },
    "9": { "961": 405, "1195": 179 },
    "10": { "956": 852, "958": 577 },
  },
  products: {
    "955": { id: "955", name: "Kategoria 1", vat: 13.5, bundle: false, type: "ticket", group: "Verkkomyyntipiste" },
    "956": { id: "956", name: "Kategoria 2", vat: 13.5, bundle: false, type: "ticket", group: "Verkkomyyntipiste" },
    "957": {
      id: "957",
      name: "Eläk., Opiskelija, Lapsi 7-15v",
      vat: 13.5,
      bundle: false,
      type: "ticket",
      group: "Verkkomyyntipiste",
    },
    "958": {
      id: "958",
      name: "Saimaan keltamustat RY jäsen",
      vat: 13.5,
      bundle: false,
      type: "ticket",
      group: "Verkkomyyntipiste",
    },
    "959": { id: "959", name: "Seisomakatsomo", vat: 13.5, bundle: false, type: "ticket", group: "Verkkomyyntipiste" },
    "960": {
      id: "960",
      name: "Junnukatsomo 7-18v",
      vat: 13.5,
      bundle: false,
      type: "ticket",
      group: "Verkkomyyntipiste",
    },
    "961": {
      id: "961",
      name: "Pyörätuoli",
      description: "Saattaja samalla lipulla",
      vat: 13.5,
      bundle: false,
      type: "ticket",
      group: "Verkkomyyntipiste",
    },
    "1195": {
      id: "1195",
      name: "Pyörätuoli Lapset",
      vat: 13.5,
      bundle: false,
      type: "ticket",
      group: "Verkkomyyntipiste",
    },
  },
};

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

// Season-ticket holders occupy specific seats for every game that season, so
// a match event's sold count is baselineSold + some fraction of the
// remaining ("irtolippu") capacity — never an independent fraction of the
// section's raw total, or most mock games would show zero irtolippu demand
// once the dashboard subtracts the baseline back out.
function soldWithBaseline(rng, popularity, total, baselineSold, spread, fixedFraction) {
  const nonBaselineCapacity = Math.max(0, total - baselineSold);
  const fraction = fixedFraction ?? clamp(popularity + (rng() - 0.5) * spread, 0.02, 0.99);
  return baselineSold + Math.round(nonBaselineCapacity * fraction);
}

function buildSections(rng, popularity, disabledSections, baselineBySection, sectionFractionOverrides = {}) {
  const baseline = baselineBySection ?? new Map();
  const sections = [];

  for (const [section, total] of Object.entries(SEATED_CAPACITIES)) {
    const disabled = disabledSections.includes(section);
    const sold = soldWithBaseline(
      rng,
      popularity,
      total,
      baseline.get(section) ?? 0,
      0.35,
      sectionFractionOverrides[section]
    );
    sections.push({
      section,
      sold,
      available: disabled ? 0 : total - sold,
      hold: disabled ? total - sold : 0,
      total,
      disabled,
    });
  }

  const standingSold = soldWithBaseline(rng, popularity, STANDING_CAPACITY, baseline.get("seisomakatsomo") ?? 0, 0.3);
  sections.push({
    section: "seisomakatsomo",
    sold: standingSold,
    available: STANDING_CAPACITY - standingSold,
    hold: 0,
    total: STANDING_CAPACITY,
  });

  const wheelchairSold = soldWithBaseline(rng, popularity, WHEELCHAIR_CAPACITY, baseline.get("invalid") ?? 0, 0.3);
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

function buildHistory(rng, { finalSold, finalStanding, firstSeenIso, lastPointIso, pointCount, pinRecentToFinal = false }) {
  const startTime = new Date(firstSeenIso).getTime();
  const endTime = new Date(lastPointIso).getTime();
  const spanDays = (endTime - startTime) / 86400000;

  const progresses = [];
  for (let i = 0; i < pointCount; i++) progresses.push(i / (pointCount - 1));

  // Splice in denser points close to "now" (the tracked window's end) so
  // 24h/7d deltas have real data to compute on — only for events with
  // enough tracked history for these offsets to fall inside their range.
  const recentProgressSet = new Set();
  if (spanDays >= 7) {
    for (const offsetDays of [7, 3, 1, 0.25]) {
      const progress = 1 - offsetDays / spanDays;
      if (progress > 0 && progress < 1) {
        progresses.push(progress);
        recentProgressSet.add(progress);
      }
    }
  }

  const uniqueSortedProgresses = [...new Set(progresses)].sort((a, b) => a - b);
  uniqueSortedProgresses[uniqueSortedProgresses.length - 1] = 1; // guarantee an exact final point

  const points = [];
  let prevSold = 0;
  for (let i = 0; i < uniqueSortedProgresses.length; i++) {
    const progress = uniqueSortedProgresses[i];
    const t = startTime + (endTime - startTime) * progress;
    const isLast = i === uniqueSortedProgresses.length - 1;

    let sold;
    if (pinRecentToFinal && (recentProgressSet.has(progress) || isLast)) {
      // Sales have plateaued over the recent window — a deliberately "flat"
      // mock game, so top-movers/sellout-estimate have a real zero-velocity
      // case to exclude, not just synthetic unit-test fixtures.
      sold = finalSold;
    } else {
      sold = clamp(Math.round(finalSold * progress * (0.85 + rng() * 0.3)), prevSold, finalSold);
    }
    if (isLast) sold = finalSold;
    prevSold = Math.max(prevSold, sold);

    const standingShare = finalSold > 0 ? finalStanding / finalSold : 0;
    const soldStanding = Math.round(sold * standingShare);
    points.push({ t: new Date(t).toISOString(), sold, soldSeated: sold - soldStanding, soldStanding });
  }

  // Same "only append when sold changed" rule as production's real history.json.
  return points.filter((p, i) => i === 0 || p.sold !== points[i - 1].sold);
}

// Deterministic seeded pick of `count` items from `pool`, sorted in the
// output for stable diffs. Uses the event's own rng, so re-running the
// generator with unchanged inputs reproduces the same seat assignments.
export function pickSeats(rng, pool, count) {
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count).sort();
}

// A match event's seat set must be a SUPERSET of its season's kausikortti
// seat set, per section — season-ticket holders sit in the same seats every
// game. `baselineSeatsBySection` is null/undefined for kausikortti events
// themselves (they define the baseline rather than build on one).
export function assignSeatIds(rng, seatPoolBySection, sections, baselineSeatsBySection) {
  const bySection = {};

  for (const row of sections) {
    const pool = seatPoolBySection[row.section];
    if (!pool) continue; // aggregate row (seisomakatsomo/invalid/press/aitiot) — no individual seat IDs

    const baselineIds = baselineSeatsBySection?.[row.section] ?? [];
    const baselineSet = new Set(baselineIds);
    const additionalPool = pool.filter((id) => !baselineSet.has(id));
    const additionalCount = Math.max(0, row.sold - baselineIds.length);

    bySection[row.section] = [...baselineIds, ...pickSeats(rng, additionalPool, additionalCount)];
  }

  return bySection;
}

async function main() {
  const schedule = JSON.parse(await readFile(path.join(repoRoot, "data", "schedule.json"), "utf8"));

  // Real, currently-active kausikortti event's seatmap — its actual seat IDs
  // (e.g. "A1-1-001") are reused for every mock event's seats.json, so mock
  // seat IDs look like the real arena rather than synthetic placeholders.
  const realLatest = JSON.parse(
    await readFile(path.join(repoRoot, "data", "events", "53-575", "latest.json"), "utf8")
  );
  const realSvg = await readFile(
    path.join(repoRoot, "data", "capacities", `${realLatest.capacitiesHash}.svg`),
    "utf8"
  );
  const seatPoolBySection = parseSeatmapSeatIds(realSvg);

  const events = [];
  const latestById = new Map();
  const historyById = new Map();
  const seatsById = new Map();
  const overrides = {};
  const autoclass = {};
  const baselineBySeason = new Map();
  const baselineSeatsBySeason = new Map();

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
    nowIso, // shared per-season "as of" instant (SEASON_2026_27_NOW etc.) — ignored if the event hasn't gone on sale yet as of that instant
    popularity,
    disabledSections = [],
    historyPoints = 10,
    sectionFractionOverrides,
    pinRecentToFinal,
  }) {
    const startIso = helsinkiLocalToUtcIso(dateStr, hour, minute);
    const stopIso = stopIsoOverride ?? new Date(new Date(startIso).getTime() + durationHours * 3600 * 1000).toISOString();
    const firstSeenIso = new Date(new Date(startIso).getTime() - firstSeenDaysBefore * 86400 * 1000).toISOString();

    let lastPointIso;
    if (status === "past") {
      lastPointIso = new Date(new Date(stopIso).getTime() + 3600 * 1000).toISOString();
    } else if (nowIso && new Date(nowIso).getTime() > new Date(firstSeenIso).getTime()) {
      lastPointIso = nowIso;
    } else {
      lastPointIso = nowIso ?? startIso;
    }

    const rng = makeRng(id);
    const baselineBySection = gameType === "kausikortti" ? null : baselineBySeason.get(season);
    const sections = buildSections(rng, popularity, disabledSections, baselineBySection, sectionFractionOverrides);
    const totals = computeTotals(sections);

    const baselineSeatsBySection = gameType === "kausikortti" ? null : baselineSeatsBySeason.get(season);
    const seatsBySection = assignSeatIds(rng, seatPoolBySection, sections, baselineSeatsBySection);
    const soldSeatIds = Object.values(seatsBySection).flat().sort();

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
      prices: MOCK_PRICES,
    });

    seatsById.set(id, {
      fetchedAt: lastPointIso,
      svgHash: "mock-fixture",
      soldSeatIds,
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
        pinRecentToFinal,
      })
    );

    if (gameType === "kausikortti") {
      const sectionBaseline = new Map(sections.map((s) => [s.section, s.sold]));
      baselineBySeason.set(season, sectionBaseline);
      baselineSeatsBySeason.set(season, seatsBySection);
    }

    return { gameType, season };
  }

  // --- Kausikortit: one per season, each its own strip. Tests the multi-strip
  // "newest season first" ordering, an archived (past) strip's frozen data,
  // and the season selector picking up a 3rd season. Also: the season each
  // kausikortti is generated "as of" (nowIso) becomes that season's shared
  // baseline AND the shared "now" reference for its match events below.
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
    nowIso: SEASON_2026_27_NOW, // sales opened 07-31; "now" is ~3 months into the season
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
    nowIso: SEASON_2027_28_NOW, // sales just opened
    popularity: 0.08,
    historyPoints: 3,
  });
  overrides["90-901"] = { gameType: "kausikortti", season: "2027-28" };

  // --- All 36 real schedule.json fixtures become mock games (id range 90:001-90:036) ---
  const PAST_OPPONENTS_BY_ORDER = 4; // first 4 fixtures (chronologically earliest) are archived
  const START_TIMES = [
    [17, 0],
    [18, 30],
    [19, 30],
  ];
  // Two hand-picked games (both close enough to SEASON_2026_27_NOW to carry
  // dense recent history) exercise scenarios the generic popularity formula
  // wouldn't reliably reach on its own.
  const NEAR_SELLOUT_INDEX = 8; // 2026-10-08 vs JYP
  const FLAT_VELOCITY_INDEX = 14; // 2026-11-13 vs Ilves

  schedule.forEach((fixture, index) => {
    const num = String(index + 1).padStart(3, "0");
    const id = `90:${num}`;
    const isPast = index < PAST_OPPONENTS_BY_ORDER;
    const [hour, minute] = START_TIMES[index % START_TIMES.length];
    const disabledSections = !isPast && index % 6 === 0 ? ["C7", "C2"] : [];

    let popularity = isPast ? 0.85 + (index % 3) * 0.05 : 0.15 + ((index * 37) % 60) / 100;
    let sectionFractionOverrides;
    let pinRecentToFinal;

    if (index === NEAR_SELLOUT_INDEX) {
      popularity = 0.9; // overall irtolippu fill % well above the Kiirehdi threshold
      sectionFractionOverrides = { C4: 0.97 }; // premium section individually near sold out
    } else if (index === FLAT_VELOCITY_INDEX) {
      pinRecentToFinal = true; // sales have plateaued — a real zero-velocity case
    }

    addEvent({
      id,
      name: `SaiPa - ${fixture.opponent}`,
      gameType: fixture.gameType,
      season: fixture.season,
      dateStr: fixture.date,
      hour,
      minute,
      status: isPast ? "past" : "upcoming",
      nowIso: isPast ? undefined : SEASON_2026_27_NOW,
      popularity,
      disabledSections,
      historyPoints: isPast ? 12 : 8,
      sectionFractionOverrides,
      pinRecentToFinal,
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
    nowIso: SEASON_2027_28_NOW,
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
    nowIso: SEASON_2027_28_NOW,
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
    nowIso: SEASON_2027_28_NOW,
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
    await writeFile(path.join(dir, "seats.json"), JSON.stringify(seatsById.get(event.id), null, 2) + "\n");
  }

  console.log(`Generated ${events.length} mock events under ${path.relative(repoRoot, mockDir)}/`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
