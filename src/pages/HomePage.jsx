import { memo, useState, useEffect, useMemo, useCallback } from "react";
import HomeSpotlight from "../components/HomeSpotlight";
import MediaCard from "../components/MediaCard";
import TrendingCarousel from "../components/TrendingCarousel";
import { tmdbFetch } from "../utils/api";
import { useRatings, getRatingForItem } from "../utils/useRatings";
import { isRestricted } from "../utils/ageRating";
import { useT } from "../utils/i18n";
import {
  loadHomeLayout,
  loadHomeViewMode,
  saveHomeLayout,
} from "../utils/homeLayout";
import SectionFrame from "../components/SectionFrame";
import {
  getHomeLanguage,
  readHomeFeedCache,
  readRecommendationCache,
  writeHomeFeedCache,
  writeRecommendationCache,
} from "../utils/homeFeedCache";
import {
  balanceMediaTypes,
  curateHomeItems,
  homeItemKey,
  isReleased,
  mergeUniqueItems,
} from "../utils/homeCurator";

function interleaveByType(movies, tv, limit = 24) {
  const merged = [];
  const max = Math.max(movies.length, tv.length);
  for (let index = 0; index < max && merged.length < limit; index += 1) {
    if (movies[index]) merged.push(movies[index]);
    if (tv[index] && merged.length < limit) merged.push(tv[index]);
  }
  return merged;
}

/**
 * Extract up to `count` unique, recently watched items from the user's
 * history (within the last 30 days). Returns newest-first and dedupes by TMDB
 * id + media_type so we don't fire duplicate API calls.
 */
