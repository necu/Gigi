// ── Home Page Layout Utilities ────────────────────────────────────────────────
// Shared between SettingsPage (editing) and HomePage (reading).

import { storage } from "./storage";

export const HOME_ROWS = [
  { id: "continue", label: "Continue Watching" },
  { id: "recent", label: "Recently Added" },
  { id: "favorites", label: "Favourites" },
  { id: "favoritePeople", label: "Favourite People" },
  { id: "favoritePeoplePicks", label: "From Favourite People" },
  { id: "smartCollections", label: "Smart Collections" },
  { id: "recommended", label: "Recommended for You" },
  { id: "trendingMovies", label: "Trending Movies" },
  { id: "trendingTV", label: "Trending Series" },
  { id: "topRated", label: "Top Rated" },
];

const DEFAULT_ROW_ORDER = HOME_ROWS.map((r) => r.id);
const DEFAULT_ROW_VISIBLE = Object.fromEntries(
  HOME_ROWS.map((r) => [r.id, true]),
);

export function loadHomeLayout() {
  const savedOrder = storage.get("homeRowOrder");
  const savedVisible = storage.get("homeRowVisible");
  const knownIds = new Set(HOME_ROWS.map((r) => r.id));

  let order = DEFAULT_ROW_ORDER;
  if (Array.isArray(savedOrder)) {
    order = savedOrder.filter((id) => knownIds.has(id));
    for (const id of DEFAULT_ROW_ORDER) {
      if (order.includes(id)) continue;
      if (id === "recent") {
        const continueIndex = order.indexOf("continue");
        order.splice(continueIndex >= 0 ? continueIndex + 1 : 0, 0, id);
      } else {
        order.push(id);
      }
    }
  }

  const visible = savedVisible
    ? { ...DEFAULT_ROW_VISIBLE, ...savedVisible }
    : DEFAULT_ROW_VISIBLE;

  return { order, visible };
}

export function saveHomeLayout(order, visible) {
  storage.set("homeRowOrder", order);
  storage.set("homeRowVisible", visible);
}

/** "carousel" (default) | "list" */
export function loadHomeViewMode() {
  return storage.get("homeViewMode") || "carousel";
}

export function saveHomeViewMode(mode) {
  storage.set("homeViewMode", mode);
}

export function loadStartPage() {
  return storage.get("startPage") || "home";
}
