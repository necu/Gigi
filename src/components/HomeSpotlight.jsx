import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookmarkFillIcon,
  BookmarkIcon,
  PlayIcon,
  StarIcon,
  TrailerIcon,
} from "./Icons";
import TrailerModal from "./TrailerModal";
import { imgUrl, tmdbFetch } from "../utils/api";
import { getHomeLanguage } from "../utils/homeFeedCache";
import { homeItemKey, isReleased } from "../utils/homeCurator";
import { useT } from "../utils/i18n";
import { storage } from "../utils/storage";

const ROTATE_MS = 10000;
const CACHE_TTL = 30 * 60 * 1000;
const spotlightCache = new Map();

const SPOTLIGHT_MODES = [
  { id: "hidden", labelKey: "spotlight.mode.hidden" },
  { id: "trending", labelKey: "spotlight.mode.trending" },
  { id: "taste", labelKey: "spotlight.mode.taste" },
];

// Each part of the day gets a different kind of odd little film. The genres
// are OR-ed in the discover query, so a title only needs to match one of them.
const MOODS = [
  {
    id: "dawn",
    from: 0,
    to: 6,
    labelKey: "spotlight.dawn",
    genres: [27, 9648, 53, 878],
  },
  {
    id: "morning",
    from: 6,
    to: 12,
    labelKey: "spotlight.morning",
    genres: [35, 10751, 16, 12],
  },
  {
    id: "afternoon",
    from: 12,
    to: 18,
    labelKey: "spotlight.afternoon",
    genres: [12, 28, 35, 14],
  },
  {
    id: "evening",
    from: 18,
    to: 23,
    labelKey: "spotlight.evening",
    genres: [18, 80, 53, 9648],
  },
  {
    id: "night",
    from: 23,
    to: 24,
    labelKey: "spotlight.night",
    genres: [27, 53, 9648, 18],
  },
];

function moodFor(date = new Date()) {
  const hour = date.getHours();
  return (
    MOODS.find((mood) => hour >= mood.from && hour < mood.to) || MOODS[0]
  );
}

