// Dashboard (?dashboard=1): hero stat tiles, a season timeline chart, and
// analysis panels — reachable from the front page's header link. Not
// unit-tested (DOM assembly, same convention as app.js/card.js); every
// number on it comes from tested pure modules (dashboardHero, -Forecast,
// -Baseline, -Trends, -Rankings, -Timing, -Heatmap).
import { getHistory, getAttendanceHistory, getCapacitiesSvg } from "./fetchData.js";
import {
  filterBySeason,
  filterBySarja,
  computeSarjaAvailability,
  resolveSarja,
  gameTypeLabel,
  buildTimeline,
  extractOpponentDisplay,
} from "./grouping.js";
import { readUrlState, writeUrlState, FORCE_FORECAST } from "./urlState.js";
import { computeUnclassifiedEvents } from "./dashboardUnclassified.js";
import {
  buildBaselineIndex,
  baselineForEvent,
  seasonForEvent,
} from "./dashboardBaseline.js";
import { computeTopMovers, computeSelloutEstimate } from "./dashboardTrends.js";
import {
  computeIrtoliputTotal,
  computeSold24hDelta,
  computeAvgAttendancePlayed,
  computeAvgAttendanceFloor,
  computeAvgAttendanceForecast,
  computeSelloutStats,
  findNextGame,
} from "./dashboardHero.js";
import {
  computeAttendanceIndices,
  buildPaceCurve,
  forecastGame,
  forecastVisibility,
} from "./dashboardForecast.js";
import { computeKiirehdiRanking, computeOpponentDemand, computeSectionSelloutRank } from "./dashboardRankings.js";
import {
  computeWeekdayAttendance,
  computeMonthAttendance,
  computePurchaseTimingProfile,
} from "./dashboardTiming.js";
import { heatColor } from "./dashboardHeatmap.js";
import { buildSparkline } from "./chart.js";
import { buildStat } from "./card.js";
import { formatThousands, formatPercent, formatHelsinkiDate } from "./format.js";
import { sectionLabel } from "./sectionLabels.js";

const SARJA_CHIP_VALUES = ["kaikki", "runkosarja", "chl", "harjoitusottelu", "playoffs"];

// The dashboard's own default differs from the front page's "kaikki":
// league numbers are the headline; CHL/harjoitus are one click away.
const DEFAULT_SARJA = "runkosarja";

function formatFraction(frac) {
  if (frac === null || frac === undefined) return "–";
  return `${Math.round(frac * 100)} %`;
}

function formatDelta(n) {
  return n > 0 ? `+${formatThousands(n)}` : formatThousands(n);
}

function buildPanel(title, subtitle) {
  const panel = document.createElement("section");
  panel.className = "dashboard-panel";
  const heading = document.createElement("h2");
  heading.textContent = title;
  if (subtitle) {
    const sub = document.createElement("span");
    sub.className = "dashboard-panel__subtitle";
    sub.textContent = ` — ${subtitle}`;
    heading.append(sub);
  }
  panel.append(heading);
  return panel;
}

// One stacked horizontal bar on the site's own sales scale: black
// kausikortti base + yellow irtoliput on a sand track. Everything the
// dashboard ranks uses this same anatomy, so magnitudes stay comparable
// across panels by eye.
function buildRowBar({ label, value, kkFraction, ilFraction, meta }) {
  const row = document.createElement("div");
  row.className = "rowbar";

  const top = document.createElement("div");
  top.className = "rowbar__top";
  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  const valueEl = document.createElement("b");
  valueEl.textContent = value;
  top.append(labelEl, valueEl);

  const track = document.createElement("div");
  track.className = "rowbar__track";
  const kk = document.createElement("span");
  kk.className = "rowbar__kk";
  kk.style.width = `${Math.max(0, Math.min(1, kkFraction)) * 100}%`;
  const il = document.createElement("span");
  il.className = "rowbar__il";
  il.style.width = `${Math.max(0, Math.min(1 - kkFraction, ilFraction)) * 100}%`;
  track.append(kk, il);

  row.append(top, track);
  if (meta) {
    const metaEl = document.createElement("div");
    metaEl.className = "rowbar__meta";
    metaEl.append(meta);
    row.append(metaEl);
  }
  return row;
}

