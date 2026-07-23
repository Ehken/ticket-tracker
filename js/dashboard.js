// Private preview: ?dashboard=1 (see js/urlState.js's IS_DASHBOARD). Not
// unit-tested (DOM assembly, same convention as app.js/card.js/filterBar.js)
// — verified via the browser instead.
import { getHistory } from "./fetchData.js";
import { filterBySeason, gameTypeLabel } from "./grouping.js";
import { buildBaselineIndex, baselineForEvent, seasonForEvent } from "./dashboardBaseline.js";
import { computeTopMovers, computeSelloutEstimate } from "./dashboardTrends.js";
import {
  computeKiirehdiRanking,
  computeOpponentDemand,
  computeOpponentTiers,
  computeSectionSelloutRank,
  PREMIUM_SECTIONS,
} from "./dashboardRankings.js";
import {
  computeWeekdayFillRates,
  computeWeekdayStartTimeGrid,
  computeWeekdayTierGrid,
  computeMonthTrend,
  computePurchaseTimingProfile,
} from "./dashboardTiming.js";
import { buildSparkline } from "./chart.js";
import { formatThousands, formatHelsinkiDate } from "./format.js";

function formatFraction(frac) {
  if (frac === null || frac === undefined) return "–";
  return `${Math.round(frac * 100)} %`;
}

function formatDelta(n) {
  if (n === null || n === undefined) return "–";
  return n > 0 ? `+${formatThousands(n)}` : formatThousands(n);
}

function buildPanel(title) {
  const panel = document.createElement("section");
  panel.className = "dashboard-panel";
  const heading = document.createElement("h2");
  heading.textContent = title;
  panel.append(heading);
  return panel;
}

function buildPlaceholder(text = "Kertyy dataa…") {
  const p = document.createElement("p");
  p.className = "empty-state";
  p.textContent = text;
  return p;
}

function buildMetric(label, value) {
  const wrapper = document.createElement("div");
  wrapper.className = "dashboard-metric";
  const labelEl = document.createElement("div");
  labelEl.className = "dashboard-metric__label";
  labelEl.textContent = label;
  const valueEl = document.createElement("div");
  valueEl.className = "dashboard-metric__value";
  valueEl.textContent = value;
  wrapper.append(labelEl, valueEl);
  return wrapper;
}

function buildRankRow({ label, value, tags = [], sparklinePoints }) {
  const row = document.createElement("div");
  row.className = "rank-row";

  const labelEl = document.createElement("span");
  labelEl.className = "rank-row__label";
  labelEl.textContent = label;
  row.append(labelEl);

  for (const tag of tags) {
    const tagEl = document.createElement("span");
    tagEl.className = "rank-row__tag";
    tagEl.textContent = tag;
    row.append(tagEl);
  }

  if (sparklinePoints) {
    const wrapper = document.createElement("div");
    wrapper.className = "sparkline-wrapper";
    const canvas = document.createElement("canvas");
    wrapper.append(canvas);
    row.append(wrapper);
    buildSparkline(canvas, sparklinePoints);
  }

  const valueEl = document.createElement("span");
  valueEl.className = "rank-row__value";
  valueEl.textContent = value;
  row.append(valueEl);

  return row;
}

function buildTimingSubsection(title, rows, rowBuilder) {
  const sub = document.createElement("div");
  sub.className = "dashboard-subsection";
  const heading = document.createElement("h3");
  heading.textContent = title;
  sub.append(heading);
  if (!rows || rows.length === 0) {
    sub.append(buildPlaceholder());
  } else {
    for (const row of rows) sub.append(rowBuilder(row));
  }
  return sub;
}

function buildSection1(kausikorttiInScope, matchInScope, baselineIndex) {
  const panel = buildPanel("Kauden kokonaiskuva");

  const kausikorttiSold = kausikorttiInScope.reduce((sum, e) => sum + e.latest.totals.sold, 0);

  let irtolippuSold = 0;
  let nonBaselineCapacity = 0;
  for (const event of matchInScope) {
    const baseline = baselineForEvent(event, baselineIndex);
    irtolippuSold += Math.max(0, event.latest.totals.sold - baseline.totalSold);
    nonBaselineCapacity += Math.max(0, event.latest.totals.total - baseline.totalSold);
  }
  const overallFillPct = nonBaselineCapacity > 0 ? irtolippuSold / nonBaselineCapacity : null;

  const metrics = document.createElement("div");
  metrics.className = "dashboard-metric-row";
  metrics.append(
    buildMetric("Kausikortit myyty", formatThousands(kausikorttiSold)),
    buildMetric("Irtoliput myyty", formatThousands(irtolippuSold)),
    buildMetric("Irtolippujen täyttöaste", formatFraction(overallFillPct))
  );
  panel.append(metrics);

  if (matchInScope.length === 0) {
    panel.append(buildPlaceholder("Ei otteluita tällä kaudella vielä."));
  }

  return panel;
}

