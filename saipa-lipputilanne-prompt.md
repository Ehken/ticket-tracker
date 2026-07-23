# Build: SaiPa ticket sales tracker (static site + GitHub Actions scraper)

Build a complete, working project in this repository. Read this whole spec before writing code — it contains verified details about the data source that you must not improvise around.

## What this is

A public, Finnish-language, minimalist website that tracks ticket sales for SaiPa (Finnish Liiga hockey) home games at Kisapuisto arena. Data comes from the club's ticket shop at `https://elippu.net/saipa`. There is NO backend and NO database: a GitHub Actions workflow scrapes the shop on a schedule, commits JSON files into this repo, and GitHub Pages serves a static frontend that reads those JSON files.

The site shows, per event and per arena section: **sold / available for purchase / not for sale ("hold") / total capacity / fill %**, plus a whole-arena summary and a sales-over-time curve per event.

## Verified facts about the data source (do not guess, use these)

### Event discovery
`https://elippu.net/saipa` is the shop front page. It contains links to events in the form `/saipa/{shopId}:{eventId}`, e.g. `/saipa/53:575`. Currently only the season-ticket event exists ("SaiPa kausikortit 2026-2027", id 53:575); individual match events will appear later with names like "SaiPa - KooKoo". Scrape this listing page to discover all currently visible events.

### Event data
Each event page (e.g. `https://elippu.net/saipa/53:575`) is a SvelteKit app. The sales data is embedded in the raw HTML inside a `<script>` tag, in a call like:

```js
kit.start(app, element, {
  node_ids: [...],
  data: [null, null, { type: "data", data: { shopId, event: {...}, map: {...} } }],
  ...
});
```

The interesting object is `data[2].data`. It contains (verified structure):

- `event`: `{ id: "53:575", name: "...", start: new Date(1785531600000), stop: new Date(...) }` — note `new Date(ms)` constructor calls, this is a JS object literal, NOT valid JSON.
- `map.status.usages`: an object where **sold seats appear as individual keys** in format `"SECTION-ROW-SEAT": 1`, e.g. `"A4-6-085": 1`. Section codes are A1–A6, C1–C8, D1–D2. The same object also contains **aggregate keys** for non-seated areas: `seisomakatsomo: <count>` (standing) and `invalid: <count>` (wheelchair), and possibly `aitio_N` and `press` keys.
- `map.status.capacities`: capacities ONLY for non-seated areas: `seisomakatsomo` (2138), `invalid` (12), `aitio_1`..`aitio_9` (total 156), `press` (24). Seated-section capacities are NOT here.
- `map.disabled`: array of section/row ids closed for sale, e.g. `["D2-1", "D2-2", "C7", "C8", "C2", "D2"]`. Entries may be whole sections (`"C7"`) or single rows (`"D2-1"`); treat a row entry as redundant if its whole section is also listed.
- `map.url`: `"/seatmap.svg"` (relative to `/saipa`).

**Parsing strategy:** the embedded object is a JS literal (unquoted keys, `new Date(...)`). Do NOT attempt `JSON.parse` directly. Recommended robust approach in Node: locate the `kit.start(app, element, ` call, extract the balanced `{...}` argument via bracket matching, then evaluate it in a `node:vm` sandbox where `Date` is available (return the object from the script). Fallback: regex-extract just the pieces you need. Whatever you do, write it defensively: if parsing fails, the run must log an error and exit WITHOUT modifying existing data files.

### Section capacities
Each event's payload contains its own seat map reference (`map.url`, currently `"/seatmap.svg"` relative to `/saipa`). **Resolve capacities per event via that URL** — do not assume one global map, since the club can modify it between seasons and it could in principle differ per event. The SVG contains one `<circle class="seat" id="SECTION-ROW-SEAT">` element per physical seat; count circles per section prefix to get capacities.

Caching: cache parsed capacities in `data/capacities/{sha1-of-svg-content}.json` and store the hash used in each event's `latest.json`. On every run, fetch the SVG referenced by each event (it's one small file; conditional GET with `If-None-Match`/`If-Modified-Since` if the server supports it, otherwise hash-compare), and if the content hash changed, parse and store the new capacity set. This gives automatic adaptation if the arena layout changes, and past events keep pointing at the capacity set that was valid for them.

