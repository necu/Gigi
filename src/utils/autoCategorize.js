// ── Auto-categorisation ───────────────────────────────────────────────────────
// Derives the "place" of a title inside the library from its own metadata:
// genres, director/creator, decade and original language become tags, and an
// official TMDB franchise becomes a collection (i.e. a ready-made playlist).
//
// Everything here is pure: callers merge the result into an existing entry so
// hand-written tags and collections are never lost.

import { deriveVibeTags } from "./vibeTags";

export const GENRE_NAMES = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  14: "Fantasy",
  36: "History",
  27: "Horror",
  10402: "Music",
  9648: "Mystery",
  10749: "Romance",
  878: "Science Fiction",
  10770: "TV Movie",
  53: "Thriller",
  10752: "War",
  37: "Western",
  10759: "Action & Adventure",
  10762: "Kids",
  10763: "News",
  10764: "Reality",
  10765: "Sci-Fi & Fantasy",
  10766: "Soap",
  10767: "Talk",
  10768: "War & Politics",
};

const LANGUAGE_NAMES = {
  ja: "Japanese",
  fr: "French",
  es: "Spanish",
  ko: "Korean",
  it: "Italian",
  de: "German",
  hi: "Hindi",
  ru: "Russian",
  zh: "Chinese",
  cn: "Cantonese",
  pt: "Portuguese",
  tr: "Turkish",
  th: "Thai",
  sv: "Swedish",
  da: "Danish",
  no: "Norwegian",
  nl: "Dutch",
  pl: "Polish",
  ar: "Arabic",
  he: "Hebrew",
  fa: "Persian",
  id: "Indonesian",
  tl: "Filipino",
  cs: "Czech",
  hu: "Hungarian",
  ro: "Romanian",
  fi: "Finnish",
  el: "Greek",
  uk: "Ukrainian",
};

const uniq = (values) => [...new Set((values || []).filter(Boolean))];

export function genreIdsOf(item) {
  if (Array.isArray(item?.genres)) {
    return item.genres
      .map((genre) => (typeof genre === "number" ? genre : genre?.id))
      .filter((id) => id != null);
  }
  return Array.isArray(item?.genre_ids) ? item.genre_ids : [];
}

export function genreNamesFor(ids) {
  return uniq((ids || []).map((id) => GENRE_NAMES[id]).filter(Boolean));
}

export function yearOf(item) {
  const raw =
    item?.release_date || item?.first_air_date || item?.year || "";
  const match = String(raw).match(/(\d{4})/);
  return match ? Number(match[1]) : null;
}

function crewOf(details, type) {
  const credits =
    type === "tv" ? details?.aggregate_credits : details?.credits;
  return credits?.crew || [];
}

/** People that can define a shelf: director/creator, music, photography. */
export function definingPeople(details, type) {
  if (!details) {
    return {
      directors: [],
      composers: [],
      cinematographers: [],
      editors: [],
    };
  }
  const crew = crewOf(details, type);
  const directors =
    type === "tv"
      ? details.created_by || []
      : crew.filter((person) => person.job === "Director");
  return {
    directors,
    composers: crew.filter(
      (person) => person.job === "Original Music Composer",
    ),
    cinematographers: crew.filter(
      (person) => person.job === "Director of Photography",
    ),
    editors: crew.filter((person) => person.job === "Editor"),
  };
}

/**
 * Derives tags + collections for a title.
 * `details` is optional: a search result with only genre_ids still gets a useful
 * category (genre + decade) immediately.
 */
export function smartPatchFor(item, details, type) {
  const source = details || item || {};
  const mediaType =
    type || (source.first_air_date || source.media_type === "tv" ? "tv" : "movie");

  const tags = [];

  const ids = genreIdsOf(source).length
    ? genreIdsOf(source)
    : genreIdsOf(item);
  tags.push(...genreNamesFor(ids).slice(0, 3));

  const people = definingPeople(source, mediaType);
  for (const person of people.directors.slice(0, 2)) {
    if (person?.name) tags.push(person.name);
  }

  const year = yearOf(source) || yearOf(item);
  if (year) tags.push(`${Math.floor(year / 10) * 10}s`);

  const language = source.original_language || item?.original_language;
  if (language && language !== "en" && LANGUAGE_NAMES[language]) {
    tags.push(LANGUAGE_NAMES[language]);
  }

  // Feeling and context tags let the library answer "what do I want to feel
  // tonight?" instead of only "which genre is this?". They are merged with
  // the factual tags, so existing manual tags remain untouched.
  tags.push(...deriveVibeTags(source));

  const collections = [];
  const collection =
    source.belongs_to_collection || item?.belongs_to_collection;
  if (collection?.name) collections.push(collection.name);

  return {
    tags: uniq(tags).slice(0, 24),
    collections: uniq(collections),
  };
}

/** Merges a derived patch into an existing entry without dropping user data. */
export function mergeSmartPatch(entry, patch) {
  const tags = uniq([...(entry?.tags || []), ...(patch?.tags || [])]);
  const collections = uniq([
    ...(entry?.collections || []),
    ...(patch?.collections || []),
  ]);
  return {
    tags: tags.slice(0, 28),
    collections,
  };
}

export const smartLibrary = {
  GENRE_NAMES,
  genreIdsOf,
  genreNamesFor,
  yearOf,
  definingPeople,
  smartPatchFor,
  mergeSmartPatch,
};

export default smartLibrary;
