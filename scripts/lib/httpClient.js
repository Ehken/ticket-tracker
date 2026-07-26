const USER_AGENT =
  "saipa-lipputilanne-tracker/1.0 (+https://github.com/; unofficial fan tracker, contact via repo issues)";

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  url,
  opts = {},
  { retries = 1, backoffMs = 1500, timeoutMs = 15000 } = {}
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
      return res;
    } catch (err) {
      const isAbort = err.name === "TimeoutError" || err.name === "AbortError";
      lastError = usesOwnTimeout && isAbort ? new Error(`Request to ${url} timed out after ${timeoutMs}ms`) : err;
      if (attempt < retries) {
        await delay(backoffMs);
      }
    }
  }

  throw new Error(`Failed to fetch ${url} after ${retries + 1} attempt(s): ${lastError.message}`);
}

export { USER_AGENT };
