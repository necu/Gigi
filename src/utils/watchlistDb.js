// ── Renderer client for the SQLite watchlist ──────────────────────────────────
// Thin, failure-tolerant wrapper around the preload bridge. Every call resolves
// to a plain object; when the database is unavailable the helpers return null
// and the caller keeps working from localStorage.

export function getWatchlistDb() {
  if (typeof window === "undefined") return null;
  return window.electron?.watchlistDb || null;
}

export function hasWatchlistDb() {
  return getWatchlistDb() != null;
}

async function call(method, ...args) {
  const api = getWatchlistDb();
  if (!api || typeof api[method] !== "function") return null;
  try {
    return await api[method](...args);
  } catch (error) {
    console.warn(`[watchlist-db] ${method} failed:`, error?.message || error);
    return null;
  }
}

export const watchlistDb = {
  available: () => call("available"),
  load: () => call("load"),
  upsert: (entry, patch) => call("upsert", entry, patch),
  update: (key, patch) => call("update", key, patch),
  remove: (key) => call("remove", key),
  removeMany: (keys) => call("removeMany", keys),
  restore: (entry, index) => call("restore", entry, index),
  reorder: (order) => call("reorder", order),
  bulkUpdate: (keys, patch) => call("bulkUpdate", keys, patch),
  importState: (state, options) => call("importState", state, options),
  exportState: () => call("exportState"),
  search: (options) => call("search", options),
  stats: () => call("stats"),
  tags: () => call("tags"),
  collections: () => call("collections"),
  playlists: () => call("playlists"),
  playlistsFull: () => call("playlistsFull"),
  getPlaylist: (id) => call("getPlaylist", id),
  savePlaylist: (playlist) => call("savePlaylist", playlist),
  deletePlaylist: (id) => call("deletePlaylist", id),
  touchPlaylist: (id) => call("touchPlaylist", id),
  renameCollection: (from, to) => call("renameCollection", from, to),
  deleteCollection: (name) => call("deleteCollection", name),
  prune: () => call("prune"),
  integrity: () => call("integrity"),
  checkpoint: () => call("checkpoint"),
};

export default watchlistDb;
