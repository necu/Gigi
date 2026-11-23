// Session-persistent caches for Home feeds. TMDB's in-memory cache only lives
// for five minutes and disappears when a page is remounted, so navigating away
// from Home and back used to trigger every feed request again. These caches
// keep the shelves instant between visits without making the content stale for
// long.
import { storage, STORAGE_KEYS } from "./storage";

const FEED_CACHE_KEY = "homeFeedCache";
const RECOMMENDATION_CACHE_KEY = "homeRecommendationCache";
const FEED_TTL = 30 * 60 * 1000; // 30 minutes
const RECOMMENDATION_TTL = 15 * 60 * 1000; // 15 minutes

export function getHomeLanguage() {
  return storage.get(STORAGE_KEYS.TMDB_LANG) || "en-US";
}

function isFresh(entry, ttl) {
  return Boolean(
    entry &&
      Number.isFinite(entry.ts) &&
      Date.now() - entry.ts >= 0 &&
      Date.now() - entry.ts < ttl,
  );
}

export function readHomeFeedCache(lang = getHomeLanguage()) {
  const cached = storage.get(FEED_CACHE_KEY);
  if (!isFresh(cached, FEED_TTL) || cached.lang !== lang) return null;
  if (!Array.isArray(cached.topRated) || !Array.isArray(cached.popular)) {
    return null;
  }
  return { topRated: cached.topRated, popular: cached.popular };
}

export function writeHomeFeedCache({ topRated, popular }, lang = getHomeLanguage()) {
  storage.set(FEED_CACHE_KEY, {
    topRated: topRated || [],
    popular: popular || [],
    ts: Date.now(),
    lang,
  });
}

export function readRecommendationCache(signature, lang = getHomeLanguage()) {
  const cached = storage.get(RECOMMENDATION_CACHE_KEY);
  if (
    !isFresh(cached, RECOMMENDATION_TTL) ||
    cached.lang !== lang ||
    cached.signature !== signature ||
    !Array.isArray(cached.items)
  ) {
    return null;
  }
  return cached.items;
}

export function writeRecommendationCache(
  signature,
  items,
  lang = getHomeLanguage(),
) {
  storage.set(RECOMMENDATION_CACHE_KEY, {
    signature,
    items: items || [],
    ts: Date.now(),
    lang,
  });
}
