# Vendored libraries

Self-hosted instead of loaded from a CDN, so visitors make zero third-party
requests, the CDN can't become a failure mode, and the "should we add SRI
hashes" question is moot — the files are the exact bytes committed here.

| File | Version | Source | Downloaded | SHA-384 | Licence |
| --- | --- | --- | --- | --- | --- |
| `chart.umd.min.js` | 4.4.4 | `https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js` | 2026-07-26 | `sha384-NrKB+u6Ts6AtkIhwPixiKTzgSKNblyhlk0Sohlgar9UHUBzai/sgnNNWWd291xqt` | MIT — [licences/chart.js-4.4.4-LICENSE.txt](licences/chart.js-4.4.4-LICENSE.txt) |
| `luxon.min.js` | 3.5.0 | `https://cdn.jsdelivr.net/npm/luxon@3.5.0/build/global/luxon.min.js` | 2026-07-26 | `sha384-CU0J6nu6GO5gWB5IqOOhPQsG0LKyjpotF5Gw502R+0zbkzKHjDWc6FKSZsNTJfLX` | MIT — [licences/luxon-3.5.0-LICENSE.txt](licences/luxon-3.5.0-LICENSE.txt) |
| `chartjs-adapter-luxon.umd.min.js` | 1.3.1 | `https://cdn.jsdelivr.net/npm/chartjs-adapter-luxon@1.3.1/dist/chartjs-adapter-luxon.umd.min.js` | 2026-07-26 | `sha384-7cWzHabR6ZyfMWzZgVssYaOQRTccHUWZ0F09AanlF3RAJ/JNyFnIma2JTYIVKEUP` | MIT — [licences/chartjs-adapter-luxon-1.3.1-LICENSE.txt](licences/chartjs-adapter-luxon-1.3.1-LICENSE.txt) |

The SHA-384 values above are recorded as provenance (proof of exactly which
upstream bytes were downloaded) — there's no `integrity` attribute to check
against at runtime, since these are loaded as local files, not from a CDN.

## Licence compliance

All three libraries are MIT-licensed, and committing them into this repo is
redistribution — MIT requires the copyright notice and licence text to
travel with the code. Recording "MIT" in the table above isn't sufficient on
its own, so each library's actual `LICENSE`/`LICENSE.md` file at its pinned
version is committed verbatim under [`licences/`](licences/), and the
minified files themselves keep whatever banner/copyright comments they
shipped with upstream (not stripped here).

## Updating a pinned version

1. Download the new version's file from the same jsdelivr path pattern
   (swap the version number), overwriting the file here.
2. Recompute its SHA-384: `openssl dgst -sha384 -binary <file> | openssl base64 -A`.
3. Download the new version's `LICENSE`/`LICENSE.md` from its GitHub repo
   at the matching tag, replacing the file under `licences/`.
4. Update this table (version, download date, hash) and the licence
   filename if the version number changed.
5. Re-verify the frontend renders correctly (`npm test` doesn't cover this —
   verify by hand, both real data and `?mock=1`, per `CLAUDE.md`).
