import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchWithRetry } from "../scripts/lib/httpClient.js";

function withStubbedFetch(responses, fn) {
  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async (...args) => {
    const next = responses[call++];
    if (next instanceof Error) throw next;
    if (typeof next === "function") return next(...args);
    return next;
  };
  return fn().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

test("fetchWithRetry returns the response on first success", async () => {
  await withStubbedFetch([{ ok: true, status: 200 }], async () => {
    const res = await fetchWithRetry("https://example.test/", {}, { retries: 1, backoffMs: 1 });
    assert.equal(res.ok, true);
  });
});

test("fetchWithRetry retries once on failure then succeeds", async () => {
  await withStubbedFetch(
    [new Error("network down"), { ok: true, status: 200 }],
    async () => {
      const res = await fetchWithRetry("https://example.test/", {}, { retries: 1, backoffMs: 1 });
      assert.equal(res.ok, true);
    }
  );
});

test("fetchWithRetry throws after exhausting retries", async () => {
  await withStubbedFetch(
    [new Error("network down"), new Error("network down again")],
    async () => {
      await assert.rejects(
        () => fetchWithRetry("https://example.test/", {}, { retries: 1, backoffMs: 1 }),
        /Failed to fetch/
      );
    }
  );
});

test("fetchWithRetry treats a non-2xx response as a failure", async () => {
  await withStubbedFetch(
    [
      { ok: false, status: 500, statusText: "Internal Server Error" },
      { ok: false, status: 500, statusText: "Internal Server Error" },
    ],
    async () => {
      await assert.rejects(
        () => fetchWithRetry("https://example.test/", {}, { retries: 1, backoffMs: 1 }),
        /Failed to fetch/
      );
    }
  );
});

test("fetchWithRetry sends a custom User-Agent header", async () => {
  let seenHeaders;
  await withStubbedFetch(
    [
      (url, opts) => {
        seenHeaders = opts.headers;
        return { ok: true, status: 200 };
      },
    ],
    async () => {
      await fetchWithRetry("https://example.test/", {}, { retries: 0 });
    }
  );
  assert.match(seenHeaders["User-Agent"], /saipa-lipputilanne-tracker/);
});
