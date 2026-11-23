// React binding for the Related Engine.
// Cancels stale requests when the user navigates to another title.

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchRelated } from "./related";

const EMPTY = {
  items: [],
  seed: null,
  loading: false,
  error: null,
  stage: null,
  cached: false,
};

export function useRelated(type, id, apiKey, limit = 18) {
  const [state, setState] = useState(EMPTY);
  const requestRef = useRef(0);

  const load = useCallback(
    async (force = false) => {
      const requestId = ++requestRef.current;
      setState((prev) => ({
        ...prev,
        loading: true,
        error: null,
        stage: "seed",
      }));

      try {
        const result = await fetchRelated({
          type,
          id,
          apiKey,
          limit,
          force,
          onProgress: (progress) => {
            if (requestId !== requestRef.current) return;
            setState((prev) => ({ ...prev, stage: progress.stage }));
          },
        });
        if (requestId !== requestRef.current) return;
        setState({
          items: result.items || [],
          seed: result.seed || null,
          loading: false,
          error: null,
          stage: null,
          cached: !!result.cached,
        });
      } catch (error) {
        if (requestId !== requestRef.current) return;
        setState({
          items: [],
          seed: null,
          loading: false,
          error: error?.message || "Could not load related titles",
          stage: null,
          cached: false,
        });
      }
    },
    [type, id, apiKey, limit],
  );

  useEffect(() => {
    load(false);
    return () => {
      requestRef.current++;
    };
  }, [load]);

  const reload = useCallback(() => load(true), [load]);

  return { ...state, reload };
}