// Ranked panels show the top ROW_LIMIT rows and fold the rest behind a
// toggle — one tall list (15 opponents) otherwise stretches its whole grid
// row and hands every neighbouring panel dead vertical space.
const ROW_LIMIT = 5;

function appendExpandableRows(panel, rows, limit = ROW_LIMIT) {
  for (const row of rows.slice(0, limit)) panel.append(row);
  if (rows.length <= limit) return;

  const rest = document.createElement("div");
  rest.hidden = true;
  for (const row of rows.slice(limit)) rest.append(row);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "dashboard-expand-toggle";
  const collapsedLabel = `Näytä kaikki (${rows.length})`;
  toggle.textContent = collapsedLabel;
  toggle.setAttribute("aria-expanded", "false");
  toggle.addEventListener("click", () => {
    const open = rest.hidden;
    rest.hidden = !open;
    toggle.textContent = open ? "Näytä vähemmän" : collapsedLabel;
    toggle.setAttribute("aria-expanded", String(open));
  });

  panel.append(rest, toggle);
}

function buildTile({ label, value, sub, subClass, tag, info }) {
  const tile = document.createElement("div");
  tile.className = "dashboard-tile";
  const stat = buildStat(label, value, { info });
  tile.append(stat);
  if (sub) {
    const subEl = document.createElement("div");
    subEl.className = `dashboard-tile__sub${subClass ? ` ${subClass}` : ""}`;
    subEl.textContent = sub;
    tile.append(subEl);
  }
  if (tag) {
    const tagEl = document.createElement("span");
    tagEl.className = "dashboard-tile__tag";
    tagEl.textContent = tag.text;
    if (tag.title) {
      tagEl.title = tag.title;
      tagEl.setAttribute("aria-label", tag.title);
    }
    tile.append(tagEl);
  }
  return tile;
}

const ATTENDANCE_INFO =
  "Yleisömäärä tarkoittaa tässä myytyjä lippuja (kausikortit + irtoliput + seisomapaikat), " +
  "ei laskettua yleisöä.";

const FLOOR_INFO =
  "Kaikki ottelut nykyisellä myynnillä: pelatut lopullisin luvuin, tulevat tämänhetkisin. " +
  "Tulevien otteluiden myynti vain kasvaa, joten todellinen keskiarvo on vähintään tämä.";

const FORECAST_INFO =
  "Ennuste perustuu kauden omaan myyntivauhtiin sekä vastustaja- ja viikonpäiväkertoimiin, " +
  "jotka on laskettu aiempien kausien yleisömääristä (liiga.fi). Ennen kuin kaudelta on " +
  "pelattuja otteluita, arvio nojaa pelkkiin historiallisiin kertoimiin. Malli ei näe " +
  "joukkueen menestystä, TV-otteluita eikä säätä.";

