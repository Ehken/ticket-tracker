// Whether to show recently-freed/recently-sold seat marks on the map —
// a user PREFERENCE (how this person likes to view the map), not a
// filter (what they're viewing), which is why it lives in localStorage
// rather than the URL — see js/urlState.js's own top comment for the
// distinction this is the one deliberate exception to.
//
// One global key, not per-event: the preference follows the reader to
// every event and every future visit in the same browser. Default ON
// when the key has never been set.
const STORAGE_KEY = "saipa-lipputilanne:showRecencyMarks";

// In-page listeners, separate from localStorage's own "storage" event —
// that event only fires in OTHER tabs/windows, never the one that made
// the change, so it can't make the toggle live across multiple
// already-expanded cards on THIS page by itself.
const listeners = new Set();

export function getShowRecencyMarks() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === null ? true : raw === "1";
}

export function setShowRecencyMarks(value) {
  localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  listeners.forEach((fn) => fn(value));
}

export function onShowRecencyMarksChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
