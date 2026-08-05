// Shareable game graphics — the same pure SVG builder feeds two callers:
// the browser's "Lataa kuva" button (js/shareImageDownload.js rasterises it
// to PNG client-side) and the hourly scrape (scripts/generateShareImages.js
// + a headless-Chrome step in fetch.yml publishes kuvat/*.png for forum
// hotlinks and embeds). One design, one source of truth.
//
// Deliberately scarcity-forward copy: a neutral "2 607 myyty" moves no
// tickets, "vain 312 paikkaa vapaana" does. The urgency tier picks both the
// wording and the accent treatment, so a wide-open game never shouts.
//
// SVG rather than canvas drawing commands, even though the browser path
// ends in a canvas: SVG is a string, so it is testable in Node without a
// DOM, and the CI path needs a string anyway. The font stack must resolve
// on BOTH macOS (Helvetica) and GitHub's ubuntu runners (DejaVu Sans) —
// no webfont is embedded, so text is laid out with slack rather than
// fitted tightly to one platform's metrics.
import { heatColor } from "./dashboardHeatmap.js";

const FONT = '"DejaVu Sans", "Helvetica Neue", Helvetica, Arial, sans-serif';

// The site's own palette (see the locked seat-map palette in CLAUDE.md).
// The share surface is deliberately DARK, unlike the seat map: a social
// feed is a dark-dominant environment and black-and-yellow is the club's
// own identity — "sales light the arena" reads strongest against black.
const BG = "#111111";
const FG = "#ffffff";
const MUTED = "#9a9a9a";
const YELLOW = "#ffd400";
const RED = "#e5484d";

export const FORMATS = {
  square: { width: 1080, height: 1080 }, // IG feed / WhatsApp / Discord
  story: { width: 1080, height: 1920 }, // IG / FB story
  wide: { width: 1200, height: 630 }, // forum hotlink, OG preview
};

// Below this many free seats, the game is "critical" regardless of
// percentage: 150 free seats in a 4 976-seat arena is a genuinely urgent
// message, while 3 % free is an abstraction nobody acts on.
const CRITICAL_AVAILABLE = 150;
const HIGH_FILL = 0.85;
// A named section this full is worth calling out by name — that's the
// concrete "the good seats are going" signal.
const SECTION_NEARLY_GONE = 0.9;

function escapeXml(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]
  );
}

function fi(n) {
  // Deliberately not toLocaleString("fi-FI"): Node on the CI runner may
  // ship without full ICU, which silently degrades to "2607" while the
  // browser renders "2 607" — the two callers must produce identical
  // pixels. U+00A0 so a number never wraps mid-thousand.
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
}

// Which section (if any) to name in the scarcity line: the fullest seated
// section past the threshold. Aggregate rows are excluded — "seisomakatsomo
// lähes loppuunmyyty" is true far more often and would crowd out the
// genuinely scarce seated blocks; press/aitiot never sell publicly at all.
const NAMEABLE_EXCLUDED = new Set(["press", "aitiot", "invalid", "seisomakatsomo"]);

export function findScarcestSection(sections = []) {
  let best = null;
  for (const row of sections) {
    if (NAMEABLE_EXCLUDED.has(row.section) || row.disabled) continue;
    if (!row.total || row.total <= 0) continue;
    const fill = row.sold / row.total;
    if (fill < SECTION_NEARLY_GONE) continue;
    if (!best || fill > best.fill) best = { section: row.section, fill, available: row.available };
  }
  return best;
}

// The headline and its urgency tier. `delta24h` (net sold change over the
// last day) only ever adds a secondary momentum line — it never overrides
// the primary scarcity message.
export function buildShareCopy({ sold, available, total, sections = [], delta24h = null }) {
  const fill = total > 0 ? sold / total : 0;
  const scarcest = findScarcestSection(sections);

  let headline;
  let urgency;
  if (available <= 0) {
    headline = "LOPPUUNMYYTY";
    urgency = "soldout";
  } else if (available <= CRITICAL_AVAILABLE) {
    headline = `Vain ${fi(available)} paikkaa vapaana`;
    urgency = "critical";
  } else if (fill >= HIGH_FILL) {
    headline = `${fi(available)} paikkaa vapaana`;
    urgency = "high";
  } else {
    headline = `${fi(available)} paikkaa vapaana`;
    urgency = "normal";
  }

  // An ARRAY, not a joined string: the 1200x630 layout has room for one
  // note beside the arena, the tall ones for both, and the layout decides.
  const notes = [];
  if (scarcest && available > 0) notes.push(`${scarcest.section} lähes loppuunmyyty`);
  if (delta24h !== null && delta24h >= 25) notes.push(`${fi(delta24h)} lippua viime vuorokautena`);

  return {
    headline,
    urgency,
    notes,
    fillText: `${Math.round(fill * 100)} % myyty · ${fi(sold)} / ${fi(total)}`,
  };
}