function buildHeroTiles(state) {
  const {
    inScope,
    inScopeWithHistory,
    nowIso,
    forecastAvg,
    showForecast,
    baselineIndex,
  } = state;

  const hero = document.createElement("div");
  hero.className = "dashboard-hero";

  const irtoliput = computeIrtoliputTotal(inScope, baselineIndex);
  const delta = computeSold24hDelta(inScopeWithHistory, nowIso);
  hero.append(
    buildTile({
      label: "Irtolippuja myyty",
      value: formatThousands(irtoliput),
      sub: delta === null ? undefined : `${formatDelta(delta)} / 24 h`,
      subClass: delta !== null && delta > 0 ? "dashboard-tile__sub--up" : undefined,
      info:
        "24 h -muutos on nettomuutos kaikista otteluista yhteens\u00e4: uudet myynnit miinus " +
        "vapautuneet paikat (esim. rauenneet varaukset). Trendaa nyt n\u00e4ytt\u00e4\u00e4 yksitt\u00e4isten " +
        "otteluiden suurimmat nousut, joten sen luvut voivat olla t\u00e4t\u00e4 suurempia.",
    })
  );

  const played = computeAvgAttendancePlayed(inScope);
  hero.append(
    buildTile({
      label: "Yleisökeskiarvo · pelatut",
      value: played ? formatThousands(Math.round(played.average)) : "–",
      sub: played ? `${played.gameCount} ottelua` : "ei pelattuja otteluita",
      info: ATTENDANCE_INFO,
    })
  );

  const floor = computeAvgAttendanceFloor(inScope);
  hero.append(
    buildTile({
      label: "Yleisökeskiarvo · nykymyynnillä",
      value: floor ? formatThousands(Math.round(floor.average)) : "–",
      sub: "vähintään",
      info: FLOOR_INFO,
    })
  );

  if (showForecast && forecastAvg) {
    hero.append(
      buildTile({
        label: "Yleisökeskiarvo · ennuste",
        value: formatThousands(Math.round(forecastAvg.average)),
        info: FORECAST_INFO,
      })
    );
  }

  const sellouts = computeSelloutStats(inScope);
  hero.append(
    buildTile({
      label: "Loppuunmyydyt",
      value: `${sellouts.soldOutCount}`,
      sub: `/ ${sellouts.gameCount} ottelua`,
    })
  );

  const next = findNextGame(inScope, nowIso);
  if (next) {
    const totals = next.latest.totals;
    hero.append(
      buildTile({
        label: "Seuraava ottelu",
        value: extractOpponentDisplay(next.name) ?? next.name,
        sub: `${formatHelsinkiDate(next.start)} · myyty ${formatThousands(totals.sold)} · ${formatPercent(totals.sold, totals.total)}`,
      })
    );
  }

  return hero;
}

// One stacked bar per game in date order: black kausikortti base, yellow
// irtoliput, faded when the game is still upcoming (current sales, not an
// outcome), red ring when sold out, and — when the forecast is visible —
// an outlined extension for expected additional sales.
function buildTimelinePanel(state) {
  const { inScope, baselineIndex, forecastByEventId, showForecast } = state;
  if (inScope.length === 0) return null;

  const panel = buildPanel(
    "Yleisömäärä ottelu kerrallaan",
    showForecast ? "tulevat ottelut: nykymyynti + ennustettu lisämyynti" : "tulevat ottelut nykymyynnin mukaan"
  );

  const maxTotal = Math.max(...inScope.map((e) => e.latest.totals.total));
  const chart = document.createElement("div");
  chart.className = "dashboard-timeline";

  const capLine = document.createElement("div");
  capLine.className = "dashboard-timeline__cap";
  const capLabel = document.createElement("span");
  capLabel.textContent = `kapasiteetti ${formatThousands(maxTotal)}`;
  capLine.append(capLabel);
  chart.append(capLine);

  for (const event of buildTimeline(inScope)) {
    const totals = event.latest.totals;
    const baseline = baselineForEvent(event, baselineIndex);
    const kk = Math.min(baseline.totalSold, totals.sold);
    const il = Math.max(0, totals.sold - kk);
    const soldOut = totals.total > 0 && totals.available === 0;
    const isUpcoming = event.status !== "past";

    const bar = document.createElement("div");
    bar.className = `dashboard-timeline__bar${isUpcoming ? " dashboard-timeline__bar--future" : ""}${soldOut ? " dashboard-timeline__bar--soldout" : ""}`;
    let titleText = `${event.name} · ${formatHelsinkiDate(event.start)} · myyty ${formatThousands(totals.sold)} (${formatPercent(totals.sold, totals.total)})`;

    const kkSeg = document.createElement("i");
    kkSeg.className = "dashboard-timeline__kk";
    kkSeg.style.height = `${(kk / maxTotal) * 100}%`;
    const ilSeg = document.createElement("i");
    ilSeg.className = "dashboard-timeline__il";
    ilSeg.style.height = `${(il / maxTotal) * 100}%`;
    bar.append(kkSeg, ilSeg);

    const forecast = showForecast && isUpcoming ? forecastByEventId.get(event.id) : null;
    if (forecast && forecast.attendance > totals.sold) {
      const extra = document.createElement("i");
      extra.className = "dashboard-timeline__forecast";
      extra.style.height = `${((forecast.attendance - totals.sold) / maxTotal) * 100}%`;
      bar.append(extra);
      titleText += ` · ennuste ${formatThousands(forecast.attendance)}`;
    }

    bar.title = titleText;
    chart.append(bar);
  }
  panel.append(chart);

  const legend = document.createElement("div");
  legend.className = "dashboard-timeline__legend";
  const items = [
    ["dashboard-legend-swatch--kk", "Kausikortit"],
    ["dashboard-legend-swatch--il", "Irtoliput"],
    ["dashboard-legend-swatch--future", "Tuleva ottelu (nykymyynti)"],
  ];
  if (showForecast) items.push(["dashboard-legend-swatch--forecast", "Ennustettu lisämyynti"]);
  items.push(["dashboard-legend-swatch--soldout", "Loppuunmyyty"]);
  for (const [cls, label] of items) {
    const item = document.createElement("span");
    const sw = document.createElement("span");
    sw.className = `dashboard-legend-swatch ${cls}`;
    item.append(sw, label);
    legend.append(item);
  }
  panel.append(legend);
  return panel;
}

