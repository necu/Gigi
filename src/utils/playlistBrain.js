// ── Playlist brain ───────────────────────────────────────────────────────────
// Builds a film list from a viewing *moment* (morning, evening, late night…),
// an optional genre and vague free text such as "slow-burn space horror".
// TMDB is used as a catalogue; the final order is explained and biased by the
// user's own taste profile.

import { tmdbFetch } from "./api";
import { GENRE_NAMES } from "./autoCategorize";
import { normalizeText, tasteAffinity, tasteGenresLabel } from "./searchBrain";

const MOVIE_GENRE_IDS = new Set([
  28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 53,
  10752, 37,
]);

export const PLAYLIST_MOMENTS = [
  {
    id: "any",
    label: "Any time",
    short: "Any",
    hint: "No clock, just mood",
    genres: [],
  },
  {
    id: "morning",
    label: "Morning",
    short: "AM",
    hint: "Light, easy, shorter",
    genres: [35, 10751, 16, 12],
    maxRuntime: 120,
  },
  {
    id: "afternoon",
    label: "Afternoon",
    short: "PM",
    hint: "Big, fun, adventurous",
    genres: [28, 12, 35, 878],
  },
  {
    id: "evening",
    label: "Evening",
    short: "EVE",
    hint: "Drama, mystery, romance",
    genres: [18, 9648, 10749, 53],
  },
  {
    id: "night",
    label: "Late night",
    short: "NITE",
    hint: "Dark, tense, strange",
    genres: [27, 53, 9648, 80],
  },
];

