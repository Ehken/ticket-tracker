// URL query params (?kausi=, ?sarja=, ?vastustaja=, ?pelatut=) are the single
// source of truth for filter state — shareable links, no localStorage.

// Private preview: ?dashboard=1 renders the dashboard instead of the normal
// view. Resolved once at load, same pattern as fetchData.js's IS_MOCK — the
// "← Takaisin" link is a real navigation, not a soft re-render, so this
// never needs to change within a single page life.
export const IS_DASHBOARD = new URLSearchParams(window.location.search).get("dashboard") === "1";

export function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  return {
    kausi: params.get("kausi") ?? undefined,
    sarja: params.get("sarja") ?? undefined,
    vastustaja: params.get("vastustaja") ?? undefined,
    pelatut: params.get("pelatut") === "1",
  };
}

export function writeUrlState(partial) {
  const params = new URLSearchParams(window.location.search);

  for (const [key, value] of Object.entries(partial)) {
    if (value === undefined || value === null) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  }

  const query = params.toString();
  const newUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
  window.history.replaceState(null, "", newUrl);
}
