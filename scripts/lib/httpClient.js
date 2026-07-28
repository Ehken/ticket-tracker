const USER_AGENT =
  "saipa-lipputilanne-tracker/1.0 (+https://github.com/Ehken/ticket-tracker; unofficial fan tracker, contact via repo issues)";

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// retries: 3 (4 attempts total), backoff growing 1.5s/3s/6s (backoffMs *
// 2**attempt) rather than a constant gap — a single transient shop hiccup
// used to lose the whole run (the old retries: 1 default gave up after one
// retry, and the next chance was an hour away).
//
// The arithmetic that matters is 3.8's ~40-event season, not the
// single-request case. Worst case for ONE request, every attempt hitting
// the full timeoutMs: 4*15000 + (1500+3000+6000) = 70500ms (~70.5s).
// scripts/fetch.js makes one such request per event (the page) plus one
// shared capacities-SVG request per *run* (see resolveCapacities's
// svgCache in lib/seatmap.js — every SaiPa home game uses the same arena
// map, so this is memoised per run instead of re-fetched per event) — so
// a full run is ~41 requests, not ~80.
//
// Taking "every request hits worst case" literally: 41 * 70.5s ≈ 48
// minutes, which still can't fit inside any reasonable timeout-minutes
// alongside a real retry policy — but that's a total outage, not the
// transient hiccup this budget exists to survive, and no retry policy can
// or should paper over a genuine total outage; timeout-minutes existing at
// all is what correctly kills that run instead of it hanging indefinitely.
// The realistic number: a normal, all-succeeding run finishes in ~2
// minutes (40 events * ~1.5s + 1 shared SVG fetch + 39 * 1.5s
// EVENT_DELAY_MS), and even ~15 of the 41 requests hitting their full
// worst-case chain on top of that still finishes comfortably inside
// timeout-minutes: 20 (.github/workflows/fetch.yml /
// fetch-intensive.yml) — a handful of isolated hiccups, not a
// simultaneous failure of everything, is what this is sized for.
export async function fetchWithRetry(
  url,
  opts = {},
  { retries = 3, backoffMs = 1500, timeoutMs = 15000 } = {}
) {
  const headers = { "User-Agent": USER_AGENT, ...(opts.headers ?? {}) };
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    // A fresh signal every attempt: AbortSignal.timeout() starts counting
    // down the moment it's created, so one built outside this loop would
    // already be expired by the time a retry re-enters it. A caller-supplied
    // signal is used as-is instead — no timeout of our own is layered on.
    const usesOwnTimeout = !opts.signal;
    const signal = opts.signal ?? AbortSignal.timeout(timeoutMs);

    try {
      const res = await fetch(url, { ...opts, headers, signal });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      }
      // The timeout signal keeps counting down after this function returns
      // — it isn't cleared just because the headers arrived in time. If a
      // caller's own body read (e.g. res.text()) is still in flight when it
      // fires, that read throws a raw TimeoutError with none of the
      // rewriting above, since it happens outside this try/catch entirely.
      // Every current caller (fetch.js, seatmap.js) reads the body
      // immediately after awaiting this call, so it's theoretical today —
      // flagged here so a future slow-body-read caller isn't surprised.
      return res;
    } catch (err) {
      const isAbort = err.name === "TimeoutError" || err.name === "AbortError";
      lastError = usesOwnTimeout && isAbort ? new Error(`Request to ${url} timed out after ${timeoutMs}ms`) : err;
      if (attempt < retries) {
        await delay(backoffMs * 2 ** attempt);
      }
    }
  }

  throw new Error(`Failed to fetch ${url} after ${retries + 1} attempt(s): ${lastError.message}`);
}

export { USER_AGENT };
