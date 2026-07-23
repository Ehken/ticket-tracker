import { irtolippuFillPct, irtolippuSections, baselineForEvent } from "./dashboardBaseline.js";
import { extractOpponentDisplay } from "./grouping.js";

export const PREMIUM_SECTIONS = ["C4", "C5", "C1", "C3"];
export const NEARLY_SOLD_OUT_THRESHOLD = 0.9;
export const KIIREHDI_FILL_THRESHOLD = 0.7;

function computeGameIrtolippu(event, baselineIndex) {
  const baseline = baselineForEvent(event, baselineIndex);
  const totals = event.latest.totals;
  const fillPct = irtolippuFillPct(totals.sold, totals.total, baseline.totalSold);
  const sections = irtolippuSections(event.latest.sections, baseline.sections);
  return { fillPct, sections, irtoliput: Math.max(0, totals.sold - baseline.totalSold) };
}

export function computeKiirehdiRanking(matchEvents, baselineIndex) {
  const rows = [];

  for (const event of matchEvents) {
    const { fillPct, sections } = computeGameIrtolippu(event, baselineIndex);
    const premiumTriggers = sections.filter(
      (s) =>
        PREMIUM_SECTIONS.includes(s.section) &&
        s.irtolippuFillPct !== null &&
        s.irtolippuFillPct >= NEARLY_SOLD_OUT_THRESHOLD
    );
    const qualifies = (fillPct !== null && fillPct >= KIIREHDI_FILL_THRESHOLD) || premiumTriggers.length > 0;

    if (qualifies) {
      rows.push({ event, irtolippuFillPct: fillPct, premiumTriggers: premiumTriggers.map((s) => s.section) });
    }
  }

  rows.sort((a, b) => (b.irtolippuFillPct ?? 0) - (a.irtolippuFillPct ?? 0));
  return rows;
}

export function computeOpponentDemand(matchEvents, baselineIndex) {
  const byOpponent = new Map();

  for (const event of matchEvents) {
    const opponent = extractOpponentDisplay(event.name);
    if (!opponent) continue;

    const { fillPct, irtoliput } = computeGameIrtolippu(event, baselineIndex);

    if (!byOpponent.has(opponent)) {
      byOpponent.set(opponent, { opponent, games: [], gameTypes: new Set() });
    }
    const entry = byOpponent.get(opponent);
    entry.games.push({ event, irtolippuFillPct: fillPct, irtoliput });
    entry.gameTypes.add(event.gameType);
  }

  const result = [...byOpponent.values()].map((entry) => {
    const validFillPcts = entry.games.map((g) => g.irtolippuFillPct).filter((v) => v !== null);
    const avgIrtolippuFillPct =
      validFillPcts.length > 0 ? validFillPcts.reduce((a, b) => a + b, 0) / validFillPcts.length : null;
    const totalIrtoliput = entry.games.reduce((sum, g) => sum + g.irtoliput, 0);

    return {
      opponent: entry.opponent,
      avgIrtolippuFillPct,
      totalIrtoliput,
      gameCount: entry.games.length,
      gameTypes: [...entry.gameTypes],
      games: entry.games,
    };
  });

  result.sort((a, b) => (b.avgIrtolippuFillPct ?? -1) - (a.avgIrtolippuFillPct ?? -1));
  return result;
}

export function computeOpponentTiers(opponentDemand) {
  const sorted = [...opponentDemand].sort((a, b) => (b.avgIrtolippuFillPct ?? -1) - (a.avgIrtolippuFillPct ?? -1));
  const bigCount = Math.max(1, Math.ceil(sorted.length / 3));
  return sorted.map((entry, index) => ({ ...entry, tier: index < bigCount ? "big" : "small" }));
}

export function computeSectionSelloutRank(matchEvents, baselineIndex) {
  if (matchEvents.length < 2) return null; // "rank across games" needs >=2 games

  const bySection = new Map();

  for (const event of matchEvents) {
    const baseline = baselineForEvent(event, baselineIndex);
    const sections = irtolippuSections(event.latest.sections, baseline.sections);
    for (const row of sections) {
      if (row.irtolippuFillPct === null) continue;
      if (!bySection.has(row.section)) bySection.set(row.section, []);
      bySection.get(row.section).push(row.irtolippuFillPct);
    }
  }

  const result = [...bySection.entries()].map(([section, values]) => ({
    section,
    avgIrtolippuFillPct: values.reduce((a, b) => a + b, 0) / values.length,
    gameCount: values.length,
  }));

  result.sort((a, b) => b.avgIrtolippuFillPct - a.avgIrtolippuFillPct);
  return result;
}
