// React bindings for mood playlists.
//
// SQLite is the source of truth, but the hook mirrors every playlist to
// localStorage as a fallback. That keeps playlists usable if node:sqlite is
// unavailable and makes the page work in browser-only development too.

import { useCallback, useEffect, useState } from "react";
import { storage } from "./storage";
import { watchlistDb } from "./watchlistDb";

const LOCAL_KEY = "playlists";

function newId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `pl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );
}

function readLocal() {
  const value = storage.get(LOCAL_KEY);
  return Array.isArray(value) ? value.filter((item) => item?.id) : [];
}

function writeLocal(list) {
  storage.set(LOCAL_KEY, list);
}

function toSummary(playlist) {
  const items = Array.isArray(playlist?.items) ? playlist.items : [];
  return {
    ...playlist,
    itemCount: Number(playlist?.itemCount ?? items.length) || 0,
    posterPath:
      playlist?.posterPath || items.find((item) => item?.poster_path)?.poster_path || null,
  };
}

export function usePlaylists() {
  const [playlists, setPlaylists] = useState(() => readLocal().map(toSummary));
  const [loading, setLoading] = useState(true);
  const [dbAvailable, setDbAvailable] = useState(false);

  const loadAll = useCallback(async () => {
    // One IPC round-trip for every playlist and its items. The fallback keeps
    // compatibility with an older preload that only exposes summaries.
    const full = await watchlistDb.playlistsFull();
    if (Array.isArray(full)) return full;

    const summaries = await watchlistDb.playlists();
    if (!Array.isArray(summaries)) return null;
    const withItems = [];
    for (const summary of summaries) {
      const detail = await watchlistDb.getPlaylist(summary.id);
      withItems.push(detail || summary);
    }
    return withItems;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const availability = await watchlistDb.available();
    const available = !!availability?.available;
    setDbAvailable(available);

    if (available) {
      let result = await loadAll();
      // First run after a fallback period: bring locally saved playlists into
      // the database instead of silently replacing them.
      if (Array.isArray(result) && result.length === 0) {
        const local = readLocal();
        if (local.length > 0) {
          for (const playlist of local) {
            await watchlistDb.savePlaylist(playlist);
          }
          result = await loadAll();
        }
      }
      if (Array.isArray(result)) {
        // If the database still has nothing after the import attempt, keep the
        // local mirror rather than losing playlists to a transient DB error.
        if (result.length === 0 && readLocal().length > 0) {
          setPlaylists(readLocal().map(toSummary));
          setLoading(false);
          return;
        }
        setPlaylists(result.map(toSummary));
        // One write with the full snapshots keeps the offline mirror complete.
        writeLocal(result);
        setLoading(false);
        return;
      }
    }

    setPlaylists(readLocal().map(toSummary));
    setLoading(false);
  }, [loadAll]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = useCallback(
    async (playlist) => {
      const fallback = {
        ...playlist,
        id: playlist?.id || newId(),
        updatedAt: Date.now(),
      };
      const result = await watchlistDb.savePlaylist(fallback);
      const saved =
        result?.ok && result.playlist ? result.playlist : toSummary(fallback);
      const local = readLocal().filter((item) => item.id !== saved.id);
      writeLocal([saved, ...local]);
      await refresh();
      return saved;
    },
    [refresh],
  );

  const load = useCallback(async (id) => {
    if (!id) return null;
    const fromDb = await watchlistDb.getPlaylist(id);
    if (fromDb) return fromDb;
    return readLocal().find((playlist) => playlist.id === id) || null;
  }, []);

  const remove = useCallback(
    async (id) => {
      if (!id) return false;
      const result = await watchlistDb.deletePlaylist(id);
      writeLocal(readLocal().filter((playlist) => playlist.id !== id));
      await refresh();
      return result?.ok !== false;
    },
    [refresh],
  );

  const touch = useCallback(async (id) => {
    if (!id || !dbAvailable) return;
    await watchlistDb.touchPlaylist(id);
  }, [dbAvailable]);

  return {
    playlists,
    loading,
    dbAvailable,
    refresh,
    save,
    load,
    remove,
    touch,
  };
}

export default usePlaylists;