function buildSection2(matchInScope, nowIso) {
  const panel = buildPanel("Trendaa nyt");

  if (matchInScope.length === 0) {
    panel.append(buildPlaceholder());
    return panel;
  }

  const movers24h = computeTopMovers(matchInScope, 24, nowIso).slice(0, 5);
  const movers7d = computeTopMovers(matchInScope, 24 * 7, nowIso).slice(0, 5);

  panel.append(
    buildTimingSubsection("Viimeiset 24 tuntia", movers24h, ({ event, delta }) =>
      buildRankRow({ label: event.name, value: formatDelta(delta), sparklinePoints: event.history })
    )
  );
  panel.append(
    buildTimingSubsection("Viimeiset 7 vuorokautta", movers7d, ({ event, delta }) =>
      buildRankRow({ label: event.name, value: formatDelta(delta), sparklinePoints: event.history })
    )
  );

  return panel;
}

function buildSection3(matchInScope, baselineIndex, nowIso) {
  const panel = buildPanel("Kiirehdi");
  const ranking = computeKiirehdiRanking(matchInScope, baselineIndex);

  if (ranking.length === 0) {
    panel.append(buildPlaceholder(matchInScope.length === 0 ? undefined : "Ei kiireellisiä otteluita juuri nyt."));
    return panel;
  }

  for (const { event, irtolippuFillPct: fillPct, premiumTriggers } of ranking.slice(0, 8)) {
    const tags = premiumTriggers.map((section) => `${section} lähes loppu`);
    const estimate = computeSelloutEstimate({
      available: event.latest.totals.available,
      historyPoints: event.history,
      latestSold: event.latest.totals.sold,
      nowIso,
    });
    let value = formatFraction(fillPct);
    if (estimate) {
      value += ` · nykyisellä varannolla ja vauhdilla myyty ~${formatHelsinkiDate(estimate.estimatedDate)} (arvio)`;
    }
    panel.append(buildRankRow({ label: event.name, value, tags }));
  }

  return panel;
}

function buildSection4(opponentDemand) {
  const panel = buildPanel("Vastustajat");

  if (opponentDemand.length === 0) {
    panel.append(buildPlaceholder());
    return panel;
  }

  for (const entry of opponentDemand.slice(0, 10)) {
    panel.append(
      buildRankRow({
        label: `${entry.opponent} (${entry.gameCount})`,
        value: formatFraction(entry.avgIrtolippuFillPct),
        tags: entry.gameTypes.map((gt) => gameTypeLabel(gt)),
      })
    );
  }

  return panel;
}

function buildSection5(matchInScope, baselineIndex, opponentDemand) {
  const panel = buildPanel("Viikonpäivät ja ajankohdat");

  const weekdayFill = computeWeekdayFillRates(matchInScope, baselineIndex);
  panel.append(
    buildTimingSubsection("Täyttöaste viikonpäivittäin", weekdayFill, (row) =>
      buildRankRow({ label: row.label, value: formatFraction(row.avgIrtolippuFillPct) })
    )
  );

  const startTimeGrid = computeWeekdayStartTimeGrid(matchInScope, baselineIndex);
  panel.append(
    buildTimingSubsection("Viikonpäivä × alkamisaika", startTimeGrid, (cell) =>
      buildRankRow({ label: `${cell.weekdayLabel} ${cell.time}`, value: formatFraction(cell.avgIrtolippuFillPct) })
    )
  );

  const tiers = computeOpponentTiers(opponentDemand);
  const tierGrid = computeWeekdayTierGrid(matchInScope, baselineIndex, tiers);
  const tierSub = document.createElement("div");
  tierSub.className = "dashboard-subsection";
  const tierHeading = document.createElement("h3");
  tierHeading.textContent = "Viikonpäivä × vastustajan suosio";
  tierSub.append(tierHeading);
  if (!tierGrid) {
    tierSub.append(
      buildPlaceholder(
        "Kertyy dataa — tarvitaan useampi ottelu sekä isoilta että pienemmiltä vastustajilta, eri viikonpäiviltä, jotta viikonpäivän ja vastustajan vaikutukset voidaan erottaa toisistaan."
      )
    );
  } else {
    const bigLabel = document.createElement("p");
    bigLabel.className = "dashboard-tier-label";
    bigLabel.textContent = "Isot vastustajat";
    tierSub.append(bigLabel);
    for (const row of tierGrid.big) {
      tierSub.append(buildRankRow({ label: row.label, value: formatFraction(row.avgIrtolippuFillPct) }));
    }

    const smallLabel = document.createElement("p");
    smallLabel.className = "dashboard-tier-label";
    smallLabel.textContent = "Pienemmät vastustajat";
    tierSub.append(smallLabel);
    for (const row of tierGrid.small) {
      tierSub.append(buildRankRow({ label: row.label, value: formatFraction(row.avgIrtolippuFillPct) }));
    }
  }
  panel.append(tierSub);

  const monthTrend = computeMonthTrend(matchInScope, baselineIndex);
  panel.append(
    buildTimingSubsection("Kuukausitrendi", monthTrend, (row) =>
      buildRankRow({ label: row.key, value: formatFraction(row.avgIrtolippuFillPct) })
    )
  );

  const pastEvents = matchInScope.filter((e) => e.status === "past");
  const purchaseTiming = computePurchaseTimingProfile(pastEvents);
  panel.append(
    buildTimingSubsection("Ostoajankohta (osuus myynnistä viim. 3 vrk aikana)", purchaseTiming, (row) =>
      buildRankRow({ label: row.label, value: formatFraction(row.avgPctInFinalThreeDays) })
    )
  );

  return panel;
}

