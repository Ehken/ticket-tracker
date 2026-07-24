const AITIO_PREFIX = "aitio_";
const AGGREGATE_SECTIONS = new Set(["seisomakatsomo", "invalid", "press", "aitiot"]);

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

// The individual seat-ID keys from usages (pattern SECTION-ROW-SEAT), sorted
// alphabetically for deterministic output and good git delta compression.
// Aggregate keys (seisomakatsomo, invalid, aitio_N) have no seat IDs and are
// excluded — same "has a dash" rule as countSoldPerSection.
export function extractSoldSeatIds(usages) {
  return Object.keys(usages)
    .filter((key) => key.indexOf("-") !== -1)
    .sort();
}

// Sanity check only — logs a warning, never throws. Confirms the seat IDs
// extracted from usages agree with the sold count already computed per
// section, catching any future drift between the two derivations without
// risking a run failure over it.
export function warnOnSeatCountMismatch(soldSeatIds, sections, logger = console) {
  const countBySection = {};
  for (const seatId of soldSeatIds) {
    const section = seatId.slice(0, seatId.indexOf("-"));
    countBySection[section] = (countBySection[section] ?? 0) + 1;
  }

  for (const row of sections) {
    if (AGGREGATE_SECTIONS.has(row.section)) continue;
    const seatIdCount = countBySection[row.section] ?? 0;
    if (seatIdCount !== row.sold) {
      logger.warn(
        `[seats] section ${row.section}: soldSeatIds count (${seatIdCount}) does not match section's sold count (${row.sold})`
      );
    }
  }
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