function buildTrendRow(event, delta) {
  const row = document.createElement("div");
  row.className = "dashboard-trend-row";
  const label = document.createElement("span");
  label.textContent = event.name;
  row.append(label);
  if (event.history?.length > 1) {
    const wrapper = document.createElement("div");
    wrapper.className = "sparkline-wrapper";
    const canvas = document.createElement("canvas");
    wrapper.append(canvas);
    row.append(wrapper);
    buildSparkline(canvas, event.history);
  }
  const value = document.createElement("span");
  value.className = "dashboard-trend-row__value";
  value.textContent = formatDelta(delta);
  row.append(value);
  return row;
}

// Panels return null instead of a "Kertyy dataa…" placeholder — an empty
// analysis earns no screen space (explicit requirement of the redesign).
function buildTrendsPanel(state) {
  const { inScopeWithHistory, nowIso } = state;
  const movers24h = computeTopMovers(inScopeWithHistory, 24, nowIso).slice(0, 5);
  const movers7d = computeTopMovers(inScopeWithHistory, 24 * 7, nowIso).slice(0, 5);
  if (movers24h.length === 0 && movers7d.length === 0) return null;

  const panel = buildPanel("Trendaa nyt");
  if (movers24h.length > 0) {
    const sub = document.createElement("div");
    sub.className = "dashboard-subsection";
    const h = document.createElement("h3");
    h.textContent = "Viimeiset 24 tuntia";
    sub.append(h);
    for (const { event, delta } of movers24h) sub.append(buildTrendRow(event, delta));
    panel.append(sub);
  }
  if (movers7d.length > 0) {
    const sub = document.createElement("div");
    sub.className = "dashboard-subsection";
    const h = document.createElement("h3");
    h.textContent = "Viimeiset 7 vuorokautta";
    sub.append(h);
    for (const { event, delta } of movers7d) sub.append(buildTrendRow(event, delta));
    panel.append(sub);
  }
  return panel;
}

