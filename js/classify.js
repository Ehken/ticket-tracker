// The single reusable "read classification + merge" module. A future admin UI
// that edits data/overrides.json (e.g. via GitHub's API) is a drop-in here —
// nothing else in the frontend needs to change.
//
// Precedence: overrides.json > autoclass.json > default "muu". The scraper
// writes autoclass.json (write-once, from schedule.json matches); overrides.json
// is manually curated and always wins when both exist for the same event.

export function toDashId(id) {
  return id.replace(/:/g, "-");
}

export function mergeClassification(event, { overrides, autoclass }) {
  // Both overrides.json and autoclass.json are keyed by the dash/directory-safe
  // id (e.g. "53-575"), not the raw colon-format event id ("53:575").
  const dashId = toDashId(event.id);
  const override = overrides[dashId] ?? {};
  const auto = autoclass[dashId] ?? {};

  return {
    id: event.id,
    name: override.displayName ?? event.name,
    gameType: override.gameType ?? auto.gameType ?? "muu",
    season: override.season ?? auto.season ?? null,
    hidden: override.hidden ?? false,
    note: override.note ?? "",
    status: event.status,
    start: event.start,
    firstSeen: event.firstSeen,
    lastSeen: event.lastSeen,
  };
}
