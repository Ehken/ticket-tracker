const AITIO_PREFIX = "aitio_";

export function countSoldPerSection(usages) {
  const counts = {};
  for (const key of Object.keys(usages)) {
    const dashIndex = key.indexOf("-");
    if (dashIndex === -1) continue; // aggregate keys (seisomakatsomo, invalid, aitio_N) have no dash
    const section = key.slice(0, dashIndex);
    counts[section] = (counts[section] ?? 0) + 1;
  }
  return counts;
}

export function extractAggregateSold(usages) {
  return {
    standing: usages.seisomakatsomo ?? 0,
    wheelchair: usages.invalid ?? 0,
  };
}

export function isSectionDisabled(sectionId, disabledList) {
  return disabledList.includes(sectionId);
}

export function warnOnOrphanRowLevelDisabled(disabledList, logger = console) {
  const wholeSections = new Set(disabledList.filter((entry) => !entry.includes("-")));

  for (const entry of disabledList) {
    if (!entry.includes("-")) continue; // whole-section entry, not a row entry
    const section = entry.slice(0, entry.indexOf("-"));
    if (!wholeSections.has(section)) {
      logger.warn(
        `map.disabled contains row-level entry "${entry}" whose whole section "${section}" is not disabled; ` +
          "per-section math ignores row-level closures and treats this section as fully open."
      );
    }
  }
}

export function buildSectionTable({ soldCounts, capacities, disabled, standingSold, wheelchairSold }) {
  const rows = [];
  let aitiotTotal = 0;

  for (const [key, total] of Object.entries(capacities)) {
    if (key.startsWith(AITIO_PREFIX)) {
      aitiotTotal += total;
      continue;
    }

    if (key === "press") {
      rows.push({ section: "press", sold: 0, available: 0, hold: total, total });
      continue;
    }

    if (key === "seisomakatsomo") {
      const sold = standingSold ?? 0;
      rows.push({ section: "seisomakatsomo", sold, available: total - sold, hold: 0, total });
      continue;
    }

    if (key === "invalid") {
      const sold = wheelchairSold ?? 0;
      rows.push({ section: "invalid", sold, available: total - sold, hold: 0, total });
      continue;
    }

    // Seated section.
    const sold = soldCounts[key] ?? 0;
    if (isSectionDisabled(key, disabled)) {
      rows.push({ section: key, sold, available: 0, hold: total - sold, total, disabled: true });
    } else {
      rows.push({ section: key, sold, available: total - sold, hold: 0, total, disabled: false });
    }
  }

  if (aitiotTotal > 0) {
    rows.push({ section: "aitiot", sold: 0, available: 0, hold: aitiotTotal, total: aitiotTotal });
  }

  return rows;
}

export function computeTotals(rows) {
  return rows.reduce(
    (totals, row) => ({
      sold: totals.sold + row.sold,
      available: totals.available + row.available,
      hold: totals.hold + row.hold,
      total: totals.total + row.total,
    }),
    { sold: 0, available: 0, hold: 0, total: 0 }
  );
}
