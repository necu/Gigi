// ── Related Engine ────────────────────────────────────────────────────────────
// Builds an explainable "related titles" graph from TMDB. Instead of trusting
// a single /similar list, it gathers candidates from several signals and scores
// every candidate with the evidence it shares with the seed title.
//
// Signals: franchise/collection, director/creator, cast, writers, composer,
// studio, network, keywords/themes, genres, decade, language, country, runtime,
// rating, TMDB recommendations/similar and a tiny popularity tiebreaker.
//
// Results are cached in localStorage for a week because enrichment is the
// expensive part (one details request per candidate).

import { tmdbFetch } from "./api";
import { storage } from "./storage";

const CACHE_KEY = "relatedCache";
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const CACHE_MAX = 150;
const MAX_CANDIDATES = 28;
const MAX_POOL = 140;

const W = {
  collection: 120,
  director: 45,
  creator: 40,
  writer: 22,
  composer: 16,
  cinematographer: 24,
  editor: 10,
  cast: 9,
  castCap: 36,
  keyword: 5,
  keywordCap: 25,
  genre: 5,
  genreCap: 20,
  company: 12,
  network: 12,
  decade: 6,
  language: 4,
  country: 3,
  runtime: 5,
  rating: 4,
  recommendation: 14,
  similar: 8,
};

// ── Small helpers ────────────────────────────────────────────────────────────