function buildSection6(matchInScope, baselineIndex) {
  const panel = buildPanel("Katsomot");
  const rank = computeSectionSelloutRank(matchInScope, baselineIndex);

  if (!rank) {
    panel.append(buildPlaceholder());
    return panel;
  }

  for (const row of rank) {
    const tags = PREMIUM_SECTIONS.includes(row.section) ? ["premium"] : [];
    panel.append(buildRankRow({ label: row.section, value: formatFraction(row.avgIrtolippuFillPct), tags }));
  }

  return panel;
}

export async function renderDashboard({ kausikortti, matchEvents, kausi }) {
  const container = document.getElementById("dashboard-container");
  container.hidden = false;
  container.replaceChildren();

  const backLink = document.createElement("a");
  backLink.className = "dashboard-back-link";
  backLink.textContent = "← Takaisin";
  const backUrl = new URL(window.location.href);
  backUrl.searchParams.delete("dashboard");
  backLink.href = `${backUrl.pathname}${backUrl.search}`;
  container.append(backLink);

  // Work on copies — the dashboard attaches its own `.history` and resolves
  // its own effective `.season`, and must never mutate the objects the
  // normal (non-dashboard) view holds onto.
  const kausikorttiInScope = filterBySeason(kausikortti, kausi).map((e) => ({ ...e }));
  const matchInScope = filterBySeason(matchEvents, kausi).map((e) => ({
    ...e,
    season: seasonForEvent(e, kausikortti),
  }));

  await Promise.all(
    [...kausikorttiInScope, ...matchInScope].map(async (event) => {
      try {
        event.history = await getHistory(event.id);
      } catch (err) {
        event.history = [];
        console.error(`Failed to load history for ${event.id}:`, err);
      }
    })
  );

  const baselineIndex = buildBaselineIndex(kausikortti);

  // "Now" for all delta/velocity math is the season's own kausikortti
  // snapshot time — the one deliberately shared reference instant for a
  // season (mirrored by the mock generator). Falling back to match events'
  // own fetchedAt would be unreliable: an upcoming match event's fetchedAt
  // can be its own (arbitrary, possibly far-future) start time rather than
  // a real observation instant, and taking a naive max across all of them
  // risks picking up something like a synthetic playoffs date next season.
  const nowSourceEvents = kausikorttiInScope.length > 0 ? kausikorttiInScope : matchInScope;
  const nowIso =
    nowSourceEvents.length > 0
      ? new Date(Math.max(...nowSourceEvents.map((e) => new Date(e.latest.fetchedAt).getTime()))).toISOString()
      : new Date().toISOString();

  const opponentDemand = computeOpponentDemand(matchInScope, baselineIndex);

  const grid = document.createElement("div");
  grid.className = "dashboard-grid";
  grid.append(
    buildSection1(kausikorttiInScope, matchInScope, baselineIndex),
    buildSection2(matchInScope, nowIso),
    buildSection3(matchInScope, baselineIndex, nowIso),
    buildSection4(opponentDemand),
    buildSection5(matchInScope, baselineIndex, opponentDemand),
    buildSection6(matchInScope, baselineIndex)
  );
  container.append(grid);
}
