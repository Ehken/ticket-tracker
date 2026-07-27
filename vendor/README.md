# Vendored libraries

Self-hosted instead of loaded from a CDN, so visitors make zero third-party
requests, the CDN can't become a failure mode, and the "should we add SRI
hashes" question is moot — the files are the exact bytes committed here.

| File | Version | Source | Downloaded | SHA-384 | Licence |
| --- | --- | --- | --- | --- | --- |
| `chart.umd.min.js` | 4.4.4 | `chart.js@4.4.4`, `dist/chart.umd.js` (npm tarball) | 2026-07-27 | `sha384-G436+Z2nlA8+PNoeRvWdxKbvOf8E/y+lYxqht2iBwNHTQDV5CJr3+AGVj8fGZi5t` | MIT — [licences/chart.js-4.4.4-LICENSE.txt](licences/chart.js-4.4.4-LICENSE.txt) |
| `luxon.min.js` | 3.5.0 | `luxon@3.5.0`, `build/global/luxon.min.js` (npm tarball) | 2026-07-26 | `sha384-CU0J6nu6GO5gWB5IqOOhPQsG0LKyjpotF5Gw502R+0zbkzKHjDWc6FKSZsNTJfLX` | MIT — [licences/luxon-3.5.0-LICENSE.txt](licences/luxon-3.5.0-LICENSE.txt) |
| `chartjs-adapter-luxon.umd.min.js` | 1.3.1 | `chartjs-adapter-luxon@1.3.1`, `dist/chartjs-adapter-luxon.umd.min.js` (npm tarball) | 2026-07-26 | `sha384-7cWzHabR6ZyfMWzZgVssYaOQRTccHUWZ0F09AanlF3RAJ/JNyFnIma2JTYIVKEUP` | MIT — [licences/chartjs-adapter-luxon-1.3.1-LICENSE.txt](licences/chartjs-adapter-luxon-1.3.1-LICENSE.txt) |

Source is the **npm package tarball**, not a CDN — `chart.umd.min.js` was
originally pulled from `cdn.jsdelivr.net`, which prepends its own
CDN-generated banner ("Skipped minification because the original file
appears to be already minified... Do NOT use SRI with dynamically
generated files") ahead of the actual Chart.js bytes. That banner has no
business in a self-hosted file, and hashing it means the recorded SHA-384
is a hash of a CDN artifact rather than of anything the library actually
published. Re-pulled from `npm pack chart.js@4.4.4` instead — confirmed
the code body was byte-identical to the previous jsDelivr download (only
the wrapper comment differed). `luxon.min.js` and
`chartjs-adapter-luxon.umd.min.js` were checked against their own npm
tarballs too and are already byte-identical to what's committed — no
CDN-added wrapper in either case, so no replacement was needed for those
two.

The SHA-384 values above are recorded as provenance (proof of exactly which
upstream bytes are committed here) — there's no `integrity` attribute to
check against at runtime, since these are loaded as local files, not from
a CDN.

## Licence compliance

All three libraries are MIT-licensed, and committing them into this repo is
redistribution — MIT requires the copyright notice and licence text to
travel with the code. Recording "MIT" in the table above isn't sufficient on
its own, so each library's actual `LICENSE`/`LICENSE.md` file at its pinned
version is committed verbatim under [`licences/`](licences/), and the
minified files themselves keep whatever banner/copyright comments they
shipped with upstream (not stripped here).

## Updating a pinned version

Always pull from the npm tarball, not a CDN — a CDN can inject its own
wrapper comment ahead of the actual file (see above), which would corrupt
both the file and its recorded hash.

1. `npm pack <package>@<version>` (e.g. `npm pack chart.js@4.4.4`), then
   `tar xzf <package>-<version>.tgz` and copy the relevant `dist/...` file
   from the extracted `package/` directory over the file here.
2. Recompute its SHA-384: `openssl dgst -sha384 -binary <file> | openssl base64 -A`.
3. The tarball's own `package/LICENSE`/`package/LICENSE.md` is the same
   licence file — copy it to `licences/`, replacing the old version's copy.
4. Update this table (version, tarball path, download date, hash) and the
   licence filename if the version number changed.
5. Re-verify the frontend renders correctly (`npm test` doesn't cover this —
   verify by hand, both real data and `?mock=1`, per `CLAUDE.md`).