function buildKiirehdiPanel(state) {
  const { inScopeWithHistory, baselineIndex, nowIso } = state;
  const upcoming = inScopeWithHistory.filter((e) => e.status === "upcoming");
  const ranking = computeKiirehdiRanking(upcoming, baselineIndex);
  if (ranking.length === 0) return null;

  const panel = buildPanel("Kiirehdi");
  const rows = [];
  for (const { event, irtolippuFillPct: fillPct, premiumTriggers } of ranking) {
    const totals = event.latest.totals;
    const baseline = baselineForEvent(event, baselineIndex);
    const kk = Math.min(baseline.totalSold, totals.sold);
    const soldOut = totals.available === 0;

    const metaParts = [];
    // The bar draws sold/capacity, so the headline % must be the same
    // quantity — showing the irtolippu-only % next to a visibly fuller bar
    // read as a contradiction. The ranking still runs on irtolippu fill,
    // shown here in the meta line.
    if (fillPct !== null) metaParts.push(`irtolippujen täyttö ${formatFraction(fillPct)}`);
    if (soldOut) metaParts.push("loppuunmyyty");
    for (const section of premiumTriggers) metaParts.push(`${sectionLabel(section)} lähes loppu`);
    const estimate = soldOut
      ? null
      : computeSelloutEstimate({
          available: totals.available,
          historyPoints: event.history,
          latestSold: totals.sold,
          nowIso,
        });

    let meta = metaParts.join(" · ");
    let metaNode = null;
    if (estimate) {
      metaNode = document.createDocumentFragment();
      if (meta) metaNode.append(`${meta} · `);
      const est = document.createElement("span");
      est.className = "dashboard-kiirehdi-estimate";
      est.textContent = `nykyvauhdilla myyty ~${formatHelsinkiDate(estimate.estimatedDate)} (arvio)`;
      metaNode.append(est);
    }

    rows.push(
      buildRowBar({
        label: `${event.name} ${formatHelsinkiDate(event.start)}`,
        value: formatPercent(totals.sold, totals.total),
        kkFraction: kk / totals.total,
        ilFraction: Math.max(0, totals.sold - kk) / totals.total,
        meta: metaNode ?? (meta || null),
      })
    );
  }
  appendExpandableRows(panel, rows);
  return panel;
}

// Top-selling games by total sold tickets — the "which single games are
// hottest" complement to Trendaa nyt's velocity view and Vastustajat's
// per-opponent averages.
function buildTopGamesPanel(state) {
  const { inScope, baselineIndex } = state;
  if (inScope.length === 0) return null;

  const maxTotal = Math.max(...inScope.map((e) => e.latest.totals.total));
  const panel = buildPanel("Myydyimmät ottelut", "myydyt liput yhteensä");

  const rows = [...inScope]
    .sort((a, b) => b.latest.totals.sold - a.latest.totals.sold)
    .map((event) => {
      const totals = event.latest.totals;
      const baseline = baselineForEvent(event, baselineIndex);
      const kk = Math.min(baseline.totalSold, totals.sold);
      const irtoliput = Math.max(0, totals.sold - kk);
      const metaParts = [
        formatHelsinkiDate(event.start),
        `irtolippuja ${formatThousands(irtoliput)}`,
        `täyttö ${formatPercent(totals.sold, totals.total)}`,
      ];
      if (totals.total > 0 && totals.available === 0) metaParts.push("loppuunmyyty");
      return buildRowBar({
        label: event.name,
        value: formatThousands(totals.sold),
        kkFraction: kk / maxTotal,
        ilFraction: irtoliput / maxTotal,
        meta: metaParts.join(" · "),
      });
    });

  appendExpandableRows(panel, rows);
  return panel;
}

function buildOpponentsPanel(state) {
  const { inScope, baselineIndex, sarja } = state;
  const demand = computeOpponentDemand(inScope, baselineIndex);
  if (demand.length === 0) return null;

  const maxTotal = Math.max(...inScope.map((e) => e.latest.totals.total));
  const panel = buildPanel("Vastustajat", "yleisökeskiarvo");

  const rows = demand
    .map((entry) => {
      const attendances = entry.games.map((g) => g.event.latest.totals.sold);
      const avgAttendance = attendances.reduce((a, b) => a + b, 0) / attendances.length;
      const avgKk =
        entry.games.reduce((s, g) => {
          const baseline = baselineForEvent(g.event, baselineIndex);
          return s + Math.min(baseline.totalSold, g.event.latest.totals.sold);
        }, 0) / entry.games.length;
      const avgIrtoliput = entry.games.reduce((s, g) => s + g.irtoliput, 0) / entry.games.length;
      return { entry, avgAttendance, avgKk, avgIrtoliput };
    })
    .sort((a, b) => b.avgAttendance - a.avgAttendance);

  const rowEls = rows.map(({ entry, avgAttendance, avgKk, avgIrtoliput }) => {
    const tags = sarja === "kaikki" ? ` · ${entry.gameTypes.map((gt) => gameTypeLabel(gt)).join(", ")}` : "";
    return buildRowBar({
      label: `${entry.opponent} (${entry.gameCount})`,
      value: formatThousands(Math.round(avgAttendance)),
      kkFraction: avgKk / maxTotal,
      ilFraction: (avgAttendance - avgKk) / maxTotal,
      meta: `irtolippuja ka. ${formatThousands(Math.round(avgIrtoliput))} · täyttö ${formatFraction(entry.avgIrtolippuFillPct)}${tags}`,
    });
  });
  appendExpandableRows(panel, rowEls);
  return panel;
}