export const PLAYLIST_GENRES = Object.entries(GENRE_NAMES)
  .filter(([id]) => MOVIE_GENRE_IDS.has(Number(id)))
  .map(([id, name]) => ({ id: Number(id), name }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const PLAYLIST_TERM_IDEAS = [
  "space",
  "heist",
  "cozy",
  "slow burn",
  "time loop",
  "practical effects",
  "one location",
  "ensemble",
  "coming of age",
  "mind bending",
];

const uniq = (values) => [...new Set((values || []).filter(Boolean))];

export function momentById(id) {
  return PLAYLIST_MOMENTS.find((moment) => moment.id === id) || PLAYLIST_MOMENTS[0];
}

export function momentForNow(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  if (hour < 23) return "evening";
  return "night";
}

export function genreIdByName(name) {
  const match = PLAYLIST_GENRES.find(
    (genre) => normalizeText(genre.name) === normalizeText(name),
  );
  return match?.id || null;
}

function isReleased(item) {
  const date = item?.release_date;
  if (!date) return true;
  return date <= new Date().toISOString().slice(0, 10);
}

function yearOf(item) {
  return (item?.release_date || item?.first_air_date || "").slice(0, 4);
}

function cardOf(item) {
  return {
    id: item.id,
    media_type: "movie",
    title: item.title || item.name || "",
    name: item.title || item.name || "",
    poster_path: item.poster_path || null,
    backdrop_path: item.backdrop_path || null,
    release_date: item.release_date || "",
    first_air_date: "",
    vote_average: item.vote_average ?? 0,
    vote_count: item.vote_count ?? 0,
    popularity: item.popularity ?? 0,
    overview: item.overview || "",
    genre_ids: item.genre_ids || [],
    original_language: item.original_language || null,
    origin_country: item.origin_country || [],
    year: yearOf(item),
  };
}

/**
 * Fetches and ranks a playlist. Never throws on a single failed endpoint; the
 * remaining sources still build a useful list.
 */
export async function buildPlaylist({
  apiKey,
  taste,
  moment = "any",
  genre = "",
  subgenre = "",
  terms = [],
  limit = 30,
}) {
  if (!apiKey) return { items: [], moment: momentById(moment), query: "" };

  const momentDef = momentById(moment);
  const genreId = genreIdByName(genre);
  const cleanTerms = uniq(
    (Array.isArray(terms) ? terms : String(terms || "").split(","))
      .map((term) => String(term).trim())
      .filter(Boolean),
  ).slice(0, 8);
  const queryText = [subgenre, ...cleanTerms].join(" ").trim();
  const today = new Date().toISOString().slice(0, 10);

  const requests = [];
  const params = new URLSearchParams({
    include_adult: "false",
    sort_by: "popularity.desc",
    "vote_count.gte": "60",
    "primary_release_date.lte": today,
    page: "1",
  });

  if (genreId) {
    params.set("with_genres", String(genreId));
  } else if (momentDef.genres.length > 0) {
    params.set("with_genres", momentDef.genres.join("|"));
  }
  if (momentDef.maxRuntime) {
    params.set("with_runtime.lte", String(momentDef.maxRuntime));
  }

  requests.push({
    path: `/discover/movie?${params.toString()}`,
    source: "discover",
  });

  if (queryText) {
    requests.push({
      path: `/search/movie?query=${encodeURIComponent(
        queryText,
      )}&include_adult=false&page=1`,
      source: "search",
      text: queryText,
    });
  }

  for (const term of cleanTerms.slice(0, 3)) {
    if (normalizeText(term) === normalizeText(subgenre)) continue;
    requests.push({
      path: `/search/movie?query=${encodeURIComponent(
        term,
      )}&include_adult=false&page=1`,
      source: "term",
      term,
    });
  }

  const responses = await Promise.allSettled(
    requests.map((request) => tmdbFetch(request.path, apiKey)),
  );

  const pool = new Map();

  const addCandidate = (item, request) => {
    if (!item?.id || item.adult || !isReleased(item)) return;
    if ((item.vote_count || 0) < 8) return;
    const key = `movie_${item.id}`;
    let candidate = pool.get(key);
    if (!candidate) {
      candidate = {
        item: cardOf(item),
        sources: new Set(),
        terms: new Set(),
      };
      pool.set(key, candidate);
    }
    candidate.sources.add(request.source);
    if (request.term) candidate.terms.add(request.term);
    if (request.text) {
      const blob = normalizeText(
        `${item.title || item.name || ""} ${item.overview || ""}`,
      );
      for (const term of cleanTerms) {
        if (blob.includes(normalizeText(term))) candidate.terms.add(term);
      }
    }
  };

  responses.forEach((response, index) => {
    if (response.status !== "fulfilled") return;
    for (const item of response.value?.results || []) {
      addCandidate(item, requests[index]);
    }
  });

  if (pool.size === 0) {
    try {
      const popular = await tmdbFetch("/movie/popular?page=1", apiKey);
      for (const item of popular?.results || []) {
        addCandidate(item, { source: "popular" });
      }
    } catch {
      // Return the empty state below.
    }
  }

  const subWords = normalizeText(subgenre)
    .split(" ")
    .filter((word) => word.length > 3);

  const scored = [];
  for (const candidate of pool.values()) {
    const item = candidate.item;
    const genres = item.genre_ids || [];
    const blob = normalizeText(`${item.title} ${item.overview}`);
    const affinity = tasteAffinity(genres, taste);
    const hasGenre = genreId ? genres.includes(genreId) : false;
    const hasMomentGenre = momentDef.genres.some((id) => genres.includes(id));
    const termHits = cleanTerms.filter((term) =>
      blob.includes(normalizeText(term)),
    );
    const subHits = subWords.filter((word) => blob.includes(word));
    const vote = Number(item.vote_average) || 0;
    const popularity = Number(item.popularity) || 0;
    const votes = Number(item.vote_count) || 0;

    let score =
      Math.log10(popularity + 1) * 9 +
      Math.log10(votes + 1) * 7 +
      vote * 2.4 +
      affinity * 24 +
      (hasGenre ? 14 : 0) +
      (hasMomentGenre ? 6 : 0) +
      Math.min(termHits.length, 3) * 7 +
      Math.min(subHits.length, 3) * 4;

    if (candidate.sources.has("search")) score += 6;
    if (candidate.sources.has("term")) score += 4;

    const reasons = [];
    if (hasGenre && genre) {
      reasons.push({ type: "genre", label: `${genre} pick` });
    }
    if (momentDef.id !== "any" && hasMomentGenre) {
      reasons.push({ type: "moment", label: `${momentDef.label} mood` });
    }
    if (termHits.length > 0) {
      reasons.push({
        type: "term",
        label: `Matches “${termHits[0]}”`,
      });
    } else if (subgenre.trim()) {
      const words = normalizeText(subgenre)
        .split(" ")
        .filter((word) => word.length > 3);
      if (words.some((word) => blob.includes(word))) {
        reasons.push({
          type: "term",
          label: `Fits “${subgenre.trim()}”`,
        });
      }
    }
    if (affinity > 0.22) {
      const label = tasteGenresLabel(genres, taste);
      if (label) {
        reasons.push({ type: "taste", label: `Because you like ${label}` });
      }
    }
    if (reasons.length === 0) {
      reasons.push(
        momentDef.id === "any"
          ? { type: "popular", label: "Popular right now" }
          : { type: "moment", label: `${momentDef.label} energy` },
      );
    }

    scored.push({
      ...item,
      _why: {
        score,
        reasons: reasons.slice(0, 3),
        sources: [...candidate.sources],
      },
    });
  }

  scored.sort((a, b) => b._why.score - a._why.score);
  const topScore = scored[0]?._why?.score || 1;
  const items = scored.slice(0, limit).map((item) => ({
    ...item,
    _why: {
      ...item._why,
      match: Math.max(52, Math.min(99, Math.round(52 + 47 * (item._why.score / topScore)))),
    },
  }));

  return {
    items,
    moment: momentDef,
    query: queryText,
    genre: genre || "",
    terms: cleanTerms,
  };
}

export default buildPlaylist;
