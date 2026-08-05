// Browser side of the shareable game graphic: takes the SVG that
// js/shareImage.js builds and hands the visitor a PNG. Client-side on
// purpose — no backend, no build step, no new dependency, and the picture
// is current to the minute the button was pressed.
//
// Not unit-tested (canvas/DOM assembly, same convention as the rest of the
// rendering code); the SVG it rasterises IS tested, and the pipeline itself
// is verified by hand in both real and ?mock=1 data.
import { buildShareSvg, shareImageFilename, FORMATS } from "./shareImage.js";
import { getHistory } from "./fetchData.js";
import { findValueAtOrBefore } from "./dashboardTrends.js";

// A blob: URL, not a data: URL — Safari refuses to load large data-URL SVGs
// into an <img>, and a blob is same-origin so the canvas never taints and
// toBlob() stays allowed.
function rasterise(svg, { width, height }) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob returned null"))), "image/png");
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load the share SVG into an image"));
    };
    img.src = url;
  });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Not revoked synchronously: Safari needs the URL to still resolve when
  // it processes the click, which happens after this frame.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const dateFormatter = new Intl.DateTimeFormat("fi-FI", {
  timeZone: "Europe/Helsinki",
  weekday: "short",
  day: "numeric",
  month: "numeric",
  year: "numeric",
});
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Helsinki",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

async function resolveDelta24h(eventId, fetchedAt) {
  try {
    const history = await getHistory(eventId);
    const cutoff = new Date(new Date(fetchedAt).getTime() - 24 * 3600 * 1000).toISOString();
    const dayAgo = findValueAtOrBefore(history, cutoff);
    return dayAgo ?? null;
  } catch (err) {
    console.warn(`[share] could not read history for ${eventId}:`, err);
    return null;
  }
}

export async function downloadShareImage({ mergedEvent, latest, kausikortti = 0, format }) {
  const dims = FORMATS[format];
  const start = new Date(mergedEvent.start);
  const dateText = `${dateFormatter.format(start)} klo ${timeFormatter.format(start)}`;

  const dayAgoPoint = await resolveDelta24h(mergedEvent.id, latest.fetchedAt);
  const delta24h = dayAgoPoint ? latest.totals.sold - dayAgoPoint.sold : null;

  const svg = buildShareSvg({
    opponent: mergedEvent.name,
    dateText,
    sold: latest.totals.sold,
    available: latest.totals.available,
    total: latest.totals.total,
    sections: latest.sections,
    kausikortti,
    delta24h,
    format,
  });

  const blob = await rasterise(svg, dims);
  triggerDownload(blob, shareImageFilename({ opponent: mergedEvent.name, dateText, format }));
}

// The card's own control row. Kausikortti listings are excluded by the
// caller — the graphic is about a game somebody can buy a ticket to.
export function buildShareRow(mergedEvent, latest, { kausikortti = 0 } = {}) {
  const row = document.createElement("div");
  row.className = "card__share-row";

  const label = document.createElement("span");
  label.className = "card__share-label";
  label.textContent = "Jaa kuvana:";
  row.append(label);

  const status = document.createElement("span");
  status.className = "card__share-status";
  status.setAttribute("role", "status"); // announces success/failure to screen readers

  for (const [format, text] of [
    ["square", "Neliö"],
    ["story", "Story"],
    ["wide", "Leveä"],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "card__share-button";
    button.textContent = text;
    button.addEventListener("click", async () => {
      button.disabled = true;
      status.textContent = "";
      try {
        await downloadShareImage({ mergedEvent, latest, kausikortti, format });
      } catch (err) {
        console.error("[share] image generation failed:", err);
        status.textContent = "Kuvan luonti ei onnistunut.";
      } finally {
        button.disabled = false;
      }
    });
    row.append(button);
  }

  row.append(status);
  return row;
}
