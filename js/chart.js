import { formatHelsinkiDateTime, formatThousands } from "./format.js";

// Chart.js, Luxon and chartjs-adapter-luxon are loaded as CDN <script> tags
// in index.html (in that order), so `Chart` is a browser global here.
const Chart = window.Chart;

export function buildChart(canvas, historyPoints) {
  const data = historyPoints.map((point) => ({ x: point.t, y: point.sold }));

  return new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Myyty",
          data,
          borderColor: "#1a5d1a",
          backgroundColor: "rgba(26, 93, 26, 0.1)",
          // Only the first point ("Seuranta alkoi") keeps a visible marker —
          // with a full season of hourly data, one per point is unreadable.
          // pointHoverRadius still gives every other point a hover target,
          // even though it's invisible at rest.
          pointRadius: (ctx) => (ctx.dataIndex === 0 ? 5 : 0),
          pointHoverRadius: 4,
          pointBackgroundColor: (ctx) => (ctx.dataIndex === 0 ? "#c0392b" : "#1a5d1a"),
          tension: 0.15,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      // Chart.js defaults to intersect: true, which needs a visible point
      // under the cursor to trigger a tooltip — with markers hidden above,
      // nothing would ever show. mode: "index" + intersect: false makes the
      // tooltip follow the cursor anywhere along the line instead.
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          type: "time",
          ticks: {
            callback: (value) => formatHelsinkiDateTime(new Date(value).toISOString()),
          },
        },
        y: {
          beginAtZero: true,
          ticks: { callback: (value) => formatThousands(value) },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title(items) {
              const item = items[0];
              if (item.dataIndex === 0) return "Seuranta alkoi";
              return formatHelsinkiDateTime(new Date(item.parsed.x).toISOString());
            },
            label(item) {
              return `Myyty: ${formatThousands(item.parsed.y)}`;
            },
          },
        },
      },
    },
  });
}

export function destroyChart(chartInstance) {
  chartInstance?.destroy();
}

// Small, axis-free line — a genuinely different rendering from buildChart's
// full card chart, not a config toggle: no markers, no axes/gridlines/
// legend/tooltip. Sizing is controlled by the canvas's CSS (fixed height).
export function buildSparkline(canvas, historyPoints) {
  const data = historyPoints.map((point) => ({ x: point.t, y: point.sold }));

  return new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        {
          data,
          borderColor: "#1a5d1a",
          backgroundColor: "rgba(26, 93, 26, 0.1)",
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.15,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: { type: "time", display: false },
        y: { display: false, beginAtZero: true },
      },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
    },
  });
}