// The arena itself as a heatmap: the real capacities SVG with every seat
// recolored by its section's average irtolippu fill, standing/wheelchair
// shapes likewise. No interactivity — this is a picture, the per-event
// seat maps on the front page are the interactive surface.
async function buildHeatmapPanel(state) {
  const { inScope, baselineIndex } = state;
  const rank = computeSectionSelloutRank(inScope, baselineIndex);
  if (!rank) return null;

  const withHash = inScope.find((e) => e.latest.capacitiesHash);
  if (!withHash) return null;

  let svgText;
  try {
    svgText = await getCapacitiesSvg(withHash.latest.capacitiesHash);
  } catch (err) {
    console.error("Failed to load arena SVG for heatmap:", err);
    return null;
  }

  const fillBySection = new Map(rank.map((r) => [r.section, r.avgIrtolippuFillPct]));
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;

  // Color the section PLATES, not the seats: the baked .section shapes
  // carry the shop's own price-group colors (teal/blue/red), which would
  // otherwise bleed through and fight the heat ramp; and at this panel's
  // size individual dots are noise anyway. Sections with no fill data
  // (aitiot, press — excluded from irtolippu math by design) go neutral.
  for (const el of svg.querySelectorAll(".section")) {
    const color = heatColor(fillBySection.get(el.id) ?? null);
    // .section is a <g>: a group-level fill is overridden by any child
    // carrying its own fill attribute (the shop's price-group plates), so
    // the children get recolored explicitly too — text stays readable.
    el.setAttribute("fill", color);
    for (const child of el.querySelectorAll("[fill]")) {
      if (child.tagName !== "text") child.setAttribute("fill", color);
    }
  }
  // The seated sections' visible plates live OUTSIDE the .section groups,
  // as .section-label paths (id "C4-label" etc.) carrying the shop's own
  // price-group colors; the glyph paths next to them have their own black
  // fill and are untouched.
  for (const el of svg.querySelectorAll(".section-label")) {
    const section = el.id?.replace(/-label$/, "");
    if (!section) continue;
    el.setAttribute("fill", heatColor(fillBySection.get(section) ?? null));
  }
  for (const el of svg.querySelectorAll(".seat")) {
    el.remove(); // no inline r -> invisible outside the seat-map CSS scope; drop the ~2600 nodes
  }

  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("class", "dashboard-heatmap-svg");
  svg.style.pointerEvents = "none";

  const panel = buildPanel("Katsomot", "irtolippujen täyttö keskimäärin");
  panel.append(svg);
  const legend = document.createElement("div");
  legend.className = "dashboard-heatmap__legend";
  legend.textContent = "vaalea = vapaata · kirkas keltainen = lähes loppu · oranssi = loppuunmyyty";
  panel.append(legend);

  const top = rank
    .filter((r) => !["press", "aitiot"].includes(r.section))
    .slice(0, 3)
    .map((r) => `${sectionLabel(r.section)} ${formatFraction(r.avgIrtolippuFillPct)}`)
    .join(" · ");
  if (top) {
    const topEl = document.createElement("div");
    topEl.className = "dashboard-heatmap__top";
    topEl.textContent = `Täysimmät: ${top}`;
    panel.append(topEl);
  }
  return panel;
}

