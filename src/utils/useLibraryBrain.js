// React binding for the "For you" shelf.
// The discovery layer caches each seed for a day, so re-mounting the library
// is cheap; the merged shelf is recomputed when the library itself changes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { recommendForLibrary } from "./searchBrain";
import { getWatchKey } from "./watchlist";

const EMPTY = { items: [], seeds: [], loading: false, error: null };

export function useLibraryRecommendations({ entries, apiKey, enabled = true }) {
  const signature = useMemo(
    () => (entries || []).map(getWatchKey).sort().join("|"),
    [entries],
  );
  const entriesRef = useRef(entries || []);
  entriesRef.current = entries || [];

  const [state, setState] = useState(EMPTY);
  const requestRef = useRef(0);

  const load = useCallback(
    async (force = false) => {
      if (!apiKey || entriesRef.current.length === 0) {
        setState(EMPTY);
        return;
      }
      const requestId = ++requestRef.current;
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const result = await recommendForLibrary({
          entries: entriesRef.current,
          apiKey,
          limit: 14,
          force,
        });
        if (requestId !== requestRef.current) return;
        setState({
          items: result.items || [],
          seeds: result.seeds || [],
          loading: false,
          error: null,
        });
      } catch {
        if (requestId !== requestRef.current) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: "Could not build recommendations right now.",
        }));
      }
    },
    [apiKey, signature],
  );

  useEffect(() => {
    if (!enabled) return;
    // Debounced: adding a 20-part saga updates the library 20 times. Without
    // this the shelf would recompute (and hit TMDB) on every single part.
    const timer = setTimeout(() => load(false), 900);
    return () => {
      clearTimeout(timer);
      requestRef.current += 1;
    };
  }, [load, enabled]);

  const reload = useCallback(() => load(true), [load]);

  return { ...state, reload };
}

export default useLibraryRecommendations;
