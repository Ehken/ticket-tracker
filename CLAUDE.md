# CLAUDE.md

Instructions for working in this repo (`saipa-lipputilanne` / ticket-tracker).

## Language

- User-facing strings (frontend copy, `README.md`, PR descriptions) are in
  **Finnish**.
- Code, code comments, and commit messages are in **English**.

## Zero runtime dependencies

- `node:test` only, ES modules, Node ≥ 20. Do not add npm packages (runtime
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

- `data/overrides.json` and `data/schedule.json` are **human-owned** —
  code must never write to them. No script in this repo does.
- `data/autoclass.json` is **scraper-owned and write-once**: an existing
  entry is never modified, even by a later, different candidate match
  (`setAutoclassIfAbsent` in `scripts/lib/dataStore.js`).
- Everything else under `data/` (`events.json`, `events/*/latest.json`,
  `events/*/history.json`, `events/*/seats.json`, `capacities/`) is
  machine-owned, written by `scripts/fetch.js`.
- `data/mock/` is a fully separate tree for `?mock=1`, regenerated via
  `npm run generate-mock` (deterministic — same command, same output,
  unless the generation logic or `data/schedule.json` changes). Never
  hand-edit files under `data/mock/`.

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