function text({ x, y, content, size, weight = "400", fill = FG, anchor = "start", spacing = "0" }) {
  return (
    `<text x="${x}" y="${y}" font-family='${FONT}' font-size="${size}" font-weight="${weight}" ` +
    `fill="${fill}" text-anchor="${anchor}" letter-spacing="${spacing}">${escapeXml(content)}</text>`
  );
}

// A schematic Kisapuisto, not the real seatmap SVG: at share-image scale
// 2 600 individual seat dots read as noise, and inlining the persisted map
// would drag its whole coordinate system (and file size) along. Section
// bands in the real arrangement (C above, A below, D right, standing left)
// coloured by each section's own fill through the dashboard's heat ramp —
// recognisably "our arena" at a glance in a feed.
function arena({ x, y, width, sections }) {
  const fillBySection = new Map(
    sections.filter((r) => r.total > 0).map((r) => [r.section, r.sold / r.total])
  );
  const color = (id) => heatColor(fillBySection.has(id) ? fillBySection.get(id) : null);

  // 1000, not 900: the drawing's own coordinate space runs to x=990 (the
  // D band) — scaling by the A/C band width alone pushed D1/D2 off the
  // canvas in every format.
  const scale = width / 1000;
  const s = (n) => n * scale;
  const parts = [];
  const push = (svg) => parts.push(svg);

  // Standing wedge (left), the arena's own tall block.
  push(
    `<polygon points="${x},${y + s(70)} ${x + s(110)},${y + s(110)} ${x + s(110)},${y + s(330)} ${x},${y + s(370)}" ` +
      `fill="${color("seisomakatsomo")}" />`
  );

  const cBand = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"];
  const aBand = ["A6", "A5", "A4", "A3", "A2", "A1"];

  cBand.forEach((id, i) => {
    const w = s(88);
    push(
      `<rect x="${x + s(140) + i * s(96)}" y="${y}" width="${w}" height="${s(90)}" rx="${s(6)}" fill="${color(id)}" />` +
        text({
          x: x + s(140) + i * s(96) + w / 2,
          y: y + s(56),
          content: id,
          size: s(30),
          weight: "700",
          fill: "#1a1a1a",
          anchor: "middle",
        })
    );
  });

  aBand.forEach((id, i) => {
    const w = s(118);
    push(
      `<rect x="${x + s(140) + i * s(126)}" y="${y + s(350)}" width="${w}" height="${s(90)}" rx="${s(6)}" fill="${color(id)}" />` +
        text({
          x: x + s(140) + i * s(126) + w / 2,
          y: y + s(406),
          content: id,
          size: s(30),
          weight: "700",
          fill: "#1a1a1a",
          anchor: "middle",
        })
    );
  });

  ["D1", "D2"].forEach((id, i) => {
    push(
      `<rect x="${x + s(920)}" y="${y + s(120) + i * s(110)}" width="${s(70)}" height="${s(96)}" rx="${s(6)}" fill="${color(id)}" />` +
        text({
          x: x + s(955),
          y: y + s(178) + i * s(110),
          content: id,
          size: s(26),
          weight: "700",
          fill: "#1a1a1a",
          anchor: "middle",
        })
    );
  });

  // The rink: white with the centre line, so the graphic reads as hockey
  // instantly rather than as an abstract chart.
  push(
    `<rect x="${x + s(180)}" y="${y + s(115)} " width="${s(660)}" height="${s(210)}" rx="${s(60)}" ` +
      `fill="#ededed" stroke="#2a2a2a" stroke-width="${s(4)}" />` +
      `<line x1="${x + s(510)}" y1="${y + s(115)}" x2="${x + s(510)}" y2="${y + s(325)}" stroke="${RED}" stroke-width="${s(5)}" />`
  );

  return parts.join("");
}

// The season-ticket share is drawn as a DIMMED yellow, not the site's
// near-black kausikortti colour: on this dark surface a near-black segment
// is indistinguishable from the empty track, so a 52 %-sold game rendered
// as an almost-empty bar — the exact opposite of the message. Sold is sold;
// the two tones only separate season tickets from singles within it.
const KAUSIKORTTI_DIM = "#8a7000";
const TRACK = "#2e2e2e";