const uniqBy = (list, keyFn) => {
  const seen = new Set();
  return (list || []).filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const intersectById = (a = [], b = []) => {
  const ids = new Set(b.map((x) => x.id));
  return a.filter((x) => ids.has(x.id));
};

const yearOf = (item) =>
  Number((item.release_date || item.first_air_date || "").slice(0, 4)) || 0;

const decadeOf = (year) => (year ? Math.floor(year / 10) * 10 : null);

const names = (list, max = 3) =>
  list
    .slice(0, max)
    .map((x) => x.name)
    .filter(Boolean)
    .join(", ");

function normalizeCard(item, type) {
  const isTV = type === "tv";
  return {
    id: item.id,
    media_type: isTV ? "tv" : "movie",
    title: item.title || item.name || "",
    name: item.name || item.title || "",
    poster_path: item.poster_path || null,
    backdrop_path: item.backdrop_path || null,
    release_date: item.release_date || item.first_air_date || "",
    first_air_date: item.first_air_date || item.release_date || "",
    vote_average: item.vote_average ?? 0,
    vote_count: item.vote_count ?? 0,
    popularity: item.popularity ?? 0,
    genre_ids: item.genre_ids || (item.genres || []).map((g) => g.id),
    original_language: item.original_language || null,
    origin_country: item.origin_country || [],
    overview: item.overview || "",
    adult: !!item.adult,
  };
}

function mergeCards(older, newer) {
  const merged = { ...older };
  for (const [key, value] of Object.entries(newer)) {
    if (
      merged[key] == null ||
      merged[key] === "" ||
      (Array.isArray(merged[key]) && merged[key].length === 0)
    ) {
      merged[key] = value;
    }
  }
  return merged;
}

// ── Cache ────────────────────────────────────────────────────────────────────

function readCache() {
  const cache = storage.get(CACHE_KEY);
  return cache && typeof cache === "object" ? cache : {};
}

function writeCache(cache) {
  const entries = Object.entries(cache)
    .filter(([, entry]) => entry && Date.now() - entry.ts < CACHE_TTL)
    .sort((a, b) => b[1].ts - a[1].ts)
    .slice(0, CACHE_MAX);
  storage.set(CACHE_KEY, Object.fromEntries(entries));
}

// ── Seed extraction ──────────────────────────────────────────────────────────

function extractSeed(data, type) {
  const isTV = type === "tv";
  const crew = isTV ? data.aggregate_credits?.crew || [] : data.credits?.crew || [];
  const cast = isTV
    ? data.aggregate_credits?.cast || []
    : data.credits?.cast || [];
  const keywords = isTV
    ? data.keywords?.results || []
    : data.keywords?.keywords || [];

  const directors = isTV
    ? []
    : uniqBy(
        crew.filter((p) => p.job === "Director"),
        (p) => p.id,
      );
  const creators = isTV ? data.created_by || [] : [];
  const writers = uniqBy(
    crew.filter((p) =>
      ["Writer", "Screenplay", "Story", "Teleplay"].includes(p.job),
    ),
    (p) => p.id,
  );
  const composers = uniqBy(
    crew.filter((p) => p.job === "Original Music Composer"),
    (p) => p.id,
  );
  const cinematographers = uniqBy(
    crew.filter((p) => p.job === "Director of Photography"),
    (p) => p.id,
  );
  const editors = uniqBy(
    crew.filter((p) => p.job === "Editor"),
    (p) => p.id,
  );

  const year = yearOf(data);
  return {
    id: data.id,
    type,
    title: data.title || data.name || "",
    year,
    decade: decadeOf(year),
    genreIds: (data.genres || []).map((g) => g.id),
    genres: (data.genres || []).map((g) => g.name).filter(Boolean),
    keywords: uniqBy(keywords, (k) => k.id).slice(0, 20),
    cast: uniqBy(cast, (p) => p.id).slice(0, 12),
    directors,
    creators,
    writers,
    composers,
    cinematographers,
    editors,
    companies: (data.production_companies || []).slice(0, 4),
    networks: (data.networks || []).slice(0, 3),
    collectionId: data.belongs_to_collection?.id || null,
    collectionName: data.belongs_to_collection?.name || null,
    language: data.original_language || null,
    countries: data.origin_country || [],
    runtime: data.runtime || data.episode_run_time?.[0] || null,
    vote_average: data.vote_average || 0,
    vote_count: data.vote_count || 0,
    popularity: data.popularity || 0,
    recommendations: data.recommendations?.results || [],
    similar: data.similar?.results || [],
  };
}

// ── Candidate pool ───────────────────────────────────────────────────────────

function addCandidate(pool, item, type, source, base) {
  if (!item?.id || item.adult) return;
  const key = `${type}_${item.id}`;
  const card = normalizeCard(item, type);
  const existing = pool.get(key);
  if (existing) {
    existing.sources.add(source);
    existing.base += base;
    existing.item = mergeCards(existing.item, card);
  } else {
    pool.set(key, {
      key,
      type,
      item: card,
      sources: new Set([source]),
      base,
    });
  }
}

function buildQueries(seed) {
  const queries = [];
  const vote = "vote_count.gte=25";
  const sort = "sort_by=popularity.desc";

  if (seed.type === "movie") {
    const director = seed.directors[0];
    if (director) {
      queries.push({
        path: `/discover/movie?with_people=${director.id}&${sort}&${vote}`,
        source: "director",
        base: W.director,
      });
    }
    for (const person of seed.cast.slice(0, 2)) {
      queries.push({
        path: `/discover/movie?with_cast=${person.id}&${sort}&${vote}`,
        source: "cast",
        base: W.cast,
      });
    }
    if (seed.companies[0]) {
      queries.push({
        path: `/discover/movie?with_companies=${seed.companies[0].id}&${sort}&${vote}`,
        source: "company",
        base: W.company,
      });
    }
  } else {
    for (const person of [...seed.creators.slice(0, 1), ...seed.cast.slice(0, 2)]) {
      queries.push({
        path: `/person/${person.id}/tv_credits`,
        source: seed.creators.some((c) => c.id === person.id)
          ? "creator"
          : "cast",
        base: seed.creators.some((c) => c.id === person.id)
          ? W.creator
          : W.cast,
        personFilter: true,
      });
    }
    if (seed.networks[0]) {
      queries.push({
        path: `/discover/tv?with_networks=${seed.networks[0].id}&${sort}&${vote}`,
        source: "network",
        base: W.network,
      });
    }
    if (seed.companies[0]) {
      queries.push({
        path: `/discover/tv?with_companies=${seed.companies[0].id}&${sort}&${vote}`,
        source: "company",
        base: W.company,
      });
    }
  }

  if (seed.keywords.length > 0) {
    const ids = seed.keywords
      .slice(0, 8)
      .map((k) => k.id)
      .join("|");
    queries.push({
      path: `/discover/${seed.type}?with_keywords=${ids}&${sort}&${vote}`,
      source: "keywords",
      base: W.keyword,
    });
  }

  if (seed.genreIds.length > 0) {
    const ids = seed.genreIds.slice(0, 3).join("|");
    const dateField =
      seed.type === "tv" ? "first_air_date" : "primary_release_date";
    const from = `${seed.decade}-01-01`;
    const to = `${seed.decade + 9}-12-31`;
    queries.push({
      path: `/discover/${seed.type}?with_genres=${ids}&${dateField}.gte=${from}&${dateField}.lte=${to}&sort_by=vote_count.desc&${vote}`,
      source: "decade",
      base: W.decade,
    });
  }

  return queries.slice(0, 8);
}

function cheapScore(candidate, seed) {
  const item = candidate.item;
  let score = candidate.base;

  const sharedGenres = (item.genre_ids || []).filter((id) =>
    seed.genreIds.includes(id),
  ).length;
  score += Math.min(sharedGenres, 4) * W.genre;

  if (decadeOf(yearOf(item)) === seed.decade) score += W.decade;
  if (item.original_language && item.original_language === seed.language) {
    score += W.language;
  }
  if ((item.origin_country || []).some((c) => seed.countries.includes(c))) {
    score += W.country;
  }
  const ratingDiff = Math.abs((item.vote_average || 0) - seed.vote_average);
  if (ratingDiff <= 0.8) score += W.rating;
  score += Math.min(item.popularity || 0, 100) * 0.05;

  candidate.cheap = score;
  return candidate;
}

// ── Rich scoring ─────────────────────────────────────────────────────────────

function scoreCandidate(candidate, seed) {
  const details = candidate.details || {};
  const type = candidate.type;
  const reasons = [];
  // Source weights only: genres, decade, language, etc. are added below as
  // explainable reasons so nothing is counted twice.
  let score =
    candidate.base + Math.min(candidate.item.popularity || 0, 100) * 0.05;

  const addReason = (reason) => {
    reasons.push(reason);
    score += reason.weight;
  };

  const collection = details.belongs_to_collection;
  if (
    seed.collectionId &&
    collection?.id &&
    collection.id === seed.collectionId
  ) {
    addReason({
      type: "collection",
      label: `Same franchise: ${collection.name || seed.collectionName}`,
      weight: W.collection,
      key: `collection:${collection.id}`,
    });
  }

  const crew = type === "tv" ? details.aggregate_credits?.crew || [] : details.credits?.crew || [];
  const cast = type === "tv" ? details.aggregate_credits?.cast || [] : details.credits?.cast || [];
  const candDirectors =
    type === "tv" ? details.created_by || [] : crew.filter((p) => p.job === "Director");
  const candWriters = crew.filter((p) =>
    ["Writer", "Screenplay", "Story", "Teleplay"].includes(p.job),
  );
  const candComposers = crew.filter((p) => p.job === "Original Music Composer");
  const candCinematographers = crew.filter(
    (p) => p.job === "Director of Photography",
  );
  const candEditors = crew.filter((p) => p.job === "Editor");

  const sharedDirectors = intersectById(
    type === "tv" ? seed.creators : seed.directors,
    candDirectors,
  );
  if (sharedDirectors.length > 0) {
    addReason({
      type: type === "tv" ? "creator" : "director",
      label: `${type === "tv" ? "Creator" : "Director"}: ${names(sharedDirectors)}`,
      weight: type === "tv" ? W.creator : W.director,
      key: `person:${sharedDirectors[0].id}`,
    });
  }

  const sharedWriters = intersectById(seed.writers, candWriters);
  if (sharedWriters.length > 0) {
    addReason({
      type: "writer",
      label: `Writer: ${names(sharedWriters)}`,
      weight: W.writer,
      key: `person:${sharedWriters[0].id}`,
    });
  }

  const sharedComposers = intersectById(seed.composers, candComposers);
  if (sharedComposers.length > 0) {
    addReason({
      type: "composer",
      label: `Music: ${names(sharedComposers)}`,
      weight: W.composer,
      key: `person:${sharedComposers[0].id}`,
    });
  }

  const sharedCinematographers = intersectById(
    seed.cinematographers,
    candCinematographers,
  );
  if (sharedCinematographers.length > 0) {
    addReason({
      type: "cinematography",
      label: `Cinematography: ${names(sharedCinematographers)}`,
      weight: W.cinematographer,
      key: `dop:${sharedCinematographers[0].id}`,
    });
  }

  const sharedEditors = intersectById(seed.editors, candEditors);
  if (sharedEditors.length > 0) {
    addReason({
      type: "editor",
      label: `Editor: ${names(sharedEditors)}`,
      weight: W.editor,
      key: `editor:${sharedEditors[0].id}`,
    });
  }

  const sharedCast = intersectById(seed.cast, cast);
  if (sharedCast.length > 0) {
    addReason({
      type: "cast",
      label: `Cast: ${names(sharedCast)}`,
      weight: Math.min(sharedCast.length * W.cast, W.castCap),
      key: `cast:${sharedCast.map((p) => p.id).sort().join(",")}`,
    });
  }

  const candKeywords =
    type === "tv" ? details.keywords?.results || [] : details.keywords?.keywords || [];
  const sharedKeywords = intersectById(seed.keywords, candKeywords);
  if (sharedKeywords.length > 0) {
    addReason({
      type: "keywords",
      label: `Themes: ${names(sharedKeywords)}`,
      weight: Math.min(sharedKeywords.length * W.keyword, W.keywordCap),
      key: "keywords",
    });
  }

  const candGenres = (details.genres || []).map((g) => g.id);
  const sharedGenres = seed.genreIds.filter((id) => candGenres.includes(id));
  if (sharedGenres.length > 0) {
    const genreNames = (details.genres || [])
      .filter((g) => sharedGenres.includes(g.id))
      .map((g) => g.name);
    addReason({
      type: "genres",
      label: `Genres: ${genreNames.slice(0, 3).join(", ")}`,
      weight: Math.min(sharedGenres.length * W.genre, W.genreCap),
      key: "genres",
    });
  }

  const sharedCompanies = intersectById(
    seed.companies,
    details.production_companies || [],
  );
  if (sharedCompanies.length > 0) {
    addReason({
      type: "company",
      label: `Studio: ${names(sharedCompanies, 2)}`,
      weight: W.company,
      key: `company:${sharedCompanies[0].id}`,
    });
  }

  const sharedNetworks = intersectById(seed.networks, details.networks || []);
  if (sharedNetworks.length > 0) {
    addReason({
      type: "network",
      label: `Network: ${names(sharedNetworks, 2)}`,
      weight: W.network,
      key: `network:${sharedNetworks[0].id}`,
    });
  }

  const candRuntime =
    details.runtime || details.episode_run_time?.[0] || null;
  const candRating = details.vote_average || 0;
  if (
    candRating > 0 &&
    seed.vote_average > 0 &&
    Math.abs(candRating - seed.vote_average) <= 0.8
  ) {
    addReason({
      type: "rating",
      label: "Similar rating",
      weight: W.rating,
      key: "rating",
    });
  }

  if (
    seed.runtime &&
    candRuntime &&
    Math.abs(seed.runtime - candRuntime) <= 15
  ) {
    addReason({
      type: "runtime",
      label: "Similar runtime",
      weight: W.runtime,
      key: "runtime",
    });
  }

  const candYear = yearOf(details);
  if (decadeOf(candYear) === seed.decade) {
    addReason({
      type: "decade",
      label: `Same decade (${seed.decade}s)`,
      weight: W.decade,
      key: "decade",
    });
  }

  if (
    details.original_language &&
    details.original_language === seed.language
  ) {
    addReason({
      type: "language",
      label: "Same language",
      weight: W.language,
      key: "language",
    });
  }

  if (
    (details.origin_country || []).some((c) => seed.countries.includes(c))
  ) {
    addReason({
      type: "country",
      label: "Same country",
      weight: W.country,
      key: "country",
    });
  }

  if (candidate.sources.has("recommendation")) {
    addReason({
      type: "recommendation",
      label: "Recommended by TMDB",
      weight: W.recommendation,
      key: "recommendation",
    });
  }
  if (candidate.sources.has("similar")) {
    addReason({
      type: "similar",
      label: "Similar on TMDB",
      weight: W.similar,
      key: "similar",
    });
  }

  reasons.sort((a, b) => b.weight - a.weight);
  candidate.score = score;
  candidate.reasons = reasons;
  return candidate;
}

// ── Diversity ────────────────────────────────────────────────────────────────

function diversify(scored, limit) {
  const out = [];
  const personCount = new Map();
  const collectionCount = new Map();

  for (const candidate of scored) {
    const person = candidate.reasons.find(
      (r) => r.type === "director" || r.type === "creator",
    );
    if (person) {
      const count = personCount.get(person.key) || 0;
      if (count >= 3) continue;
      personCount.set(person.key, count + 1);
    }
    const collection = candidate.reasons.find((r) => r.type === "collection");
    if (collection) {
      const count = collectionCount.get(collection.key) || 0;
      if (count >= 4) continue;
      collectionCount.set(collection.key, count + 1);
    }
    out.push(candidate);
    if (out.length >= limit) break;
  }

  // Never leave the shelf short just because of the diversity caps.
  if (out.length < limit) {
    const seen = new Set(out.map((c) => c.key));
    for (const candidate of scored) {
      if (seen.has(candidate.key)) continue;
      out.push(candidate);
      if (out.length >= limit) break;
    }
  }

  return out;
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function fetchRelated({
  type,
  id,
  apiKey,
  limit = 18,
  force = false,
  onProgress,
}) {
  if (!apiKey || !id) return { items: [], seed: null, cached: false };
  const kind = type === "tv" ? "tv" : "movie";
  const cacheKey = `${kind}_${id}`;
  const cache = readCache();
  const hit = cache[cacheKey];

  if (!force && hit && Date.now() - hit.ts < CACHE_TTL) {
    return {
      items: (hit.data.items || []).slice(0, limit),
      seed: hit.data.seed || null,
      cached: true,
    };
  }

  onProgress?.({ stage: "seed" });

  const seedPath =
    kind === "tv"
      ? `/tv/${id}?append_to_response=aggregate_credits,keywords,recommendations,similar`
      : `/movie/${id}?append_to_response=credits,keywords,recommendations,similar`;
  const seedData = await tmdbFetch(seedPath, apiKey);
  const seed = extractSeed(seedData, kind);

  // 1. Directly related lists from TMDB.
  const pool = new Map();
  for (const item of seed.recommendations) {
    addCandidate(pool, item, kind, "recommendation", W.recommendation);
  }
  for (const item of seed.similar) {
    addCandidate(pool, item, kind, "similar", W.similar);
  }

  // 2. Franchise parts.
  if (seed.collectionId) {
    try {
      const collection = await tmdbFetch(
        `/collection/${seed.collectionId}`,
        apiKey,
      );
      for (const part of collection.parts || []) {
        addCandidate(pool, part, "movie", "collection", W.collection);
      }
    } catch {
      // A missing collection must never break the section.
    }
  }

  // 3. Multi-signal discovery.
  const queries = buildQueries(seed);
  onProgress?.({ stage: "discover", total: queries.length });
  const results = await Promise.allSettled(
    queries.map((query) => tmdbFetch(query.path, apiKey)),
  );

  results.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const query = queries[index];
    const data = result.value || {};
    if (query.personFilter) {
      const shows = [
        ...(data.cast || []),
        ...(data.crew || []).filter((credit) => credit.job === "Creator"),
      ];
      for (const show of shows) {
        addCandidate(pool, show, "tv", query.source, query.base);
      }
    } else {
      for (const item of data.results || []) {
        addCandidate(pool, item, kind, query.source, query.base);
      }
    }
  });

  // 4. Cheap pre-score, then enrich the most promising candidates.
  const candidates = [...pool.values()]
    .filter((candidate) => candidate.item.id !== seed.id)
    .map((candidate) => cheapScore(candidate, seed))
    .sort((a, b) => b.cheap - a.cheap)
    .slice(0, Math.min(MAX_CANDIDATES, MAX_POOL));

  onProgress?.({ stage: "enrich", total: candidates.length });
  const enriched = await Promise.allSettled(
    candidates.map(async (candidate) => {
      const path =
        candidate.type === "tv"
          ? `/tv/${candidate.item.id}?append_to_response=aggregate_credits,keywords`
          : `/movie/${candidate.item.id}?append_to_response=credits,keywords`;
      const details = await tmdbFetch(path, apiKey);
      return { ...candidate, details };
    }),
  );

  const scored = [];
  for (const result of enriched) {
    if (result.status !== "fulfilled") continue;
    scored.push(scoreCandidate(result.value, seed));
  }
  scored.sort((a, b) => b.score - a.score);

  const selected = diversify(scored, limit).map((candidate) => ({
    ...candidate.item,
    _related: {
      score: Math.round(candidate.score),
      reasons: candidate.reasons.slice(0, 4),
      sources: [...candidate.sources],
    },
  }));

  const payload = {
    items: selected,
    seed: {
      title: seed.title,
      year: seed.year,
      collection: seed.collectionName,
    },
  };

  cache[cacheKey] = { ts: Date.now(), data: payload };
  writeCache(cache);

  return { ...payload, cached: false };
}

/** Removes the cached graph for one title (used by a manual refresh). */
export function clearRelatedCache(type, id) {
  const cache = readCache();
  delete cache[`${type === "tv" ? "tv" : "movie"}_${id}`];
  writeCache(cache);
}
