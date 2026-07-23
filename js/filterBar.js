import { writeUrlState } from "./urlState.js";

function buildKausiField({ seasons, hasMultipleSeasons, kausi, onChange }) {
  const wrapper = document.createElement("div");
  wrapper.className = "filter-bar__field filter-bar__field--kausi";
  wrapper.hidden = !hasMultipleSeasons;

  const select = document.createElement("select");
  select.setAttribute("aria-label", "Kausi");

  for (const season of seasons) {
    const option = document.createElement("option");
    option.value = season;
    option.textContent = season;
    select.append(option);
  }
  const kaikki = document.createElement("option");
  kaikki.value = "kaikki";
  kaikki.textContent = "Kaikki";
  select.append(kaikki);

  select.value = kausi;
  select.addEventListener("change", () => {
    writeUrlState({ kausi: select.value });
    onChange();
  });

  wrapper.append(select);
  return wrapper;
}

function buildSarjaField({ sarjaOptions, sarja, onChange }) {
  const wrapper = document.createElement("div");
  wrapper.className = "filter-bar__field filter-bar__field--sarja";

  const select = document.createElement("select");
  select.setAttribute("aria-label", "Sarja");

  for (const option of sarjaOptions) {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    el.disabled = !option.hasEvents; // shown but disabled, never hidden
    select.append(el);
  }

  select.value = sarja;
  select.addEventListener("change", () => {
    writeUrlState({ sarja: select.value === "kaikki" ? undefined : select.value });
    onChange();
  });

  wrapper.append(select);
  return wrapper;
}

function buildVastustajaField({ opponents, vastustaja, onChange }) {
  const wrapper = document.createElement("div");
  wrapper.className = "filter-bar__field filter-bar__field--vastustaja";

  const select = document.createElement("select");
  select.setAttribute("aria-label", "Vastustaja");

  const kaikki = document.createElement("option");
  kaikki.value = "kaikki";
  kaikki.textContent = "Kaikki";
  select.append(kaikki);

  for (const opponent of opponents) {
    const option = document.createElement("option");
    option.value = opponent;
    option.textContent = opponent;
    select.append(option);
  }

  select.value = vastustaja;
  select.addEventListener("change", () => {
    writeUrlState({ vastustaja: select.value === "kaikki" ? undefined : select.value });
    onChange();
  });

  wrapper.append(select);
  return wrapper;
}

function buildPelatutField({ pelatut, onChange }) {
  const label = document.createElement("label");
  label.className = "filter-bar__field filter-bar__field--pelatut";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = pelatut;
  checkbox.addEventListener("change", () => {
    writeUrlState({ pelatut: checkbox.checked ? "1" : undefined });
    onChange();
  });

  label.append(checkbox, document.createTextNode(" Näytä myös pelatut"));
  return label;
}

export function buildFilterBar({
  seasons,
  hasMultipleSeasons,
  kausi,
  sarjaOptions,
  sarja,
  opponents,
  vastustaja,
  pelatut,
  onChange,
}) {
  const bar = document.createElement("div");
  bar.className = "filter-bar";

  bar.append(
    buildKausiField({ seasons, hasMultipleSeasons, kausi, onChange }),
    buildSarjaField({ sarjaOptions, sarja, onChange }),
    buildVastustajaField({ opponents, vastustaja, onChange }),
    buildPelatutField({ pelatut, onChange })
  );

  return bar;
}