function buildTimingPanel(state) {
  const { inScope, inScopeWithHistory, baselineIndex } = state;
  const subs = [];

  // Average attendance, not irtolippu fill%, as the headline (the same
  // scale as Vastustajat): the season-ticket base dominates real arena
  // fullness, so fill%-only rows read as "everything is 0-3%" all season.
  const maxTotal = inScope.length > 0 ? Math.max(...inScope.map((e) => e.latest.totals.total)) : 1;
  const attendanceRow = (row) =>
    buildRowBar({
      label: `${row.label} (${row.gameCount})`,
      value: formatThousands(Math.round(row.avgAttendance)),
      kkFraction: row.avgKk / maxTotal,
      ilFraction: (row.avgAttendance - row.avgKk) / maxTotal,
      meta: `irtolippujen täyttö ${formatFraction(row.avgIrtolippuFillPct)}`,
    });

  const weekdayAttendance = computeWeekdayAttendance(inScope, baselineIndex);
  if (weekdayAttendance?.length > 0) {
    subs.push(["Yleisökeskiarvo viikonpäivittäin", weekdayAttendance.map(attendanceRow)]);
  }

  const monthAttendance = computeMonthAttendance(inScope, baselineIndex);
  if (monthAttendance?.length > 0) {
    subs.push(["Yleisökeskiarvo kuukausittain", monthAttendance.map(attendanceRow)]);
  }

  const pastEvents = inScopeWithHistory.filter((e) => e.status === "past");
  const purchaseTiming = computePurchaseTimingProfile(pastEvents);
  if (purchaseTiming?.length > 0) {
    subs.push([
      "Ostoajankohta (osuus myynnistä viim. 3 vrk aikana)",
      purchaseTiming.map((row) =>
        buildRowBar({
          label: row.label,
          value: formatFraction(row.avgPctInFinalThreeDays),
          kkFraction: 0,
          ilFraction: row.avgPctInFinalThreeDays ?? 0,
          meta: null,
        })
      ),
    ]);
  }

  if (subs.length === 0) return null;
  const panel = buildPanel("Viikonpäivät ja ajankohdat");
  for (const [title, rows] of subs) {
    const sub = document.createElement("div");
    sub.className = "dashboard-subsection";
    const h = document.createElement("h3");
    h.textContent = title;
    sub.append(h);
    for (const row of rows) sub.append(row);
    panel.append(sub);
  }
  return panel;
}

function buildUnclassifiedPanel(allEvents, schedule) {
  const unclassified = computeUnclassifiedEvents(allEvents, schedule);
  if (unclassified.length === 0) return null;

  const panel = buildPanel("Luokittelemattomat");
  for (const { event, sameDateDifferentOpponent, sameOpponentDifferentDate } of unclassified) {
    const row = document.createElement("div");
    row.className = "dashboard-unclassified-row";
    const label = document.createElement("span");
    label.textContent = `${event.name} (${formatHelsinkiDate(event.start)})`;
    const detail = document.createElement("span");
    detail.className = "dashboard-unclassified-row__detail";
    const sameDate = sameDateDifferentOpponent.map((f) => f.opponent).join(", ") || "ei osumia";
    const sameOpp = sameOpponentDifferentDate.map((f) => f.date).join(", ") || "ei osumia";
    detail.textContent = `sama pvm, eri vastustaja: ${sameDate} · sama vastustaja, eri pvm: ${sameOpp}`;
    row.append(label, detail);
    panel.append(row);
  }
  return panel;
}

function buildSarjaChips(availability, active, onSelect) {
  const bar = document.createElement("div");
  bar.className = "dashboard-chips";
  for (const option of availability) {
    if (!SARJA_CHIP_VALUES.includes(option.value)) continue;
    if (!option.hasEvents && option.value !== "kaikki") continue;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `dashboard-chip${option.value === active ? " dashboard-chip--on" : ""}`;
    chip.textContent = option.label;
    chip.addEventListener("click", () => onSelect(option.value));
    bar.append(chip);
  }
  return bar;
}