function recentSources(history, limit = 3) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const seen = new Set();
  const out = [];
  for (const item of [...(history || [])]
    .filter((entry) => entry?.watchedAt && entry.watchedAt > cutoff)
    .sort((a, b) => b.watchedAt - a.watchedAt)) {
    const key = homeItemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

function estimateTaste(items, excluded, mode = "hidden") {
  const seen = new Set();
  const clean = [];
  for (const raw of items || []) {
    if (!raw || raw.id == null) continue;
    const type = raw.media_type === "tv" ? "tv" : "movie";
    const item = { ...raw, media_type: type };
    const key = homeItemKey(item);
    if (seen.has(key) || excluded.has(key)) continue;
    if (!isReleased(item)) continue;
    if (!Number(raw.vote_count) || Number(raw.vote_count) < 25) continue;
    if (!Number(raw.vote_average) || Number(raw.vote_average) < 2.4) continue;
    if (!raw.backdrop_path && !raw.poster_path) continue;
    seen.add(key);
    clean.push(item);
  }

  const ranked = clean.sort((a, b) => {
    if (mode === "trending") {
      return (
        (Number(b.popularity) || 0) - (Number(a.popularity) || 0) ||
        (Number(b.vote_count) || 0) - (Number(a.vote_count) || 0)
      );
    }
    if (mode === "taste") {
      return (
        (Number(b.vote_average) || 0) - (Number(a.vote_average) || 0) ||
        (Number(b.vote_count) || 0) - (Number(a.vote_count) || 0)
      );
    }
    // Hidden gems: worst rating first, then the least-known title.
    const rating = (Number(a.vote_average) || 0) - (Number(b.vote_average) || 0);
    if (rating !== 0) return rating;
    return (Number(a.vote_count) || 0) - (Number(b.vote_count) || 0);
  });

  const movies = ranked.filter((item) => item.media_type === "movie").slice(0, 8);
  const tv = ranked.filter((item) => item.media_type === "tv").slice(0, 8);
  return [...movies, ...tv]
    .sort((a, b) => {
      if (mode === "trending") {
        return (Number(b.popularity) || 0) - (Number(a.popularity) || 0);
      }
      if (mode === "taste") {
        return (Number(b.vote_average) || 0) - (Number(a.vote_average) || 0);
      }
      return (Number(a.vote_average) || 0) - (Number(b.vote_average) || 0);
    })
    .slice(0, 10);
}

function discoverUrl(type, genres, mode = "hidden") {
  const today = new Date().toISOString().slice(0, 10);
  if (mode === "trending") {
    const params = new URLSearchParams({
      sort_by: "popularity.desc",
      "vote_count.gte": "200",
      "vote_average.gte": "5.5",
      include_adult: "false",
      page: "1",
    });
    if (genres.length > 0) params.set("with_genres", genres.join("|"));
    if (type === "movie") params.set("primary_release_date.lte", today);
    else params.set("first_air_date.lte", today);
    return `/discover/${type}?${params.toString()}`;
  }
  if (mode === "taste") {
    const params = new URLSearchParams({
      sort_by: "vote_average.desc",
      "vote_count.gte": "500",
      "vote_average.gte": "7",
      include_adult: "false",
      page: "1",
    });
    if (genres.length > 0) params.set("with_genres", genres.join("|"));
    if (type === "movie") params.set("primary_release_date.lte", today);
    else params.set("first_air_date.lte", today);
    return `/discover/${type}?${params.toString()}`;
  }
  const params = new URLSearchParams({
    sort_by: "vote_average.asc",
    "vote_count.gte": "40",
    "vote_count.lte": type === "movie" ? "1400" : "800",
    "vote_average.gte": "2.6",
    "vote_average.lte": "6.3",
    include_adult: "false",
    page: "1",
  });
  if (genres.length > 0) params.set("with_genres", genres.join("|"));
  if (type === "movie") params.set("primary_release_date.lte", today);
  else params.set("first_air_date.lte", today);
  return `/discover/${type}?${params.toString()}`;
}

async function fetchPool({ apiKey, genres, sources, excluded, mode = "hidden" }) {
  // Discover responses do not carry media_type, so each request remembers it.
  const requests = [
    {
      type: "movie",
      promise: tmdbFetch(discoverUrl("movie", genres, mode), apiKey),
    },
    {
      type: "tv",
      promise: tmdbFetch(discoverUrl("tv", genres, mode), apiKey),
    },
  ];

  // Blend in what the provider of each recently watched title recommends, so
  // the spotlight follows the user's taste instead of only mood genres.
  for (const source of sources.slice(0, 2)) {
    const type = source.media_type === "tv" ? "tv" : "movie";
    requests.push({
      type,
      promise: tmdbFetch(`/${type}/${source.id}/recommendations`, apiKey),
    });
  }

  const settled = await Promise.allSettled(
    requests.map((request) => request.promise),
  );
  const items = [];
  settled.forEach((result, position) => {
    if (result.status !== "fulfilled") return;
    const type = requests[position].type;
    for (const item of result.value?.results || []) {
      items.push({ ...item, media_type: type });
    }
  });
  return estimateTaste(items, excluded, mode);
}

/**
 * The Home header used to be one static trending title. This spotlight turns
 * it into a small rotating shelf of deliberately odd recommendations: titles
 * tied to the last things watched and to the current time of day, sorted by
 * their worst TMDB rating, with trailer and favourite actions.
 */
export default function HomeSpotlight({
  apiKey,
  history = [],
  savedEntries = [],
  fallbackItem = null,
  onSelect,
  onToggleSave,
  isSaved,
}) {
  const t = useT();
  const [mood, setMood] = useState(() => moodFor());
  const [mode, setMode] = useState(
    () => storage.get("spotlightMode") || "hidden",
  );
  const [recentGenres, setRecentGenres] = useState([]);
  const [recentTitle, setRecentTitle] = useState("");
  const [items, setItems] = useState([]);
  const [dismissed, setDismissed] = useState(
    () => {
      const saved = storage.get("spotlightDismissed");
      return new Set(Array.isArray(saved) ? saved : []);
    },
  );
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [showTrailer, setShowTrailer] = useState(false);
  const [trailerKey, setTrailerKey] = useState(null);
  const [trailerLoading, setTrailerLoading] = useState(false);
  const [trailerFailed, setTrailerFailed] = useState(false);
  const [feedLang, setFeedLang] = useState(getHomeLanguage);
  const mountedRef = useRef(true);

  const sources = useMemo(() => recentSources(history, 3), [history]);
  const historySignature = useMemo(
    () => (history || []).slice(0, 12).map(homeItemKey).join("|"),
    [history],
  );
  const excluded = useMemo(() => {
    const keys = new Set();
    for (const item of history || []) keys.add(homeItemKey(item));
    for (const item of savedEntries || []) keys.add(homeItemKey(item));
    return keys;
  }, [history, savedEntries]);

  const recentSignature = sources.map(homeItemKey).join("|");

  useEffect(() => {
    mountedRef.current = true;
    const timer = setInterval(() => setMood(moodFor()), 15 * 60 * 1000);
    const onLanguage = () => setFeedLang(getHomeLanguage());
    window.addEventListener("streambert:tmdb-lang-changed", onLanguage);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
      window.removeEventListener("streambert:tmdb-lang-changed", onLanguage);
    };
  }, []);

  // Turn the last watched titles into genre ids. History entries only carry
  // the card fields, so this asks TMDB for the small detail object.
  useEffect(() => {
    setRecentTitle(sources[0]?.title || sources[0]?.name || "");
    if (!apiKey || sources.length === 0) {
      setRecentGenres([]);
      return undefined;
    }
    let cancelled = false;
    Promise.all(
      sources.map((source) => {
        const type = source.media_type === "tv" ? "tv" : "movie";
        return tmdbFetch(`/${type}/${source.id}`, apiKey)
          .then((data) => data?.genres || [])
          .catch(() => []);
      }),
    ).then((genreLists) => {
      if (cancelled) return;
      const ids = [];
      for (const list of genreLists) {
        for (const genre of list) {
          if (genre?.id && !ids.includes(genre.id)) ids.push(genre.id);
        }
      }
      setRecentGenres(ids.slice(0, 3));
    });
    return () => {
      cancelled = true;
    };
  }, [apiKey, recentSignature]);

  useEffect(() => {
    if (!apiKey) {
      setItems([]);
      return undefined;
    }
    let cancelled = false;
    const lang = feedLang;
    const genreIds = [...recentGenres, ...mood.genres].filter(
      (id, position, list) => list.indexOf(id) === position,
    );
    const cacheKey = [
      lang,
      mood.id,
      genreIds.join(","),
      recentSignature,
      historySignature,
      mode,
    ].join("|");
    const cached = spotlightCache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL) {
      setItems(cached.items);
      setIndex(0);
      return undefined;
    }

    (async () => {
      let next = await fetchPool({
        apiKey,
        genres: genreIds.slice(0, 4),
        sources,
        excluded,
        mode,
      });
      // A very specific taste + late hour can leave the basket empty. Retry
      // with the mood only, then with no genre filter at all.
      if (next.length < 4) {
        next = await fetchPool({
          apiKey,
          genres: mood.genres,
          sources,
          excluded,
          mode,
        });
      }
      if (next.length < 4) {
        next = await fetchPool({
          apiKey,
          genres: [],
          sources,
          excluded,
          mode,
        });
      }
      if (cancelled || !mountedRef.current) return;
      spotlightCache.set(cacheKey, { items: next, at: Date.now() });
      if (spotlightCache.size > 12) {
        const first = spotlightCache.keys().next().value;
        spotlightCache.delete(first);
      }
      setItems(next);
      setIndex(0);
    })();

    return () => {
      cancelled = true;
    };
    // `history` is represented by its signature; including it whole would
    // refetch on every unrelated App render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    apiKey,
    mood.id,
    feedLang,
    recentGenres.join(","),
    recentSignature,
    historySignature,
    mode,
  ]);

  const visibleItems = useMemo(
    () => items.filter((entry) => !dismissed.has(homeItemKey(entry))),
    [dismissed, items],
  );
  const list =
    visibleItems.length > 0
      ? visibleItems
      : items.length > 0
        ? items
        : fallbackItem
          ? [fallbackItem]
          : [];
  const item = list[Math.min(index, list.length - 1)] || null;
  const usingFallback = visibleItems.length === 0 && items.length === 0 && !!fallbackItem;

  const dismissCurrent = () => {
    if (!item || usingFallback) return;
    const key = homeItemKey(item);
    const next = new Set(dismissed);
    next.add(key);
    setDismissed(next);
    storage.set("spotlightDismissed", [...next].slice(-100));
    setIndex(0);
  };

  useEffect(() => {
    if (items.length < 2 || paused || showTrailer) return undefined;
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % items.length);
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [items.length, paused, showTrailer, index]);

  useEffect(() => {
    setShowTrailer(false);
    setTrailerKey(null);
    setTrailerFailed(false);
  }, [item?.id, item?.media_type]);

  const openTrailer = useCallback(async () => {
    if (!item || !apiKey) return;
    if (trailerKey) {
      setShowTrailer(true);
      return;
    }
    setTrailerLoading(true);
    setTrailerFailed(false);
    try {
      const type = item.media_type === "tv" ? "tv" : "movie";
      const data = await tmdbFetch(`/${type}/${item.id}/videos`, apiKey);
      const videos = (data?.results || []).filter(
        (video) => video.site === "YouTube" && video.key,
      );
      const trailer =
        videos.find((video) => video.type === "Trailer") || videos[0];
      if (!trailer) {
        setTrailerFailed(true);
        return;
      }
      setTrailerKey(trailer.key);
      setShowTrailer(true);
    } catch {
      setTrailerFailed(true);
    } finally {
      setTrailerLoading(false);
    }
  }, [apiKey, item, trailerKey]);

  if (!item) return null;

  const title = item.title || item.name || "";
  const year = (item.release_date || item.first_air_date || "").slice(0, 4);
  const typeLabel =
    item.media_type === "tv" ? t("spotlight.series") : t("spotlight.movie");
  const rating = Number(item.vote_average) || 0;
  const votes = Number(item.vote_count) || 0;
  const saved = isSaved
    ? isSaved(item)
    : savedEntries.some((entry) => homeItemKey(entry) === homeItemKey(item));
  const moodLabel = t(mood.labelKey);
  const reason = usingFallback
    ? null
    : mode === "trending"
      ? null
      : mode === "taste"
        ? recentTitle
          ? t("spotlight.becauseWatched", { title: recentTitle })
          : t("spotlight.criteria.taste")
        : recentTitle
          ? t("spotlight.becauseWatched", { title: recentTitle })
          : t("spotlight.becauseMood", { mood: moodLabel });

  const step = (delta) => {
    if (list.length < 2) return;
    setIndex((current) => (current + delta + list.length) % list.length);
  };

  return (
    <section
      className="home-spotlight"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      aria-roledescription="carousel"
    >
      <div
        key={`${item.media_type}-${item.id}`}
        className="home-spotlight__bg"
        style={{
          backgroundImage: `url(${imgUrl(item.backdrop_path || item.poster_path, "original")})`,
        }}
      />
      <div className="home-spotlight__veil" />

      <div
        key={`copy-${item.media_type}-${item.id}`}
        className="home-spotlight__content"
      >
        <div className="home-spotlight__kicker">
          <span className="home-spotlight__spark">✦</span>
          <span>{t("spotlight.kicker")}</span>
          <span className="home-spotlight__sep">·</span>
          <span>{moodLabel}</span>
          {!usingFallback && (
            <>
              <span className="home-spotlight__sep">·</span>
              <span className="home-spotlight__badge">
                {t(`spotlight.badge.${mode}`)}
              </span>
            </>
          )}
        </div>

        <div className="home-spotlight__modes" role="group" aria-label={t("spotlight.mode")}>
          {SPOTLIGHT_MODES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`home-spotlight__mode${mode === option.id ? " is-active" : ""}`}
              onClick={() => {
                setMode(option.id);
                storage.set("spotlightMode", option.id);
              }}
              aria-pressed={mode === option.id}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>

        <h1 className="home-spotlight__title">{title}</h1>

        <div className="home-spotlight__meta">
          <span className="home-spotlight__rating">
            <StarIcon /> {rating.toFixed(1)}
          </span>
          {year && <span>{year}</span>}
          <span>{typeLabel}</span>
          {!usingFallback && (
            <span className="home-spotlight__votes">
              {t("spotlight.votes", { n: votes.toLocaleString() })}
              {" · "}
              {t("spotlight.obscure")}
            </span>
          )}
        </div>

        <p className="home-spotlight__overview">{item.overview}</p>
        {reason && <p className="home-spotlight__reason">{reason}</p>}
        {!usingFallback && (
          <p className="home-spotlight__criteria">
            {t(`spotlight.criteria.${mode}`)}
          </p>
        )}

        <div className="home-spotlight__actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onSelect?.(item)}
          >
            <PlayIcon /> {t("home.watchNow")}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={openTrailer}
            disabled={trailerLoading}
          >
            <TrailerIcon />{" "}
            {trailerLoading
              ? t("spotlight.loadingTrailer")
              : trailerFailed
                ? t("spotlight.noTrailer")
                : t("spotlight.trailer")}
          </button>
          <button
            type="button"
            className={`btn btn-secondary home-spotlight__save${saved ? " is-saved" : ""}`}
            onClick={() => onToggleSave?.(item)}
            aria-pressed={saved}
          >
            {saved ? <BookmarkFillIcon /> : <BookmarkIcon />}
            {saved ? t("spotlight.saved") : t("spotlight.save")}
          </button>
          {!usingFallback && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={dismissCurrent}
            >
              {t("spotlight.notInterested")}
            </button>
          )}
        </div>
      </div>

      <div className="home-spotlight__rail">
        <button
          type="button"
          className="home-spotlight__arrow"
          onClick={() => step(-1)}
          disabled={list.length < 2}
          aria-label={t("spotlight.previous")}
        >
          ‹
        </button>
        <div className="home-spotlight__dots">
          {list.map((entry, position) => (
            <button
              key={`${entry.media_type}-${entry.id}`}
              type="button"
              className={`home-spotlight__dot${position === Math.min(index, list.length - 1) ? " is-active" : ""}`}
              onClick={() => setIndex(position)}
              aria-label={t("spotlight.goTo", { n: position + 1 })}
              aria-current={position === index}
            />
          ))}
        </div>
        <button
          type="button"
          className="home-spotlight__arrow"
          onClick={() => step(1)}
          disabled={list.length < 2}
          aria-label={t("spotlight.next")}
        >
          ›
        </button>
        <span className="home-spotlight__count">
          {String(Math.min(index, list.length - 1) + 1).padStart(2, "0")}
          <em>/</em>
          {String(list.length).padStart(2, "0")}
        </span>
      </div>

      {showTrailer && trailerKey && (
        <TrailerModal
          trailerKey={trailerKey}
          title={title}
          onClose={() => setShowTrailer(false)}
        />
      )}
    </section>
  );
}
