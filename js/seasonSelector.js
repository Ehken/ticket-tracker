import { writeUrlState } from "./urlState.js";

// `hidden` only affects the <select>'s own visibility. The filtering logic
// (grouping.js's filterBySeason) always runs off the URL-derived value
// regardless of whether this control is shown — a ?kausi= deep link works
// even while the selector itself is hidden.
export function buildSeasonSelector({ seasons, hasMultipleSeasons, currentKausi, onChange }) {
  const wrapper = document.createElement("div");
  wrapper.className = "season-selector";
  wrapper.hidden = !hasMultipleSeasons;

  const select = document.createElement("select");
  select.setAttribute("aria-label", "Kausi");

  for (const season of seasons) {
    const option = document.createElement("option");
    option.value = season;
    option.textContent = season;
    select.append(option);
  }

  const kaikkiOption = document.createElement("option");
  kaikkiOption.value = "kaikki";
  kaikkiOption.textContent = "Kaikki";
  select.append(kaikkiOption);

  select.value = currentKausi;

  select.addEventListener("change", () => {
    writeUrlState({ kausi: select.value });
    onChange(select.value);
  });

  wrapper.append(select);
  return wrapper;
}
