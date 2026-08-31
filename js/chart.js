import { formatHelsinkiDateTime, formatHelsinkiDayMonth, formatThousands } from "./format.js";
import { computeChartYBounds, layoutReferenceLabels, selectChartReferencePoints } from "./chartReferencePoints.js";

// Chart.js, Luxon and chartjs-adapter-luxon are loaded as <script> tags in
// index.html (in that order, self-hosted from vendor/), so `Chart` is a
// browser global here.
const Chart = window.Chart;

const LINE_COLOR = "#1a5d1a";
const FIRST_POINT_COLOR = "#c0392b";

// Light-mode values of the CSS variables, used only if the variable can't
// be read (the labels must never fall back to an invisible colour).
const FALLBACK_TEXT = "#1a1a1a";
const FALLBACK_HALO = "#ffffff";

function cssColor(canvas, name, fallback) {
  const value = getComputedStyle(canvas).getPropertyValue(name).trim();
  return value || fallback;
}

// Labelled reference points, drawn by hand: no datalabels or annotation
// plugin is vendored and adding one for this isn't worth a dependency.
// A plugin rather than a second dataset on purpose — the tooltip runs
// interaction mode "index" and its title callback keys off dataIndex === 0,
// both of which a second dataset would disturb.
const referenceLabelsPlugin = {
  id: "referenceLabels",

  // afterLayout, not afterDatasetsDraw: the scales have their final pixel
  // ranges by now, and Chart.js resolves the dataset's scriptable
  // pointRadius later in the same update — so the markers and the labels
  // are guaranteed to agree on which points were chosen. It also re-runs
  // on resize, so a 380px canvas gets its own layout rather than a
  // scaled-down copy of the desktop one.
  afterLayout(chart, args, options) {
    const historyPoints = options.history ?? [];
    if (historyPoints.length === 0) {
      chart.$referenceLabels = [];
      return;
    }
    const { x: xScale, y: yScale } = chart.scales;
    const project = (point) => ({
      x: xScale.getPixelForValue(new Date(point.t).getTime()),
      y: yScale.getPixelForValue(point.sold),
    });

    const selected = selectChartReferencePoints(historyPoints, {
      eventStart: options.eventStart ?? null,
      project,
    });

    const fontSize = chart.width < 420 ? 10 : 11;
    const lineHeight = Math.round(fontSize * 1.25);
    const font = `600 ${fontSize}px ${Chart.defaults.font.family}`;

    const { ctx } = chart;
    ctx.save();
    ctx.font = font;
    const labels = layoutReferenceLabels(
      selected.map((entry) => ({
        index: entry.index,
        priority: entry.priority,
        text: `${formatHelsinkiDayMonth(entry.t)} ${formatThousands(entry.sold)}`,
        ...project(entry),
      })),
      { chartArea: chart.chartArea, measureWidth: (text) => ctx.measureText(text).width, lineHeight },
    );
    ctx.restore();

    chart.$referenceLabels = labels;
    chart.$referenceFont = font;
  },

  afterDatasetsDraw(chart) {
    const labels = chart.$referenceLabels ?? [];
    if (labels.length === 0) return;

    const { ctx } = chart;
    ctx.save();
    ctx.font = chart.$referenceFont;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    // Halo first, so a label stays readable where it crosses the line.
    ctx.strokeStyle = cssColor(chart.canvas, "--card-bg", FALLBACK_HALO);
    ctx.fillStyle = cssColor(chart.canvas, "--fg", FALLBACK_TEXT);
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";

    for (const label of labels) {
      ctx.strokeText(label.text, label.x, label.y);
      ctx.fillText(label.text, label.x, label.y);
    }
    ctx.restore();
  },
};

export function buildChart(canvas, historyPoints, { eventStart = null } = {}) {
  const data = historyPoints.map((point) => ({ x: point.t, y: point.sold }));
  const bounds = computeChartYBounds(historyPoints);

  return new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Myyty",
          data,
          borderColor: LINE_COLOR,
          borderWidth: 2,
          // The first point ("Seuranta alkoi") and the labelled reference
          // points keep a visible marker — with a full season of hourly
          // data, one per point is unreadable. pointHoverRadius still
          // gives every other point a hover target, even though it's
          // invisible at rest.
          pointRadius: (ctx) => {
            if (ctx.dataIndex === 0) return 5;
            return ctx.chart.$referenceLabels?.some((label) => label.index === ctx.dataIndex) ? 4 : 0;
          },
          pointHoverRadius: 4,
          pointBackgroundColor: (ctx) => (ctx.dataIndex === 0 ? FIRST_POINT_COLOR : LINE_COLOR),
          tension: 0.15,
          // No area fill: the y axis is cropped to the data, and a filled
          // area reads as magnitude-from-zero — the exact misreading the
          // crop would otherwise invite.
          fill: false,
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
          min: bounds.min,
          max: bounds.max,
          ticks: { stepSize: bounds.stepSize, callback: (value) => formatThousands(value) },
        },
      },
      plugins: {
        // Read back by the plugin in afterLayout. Passed as plugin options
        // rather than assigned to the instance afterwards, because the
        // first layout happens inside the Chart constructor — anything set
        // after it would arrive one render too late.
        referenceLabels: { history: historyPoints, eventStart },
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
    plugins: [referenceLabelsPlugin],
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
