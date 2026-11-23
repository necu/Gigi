// ── Renderer client for the search database ───────────────────────────────────
// Mirrors the SQLite-backed search memory, with a localStorage fallback so the
// search UI keeps remembering queries even outside Electron.

import { storage } from "./storage";

const LOCAL_KEY = "searchMemory";
const LOCAL_MAX = 30;

function bridge() {
  if (typeof window === "undefined") return null;
  return window.electron?.searchDb || null;
}

async function call(method, ...args) {
  const api = bridge();
  if (!api || typeof api[method] !== "function") return null;
  try {
    return await api[method](...args);
  } catch (error) {
    console.warn(`[search-db] ${method} failed:`, error?.message || error);
    return null;
  }
}

function readLocal() {
  const list = storage.get(LOCAL_KEY);
  return Array.isArray(list) ? list : [];
}

function writeLocal(list) {
  storage.set(LOCAL_KEY, list.slice(0, LOCAL_MAX));
}

export const searchDb = {
  async available() {
    const result = await call("available");
    return !!result?.available;
  },

  async record({ query, resultCount = 0, kind = "text" }) {
    const result = await call("record", { query, resultCount, kind });
    if (result?.ok) return result;

    const trimmed = String(query || "").trim();
    if (!trimmed) return result;
    const normalized = trimmed.toLowerCase();
    const current = readLocal();
    const existing = current.find(
      (entry) => entry.query.toLowerCase() === normalized,
    );
    const next = [
      {
        query: trimmed,
        uses: (existing?.uses || 0) + 1,
        lastUsed: Date.now(),
        bestKey: existing?.bestKey || null,
        bestTitle: existing?.bestTitle || null,
      },
      ...current.filter((entry) => entry.query.toLowerCase() !== normalized),
    ];
    writeLocal(next);
    return result;
  },

  async recordPick({ query, key, title, mediaType }) {
    const result = await call("recordPick", { query, key, title, mediaType });
    if (result?.ok) return result;

    const trimmed = String(query || "").trim();
    if (!trimmed || !key) return result;
    const normalized = trimmed.toLowerCase();
    const current = readLocal();
    const next = current.map((entry) =>
      entry.query.toLowerCase() === normalized
        ? { ...entry, bestKey: key, bestTitle: title || entry.bestTitle }
        : entry,
    );
    if (!next.some((entry) => entry.query.toLowerCase() === normalized)) {
      next.unshift({
        query: trimmed,
        uses: 1,
        lastUsed: Date.now(),
        bestKey: key,
        bestTitle: title || null,
      });
    }
    writeLocal(next);
    return result;
  },

  async suggest(limit = 20) {
    const result = await call("suggest", limit);
    if (result?.ok) return result.suggestions || [];
    return readLocal().slice(0, limit);
  },

  async boosts() {
    const result = await call("boosts");
    if (result?.ok) return result.boosts || {};
    const boosts = {};
    for (const entry of readLocal()) {
      if (entry.bestKey) boosts[entry.bestKey] = 1;
    }
    return boosts;
  },

  async stats() {
    const result = await call("stats");
    return result?.ok ? result : { searches: 0, queries: 0, picks: 0, titles: 0 };
  },

  async clear() {
    const result = await call("clear");
    writeLocal([]);
    return result;
  },
};

export default searchDb;
