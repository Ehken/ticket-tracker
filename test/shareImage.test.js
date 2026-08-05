import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildShareCopy,
  buildShareSvg,
  findScarcestSection,
  shareImageFilename,
  FORMATS,
} from "../js/shareImage.js";

// The module groups thousands with U+00A0 so a number never wraps
// mid-thousand in the graphic; expectations build the same way rather than
// carrying an invisible literal.
const NB = "\u00a0";

const sections = [
  { section: "A1", sold: 62, available: 109, total: 171 },
  { section: "A4", sold: 232, available: 12, total: 244 }, // 95% — nameable
  { section: "seisomakatsomo", sold: 2100, available: 38, total: 2138 }, // excluded
  { section: "press", sold: 0, available: 0, total: 24 }, // excluded
];

test("findScarcestSection names the fullest seated section past the threshold", () => {
  assert.deepEqual(findScarcestSection(sections).section, "A4");
  // Nothing past 90% -> nothing to name
  assert.equal(findScarcestSection([{ section: "A1", sold: 10, available: 90, total: 100 }]), null);
  // A disabled section is never named, however "full" its ratio looks
  assert.equal(
    findScarcestSection([{ section: "C7", sold: 94, available: 0, total: 94, disabled: true }]),
    null
  );
});

test("buildShareCopy escalates: sold out > critical > high > normal", () => {
  assert.deepEqual(
    { ...buildShareCopy({ sold: 4976, available: 0, total: 4976 }) },
    { headline: "LOPPUUNMYYTY", urgency: "soldout", notes: [], fillText: `100 % myyty · 4${NB}976 / 4${NB}976` }
  );

  const critical = buildShareCopy({ sold: 4900, available: 76, total: 4976 });
  assert.equal(critical.urgency, "critical");
  assert.match(critical.headline, /^Vain 76 paikkaa/);

  const high = buildShareCopy({ sold: 4400, available: 576, total: 4976 });
  assert.equal(high.urgency, "high");
  assert.equal(high.headline, "576 paikkaa vapaana");

  const normal = buildShareCopy({ sold: 2607, available: 1774, total: 4976 });
  assert.equal(normal.urgency, "normal");
  assert.equal(normal.fillText, `52 % myyty · 2${NB}607 / 4${NB}976`);
});

test("buildShareCopy adds section and momentum notes without overriding the headline", () => {
  const copy = buildShareCopy({ sold: 2607, available: 1774, total: 4976, sections, delta24h: 186 });
  assert.equal(copy.headline, `1${NB}774 paikkaa vapaana`);
  assert.deepEqual(copy.notes, ["A4 lähes loppuunmyyty", "186 lippua viime vuorokautena"]);

  // Below the momentum floor, and sold out: no seat-scarcity note at all.
  const quiet = buildShareCopy({ sold: 2607, available: 1774, total: 4976, sections: [], delta24h: 4 });
  assert.deepEqual(quiet.notes, []);
  const soldOut = buildShareCopy({ sold: 4976, available: 0, total: 4976, sections, delta24h: 200 });
  assert.deepEqual(soldOut.notes, ["200 lippua viime vuorokautena"]);
});

test("buildShareSvg emits correct dimensions for every format", () => {
  for (const [format, dims] of Object.entries(FORMATS)) {
    const svg = buildShareSvg({
      opponent: "SaiPa - Tappara",
      dateText: "ti 1.9.2026 klo 18:30",
      sold: 2607,
      available: 1774,
      total: 4976,
      sections,
      kausikortti: 2490,
      format,
    });
    assert.match(svg, new RegExp(`width="${dims.width}"`));
    assert.match(svg, new RegExp(`height="${dims.height}"`));
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /<\/svg>$/);
    // Content invariants: every format carries the same story
    assert.ok(svg.includes("SaiPa - Tappara"));
    assert.ok(svg.includes(`1${NB}774 paikkaa vapaana`));
    assert.ok(svg.includes("KISAPUISTON LIPPUTILANNE"));
    assert.ok(svg.includes("elippu.net"));
  }
});

test("buildShareSvg escapes XML in the opponent name", () => {
  const svg = buildShareSvg({
    opponent: 'SaiPa - "Ässät" & <co>',
    dateText: "1.1.2027",
    sold: 1,
    available: 1,
    total: 2,
    format: "wide",
  });
  assert.ok(svg.includes("&quot;Ässät&quot; &amp; &lt;co&gt;"));
  assert.ok(!svg.includes("<co>"));
});

test("buildShareSvg rejects an unknown format", () => {
  assert.throws(
    () => buildShareSvg({ opponent: "x", dateText: "y", sold: 1, available: 1, total: 2, format: "banner" }),
    /Unknown share-image format/
  );
});

test("shareImageFilename slugs Finnish characters and the date", () => {
  assert.equal(
    shareImageFilename({ opponent: "SaiPa - Ässät", dateText: "ti 1.9.2026 klo 18:30", format: "square" }),
    "saipa-saipa-assat-1-9-2026-18-30-square.png"
  );
});
