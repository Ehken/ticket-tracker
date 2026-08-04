// Color math for the dashboard's arena heatmap: average irtolippu fill per
// section → a color on the site's own sales ramp, vapaa-sand (#f3ead1) at 0
// through irtolippu-yellow (#ffd400) at ~85%, deepening toward amber at a
// full sellout so "completely gone" reads hotter than "nearly gone". Kept
// separate from the locked seat-map palette on purpose: those five colors
// are STATE colors (a seat IS sold or free); this ramp encodes a continuous
// quantity, which the palette lock was never about.
const RAMP = [
  { at: 0, color: [0xf3, 0xea, 0xd1] }, // --seat-vapaa
  { at: 0.85, color: [0xff, 0xd4, 0x00] }, // --seat-irtolippu
  { at: 1, color: [0xf5, 0xa6, 0x00] }, // amber: sold out
];

function toHex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

export function heatColor(fillPct) {
  if (fillPct === null || fillPct === undefined || Number.isNaN(fillPct)) return "#e4e4e4";
  const p = Math.max(0, Math.min(1, fillPct));
  for (let i = 1; i < RAMP.length; i++) {
    if (p <= RAMP[i].at) {
      const lo = RAMP[i - 1];
      const hi = RAMP[i];
      const t = (p - lo.at) / (hi.at - lo.at);
      return toHex(lo.color.map((c, j) => c + (hi.color[j] - c) * t));
    }
  }
  return toHex(RAMP[RAMP.length - 1].color);
}
