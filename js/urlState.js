// URL query params (?kausi=, ?tab=) are the single source of truth for
// season/tab selection state — shareable links, no localStorage.

export function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  return {
    kausi: params.get("kausi") ?? undefined,
    tab: params.get("tab") ?? undefined,
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
