# CLAUDE.md

Instructions for working in this repo (`saipa-lipputilanne` / ticket-tracker).

## Language

- User-facing strings (frontend copy, `README.md`, PR descriptions) are in
  **Finnish**.
- Code, code comments, and commit messages are in **English**.

## Zero runtime dependencies

- `node:test` only, ES modules, Node ≥ 24 (current Active LTS; matches
  `package.json`'s `engines.node` and the fetch workflows' `setup-node`
  version — keep all three in sync). Do not add npm packages (runtime
  or dev). If a task seems to need one, stop and ask first.
- Frontend libraries (Chart.js, Luxon, chartjs-adapter-luxon) are
  self-hosted under `vendor/` — see `vendor/README.md` before touching
  them (licence-attribution requirements apply to any update).

## Before every commit

- Run `npm test`. All tests must pass.
- Every behaviour change needs a test, except DOM/canvas assembly
  (`js/chart.js`, `js/seatMap.js`, card/dashboard rendering) — this
  project's existing convention is to verify those by hand instead
  (headless browser or manual check), not unit-test DOM construction.
- Verify any frontend change in **both** real data and `?mock=1` — the
  mock dataset intentionally covers edge cases (multi-season kausikortti
  strips, an unclassified event, long/short sale curves) that real data
  may not currently exercise.
- GitHub Pages caching lags roughly 10 minutes behind a push — check a
  live deploy in incognito or with a hard refresh before concluding a
  deploy failed.

## Workflow

- Plan mode before substantial work. Ask clarifying questions before
  producing a plan, not after — if a request is ambiguous or conflicts
  with what's in the code, ask, don't guess or silently redesign.
- Feature branch → PR → squash merge.
- Commit when done without asking, with a descriptive message.

## Data ownership (`data/`)

- `data/overrides.json`, `data/schedule.json`, and `data/watchDates.json`
  are **human-owned** — code must never write to them. No script in this
  repo does. `watchDates.json` is read-only input to
  `scripts/checkGameWindow.js`'s game-day gate (extends it to high-frequency
  scraping on a chosen date, e.g. a sales-opening day, not just an actual
  game day) — see `isGameDayWindowNow`/`warnOnPastWatchDates` in
  `scripts/lib/gameWindow.js`.
- `data/autoclass.json` is **scraper-owned and write-once**: an existing
  entry is never modified, even by a later, different candidate match
  (`setAutoclassIfAbsent` in `scripts/lib/dataStore.js`). Classification is
  retried every run until an entry exists here (or `overrides.json` sets
  `gameType` for that event) — see `scripts/fetch.js`.
- Everything else under `data/` (`events.json`, `events/*/latest.json`,
  `events/*/history.json`, `events/*/sectionHistory.json`,
  `events/*/seats.json`, `events/*/seasonBaseline.json`,
  `events/*/seasonBaselineHistory.json`, `capacities/`) is machine-owned,
  written by `scripts/fetch.js`.
- A kausikortti listing's own sold count is NOT a season-ticket count once
  match tickets are on sale (single-game purchases block the seat there
  too) — the true count is derived per game in
  `scripts/lib/seasonBaseline.js` and consumed everywhere via
  `seasonBaseline.json`; raw listing totals are only a fallback for
  seasons with no derived file.
- `data/mock/` is a fully separate tree for `?mock=1`, regenerated via
  `npm run generate-mock` (deterministic — same command, same output,
  unless the generation logic or `data/schedule.json` changes). Never
  hand-edit files under `data/mock/`.

## Scrape workflows and the external trigger

- Two workflows, two cadences: `.github/workflows/fetch.yml` (hourly
  baseline, **never gated**) and `.github/workflows/fetch-intensive.yml`
  (10-minute game-day/watch-date cadence, **always gated** by
  `scripts/checkGameWindow.js` — including on `workflow_dispatch`, so a
  manual run of that workflow on an ordinary day does nothing; use
  `fetch.yml` for an on-demand scrape). Neither workflow's job body
  branches on `github.event_name` or a cron-string literal — keep it that
  way; that comparison used to silently couple the gate to one workflow's
  own cron string and broke the moment a second trigger type needed to
  route independently.
- GitHub's own scheduler drops/delays scheduled runs badly under load
  (observed: 9 of 24 expected hourly runs in the first 24h; ~4% of
  expected 10-minute runs) — documented GitHub behavior, not a bug here.
  An external service now drives the intended cadence via
  `repository_dispatch` (`scrape` → `fetch.yml`, `scrape-intensive` →
  `fetch-intensive.yml`); the crons in both workflow files are a fallback
  for when that service is down, not the primary mechanism. Keep exactly
  one baseline cron — don't add redundant crons "just in case," since
  every one that fires is a full scrape.
- The external service authenticates with a fine-grained PAT scoped to
  `Contents: write` on this repo alone. The token lives at the external
  service, not in this repo, and has an expiry that needs rotating there.
  Verify it's still firing via `gh run list --event repository_dispatch`.
  See README.md's "Ulkoinen käynnistin" section for the full write-up.
- `resolveCapacities` (`scripts/lib/seatmap.js`) takes an optional
  per-run `svgCache` Map (created once in `scripts/fetch.js`'s `run()`,
  never persisted across runs) — every SaiPa home game shares the same
  arena map, so this avoids re-downloading an identical, large SVG once
  per event. Don't widen its scope beyond one run; a genuine map change
  must still be detected on the next one.

## Invariants that must not regress

- `firstSeen` on an `events.json` entry is never reset, even if the event
  disappears from the listing and reappears later.
- The index is never mass-archived when the listing comes back
  suspiciously empty — `assertListingNotSuspiciouslyEmpty` in
  `scripts/lib/dataStore.js` guards this, and runs before any writes.
- Per-event fetch failures are isolated: one event's parse/fetch error
  logs and skips that event only, and must never abort the whole run or
  touch other events' already-written data.

## Locked seat-map palette

Independent of light/dark theme — the map's own surface is deliberately
always light, even in dark mode (sales visually "ignite" the arena
black-and-yellow; a dark map background would invert that weight and make
a full arena read as empty):

- `#1a1a1a` — kausikortti (season ticket, sold)
- `#ffd400` — irtolippu (single ticket, sold)
- `#f3ead1` — vapaa (unsold)
- `rgba(163, 163, 163, 0.55)` — ei myynnissä (not on sale), rendered at a
  smaller radius too — the state differs by shape, not just colour
- `#7b4fb5` — aitio myyty (box sold via another channel)

## Never

- Commit secrets, tokens, or personal identifiers. Commits and PRs use a
  neutral project identity (see `LICENSE`'s copyright line), not a
  personal name.
