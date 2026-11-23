// ── Watchlist 2.0 ─────────────────────────────────────────────────────────────
// Versioned watchlist model with migration from the legacy `saved` /
// `savedOrder` pair. Everything lives in localStorage and stays compatible
// with the stock app: every write also refreshes the legacy keys.

import { storage } from "./storage";

export const WATCHLIST_KEY = "watchlist";
export const WATCHLIST_VERSION = 2;
const LEGACY_SAVED = "saved";
const LEGACY_ORDER = "savedOrder";
const MAX_ITEMS = 5000;

export const WATCH_STATUSES = [
  { id: "planned", label: "Planned", short: "Planned", color: "#8b8b9e" },
  { id: "watching", label: "Watching", short: "Watching", color: "#4caf50" },
  { id: "done", label: "Completed", short: "Done", color: "#3b82f6" },
  { id: "dropped", label: "Dropped", short: "Dropped", color: "#e5484d" },
];

export const WATCH_STATUS_IDS = WATCH_STATUSES.map((s) => s.id);
export const DEFAULT_STATUS = "planned";

export const SORT_OPTIONS = [
  { value: "manual", label: "Custom order" },
  { value: "added", label: "Recently added" },
  { value: "title", label: "Title A-Z" },
  { value: "rating", label: "Best rated" },
  { value: "year", label: "Newest first" },
  { value: "status", label: "Status" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const uniq = (values) => [...new Set((values || []).filter(Boolean))];

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

const asNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const normalizeStatus = (status) =>
  WATCH_STATUS_IDS.includes(status) ? status : DEFAULT_STATUS;

const normalizeRating = (value) => {
  const n = asNumber(value);
  if (n == null) return null;
  return clamp(Math.round(n * 10) / 10, 0, 10);
};

const genreIds = (item) => {
  if (Array.isArray(item?.genres)) {
    return item.genres
      .map((g) => (typeof g === "number" ? g : g?.id))
      .filter((id) => id != null);
  }
  return Array.isArray(item?.genre_ids) ? item.genre_ids : [];
};

export function detectAnime(item) {
  if (!item) return false;
  if (typeof item.isAnime === "boolean") return item.isAnime;
  const ids = genreIds(item);
  const hasAnimation = ids.includes(16);
  const lang = item.original_language;
  const countries = item.origin_country || [];
  return hasAnimation && (lang === "ja" || countries.includes("JP"));
}

export function getWatchKey(item) {
  if (!item) return null;
  const type = item.media_type || (item.first_air_date ? "tv" : "movie");
  return `${type === "tv" ? "tv" : "movie"}_${item.id}`;
}

/** Stable, flat entry stored in the watchlist. */
export function normalizeEntry(item, key, index = 0, now = Date.now()) {
  if (!item || item.id == null) return null;
  const mediaType =
    item.media_type === "tv" || (key || "").startsWith("tv_") ? "tv" : "movie";
  const addedAt = asNumber(item.addedAt) ?? now - index * 1000;
  const year =
    item.year ||
    (item.release_date || item.first_air_date || "").slice(0, 4) ||
    "";
  return {
    id: item.id,
    media_type: mediaType,
    title: item.title || item.name || "",
    poster_path: item.poster_path || null,
    backdrop_path: item.backdrop_path || null,
    year: String(year),
    vote_average: asNumber(item.vote_average),
    vote_count: asNumber(item.vote_count),
    popularity: asNumber(item.popularity),
    overview: item.overview || "",
    original_language: item.original_language || null,
    origin_country: Array.isArray(item.origin_country)
      ? item.origin_country
      : [],
    genres: genreIds(item),
    isAnime: detectAnime(item),
    runtime: asNumber(item.runtime) ?? asNumber(item.episode_run_time?.[0]),
    addedAt,
    updatedAt: asNumber(item.updatedAt) ?? addedAt,
    status: normalizeStatus(item.status),
    tags: uniq(item.tags),
    collections: uniq(item.collections),
    personalRating: normalizeRating(item.personalRating),
    notes: typeof item.notes === "string" ? item.notes : "",
    lastEpisode:
      item.lastEpisode && typeof item.lastEpisode === "object"
        ? item.lastEpisode
        : null,
  };
}

export function emptyWatchlist() {
  return {
    version: WATCHLIST_VERSION,
    items: {},
    order: [],
    updatedAt: Date.now(),
  };
}

// ── Loading + migration ──────────────────────────────────────────────────────

function normalizeOrder(order, items) {
  const seen = new Set();
  const result = [];
  for (const key of order || []) {
    if (items[key] && !seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  }
  for (const key of Object.keys(items)) {
    if (!seen.has(key)) result.push(key);
  }
  return result;
}

/** Pick up favourites added by the stock app while this build was closed. */
function mergeLegacy(state) {
  const legacy = storage.get(LEGACY_SAVED);
  if (!legacy || typeof legacy !== "object") return state;
  let changed = false;
  for (const [key, raw] of Object.entries(legacy)) {
    if (!raw || raw.id == null || state.items[key]) continue;
    const entry = normalizeEntry(raw, key, state.order.length);
    if (!entry) continue;
    state.items[key] = entry;
    state.order.push(key);
    changed = true;
  }
  return changed ? state : state;
}

export function loadWatchlist() {
  const stored = storage.get(WATCHLIST_KEY);
  if (
    stored &&
    stored.version === WATCHLIST_VERSION &&
    stored.items &&
    typeof stored.items === "object"
  ) {
    const items = {};
    for (const [key, raw] of Object.entries(stored.items)) {
      const entry = normalizeEntry(raw, key, 0, raw?.addedAt);
      if (entry) items[key] = entry;
    }
    const state = {
      version: WATCHLIST_VERSION,
      items,
      order: normalizeOrder(stored.order, items),
      updatedAt: asNumber(stored.updatedAt) ?? Date.now(),
    };
    return mergeLegacy(state);
  }
  return migrateLegacy();
}

export function migrateLegacy() {
  const legacy = storage.get(LEGACY_SAVED) || {};
  const legacyOrder = storage.get(LEGACY_ORDER);
  const keys = Array.isArray(legacyOrder)
    ? [
        ...legacyOrder.filter((key) => legacy[key]),
        ...Object.keys(legacy).filter((key) => !legacyOrder.includes(key)),
      ]
    : Object.keys(legacy);
  const now = Date.now();
  const items = {};
  keys.forEach((key, index) => {
    const entry = normalizeEntry(legacy[key], key, index, now);
    if (entry) items[key] = entry;
  });
  return {
    version: WATCHLIST_VERSION,
    items,
    order: normalizeOrder(keys, items),
    updatedAt: now,
  };
}

// ── Persistence ──────────────────────────────────────────────────────────────

function toLegacyEntry(entry) {
  return {
    id: entry.id,
    title: entry.title,
    poster_path: entry.poster_path,
    media_type: entry.media_type,
    vote_average: entry.vote_average,
    year: entry.year,
  };
}

/** Persists v2 and refreshes the legacy keys so both builds stay in sync. */
export function saveWatchlist(state) {
  const next = {
    ...state,
    version: WATCHLIST_VERSION,
    updatedAt: Date.now(),
  };
  storage.set(WATCHLIST_KEY, next);

  const legacy = {};
  for (const key of next.order) {
    const entry = next.items[key];
    if (entry) legacy[key] = toLegacyEntry(entry);
  }
  storage.set(LEGACY_SAVED, legacy);
  storage.set(LEGACY_ORDER, next.order.filter((key) => next.items[key]));
  return next;
}

// ── Mutations (pure) ─────────────────────────────────────────────────────────

export function addItem(state, item, patch = {}) {
  const key = getWatchKey(item);
  if (!key) return state;
  const existing = state.items[key];
  if (!existing && Object.keys(state.items).length >= MAX_ITEMS) return state;

  const now = Date.now();
  const entry = normalizeEntry(
    { ...(existing || {}), ...item, ...patch },
    key,
    0,
    now,
  );
  if (!entry) return state;
  if (existing) entry.addedAt = existing.addedAt;
  entry.updatedAt = now;

  return {
    ...state,
    items: { ...state.items, [key]: entry },
    order: existing ? state.order : [...state.order, key],
    updatedAt: now,
  };
}

export function restoreItem(state, entry, index = 0) {
  const key = getWatchKey(entry);
  if (!key) return state;
  const normalized = normalizeEntry(entry, key, 0, entry.addedAt);
  if (!normalized) return state;
  const order = state.order.filter((k) => k !== key);
  order.splice(clamp(index, 0, order.length), 0, key);
  return {
    ...state,
    items: { ...state.items, [key]: normalized },
    order,
    updatedAt: Date.now(),
  };
}

export function removeItem(state, key) {
  if (!state.items[key]) return state;
  const items = { ...state.items };
  delete items[key];
  return {
    ...state,
    items,
    order: state.order.filter((k) => k !== key),
    updatedAt: Date.now(),
  };
}

export function updateItem(state, key, patch) {
  const existing = state.items[key];
  if (!existing) return state;
  const entry = normalizeEntry({ ...existing, ...patch }, key, 0, Date.now());
  if (!entry) return state;
  entry.addedAt = existing.addedAt;
  entry.updatedAt = Date.now();
  return {
    ...state,
    items: { ...state.items, [key]: entry },
    updatedAt: entry.updatedAt,
  };
}

export function setOrder(state, order) {
  const nextOrder = normalizeOrder(order, state.items);
  return { ...state, order: nextOrder, updatedAt: Date.now() };
}

// ── Selectors ────────────────────────────────────────────────────────────────

const statusRank = (status) => {
  const index = WATCH_STATUS_IDS.indexOf(status);
  return index === -1 ? WATCH_STATUS_IDS.length : index;
};

function matchesQuery(entry, query) {
  if (!query) return true;
  const haystack = [
    entry.title,
    entry.year,
    entry.notes,
    ...entry.tags,
    ...entry.collections,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

function matchesTypes(entry, types) {
  if (!types || types.length === 0) return true;
  return types.some((type) => {
    if (type === "anime") return entry.isAnime;
    if (type === "movie") return entry.media_type === "movie";
    if (type === "tv") return entry.media_type === "tv";
    return true;
  });
}

export function buildWatchlistView(state, options = {}) {
  const {
    query = "",
    types = [],
    statuses = [],
    tags = [],
    collection = null,
    sort = "manual",
    dir = "asc",
  } = options;

  const all = (state.order || [])
    .map((key) => state.items[key])
    .filter(Boolean);

  const filtered = all.filter((entry) => {
    if (!matchesQuery(entry, query)) return false;
    if (!matchesTypes(entry, types)) return false;
    if (statuses.length > 0 && !statuses.includes(entry.status)) return false;
    if (tags.length > 0 && !tags.some((tag) => entry.tags.includes(tag)))
      return false;
    if (collection && !entry.collections.includes(collection)) return false;
    return true;
  });

  const direction = dir === "desc" ? -1 : 1;
  const sorted = [...filtered];
  switch (sort) {
    case "added":
      sorted.sort((a, b) => (a.addedAt - b.addedAt) * direction);
      break;
    case "title":
      sorted.sort((a, b) => a.title.localeCompare(b.title) * direction);
      break;
    case "rating":
      sorted.sort(
        (a, b) =>
          ((a.personalRating ?? a.vote_average ?? 0) -
            (b.personalRating ?? b.vote_average ?? 0)) *
          direction,
      );
      break;
    case "year":
      sorted.sort((a, b) => (Number(a.year) - Number(b.year)) * direction);
      break;
    case "status":
      sorted.sort(
        (a, b) => (statusRank(a.status) - statusRank(b.status)) * direction,
      );
      break;
    default:
      // manual: keep the stored order (direction is ignored on purpose)
      break;
  }

  // Build every facet in one pass. The previous version walked the full
  // library once per facet (and created several temporary arrays), which was
  // noticeable with large libraries.
  const statusCounts = Object.fromEntries(
    WATCH_STATUS_IDS.map((id) => [id, 0]),
  );
  const tagCounts = new Map();
  const collectionCounts = new Map();
  const yearCounts = new Map();
  let movies = 0;
  let tv = 0;
  let anime = 0;

  for (const entry of all) {
    if (entry.media_type === "movie") movies += 1;
    else if (entry.media_type === "tv") tv += 1;
    if (entry.isAnime) anime += 1;
    if (entry.status in statusCounts) statusCounts[entry.status] += 1;
    for (const tag of entry.tags || []) {
      if (tag) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
    for (const collection of entry.collections || []) {
      if (collection) {
        collectionCounts.set(
          collection,
          (collectionCounts.get(collection) || 0) + 1,
        );
      }
    }
    if (entry.year) {
      yearCounts.set(entry.year, (yearCounts.get(entry.year) || 0) + 1);
    }
  }

  const facets = {
    total: all.length,
    movies,
    tv,
    anime,
    statuses: statusCounts,
    tags: countValues(tagCounts),
    collections: countValues(collectionCounts),
    years: countValues(yearCounts).sort(
      (a, b) => Number(b.value) - Number(a.value),
    ),
  };

  return {
    items: sorted,
    filtered: sorted.length,
    facets,
  };
}

function countValues(map) {
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
