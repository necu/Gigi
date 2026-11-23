// ── Saved library views ───────────────────────────────────────────────────────
// Small, portable filter presets. Built-ins are code-owned; custom views live in
// localStorage and are included in backups.

import { storage } from "./storage";

export const LIBRARY_VIEWS_STORAGE_KEY = "libraryViews";
export const MAX_CUSTOM_VIEWS = 24;

const filterDefaults = {
  query: "",
  typeTab: "all",
  statusFilter: "all",
  tagFilter: null,
  collectionFilter: "",
  sort: "",
  dir: "",
};

export const BUILTIN_LIBRARY_VIEWS = [
  {
    id: "all",
    name: "All titles",
    filters: { ...filterDefaults },
  },
  {
    id: "planned",
    name: "Planned",
    filters: { ...filterDefaults, statusFilter: "planned" },
  },
  {
    id: "watching",
    name: "Watching",
    filters: { ...filterDefaults, statusFilter: "watching" },
  },
  {
    id: "completed",
    name: "Completed",
    filters: { ...filterDefaults, statusFilter: "done" },
  },
  {
    id: "anime",
    name: "Anime",
    filters: { ...filterDefaults, typeTab: "anime" },
  },
];

function normalizeText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function normalizeLibraryFilters(filters = {}) {
  const tag =
    typeof filters.tagFilter === "string" && filters.tagFilter.trim()
      ? filters.tagFilter.trim()
      : null;

  return {
    query: normalizeText(filters.query).slice(0, 160),
    typeTab: ["all", "movie", "tv", "anime"].includes(filters.typeTab)
      ? filters.typeTab
      : "all",
    statusFilter: ["all", "planned", "watching", "done"].includes(
      filters.statusFilter,
    )
      ? filters.statusFilter
      : "all",
    tagFilter: tag,
    collectionFilter: normalizeText(filters.collectionFilter).slice(0, 160),
    sort: normalizeText(filters.sort).slice(0, 40),
    dir: filters.dir === "desc" ? "desc" : filters.dir === "asc" ? "asc" : "",
  };
}

export function loadLibraryViews() {
  const saved = storage.get(LIBRARY_VIEWS_STORAGE_KEY);
  if (!Array.isArray(saved)) return [];
  return saved
    .filter(
      (view) =>
        view &&
        typeof view === "object" &&
        typeof view.id === "string" &&
        typeof view.name === "string" &&
        view.name.trim(),
    )
    .slice(0, MAX_CUSTOM_VIEWS)
    .map((view) => ({
      id: view.id,
      name: view.name.trim().slice(0, 40),
      filters: normalizeLibraryFilters(view.filters),
    }));
}

export function saveLibraryView(name, filters) {
  const cleanName = String(name || "").trim().slice(0, 40);
  if (!cleanName) throw new Error("Give the view a name.");

  const views = loadLibraryViews();
  const normalized = normalizeLibraryFilters(filters);
  const existing = views.find(
    (view) => view.name.toLowerCase() === cleanName.toLowerCase(),
  );
  const nextView = existing
    ? { ...existing, name: cleanName, filters: normalized }
    : {
        id: `custom-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 6)}`,
        name: cleanName,
        filters: normalized,
      };

  const next = existing
    ? views.map((view) => (view.id === existing.id ? nextView : view))
    : [...views, nextView].slice(-MAX_CUSTOM_VIEWS);

  storage.set(LIBRARY_VIEWS_STORAGE_KEY, next);
  return nextView;
}

export function deleteLibraryView(id) {
  const next = loadLibraryViews().filter((view) => view.id !== id);
  storage.set(LIBRARY_VIEWS_STORAGE_KEY, next);
  return next;
}
