import { formatThousands, formatPercent } from "./format.js";
import { sectionLabel as translateSectionLabel } from "./sectionLabels.js";

function sectionLabel(row) {
  const base = translateSectionLabel(row.section);
  return row.disabled ? `${base} (suljettu)` : base;
}

function fillFraction(row) {
  return row.total > 0 ? row.sold / row.total : 0;
}

export function buildFillBar(row) {
  const bar = document.createElement("div");
  bar.className = "fill-bar";
  const total = row.total || 1;

  for (const [cls, value] of [
    ["sold", row.sold],
    ["available", row.available],
    ["hold", row.hold],
  ]) {
    const span = document.createElement("span");
    span.className = `fill-bar__segment fill-bar__segment--${cls}`;
    span.style.flexBasis = `${(value / total) * 100}%`;
    bar.append(span);
  }

  return bar;
}

function buildValueCells(values) {
  return values.map((value) => {
    const td = document.createElement("td");
    td.textContent = formatThousands(value);
    return td;
  });
}

function buildFillCell(sold, total, row) {
  const td = document.createElement("td");
  td.className = "section-row__fill";
  const pct = document.createElement("span");
  pct.className = "fill-pct";
  pct.textContent = formatPercent(sold, total);
  td.append(pct, buildFillBar(row));
  return td;
}

function buildRow(row) {
  const tr = document.createElement("tr");
  tr.className = "section-row";

  const katsomoCell = document.createElement("td");
  katsomoCell.className = "section-row__katsomo";
  katsomoCell.textContent = sectionLabel(row);

  tr.append(
    katsomoCell,
    ...buildValueCells([row.sold, row.available, row.hold, row.total]),
    buildFillCell(row.sold, row.total, row)
  );
  return tr;
}

function buildTotalRow(totals) {
  const tr = document.createElement("tr");
  tr.className = "section-row section-row--total";

  const label = document.createElement("td");
  label.textContent = "Yhteensä";

  tr.append(
    label,
    ...buildValueCells([totals.sold, totals.available, totals.hold, totals.total]),
    buildFillCell(totals.sold, totals.total, totals)
  );
  return tr;
}

export function buildSectionTable(latest) {
  const wrapper = document.createElement("div");
  wrapper.className = "section-table-wrapper";

  const table = document.createElement("table");
  table.className = "section-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["Katsomo", "Myyty", "Ostettavissa", "Ei myynnissä", "Kapasiteetti", "Täyttö"]) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.append(th);
  }
  thead.append(headRow);

  const tbody = document.createElement("tbody");
  const sortedRows = [...latest.sections].sort((a, b) => fillFraction(b) - fillFraction(a));
  for (const row of sortedRows) {
    tbody.append(buildRow(row));
  }
  tbody.append(buildTotalRow(latest.totals));

  table.append(thead, tbody);
  wrapper.append(table);
  return wrapper;
}
