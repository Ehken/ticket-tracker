import { formatThousands, formatPercent } from "./format.js";
import { sectionLabel as translateSectionLabel } from "./sectionLabels.js";
import { resolveSectionPrice, formatPrice } from "./prices.js";

function sectionLabel(row) {
  const base = translateSectionLabel(row.section);
  return row.disabled ? `${base} (suljettu)` : base;
}

function fillFraction(row) {
  return row.total > 0 ? row.sold / row.total : 0;
}

// Two drawn segments, not three — the free zone is the bar's own
// background (--seat-vapaa), not a span (see the .fill-bar comment in
// style.css for the full reasoning, including why this reads correctly
// even when `available` is 0). row.section === "aitiot" is the one case
// that changes the sold segment's color (purple, not yellow) rather than
// its size — everything else about the row (aggregate totals, which
// carry no .section field at all) renders identically either way.
export function buildFillBar(row) {
  const bar = document.createElement("div");
  bar.className = "fill-bar";
  const total = row.total || 1;

  const sold = document.createElement("span");
  sold.className = "fill-bar__segment fill-bar__segment--sold";
  if (row.section === "aitiot") sold.classList.add("fill-bar__segment--aitio");
  // A hard separator on this segment's own inner edge — but only where
  // there's a real zone on the other side of it to separate from.
  // Without this guard, a 0%-width segment would still paint its own
  // 1px border (a border doesn't scale to zero with its box), drawing a
  // boundary where no zone exists — not theoretical: available is
  // permanently 0 for aitio and press, and sold is 0 for press. See the
  // .fill-bar__segment--separated rule in style.css.
  if (row.sold > 0 && (row.available > 0 || row.hold > 0)) {
    sold.classList.add("fill-bar__segment--separated");
  }
  sold.style.width = `${(row.sold / total) * 100}%`;

  const hold = document.createElement("span");
  hold.className = "fill-bar__segment fill-bar__segment--hold";
  if (row.hold > 0 && (row.available > 0 || row.sold > 0)) {
    hold.classList.add("fill-bar__segment--separated");
  }
  hold.style.width = `${(row.hold / total) * 100}%`;

  bar.append(sold, hold);
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

function buildPriceCell(row, prices) {
  const td = document.createElement("td");
  td.className = "section-row__price";

  const resolved = prices ? resolveSectionPrice(row.section, prices) : null;
  if (!resolved) {
    td.textContent = "–";
    return td;
  }

  td.textContent = formatPrice(resolved.headlinePrice);

  // A price group is shared across several sections (e.g. one group can
  // cover five to seven of them), so a visible per-row discount line would
  // repeat the same string five to seven times down this column — with
  // every cell already set to nowrap, that's what was driving the section
  // table into horizontal scroll. The title attribute surfaces the exact,
  // per-group discount detail on hover at zero layout cost, and stays
  // accurate even though different groups' discounts differ in kind (an
  // age-based discount in one group, a club-membership rate in another) —
  // a single blanket summary couldn't state a specific number without
  // either repeating this same per-group detail or being misleadingly
  // vague. Known tradeoff: title attributes aren't reliably exposed to
  // touch/screen-reader users; [title] gets a dotted-underline hint
  // in CSS so a mouse user notices there's more here.
  //
  // Strictly cheaper than the headline, not merely "every other product" —
  // stays correct even if a group ever has two products tied at the max,
  // since a second full-price product isn't a discount and shouldn't be
  // listed as one.
  const discounts = resolved.products.filter((p) => p.price < resolved.headlinePrice);
  if (discounts.length > 0) {
    td.title = discounts.map((p) => `${p.name}: ${formatPrice(p.price)}`).join(", ");
  }

  return td;
}

function buildRow(row, prices) {
  const tr = document.createElement("tr");
  tr.className = "section-row";

  const katsomoCell = document.createElement("td");
  katsomoCell.className = "section-row__katsomo";
  katsomoCell.textContent = sectionLabel(row);

  tr.append(
    katsomoCell,
    ...buildValueCells([row.sold, row.available, row.hold, row.total]),
    buildFillCell(row.sold, row.total, row),
    buildPriceCell(row, prices)
  );
  return tr;
}

function buildTotalRow(totals) {
  const tr = document.createElement("tr");
  tr.className = "section-row section-row--total";

  const label = document.createElement("td");
  label.textContent = "Yhteensä";

  const priceTd = document.createElement("td");
  priceTd.className = "section-row__price";

  tr.append(
    label,
    ...buildValueCells([totals.sold, totals.available, totals.hold, totals.total]),
    buildFillCell(totals.sold, totals.total, totals),
    priceTd
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
  for (const label of ["Katsomo", "Myyty", "Ostettavissa", "Ei myynnissä", "Kapasiteetti", "Täyttö", "Hinta"]) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.append(th);
  }
  thead.append(headRow);

  const tbody = document.createElement("tbody");
  const sortedRows = [...latest.sections].sort((a, b) => fillFraction(b) - fillFraction(a));
  for (const row of sortedRows) {
    tbody.append(buildRow(row, latest.prices));
  }
  tbody.append(buildTotalRow(latest.totals));

  table.append(thead, tbody);
  wrapper.append(table);
  return wrapper;
}
