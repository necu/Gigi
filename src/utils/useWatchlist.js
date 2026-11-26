// React bindings for the Watchlist 2.0 model backed by SQLite.
//
// Strategy: the hook keeps an optimistic in-memory copy so every interaction is
// instant, mirrors it to localStorage (backup + compatibility with the stock
// app) and persists each mutation to the SQLite database in the main process.
// On first run the database is seeded from the existing localStorage data.

import { useCallback, useEffect, useRef, useState } from "react";
import { storage } from "./storage";
import { watchlistDb } from "./watchlistDb";
import {
  addItem,
  buildWatchlistView,
  getWatchKey,
  loadWatchlist,
  normalizeEntry,
  removeItem,
  restoreItem,
  saveWatchlist,
  setOrder,
  updateItem,
} from "./watchlist";

const LEGACY_SAVED = "saved";

/** Merge entries added by the stock app while this build was closed. */
function mergeLegacySaved(state) {
  const legacy = storage.get(LEGACY_SAVED);
  if (!legacy || typeof legacy !== "object") return { state, added: [] };
  const items = { ...state.items };
  const order = [...state.order];
  const added = [];
  for (const [key, raw] of Object.entries(legacy)) {
    if (!raw || raw.id == null || items[key]) continue;
    const entry = normalizeEntry(raw, key, order.length);
    if (!entry) continue;
    items[key] = entry;
    order.push(key);
    added.push(entry);
  }
  if (added.length === 0) return { state, added };
  return {
    state: { ...state, items, order, updatedAt: Date.now() },
    added,
  };
}

export function useWatchlist() {
  const [state, setState] = useState(loadWatchlist);
  const [ready, setReady] = useState(false);
  const [storageMode, setStorageMode] = useState("local"); // 'local' | 'sqlite'
  const stateRef = useRef(state);
  stateRef.current = state;

  // ── Initial load: SQLite first, localStorage as fallback / seed ───────────
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const result = await watchlistDb.load();
      if (cancelled) return;

      if (!result?.ok || !result.state) {
        // Database unavailable: keep working from localStorage.
        setStorageMode("local");
        setReady(true);
        return;
      }

      const dbState = result.state;
      const local = loadWatchlist();
      const dbCount = Object.keys(dbState.items || {}).length;
      const localCount = Object.keys(local.items || {}).length;

      if (dbCount === 0 && localCount > 0) {
        // First run with SQLite: seed from the existing localStorage library.
        const imported = await watchlistDb.importState(local, { replace: false });
        if (cancelled) return;
        if (!imported?.ok) {
          // Never swap a non-empty local library for an empty database: keep
          // working from localStorage until the next launch can seed it.
          setStorageMode("local");
          setReady(true);
          return;
        }
        stateRef.current = local;
        setState(local);
        setStorageMode("sqlite");
        setReady(true);
        return;
      }

      // Pick up favourites added by the stock app while this build was closed.
      const { state: merged, added } = mergeLegacySaved(dbState);
      if (added.length > 0) {
        const addedKeys = added.map((entry) => getWatchKey(entry));
        await watchlistDb.importState(
          {
            version: 2,
            items: Object.fromEntries(
              added.map((entry, index) => [addedKeys[index], entry]),
            ),
            order: addedKeys,
          },
          { replace: false },
        );
      }
      if (cancelled) return;
      stateRef.current = merged;
      setState(merged);
      setStorageMode("sqlite");
      setReady(true);
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  // localStorage mirror (keeps legacy `saved` / `savedOrder` in sync).
  useEffect(() => {
    saveWatchlist(state);
  }, [state]);

  // Apply a pure mutation synchronously so back-to-back calls never clobber.
  const apply = useCallback((mutator) => {
    const current = stateRef.current;
    const next = mutator(current);
    if (next === current) return current;
    stateRef.current = next;
    setState(next);
    return next;
  }, []);

  const add = useCallback(
    (item, patch) => {
      const next = apply((current) => addItem(current, item, patch));
      const key = getWatchKey(item);
      const entry = key ? next.items[key] : null;
      if (entry) watchlistDb.upsert(entry);
      return entry;
    },
    [apply],
  );

  const remove = useCallback(
    (key) => {
      apply((current) => removeItem(current, key));
      if (key) watchlistDb.remove(key);
    },
    [apply],
  );

  const removeMany = useCallback(
    (keys) => {
      const list = [...new Set((keys || []).filter(Boolean))];
      if (list.length === 0) return;
      apply((current) => list.reduce((acc, key) => removeItem(acc, key), current));
      watchlistDb.removeMany(list);
    },
    [apply],
  );

  const restore = useCallback(
    (entry, index = 0) => {
      const next = apply((current) => restoreItem(current, entry, index));
      const key = getWatchKey(entry);
      if (key && next.items[key]) watchlistDb.restore(next.items[key], index);
    },
    [apply],
  );

  const update = useCallback(
    (key, patch) => {
      const next = apply((current) => updateItem(current, key, patch));
      if (next.items[key]) watchlistDb.update(key, patch);
    },
    [apply],
  );

  const updateMany = useCallback(
    (keys, patch) => {
      const list = [...new Set((keys || []).filter(Boolean))];
      if (list.length === 0) return;
      apply((current) =>
        list.reduce((acc, key) => updateItem(acc, key, patch), current),
      );
      watchlistDb.bulkUpdate(list, patch);
    },
    [apply],
  );

  const reorder = useCallback(
    (order) => {
      const next = apply((current) => setOrder(current, order));
      watchlistDb.reorder(next.order);
    },
    [apply],
  );

  /** Returns true when the item was removed, false when it was added. */
  const toggle = useCallback(
    (item, patch) => {
      const key = getWatchKey(item);
      if (!key) return false;
      const current = stateRef.current;
      const wasSaved = !!current.items[key];
      const next = apply((state) =>
        wasSaved ? removeItem(state, key) : addItem(state, item, patch),
      );
      if (wasSaved) watchlistDb.remove(key);
      else if (next.items[key]) watchlistDb.upsert(next.items[key]);
      return wasSaved;
    },
    [apply],
  );

  const isSaved = useCallback((item) => {
    const key = getWatchKey(item);
    return !!(key && stateRef.current.items[key]);
  }, []);

  const getEntry = useCallback((item) => {
    const key = getWatchKey(item);
    return key ? stateRef.current.items[key] || null : null;
  }, []);

  const view = useCallback(
    (options) => buildWatchlistView(stateRef.current, options),
    [],
  );

  return {
    state,
    items: state.items,
    order: state.order,
    ready,
    storageMode,
    add,
    remove,
    removeMany,
    restore,
    update,
    updateMany,
    reorder,
    toggle,
    isSaved,
    getEntry,
    view,
  };
}
