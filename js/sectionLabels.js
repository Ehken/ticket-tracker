// Single source of truth for section-key -> Finnish display label. The data
// key itself (from elippu's payload) never changes — only what we show.
export const SECTION_LABELS = {
  seisomakatsomo: "Kaukaan pääty",
  invalid: "Pyörätuolipaikat",
  aitiot: "Aitiot",
  press: "Lehdistö",
};

export function sectionLabel(section) {
  return SECTION_LABELS[section] ?? section; // seated sections (A1..D2) pass through unchanged
}