export async function renderDashboard({ kausikortti, matchEvents, kausi, schedule }) {
  const container = document.getElementById("dashboard-container");
  container.hidden = false;

  // Copies — the dashboard attaches .history and resolves effective
  // .season, and must never mutate the objects the normal view holds onto.
  const kausikorttiInScope = filterBySeason(kausikortti, kausi).map((e) => ({ ...e }));
  const seasonEvents = filterBySeason(matchEvents, kausi).map((e) => ({
    ...e,
    season: seasonForEvent(e, kausikortti),
  }));

  // Fetched once for the whole season scope; the sarja chips re-render from
  // memory without refetching.
  const [attendanceHistory] = await Promise.all([
    getAttendanceHistory().catch(() => null),
    ...[...kausikorttiInScope, ...seasonEvents].map(async (event) => {
      try {
        event.history = await getHistory(event.id);
      } catch (err) {
        event.history = [];
        console.error(`Failed to load history for ${event.id}:`, err);
      }
    }),
  ]);

  const baselineIndex = buildBaselineIndex(kausikortti);

  // "Now" = the season's kausikortti snapshot time (see the mock generator's
  // shared per-season reference instant); match-event fetchedAt values are
  // not reliable observation instants for upcoming events.
  const nowSourceEvents = kausikorttiInScope.length > 0 ? kausikorttiInScope : seasonEvents;
  const nowIso =
    nowSourceEvents.length > 0
      ? new Date(Math.max(...nowSourceEvents.map((e) => new Date(e.latest.fetchedAt).getTime()))).toISOString()
      : new Date().toISOString();

  // Forecast inputs are season-wide (not sarja-filtered): pace behavior is
  // shared across competitions and completed games are scarce.
  const completedGames = seasonEvents
    .filter((e) => e.status === "past")
    .map((e) => ({
      startIso: e.start,
      history: e.history,
      finalSold: e.latest.totals.sold,
      baselineSold: baselineForEvent(e, baselineIndex).totalSold,
    }));
  const paceCurve = buildPaceCurve(completedGames);
  const indices = computeAttendanceIndices(attendanceHistory);
  const completedCount = completedGames.length;
  const visibility = forecastVisibility({
    completedCount,
    hasIndices: indices !== null,
    forceVisible: FORCE_FORECAST,
  });

  const forecastByEventId = new Map();
  if (visibility.show) {
    for (const event of seasonEvents) {
      if (event.status !== "upcoming") continue;
      const forecast = forecastGame(
        {
          name: event.name,
          startIso: event.start,
          currentSold: event.latest.totals.sold,
          capacity: event.latest.totals.total,
          nowIso,
        },
        { paceCurve, indices, completedCount }
      );
      if (forecast) forecastByEventId.set(event.id, forecast);
    }
  }

  const availability = computeSarjaAvailability(seasonEvents);

  async function render() {
    // No ?sarja= means the dashboard's own default (runkosarja);
    // resolveSarja degrades either to "kaikki" when it has no events.
    const sarja = resolveSarja(readUrlState().sarja ?? DEFAULT_SARJA, availability);

    const inScope = filterBySarja(seasonEvents, sarja);
    const state = {
      sarja,
      inScope,
      inScopeWithHistory: inScope,
      baselineIndex,
      nowIso,
      forecastByEventId,
      showForecast: visibility.show && forecastByEventId.size > 0,
      forecastAvg: computeAvgAttendanceForecast(inScope, forecastByEventId),
    };

    container.replaceChildren();
    container.append(buildSarjaChips(availability, sarja, (value) => {
      writeUrlState({ sarja: value === DEFAULT_SARJA ? undefined : value });
      render();
    }));

    container.append(buildHeroTiles(state));

    const timeline = buildTimelinePanel(state);
    if (timeline) timeline.classList.add("dashboard-panel--wide");
    const unclassified = buildUnclassifiedPanel([...kausikortti, ...matchEvents], schedule);
    if (unclassified) unclassified.classList.add("dashboard-panel--wide");

    const panels = [
      timeline,
      buildTopGamesPanel(state),
      buildTrendsPanel(state),
      buildKiirehdiPanel(state),
      buildOpponentsPanel(state),
      await buildHeatmapPanel(state),
      buildTimingPanel(state),
      unclassified,
    ].filter(Boolean);

    const grid = document.createElement("div");
    grid.className = "dashboard-grid";
    for (const panel of panels) grid.append(panel);
    container.append(grid);
  }

  await render();
}