Verified totals for the current map (use as a sanity check / test fixture, NOT as hardcoded runtime values): A1=171, A2=268, A3=246, A4=244, A5=247, A6=120, C1=108, C2=120, C3=150, C4=120, C5=120, C6=113, C7=94, C8=105, D1=205, D2=215; seated total 2646. Also merge in the non-seated capacities from the event payload (seisomakatsomo, invalid, aitiot, press) — these come per event anyway.

### Per-section math (this is the core logic)
For each seated section:
- `sold` = count of `usages` keys starting with `SECTION-`
- `total` = capacity from seatmap.svg
- if section is in `disabled`: `available = 0`, `hold = total - sold`
- else: `available = total - sold`, `hold = 0`

Standing (`seisomakatsomo`) and wheelchair (`invalid`): `sold` from the aggregate usage key, `total` from capacities, `available = total - sold`, `hold = 0`. Aitiot (156) and press (24): always `hold = total`, sold/available 0 (not sold through this shop).

Arena totals = sum of all of the above. (Sanity reference from real data: at one point season tickets showed 2552 sold / 1828 available / 596 hold / 4976 total.)

## Data files & archiving

```
data/
  capacities/
    {svg-hash}.json               # section -> capacity, one file per seen seatmap version
  events.json                     # index: [{id, name, start, status: "upcoming"|"past", firstSeen, lastSeen}]
  events/
    53-575/
      latest.json                 # most recent full snapshot (per-section table + totals + fetchedAt + capacities hash)
      history.json                # timeseries: [{t: ISO timestamp, sold, soldSeated, soldStanding}]
```

Rules:
- Use `:` → `-` in directory names (Windows-safe).
- Append to `history.json` only when the total sold count changed since the last point (plus always keep the very first point = **sales start marker**, `firstSeen`). This keeps files small and makes the curve honest: the first point is when the tracker first saw the event, which the UI must label as "seuranta alkoi", not "myynti alkoi".
- **Archiving without a clock:** when a previously-known event no longer appears in the shop listing, do NOT delete anything — mark it `status: "past"` in `events.json` and freeze its `latest.json` as the final result. This makes the "grab the final state" problem robust: the last successful fetch before disappearance IS the final state, no matter when elippu removes the event.
- The scraper commits only if file contents actually changed (`git diff --quiet` check) to avoid noisy empty commits.

## Scraper

- Node.js (>=20), no heavy dependencies — native `fetch` is fine, avoid puppeteer (the data is in static HTML, no JS rendering needed).
- Polite: identify with a custom User-Agent, 1–2 s delay between event page requests, single retry with backoff on failure.
- One entry point: `node scripts/fetch.js`. It: fetches listing → discovers events → fetches each event page → parses → updates data files → updates events.json (including detecting disappeared events → archive).
- Write a couple of unit tests for the parser using a saved HTML fixture (save a real trimmed sample of the embedded script into `test/fixtures/`), and for the seatmap counter against the verified capacity numbers above.

## GitHub Actions

Two concerns, one workflow file (`.github/workflows/fetch.yml`):
1. **Hourly baseline:** `cron: "0 * * * *"`.
2. **Game-day intensive mode:** every 10 minutes between 15:00–21:00 **Finnish time** on days when an upcoming event's `start` date is today. GitHub cron runs in UTC and Finland is UTC+2/+3 (DST), so: schedule `*/10 11-19 * * *` as a second cron entry, and have the script itself decide (using `Intl.DateTimeFormat` with `Europe/Helsinki`) whether it is (a) within 15–21 local time AND (b) a game day per `events.json`; if not, exit immediately without fetching. This handles DST correctly with zero configuration.
- The workflow checks out the repo, runs the scraper, commits & pushes with a bot identity. Note in a code comment that GitHub cron can be delayed several minutes under load — the design tolerates this.
- Also support `workflow_dispatch` for manual runs.

## Frontend

Static, served by GitHub Pages from the repo (either `/docs` or root — pick one and configure). Plain HTML + CSS + vanilla JS (or a single small build-free setup). Chart.js from CDN for the sales curve. Everything in **Finnish**.

Layout (minimalist, mobile-friendly, no visual extravagance):