function getRecentHistoryItems(history, count = 5) {
  if (!history || history.length === 0) return [];
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = history
    .filter((h) => h.watchedAt && h.watchedAt > thirtyDaysAgo)
    .sort((a, b) => b.watchedAt - a.watchedAt);

  const seen = new Set();
  const unique = [];
  for (const item of recent) {
    const key = `${item.media_type || "movie"}_${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= count) break;
  }
  return unique;
}

function HomePage({
  trending,
  trendingTV,
  loading,
  onSelect,
  progress,
  inProgress,
  offline,
  onRetry,
  watched,
  onMarkWatched,
  onMarkUnwatched,
  history,
  apiKey,
  savedEntries = [],
  isSaved,
  onToggleSave,
}) {
  const t = useT();
  // The spotlight builds its own rotating list. This fallback only keeps the
  // header from ever collapsing while the first TMDB call is in flight.
  const fallbackHero = useMemo(() => {
    const released = (trending || []).filter((item) => isReleased(item));
    const best = curateHomeItems(released, {
      limit: 1,
      minRating: 0,
      minVotes: 0,
    });
    return best[0] || trending?.[0] || null;
  }, [trending]);

  const [recommendedItems, setRecommendedItems] = useState([]);
  const [topRatedItems, setTopRatedItems] = useState(
    () => readHomeFeedCache()?.topRated || [],
  );
  const [popularItems, setPopularItems] = useState(
    () => readHomeFeedCache()?.popular || [],
  );
  const [feedLang, setFeedLang] = useState(getHomeLanguage);

  // Load layout config (order + visibility) once on mount
  const [layout, setLayout] = useState(() => loadHomeLayout());
  const { order: rowOrder, visible: rowVisible } = layout;
  const moveRow = useCallback((id, delta) => {
    setLayout((current) => {
      const visibleIds = current.order.filter((row) => current.visible[row]);
      const from = visibleIds.indexOf(id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= visibleIds.length) return current;
      const targetId = visibleIds[to];
      const nextOrder = [...current.order];
      const a = nextOrder.indexOf(id);
      const b = nextOrder.indexOf(targetId);
      [nextOrder[a], nextOrder[b]] = [nextOrder[b], nextOrder[a]];
      saveHomeLayout(nextOrder, current.visible);
      return { ...current, order: nextOrder };
    });
  }, []);
  const visibleRowOrder = rowOrder.filter((row) => rowVisible[row]);

  const [viewMode] = useState(() => loadHomeViewMode());

  // All items for batch ratings fetch
  const recentItems = useMemo(
    () =>
      [...savedEntries]
        .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
        .slice(0, 12),
    [savedEntries],
  );

  // All items for batch ratings fetch
  const allItems = useMemo(
    () => [
      ...inProgress,
      ...trending.map((i) => ({ ...i, media_type: "movie" })),
      ...trendingTV.map((i) => ({ ...i, media_type: "tv" })),
      ...recentItems,
      ...recommendedItems,
      ...topRatedItems,
      ...popularItems,
    ],
    [
      inProgress,
      trending,
      trendingTV,
      recentItems,
      recommendedItems,
      topRatedItems,
      popularItems,
    ],
  );

  const { ratingsMap, ageLimitSetting } = useRatings(allItems);

  const getRating = useCallback(
    (item) => getRatingForItem(item, ratingsMap),
    [ratingsMap],
  );
  const itemRestricted = useCallback(
    (item) =>
      isRestricted(getRatingForItem(item, ratingsMap).minAge, ageLimitSetting),
    [ratingsMap, ageLimitSetting],
  );

  // Enrich ratingsMap with restricted flag for carousels
  const enrichedRatingsMap = useMemo(() => {
    const out = {};
    for (const [k, v] of Object.entries(ratingsMap)) {
      out[k] = { ...v, restricted: isRestricted(v.minAge, ageLimitSetting) };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratingsMap, ageLimitSetting]);

  const topRatedMovies = useMemo(
    () => topRatedItems.filter((item) => item.media_type === "movie"),
    [topRatedItems],
  );
  const topRatedTV = useMemo(
    () => topRatedItems.filter((item) => item.media_type === "tv"),
    [topRatedItems],
  );
  const curatedTopRatedItems = useMemo(
    () =>
      balanceMediaTypes(
        curateHomeItems(topRatedItems, {
          limit: 24,
          minRating: 7,
          minVotes: 100,
          relaxWhenSmall: false,
        }),
        16,
      ),
    [topRatedItems],
  );

  const watchedAndSavedKeys = useMemo(() => {
    const keys = new Set();
    for (const item of history || []) keys.add(homeItemKey(item));
    for (const item of savedEntries) keys.add(homeItemKey(item));
    return keys;
  }, [history, savedEntries]);

  const popularPicks = useMemo(
    () =>
      balanceMediaTypes(
        curateHomeItems(popularItems, {
          limit: 24,
          minRating: 6.5,
          minVotes: 100,
          relaxWhenSmall: false,
        }),
        12,
      ),
    [popularItems],
  );

  const fallbackRecommendationItems = useMemo(() => {
    const diverseFallback = mergeUniqueItems(
      popularPicks,
      curatedTopRatedItems,
      24,
    ).filter((item) => !watchedAndSavedKeys.has(homeItemKey(item)));
    return balanceMediaTypes(diverseFallback, 16);
  }, [popularPicks, curatedTopRatedItems, watchedAndSavedKeys]);

  // Personal history first, then a high-quality fallback so the shelf never
  // disappears for a new user or when TMDB has no recommendations.
  const curatedRecommendedItems = useMemo(
    () =>
      mergeUniqueItems(
        curateHomeItems(recommendedItems, {
          limit: 12,
          minRating: 6,
          minVotes: 20,
          relaxWhenSmall: false,
        }),
        fallbackRecommendationItems,
        24,
      ),
    [recommendedItems, fallbackRecommendationItems],
  );

  const filteredRecommendedItems = useMemo(
    () =>
      balanceMediaTypes(
        curatedRecommendedItems.filter(
          (item) =>
            !itemRestricted(item) &&
            !watchedAndSavedKeys.has(homeItemKey(item)),
        ),
        12,
      ),
    [curatedRecommendedItems, itemRestricted, watchedAndSavedKeys],
  );

  // Refresh recommendations when the actual history changes, not only when its
  // length changes (e.g. removing one item and watching another).
  const historySignature = useMemo(
    () =>
      (history || [])
        .slice(0, 12)
        .map((item) => homeItemKey(item))
        .join("|"),
    [history],
  );

  // Keep the feed cache in sync when the user changes metadata language from
  // Settings, without requiring a Home remount.
  useEffect(() => {
    const handler = () => setFeedLang(getHomeLanguage());
    window.addEventListener("streambert:tmdb-lang-changed", handler);
    return () =>
      window.removeEventListener("streambert:tmdb-lang-changed", handler);
  }, []);

  // Fetch personalised recommendations from multiple recent history items
  useEffect(() => {
    if (!apiKey || offline || !history || history.length === 0) return;
    const sources = getRecentHistoryItems(history, 5);
    if (sources.length === 0) return;

    const cached = readRecommendationCache(historySignature, feedLang);
    if (cached !== null) {
      setRecommendedItems(cached);
      return;
    }

    const controller = new AbortController();

    // Build a Set of already-watched TMDB ids for dedup
    const watchedIds = new Set(
      (history || []).map((h) => `${h.media_type || "movie"}_${h.id}`),
    );

    // For each source, try /recommendations first, fall back to /similar
    const fetches = sources.map((source) => {
      const type = source.media_type === "tv" ? "tv" : "movie";
      return tmdbFetch(`/${type}/${source.id}/recommendations`, apiKey, {
        signal: controller.signal,
      })
        .then((data) => {
          const results = (data.results || []).map((i) => ({
            ...i,
            media_type: type,
          }));
          if (results.length > 0) return results;
          // Fall back to /similar if /recommendations returned nothing
          return tmdbFetch(`/${type}/${source.id}/similar`, apiKey, {
            signal: controller.signal,
          }).then((d) =>
            (d.results || []).map((i) => ({ ...i, media_type: type })),
          );
        })
        .catch(() => []);
    });

    Promise.all(fetches)
      .then((arrays) => {
        // Interleave results from each source for variety
        const merged = [];
        const maxLen = Math.max(...arrays.map((a) => a.length));
        for (let i = 0; i < maxLen; i++) {
          for (const arr of arrays) {
            if (arr[i]) merged.push(arr[i]);
          }
        }

        // Deduplicate and filter out already-watched items
        const seen = new Set();
        const deduped = merged.filter((item) => {
          const key = `${item.media_type}_${item.id}`;
          if (seen.has(key) || watchedIds.has(key)) return false;
          seen.add(key);
          return true;
        });

        const items = deduped.slice(0, 20);
        setRecommendedItems(items);
        writeRecommendationCache(historySignature, items, feedLang);
      })
      .catch((e) => {
        if (e.name !== "AbortError")
          console.warn("Recommendations fetch failed", e);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, offline, historySignature, feedLang]);

  // Fetch Top Rated and Popular together. They power several Home rows, so one
  // shared cache and one effect avoids duplicate mounts and repeated requests
  // when navigating away from Home and back.
  useEffect(() => {
    if (!apiKey || offline) return;
    const cached = readHomeFeedCache(feedLang);
    if (cached) {
      setTopRatedItems(cached.topRated);
      setPopularItems(cached.popular);
      return;
    }

    const controller = new AbortController();
    Promise.all([
      tmdbFetch("/movie/top_rated?page=1", apiKey, {
        signal: controller.signal,
      }),
      tmdbFetch("/tv/top_rated?page=1", apiKey, { signal: controller.signal }),
      tmdbFetch("/movie/popular?page=1", apiKey, {
        signal: controller.signal,
      }),
      tmdbFetch("/tv/popular?page=1", apiKey, { signal: controller.signal }),
    ])
      .then(([topMovies, topTV, popularMovies, popularTV]) => {
        const topRated = interleaveByType(
          (topMovies.results || [])
            .slice(0, 12)
            .map((item) => ({ ...item, media_type: "movie" })),
          (topTV.results || [])
            .slice(0, 12)
            .map((item) => ({ ...item, media_type: "tv" })),
          24,
        );
        const popular = interleaveByType(
          (popularMovies.results || []).map((item) => ({
            ...item,
            media_type: "movie",
          })),
          (popularTV.results || []).map((item) => ({
            ...item,
            media_type: "tv",
          })),
          24,
        );
        setTopRatedItems(topRated);
        setPopularItems(popular);
        writeHomeFeedCache({ topRated, popular }, feedLang);
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          console.warn("Home feed fetch failed", e);
        }
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, offline, feedLang]);

  // Curate each row instead of showing the raw TMDB order. Trending titles lead
  // their rows, then current popular titles fill gaps, with top-rated as the
  // final backstop so a row never looks like an unrelated classics shelf.
  const trendingMovieItems = useMemo(() => {
    const primary = curateHomeItems(
      (trending || []).map((i) => ({ ...i, media_type: "movie" })),
      { limit: 12, minRating: 5.8, minVotes: 100 },
    );
    const popularFallback = curateHomeItems(
      popularItems.filter((item) => item.media_type === "movie"),
      { limit: 12, minRating: 6.5, minVotes: 100 },
    );
    const topFallback = curateHomeItems(topRatedMovies, {
      limit: 12,
      minRating: 7,
      minVotes: 100,
    });
    return mergeUniqueItems(
      primary,
      mergeUniqueItems(popularFallback, topFallback, 24),
      12,
    );
  }, [trending, topRatedMovies, popularItems]);

  const trendingTVItems = useMemo(() => {
    const primary = curateHomeItems(
      (trendingTV || []).map((i) => ({ ...i, media_type: "tv" })),
      { limit: 12, minRating: 5.8, minVotes: 100 },
    );
    const popularFallback = curateHomeItems(
      popularItems.filter((item) => item.media_type === "tv"),
      { limit: 12, minRating: 6.5, minVotes: 100 },
    );
    const topFallback = curateHomeItems(topRatedTV, {
      limit: 12,
      minRating: 7,
      minVotes: 100,
    });
    return mergeUniqueItems(
      primary,
      mergeUniqueItems(popularFallback, topFallback, 24),
      12,
    );
  }, [trendingTV, topRatedTV, popularItems]);

  return (
    <div className="fade-in">
      {/* ── Offline ── */}
      {offline && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "60vh",
            gap: 16,
            color: "var(--text2)",
          }}
        >
          <div style={{ fontSize: 48 }}>📡</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: "var(--text)" }}>
            No internet connection
          </div>
          <div style={{ fontSize: 14, color: "var(--text3)" }}>
            Trending and search require an internet connection. Your downloads
            and library still work offline.
          </div>
          <button
            className="btn btn-primary"
            style={{ marginTop: 8 }}
            onClick={onRetry}
          >
            Retry
          </button>
        </div>
      )}

      {!offline && loading && (
        <div className="loader">
          <div className="spinner" />
        </div>
      )}

      {/* ── Smart spotlight (always first) ── */}
      {!loading && (
        <HomeSpotlight
          apiKey={apiKey}
          history={history}
          savedEntries={savedEntries}
          fallbackItem={fallbackHero}
          onSelect={onSelect}
          onToggleSave={onToggleSave}
          isSaved={isSaved}
        />
      )}

      {/* ── Rows in user-configured order ── */}
      <div className="home-panels">
      {rowOrder.map((id) => {
        if (!rowVisible[id]) return null;
        const content = (() => {

        if (id === "continue") {
          if (inProgress.length === 0) return null;
          return (
            <div key="continue" className="section">
              <div className="section-title">{t("home.continue")}</div>
              <div className="cards-grid">
                {inProgress.map((item) => {
                  const pk =
                    item.media_type === "movie"
                      ? `movie_${item.id}`
                      : `tv_${item.id}_s${item.season}e${item.episode}`;
                  const r = getRating(item);
                  const restr = itemRestricted(item);
                  return (
                    <MediaCard
                      key={`${item.media_type}_${item.id}`}
                      item={item}
                      onClick={() => onSelect(item)}
                      progress={progress[pk] || 0}
                      watched={watched}
                      onMarkWatched={onMarkWatched}
                      onMarkUnwatched={onMarkUnwatched}
                      ageRating={r.cert}
                      restricted={restr}
                    />
                  );
                })}
              </div>
            </div>
          );
        }

        // Render a section as a flat cards-grid (list view)
        const renderList = (
          key,
          title,
          titleHighlight,
          items,
          subtitle,
        ) => {
          if (!items || items.length === 0) return null;
          return (
            <div key={key} className="section">
              <div className="section-title">
                {titleHighlight ? (
                  <>
                    {title}&nbsp;
                    <span style={{ color: "var(--red)" }}>
                      {titleHighlight}
                    </span>
                  </>
                ) : (
                  title
                )}
              </div>
              {subtitle && (
                <div className="section-subtitle">{subtitle}</div>
              )}
              <div className="cards-grid">
                {items.map((item) => {
                  const type = item.media_type === "tv" ? "tv" : "movie";
                  const rk = `${type}_${item.id}`;
                  const rd = enrichedRatingsMap[rk] || {};
                  return (
                    <MediaCard
                      key={`${item.media_type}_${item.id}`}
                      item={item}
                      onClick={() => onSelect(item)}
                      progress={0}
                      watched={watched}
                      onMarkWatched={onMarkWatched}
                      onMarkUnwatched={onMarkUnwatched}
                      ageRating={rd.cert}
                      restricted={rd.restricted}
                    />
                  );
                })}
              </div>
            </div>
          );
        };

        if (id === "recent") {
          if (recentItems.length === 0) return null;
          if (viewMode === "list")
            return renderList(
              "recent",
              t("home.recent"),
              null,
              recentItems,
              t("home.recentListSub"),
            );
          return (
            <TrendingCarousel
              key="recent"
              storageKey="recent"
              items={recentItems}
              title={t("home.recent")}
              subtitle={t("home.recentSub")}
              onSelect={onSelect}
              ratingsMap={enrichedRatingsMap}
            />
          );
        }

        if (id === "recommended") {
          if (filteredRecommendedItems.length === 0) return null;
          if (viewMode === "list")
            return renderList(
              "recommended",
              t("home.recommended"),
              null,
              filteredRecommendedItems,
              t("home.recommendedListSub"),
            );
          return (
            <TrendingCarousel
              key="recommended"
              storageKey="recommended"
              items={filteredRecommendedItems}
              title={t("home.recommended")}
              subtitle={t("home.recommendedSub")}
              onSelect={onSelect}
              ratingsMap={enrichedRatingsMap}
            />
          );
        }

        if (id === "trendingMovies") {
          if (trendingMovieItems.length === 0) return null;
          if (viewMode === "list")
            return renderList(
              "trendingMovies",
              t("home.trendingMovies"),
              null,
              trendingMovieItems,
              t("home.trendingMoviesListSub"),
            );
          return (
            <TrendingCarousel
              key="trendingMovies"
              storageKey="trendingMovies"
              items={trendingMovieItems}
              title={t("home.trendingMovies")}
              subtitle={t("home.trendingMoviesSub")}
              onSelect={onSelect}
              ratingsMap={enrichedRatingsMap}
            />
          );
        }

        if (id === "trendingTV") {
          if (trendingTVItems.length === 0) return null;
          if (viewMode === "list")
            return renderList(
              "trendingTV",
              t("home.trendingTV"),
              null,
              trendingTVItems,
              t("home.trendingTVListSub"),
            );
          return (
            <TrendingCarousel
              key="trendingTV"
              storageKey="trendingTV"
              items={trendingTVItems}
              title={t("home.trendingTV")}
              subtitle={t("home.trendingTVSub")}
              onSelect={onSelect}
              ratingsMap={enrichedRatingsMap}
            />
          );
        }

        if (id === "topRated") {
          if (curatedTopRatedItems.length === 0) return null;
          if (viewMode === "list")
            return renderList(
              "topRated",
              t("home.topRated"),
              null,
              curatedTopRatedItems,
              t("home.topRatedListSub"),
            );
          return (
            <TrendingCarousel
              key="topRated"
              storageKey="topRated"
              items={curatedTopRatedItems}
              title={t("home.topRated")}
              subtitle={t("home.topRatedSub")}
              onSelect={onSelect}
              ratingsMap={enrichedRatingsMap}
            />
          );
        }

        return null;
        })();
        return content ? (
          <SectionFrame
            key={id}
            id={id}
            index={visibleRowOrder.indexOf(id)}
            count={visibleRowOrder.length}
            onMove={moveRow}
            order={rowOrder.indexOf(id)}
          >
            {content}
          </SectionFrame>
        ) : null;
      })}
      </div>
    </div>
  );
}

export default memo(HomePage);
