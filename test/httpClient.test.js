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

test("fetchWithRetry aborts on timeout, retries, and produces a clear error naming the URL and timeout", async () => {
  // AbortSignal.timeout()'s own internal timer is deliberately unref'd by
  // Node (it relies on the real fetch()'s underlying socket to keep the
  // event loop alive while it waits) — with fetch fully stubbed out here,
  // nothing else holds the process open, so a ref'd keep-alive timer is
  // needed for the abort to actually fire before Node decides there's
  // nothing left to do.
  const hangUntilAborted = (url, opts) =>
    new Promise((_resolve, reject) => {
      const keepAlive = setInterval(() => {}, 1000);
      opts.signal.addEventListener("abort", () => {
        clearInterval(keepAlive);
        reject(opts.signal.reason ?? new Error("aborted"));
      });
    });

  await withStubbedFetch([hangUntilAborted, hangUntilAborted], async () => {
    await assert.rejects(
      () => fetchWithRetry("https://example.test/slow", {}, { retries: 1, backoffMs: 1, timeoutMs: 5 }),
      (err) => {
        assert.match(err.message, /timed out/);
        assert.match(err.message, /https:\/\/example\.test\/slow/);
        assert.match(err.message, /5ms/);
        return true;
      }
    );
  });
});

test("fetchWithRetry respects a caller-supplied signal instead of layering its own timeout", async () => {
  const controller = new AbortController();
  controller.abort(new Error("caller cancelled"));

  await withStubbedFetch(
    [
      (url, opts) => {
        // A real fetch() would reject immediately for an already-aborted
        // signal; the stub mimics that directly.
        if (opts.signal.aborted) return Promise.reject(opts.signal.reason);
        return { ok: true, status: 200 };
      },
    ],
    async () => {
      await assert.rejects(
        () => fetchWithRetry("https://example.test/", { signal: controller.signal }, { retries: 0, timeoutMs: 5 }),
        /caller cancelled/
      );
    }
  );
});

test("fetchWithRetry defaults to 3 retries: succeeds on the 4th attempt after 3 failures", async () => {
  let attempts = 0;
  await withStubbedFetch(
    [
      () => {
        attempts++;
        throw new Error("fail 1");
      },
      () => {
        attempts++;
        throw new Error("fail 2");
      },
      () => {
        attempts++;
        throw new Error("fail 3");
      },
      () => {
        attempts++;
        return { ok: true, status: 200 };
      },
    ],
    async () => {
      // retries not overridden — proves the default, not a passed-in value.
      const res = await fetchWithRetry("https://example.test/", {}, { backoffMs: 1 });
      assert.equal(res.ok, true);
    }
  );
  assert.equal(attempts, 4);
});

test("fetchWithRetry defaults to 3 retries: throws after exactly 4 failed attempts", async () => {
  let attempts = 0;
  await withStubbedFetch(
    [
      () => {
        attempts++;
        throw new Error("fail");
      },
      () => {
        attempts++;
        throw new Error("fail");
      },
      () => {
        attempts++;
        throw new Error("fail");
      },
      () => {
        attempts++;
        throw new Error("fail");
      },
    ],
    async () => {
      await assert.rejects(
        () => fetchWithRetry("https://example.test/", {}, { backoffMs: 1 }),
        /Failed to fetch .* after 4 attempt\(s\)/
      );
    }
  );
  assert.equal(attempts, 4);
});

test("fetchWithRetry's backoff grows between attempts (doubling), not a constant gap", async () => {
  const timestamps = [];
  await withStubbedFetch(
    [
      () => {
        timestamps.push(Date.now());
        throw new Error("fail 1");
      },
      () => {
        timestamps.push(Date.now());
        throw new Error("fail 2");
      },
      () => {
        timestamps.push(Date.now());
        throw new Error("fail 3");
      },
      () => {
        timestamps.push(Date.now());
        return { ok: true, status: 200 };
      },
    ],
    async () => {
      await fetchWithRetry("https://example.test/", {}, { retries: 3, backoffMs: 20 });
    }
  );

  const gap1 = timestamps[1] - timestamps[0]; // expected ~20ms
  const gap2 = timestamps[2] - timestamps[1]; // expected ~40ms
  const gap3 = timestamps[3] - timestamps[2]; // expected ~80ms

  // Ratios, not exact milliseconds — robust to CI timing jitter, same
  // spirit as the existing timeout test's small-value approach.
  assert.ok(gap2 > gap1 * 1.5, `gap2 (${gap2}ms) should be notably larger than gap1 (${gap1}ms)`);
  assert.ok(gap3 > gap2 * 1.5, `gap3 (${gap3}ms) should be notably larger than gap2 (${gap2}ms)`);
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