1. **Header**: title (e.g. "Kisapuiston lipputilanne"), timestamp of last data update ("Päivitetty HH:MM"), and a one-line disclaimer: data from elippu.net's public shop pages, updated hourly (10 min välein ottelupäivinä klo 15–21), epävirallinen seurantasivu.
2. **Kausikortit** — its own separate block at top (visually distinct from games, since right now it's the main content; later it becomes secondary but stays separate). Shows arena summary numbers + expandable section table.
3. **Tulevat ottelut** — list of upcoming game events, each a collapsed card showing: opponent/name, date (Europe/Helsinki), and headline numbers (myyty / ostettavissa / ei myynnissä / kapasiteetti / täyttö-%). Expanding a card reveals:
   - the full per-section table (columns: Katsomo, Myyty, Ostettavissa, Ei myynnissä, Kapasiteetti, Täyttö), sections sorted by fill %, closed sections labeled "(suljettu)", plus rows for Seisomakatsomo, Pyörätuolipaikat, Aitiot, Lehdistö, and a bold total row;
   - the sales curve (Chart.js line, x = time, y = total sold; mark the first datapoint as "seuranta alkoi").
4. **Pelatut ottelut** — archived events, same expandable cards, header notes the frozen final state ("lopputilanne ennen ottelua").
5. Fill % shown both as number and a thin horizontal bar (sold = dark, available = light, hold = gray). Round all percentages to whole numbers, format thousands with a space (fi-FI locale).

Design: system font stack or one clean font, white background, hairline borders, SaiPa-neutral (do not use club logos or copyrighted assets). Dark mode via `prefers-color-scheme` is a nice-to-have, not required.

## Manual curation / "admin" (design for it now, no UI yet)

There is no backend, so the admin mechanism is a **manually edited overrides file in the repo** — git is the admin portal. Implement:

- `data/overrides.json`: a map keyed by event id, e.g.
  ```json
  {
    "53-580": { "gameType": "harjoitusottelu", "season": "2026-27", "hidden": false, "displayName": null, "note": "" },
    "53-575": { "gameType": "kausikortti" }
  }
  ```
  Supported fields (all optional): `gameType` (`"kausikortti" | "harjoitusottelu" | "runkosarja" | "playoffs" | "muu"`), `season` (string like `"2026-27"`), `hidden` (bool, exclude from the site entirely), `displayName` (override the scraped name), `note` (free text shown on the card).
- **Merge rule:** overrides are a layer ON TOP of scraped data, applied at read time in the frontend build/JS (or when the scraper writes `events.json` — pick one and be consistent). The scraper must NEVER write into `overrides.json`, and manual data must never be lost by a scraper run. Unknown event ids in overrides are ignored silently (they may refer to future events).
- **Defaults when no override exists:** the season-ticket event gets `gameType: "kausikortti"`; games in Aug–early Sep default to `"harjoitusottelu"` is tempting but do NOT auto-classify — default is `"muu"` and the site groups ungrouped games under "Ottelut". Manual classification is the whole point of the file.
- **Frontend grouping:** upcoming and past games are grouped by `gameType` (Runkosarja / Harjoitusottelut / Playoffs / Muut) with season shown where set. Hidden events are skipped everywhere.
- Structure the code so a future admin UI is a drop-in: a single module owns "read overrides + merge", so a later admin page (e.g. a small page that edits `overrides.json` via the GitHub API with a personal access token, or just GitHub's web editor) requires no refactoring. Do NOT build that UI now — but mention in the README that editing `data/overrides.json` in the GitHub web UI is the current admin flow, with a copy-pasteable example snippet.

## Robustness & etiquette

- If elippu's HTML structure changes and parsing fails, the workflow must fail loudly (red run) but leave existing data untouched.
- Never delete historical data.
- Keep total repo size in mind: history.json points only on change (see above).
- Add a short README (Finnish ok) explaining what the project does, the data source, and how to run the fetch locally.

## Definition of done

- `node scripts/fetch.js` run locally populates `data/` from the live shop (currently: the season-ticket event).
- Parser unit tests pass, including the capacity sanity numbers.
- Opening the site locally (e.g. `npx serve`) shows the kausikortti block with correct numbers matching the shop.
- Actions workflow is valid YAML and runs on `workflow_dispatch`.
