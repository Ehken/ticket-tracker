// latest.json's prices object has three parts: priceGroups (section -> group
// id), productPrices (group id -> product id -> price), products (product id
// -> metadata incl. name). A group can hold several products because
// discounted tickets (pensioner, student, child) sit alongside the
// unrestricted one.
export function resolveSectionPrice(section, prices) {
  const groupId = prices.priceGroups?.[section];
  if (groupId == null) return null; // aitiot/press — normal, not an error

  const productPrices = prices.productPrices?.[groupId];
  if (!productPrices) return null;

  const productIds = Object.keys(productPrices);
  if (productIds.length === 0) return null;

  const products = productIds.map((id) => ({
    name: prices.products?.[id]?.name ?? id,
    price: productPrices[id],
  }));

  // The unrestricted adult product, not the cheapest — in every group in
  // today's data the discounted product is strictly cheaper than the base
  // one, so the group's maximum is the unrestricted ticket. Leading with
  // the lowest price would headline a child/pensioner ticket as if it were
  // open to everyone. Not matched by product name — names are free text
  // and differ between events.
  const headlinePrice = Math.max(...products.map((p) => p.price));

  return { headlinePrice, products };
}

// invalid (wheelchair spaces, 12 total) is deliberately excluded here even
// though it has a price — those are a limited accessibility resource, not
// a budget option, and they're likely to be among the cheapest rows. This
// function recommends a seat to a general audience; showing invalid's
// price in the section table (js/sectionTable.js) is fine — that's just
// information — recommending it here is not: someone acting on the
// suggestion would occupy a wheelchair space for no reason. seisomakatsomo
// stays eligible — standing is a legitimate cheap choice and probably the
// most useful thing this function will ever surface. press is already
// excluded by having no price group at all.
const EXCLUDED_FROM_CHEAPEST = new Set(["invalid"]);

export function findCheapestAvailableSection(sections, prices) {
  let best = null;
  for (const row of sections) {
    if (!(row.available > 0) || row.disabled || EXCLUDED_FROM_CHEAPEST.has(row.section)) continue;
    const resolved = resolveSectionPrice(row.section, prices);
    if (!resolved) continue;
    if (best === null || resolved.headlinePrice < best.price) {
      best = { section: row.section, price: resolved.headlinePrice };
    }
  }
  return best;
}

// fi-FI currency formatting always pads to a fixed decimal count — with
// minimumFractionDigits 0 alone, a non-integer like 24.5 renders as
// "24,5 €", which isn't a valid Finnish price (needs exactly 0 or exactly
// 2 decimals, never 1). Two formatter variants, chosen per value, rather
// than assuming every price is a whole euro amount (today's values are,
// but single-match prices may carry decimals).
const integerPriceFormatter = new Intl.NumberFormat("fi-FI", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const decimalPriceFormatter = new Intl.NumberFormat("fi-FI", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatPrice(value) {
  return (Number.isInteger(value) ? integerPriceFormatter : decimalPriceFormatter).format(value);
}
