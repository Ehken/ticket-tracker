// Pure keyboard arithmetic for the card's Kartta/Taulukko tablist (buildTabs
// in card.js) — the only non-DOM logic in that otherwise DOM-assembly-only
// module, so it's pulled out here to be unit-tested like the rest of this
// project's pure helpers (seatMapViewBox.js etc).
export function nextTabIndex(current, key, count) {
  switch (key) {
    case "ArrowRight":
      return (current + 1) % count;
    case "ArrowLeft":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return current;
  }
}
