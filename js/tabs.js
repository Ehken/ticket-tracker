import { writeUrlState } from "./urlState.js";

// Builds the tab bar only. Rendering the active tab's card list (or the
// Runkosarja placeholder) is app.js's job, same as everywhere else it
// composes fetched data with DOM building.
export function buildTabBar({ tabs, activeTab, onSelect }) {
  const nav = document.createElement("div");
  nav.className = "tabs";
  nav.setAttribute("role", "tablist");

  for (const tabInfo of tabs) {
    if (!tabInfo.visible) continue;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab";
    button.textContent = tabInfo.label;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(tabInfo.tab === activeTab));
    button.disabled = tabInfo.disabled;
    if (tabInfo.tab === activeTab) button.classList.add("tab--active");
    if (tabInfo.disabled) button.classList.add("tab--disabled");

    if (!tabInfo.disabled) {
      button.addEventListener("click", () => {
        writeUrlState({ tab: tabInfo.tab });
        onSelect(tabInfo.tab);
      });
    }

    nav.append(button);
  }

  return nav;
}
