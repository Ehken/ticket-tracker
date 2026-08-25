// The front page's own compressed dashboard: the hero tile row plus the three
// panels that answer "how is the season selling?" without leaving the game
// list. Every element here is built by js/dashboard.js's own builders from
// js/dashboard.js's own prepared state — this is a second CALL SITE, not a
// second implementation, so a number shown here can never drift from the same
// number on ?dashboard=1.
//
// Scope is deliberately kausi + sarja only. The vastustaja and pelatut filters
// below it do not touch the strip: it's a season overview, and narrowing it to
// one opponent would turn a season summary into a two-game stat block.
import {
  prepareSeasonState,
  scopeStateToSarja,
  buildHeroTiles,
  buildTimelinePanel,
  buildTopGamesPanel,
  buildTrendsPanel,
  TREND_WINDOWS,
} from "./dashboard.js";

const STORAGE_KEY = "saipa-lipputilanne:summaryStripOpen";
const TITLE = "Kauden luvut";

// Shown only while collapsed. Closed-by-default means the strip has to earn
// its own click, and "what is behind this" does that far better than a bare
// title does.
const HINT = "Tunnusluvut, yleisömäärät, myydyimmät ottelut ja irtolippujen myynti";

// Hard limits, no "Näytä kaikki" fold: the strip is a teaser for the full
// dashboard, not the place to read a whole ranking.
//
// The two counts differ on purpose. The three panels sit in one grid row, so
// they stretch to a shared height, and a row of Myydyimmät ottelut is about
// half again as tall as a trend row (label+value, bar, meta line vs. one
// line with a sparkline). Matching the counts left one column with a large
// dead gap at the bottom; these numbers are tuned so all three columns end
// at roughly the same place. Re-measure if either row's anatomy changes.
const TOP_GAMES_ROWS = 5;
const TREND_ROWS = 8;

// Closed by default — the card list is what the front page is for, and the
// strip's data (one history.json per game) is only fetched once someone opens
// it. This is a HOW-axis preference like js/recencyPreference.js, not a filter;
// see js/urlState.js for the distinction. Unlike that module the storage access
// is guarded: this runs during the front page's very first render, and a
// browser that throws on localStorage (blocked site data) must not take the
// whole page down with it.
function readOpenPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeOpenPreference(open) {
  try {
    localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
  } catch {
    // The preference just doesn't survive the visit; the strip still works.
  }
}

function buildMessage(className, text) {
  const p = document.createElement("p");
  p.className = className;
  p.textContent = text;
  return p;
}

export function buildSummaryStrip({ kausikortti, matchEvents }) {
  const element = document.createElement("section");
  element.className = "summary-strip";

  const body = document.createElement("div");
  body.className = "summary-strip__body";
  body.id = "summary-strip-body";

  // Header row is both opener and closer, matching the card's own disclosure
  // (buildHeader/setExpanded in js/card.js) right down to reusing
  // .card__chevron — which already carries the prefers-reduced-motion guard.
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "summary-strip__toggle";
  toggle.setAttribute("aria-controls", body.id);

  const label = document.createElement("span");
  label.className = "summary-strip__label";
  const title = document.createElement("span");
  title.className = "summary-strip__title";
  title.textContent = TITLE;
  const hint = document.createElement("span");
  hint.className = "summary-strip__hint";
  hint.textContent = HINT;
  label.append(title, hint);

  const chevron = document.createElement("span");
  chevron.className = "card__chevron";
  toggle.append(label, chevron);

  element.append(toggle, body);

  // Prepared season state cached per kausi: getHistory() is uncached and
  // undeduped (js/fetchData.js), so switching seasons back and forth would
  // otherwise refetch every game's history.json every time.
  const seasonCache = new Map();

  let open = readOpenPreference();
  let requested = null; // { kausi, sarja } last asked for by app.js
  let rendered = null; // { kausi, sarja } currently drawn in `body`
  // Guards against an out-of-order paint when a slow season fetch is
  // superseded by a faster one (kausi switched twice in quick succession).
  let renderToken = 0;

  function setExpanded(value) {
    open = value;
    body.hidden = !value;
    toggle.setAttribute("aria-expanded", String(value));
  }

  function paint(base, sarja) {
    const state = scopeStateToSarja(base, sarja);

    const grid = document.createElement("div");
    grid.className = "dashboard-grid";

    // Panels return null when they'd have nothing to say — same contract as on
    // the dashboard, where an empty analysis earns no screen space.
    const timeline = buildTimelinePanel(state);
    if (timeline) {
      // Only meaningful inside a grid: the modifier is just grid-column: 1/-1.
      timeline.classList.add("dashboard-panel--wide");
      grid.append(timeline);
    }
    const topGames = buildTopGamesPanel(state, { limit: TOP_GAMES_ROWS, expandable: false });
    if (topGames) grid.append(topGames);
    for (const window of TREND_WINDOWS) {
      const trends = buildTrendsPanel(state, { ...window, limit: TREND_ROWS });
      if (trends) grid.append(trends);
    }

    body.replaceChildren(buildHeroTiles(state), grid);
  }

  async function draw() {
    if (!open || !requested) return;

    const { kausi, sarja } = requested;
    if (rendered && rendered.kausi === kausi && rendered.sarja === sarja) return;

    const token = ++renderToken;
    let base = seasonCache.get(kausi);

    if (!base) {
      body.replaceChildren(buildMessage("summary-strip__loading", "Ladataan lukuja…"));
      try {
        base = await prepareSeasonState({ kausikortti, matchEvents, kausi });
      } catch (err) {
        console.error("Failed to prepare summary strip data:", err);
        if (token === renderToken) {
          rendered = null;
          body.replaceChildren(
            buildMessage("summary-strip__loading", "Lukujen lataaminen epäonnistui.")
          );
        }
        return;
      }
      // Cache before the staleness check — the data is good regardless of
      // whether this particular paint still gets to happen.
      seasonCache.set(kausi, base);
      if (token !== renderToken) return;
    }

    rendered = { kausi, sarja };
    paint(base, sarja);
  }

  toggle.addEventListener("click", () => {
    setExpanded(!open);
    writeOpenPreference(open);
    if (open) void draw();
  });

  setExpanded(open);

  return {
    element,
    // Fire-and-forget from app.js: a closed strip only records what it would
    // have shown and fetches nothing, so a reader who never opens it pays for
    // none of this.
    update({ kausi, sarja }) {
      requested = { kausi, sarja };
      return draw();
    },
  };
}
