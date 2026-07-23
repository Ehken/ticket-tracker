const USER_AGENT =
  "saipa-lipputilanne-tracker/1.0 (+https://github.com/; unofficial fan tracker, contact via repo issues)";

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(url, opts = {}, { retries = 1, backoffMs = 1500 } = {}) {
  const headers = { "User-Agent": USER_AGENT, ...(opts.headers ?? {}) };
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...opts, headers });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await delay(backoffMs);
      }
    }
  }

  throw new Error(`Failed to fetch ${url} after ${retries + 1} attempt(s): ${lastError.message}`);
}

export { USER_AGENT };