function fillBar({ x, y, width, height, sold, total, kausikortti = 0 }) {
  const frac = total > 0 ? Math.min(1, sold / total) : 0;
  const kkFrac = total > 0 ? Math.min(frac, kausikortti / total) : 0;
  return (
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="${TRACK}" />` +
    `<rect x="${x}" y="${y}" width="${width * frac}" height="${height}" rx="${height / 2}" fill="${YELLOW}" />` +
    (kkFrac > 0
      ? `<rect x="${x}" y="${y}" width="${width * kkFrac}" height="${height}" rx="${height / 2}" fill="${KAUSIKORTTI_DIM}" />`
      : "")
  );
}

// Layout per format. Kept as data so the three variants can't drift in
// content — every one draws the same elements, only the geometry differs.
const LAYOUTS = {
  square: {
    pad: 72,
    kicker: 108,
    title: 190,
    titleSize: 84,
    date: 258,
    arenaY: 330,
    arenaW: 936,
    headline: 856,
    headlineSize: 68,
    note: 906,
    noteSize: 30,
    maxNotes: 2,
    barY: 940,
    fillText: 1006,
    footer: 1046,
  },
  // Story deliberately ends its content ~450px above the bottom edge:
  // Instagram overlays its own chrome (reply bar, sticker row) there, and
  // anything drawn into that band is covered on a real phone. The headline
  // is the same 68px as square, not larger — "1 774 paikkaa vapaana" at
  // 84px overran the 912px text column and lost its last word.
  story: {
    pad: 84,
    kicker: 220,
    title: 330,
    titleSize: 92,
    date: 410,
    arenaY: 560,
    arenaW: 912,
    headline: 1180,
    headlineSize: 68,
    note: 1252,
    noteSize: 34,
    maxNotes: 2,
    barY: 1320,
    fillText: 1410,
    footer: 1470,
  },
  // Wide is a two-column layout: all text in the left column, the arena
  // top-right. Every geometry here is bounded by that split — the arena
  // used to overlap the headline and the footer used to run under the A
  // band, both because the text column had no right-hand limit.
  wide: {
    pad: 64,
    kicker: 92,
    title: 168,
    titleSize: 62,
    date: 224,
    arenaY: 120,
    arenaW: 480,
    arenaX: 660,
    headline: 352,
    headlineSize: 52,
    note: 402,
    noteSize: 26,
    maxNotes: 1,
    barY: 436,
    fillText: 502,
    footer: 570,
    leftColumn: true,
  },
};

export function buildShareSvg({
  opponent,
  dateText,
  sold,
  available,
  total,
  sections = [],
  kausikortti = 0,
  delta24h = null,
  format = "square",
  siteUrl = "ehken.github.io/ticket-tracker",
}) {
  const dims = FORMATS[format];
  if (!dims) throw new Error(`Unknown share-image format: ${format}`);
  const L = LAYOUTS[format];
  const copy = buildShareCopy({ sold, available, total, sections, delta24h });
  const accent = copy.urgency === "soldout" || copy.urgency === "critical" ? YELLOW : FG;

  const contentWidth = L.leftColumn ? L.arenaX - L.pad - 40 : dims.width - 2 * L.pad;
  const barWidth = contentWidth;

  const body = [
    `<rect width="${dims.width}" height="${dims.height}" fill="${BG}" />`,
    // A thin yellow rule at the very top — the club's colour as a frame,
    // and it makes the graphic identifiable even as a thumbnail.
    `<rect x="0" y="0" width="${dims.width}" height="10" fill="${YELLOW}" />`,
    text({
      x: L.pad,
      y: L.kicker,
      content: "KISAPUISTON LIPPUTILANNE",
      size: 26,
      weight: "700",
      fill: YELLOW,
      spacing: "3",
    }),
    text({ x: L.pad, y: L.title, content: opponent, size: L.titleSize, weight: "700" }),
    text({ x: L.pad, y: L.date, content: dateText, size: 36, fill: MUTED }),
    arena({
      x: L.arenaX ?? L.pad,
      y: L.arenaY,
      width: L.arenaW,
      sections,
    }),
    text({
      x: L.pad,
      y: L.headline,
      content: copy.headline,
      size: L.headlineSize,
      weight: "700",
      fill: accent,
    }),
    copy.notes.length > 0
      ? text({
          x: L.pad,
          y: L.note,
          content: copy.notes.slice(0, L.maxNotes).join(" · "),
          size: L.noteSize,
          fill: MUTED,
        })
      : "",
    fillBar({ x: L.pad, y: L.barY, width: barWidth, height: 22, sold, total, kausikortti }),
    text({ x: L.pad, y: L.fillText, content: copy.fillText, size: 32, fill: FG }),
    text({
      x: L.pad,
      y: L.footer,
      content: `liput elippu.net · ${siteUrl} · epävirallinen seuranta`,
      size: 24,
      fill: MUTED,
    }),
  ];

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dims.width}" height="${dims.height}" ` +
    `viewBox="0 0 ${dims.width} ${dims.height}">${body.join("")}</svg>`
  );
}

// Filename a download or a published file gets. Slugged opponent so a
// saved file is identifiable in a downloads folder / on a server.
export function shareImageFilename({ opponent, dateText, format }) {
  const slug = String(opponent)
    .toLowerCase()
    .replace(/[äå]/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const date = String(dateText).replace(/[^0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return `saipa-${slug}-${date}-${format}.png`;
}
