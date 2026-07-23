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
          pointRadius: (ctx) => (ctx.dataIndex === 0 ? 5 : 3),
          pointBackgroundColor: (ctx) => (ctx.dataIndex === 0 ? "#c0392b" : "#1a5d1a"),
          tension: 0.15,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
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
