import { useState, useEffect, useMemo } from "react";
import {
  fetchMovieRating,
  fetchTVRating,
  getAgeLimitSetting,
  getRatingCountry,
} from "./ageRating";
import { storage, getApiKey } from "./storage";

const CACHE_KEY = "ratingsCache";
const CACHE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days
const BATCH_SIZE = 4;

// Read the whole cache once and return it, caller holds reference
function readCache() {
  try {
    return storage.get(CACHE_KEY) || {};
  } catch {
    return {};
  }
}

function writeCache(cache) {
  try {
    storage.set(CACHE_KEY, cache);
  } catch {}
}

// Evict entries older than TTL and return the cleaned cache
function evictStale(cache) {
  const now = Date.now();
  for (const key of Object.keys(cache)) {
    if (now - cache[key].ts > CACHE_TTL) {
      delete cache[key];
    }
  }
  return cache;
}

/**
 * Hook that fetches + caches age ratings for an array of items.
 *
 * Items are deduplicated before requesting, and requests run in small batches
 * (TMDB already caps concurrency at 4). This avoids fetching the same title
 * several times when it appears in multiple Home rows, and avoids the old
 * one-request-at-a-time loop that made large rows feel slow.
 */
export function useRatings(items) {
  const [ratingsMap, setRatingsMap] = useState({});
  // Read stable settings once — these only change when user visits Settings,
  // which unmounts/remounts affected pages anyway, so useState(init) is correct.
  const [ageLimitSetting] = useState(() => getAgeLimitSetting(storage));
  const [ratingCountry] = useState(() => getRatingCountry(storage));
  const [apiKey] = useState(() => getApiKey());

  const uniqueItems = useMemo(() => {
    const seen = new Set();
    const unique = [];
    for (const item of items || []) {
      if (!item || item.id == null) continue;
      const type = item.media_type === "tv" ? "tv" : "movie";
      const key = `${type}_${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }
    return unique;
  }, [items]);

  const itemsKey = useMemo(
    () =>
      uniqueItems
        .map((item) => `${item.media_type === "tv" ? "tv" : "movie"}_${item.id}`)
        .sort()
        .join(","),
    [uniqueItems],
  );

  useEffect(() => {
    if (!itemsKey || !apiKey) return;

    // Read cache once for the whole effect run
    const cache = evictStale(readCache());
    let cacheModified = false;

    // Seed from cache immediately (no flash)
    const initial = {};
    const missing = [];
    for (const item of uniqueItems) {
      const type = item.media_type === "tv" ? "tv" : "movie";
      const cacheKey = `${type}_${item.id}_${ratingCountry}`;
      const entry = cache[cacheKey];
      const isValid = entry && Date.now() - entry.ts <= CACHE_TTL;
      if (isValid) {
        initial[`${type}_${item.id}`] = {
          cert: entry.cert,
          minAge: entry.minAge,
        };
      } else {
        missing.push(item);
      }
    }

    if (Object.keys(initial).length) {
      setRatingsMap((prev) => ({ ...prev, ...initial }));
    }

    if (!missing.length) return;

    let cancelled = false;
    (async () => {
      for (let start = 0; start < missing.length && !cancelled; start += BATCH_SIZE) {
        const batch = missing.slice(start, start + BATCH_SIZE);
        const updates = {};

        await Promise.all(
          batch.map(async (item) => {
            const type = item.media_type === "tv" ? "tv" : "movie";
            const mapKey = `${type}_${item.id}`;
            const cacheKey = `${type}_${item.id}_${ratingCountry}`;
            try {
              const result =
                type === "tv"
                  ? await fetchTVRating(item.id, apiKey, ratingCountry)
                  : await fetchMovieRating(item.id, apiKey, ratingCountry);
              if (cancelled) return;
              cache[cacheKey] = {
                cert: result.cert,
                minAge: result.minAge,
                ts: Date.now(),
              };
              cacheModified = true;
              updates[mapKey] = result;
            } catch {}
          }),
        );

        if (cancelled) break;
        if (Object.keys(updates).length) {
          setRatingsMap((prev) => ({ ...prev, ...updates }));
        }

        // Small gap between batches keeps us well below TMDB rate limits while
        // still being several times faster than a serial loop.
        if (start + BATCH_SIZE < missing.length) {
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
      }
      // Write cache once at the end instead of after each item
      if (cacheModified && !cancelled) writeCache(cache);
    })();

    return () => {
      cancelled = true;
    };
    // itemsKey changes only when the unique type/id set changes, so metadata
    // refreshes do not restart an in-progress ratings sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, apiKey, ratingCountry]);

  return { ratingsMap, ageLimitSetting, ratingCountry };
}

export function getRatingForItem(item, ratingsMap) {
  const type = item.media_type === "tv" ? "tv" : "movie";
  return ratingsMap[`${type}_${item.id}`] || { cert: null, minAge: null };
}
