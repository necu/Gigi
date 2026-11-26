// ── Search brain ──────────────────────────────────────────────────────────────
// The intelligence behind the search box and the "For you" shelf.
//
// It combines several TMDB endpoints, the user's own taste profile (built from
// the library) and the local search database to:
//   • decide which result is really the title the user meant
//   • offer valid recommendations next to that result
//   • explain every recommendation (director, cinematography, music, cast,
//     themes, studio, franchise, taste)
//
// Discovery results are cached for a day because the expensive part is the
// per-title discovery fan-out.

import { tmdbFetch } from "./api";
import { storage } from "./storage";
import { GENRE_NAMES } from "./autoCategorize";
import { getWatchKey } from "./watchlist";

const DISCOVERY_CACHE_KEY = "smartDiscoveryCache";
const DISCOVERY_TTL = 24 * 60 * 60 * 1000;
const DISCOVERY_MAX = 120;

// ── Generic helpers ──────────────────────────────────────────────────────────

const uniqById = (list) => {
  const seen = new Set();
  return (list || []).filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const SEARCH_STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "or",
  "to",
  "in",
  "on",
  "for",
  "with",
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "y",
  "o",
  "en",
  "un",
  "una",
  "al",
]);

/** Classic edit distance, capped only by the strings themselves. */
export function levenshtein(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
    }
    previous = current;
  }
  return previous[b.length];
}

export function similarity(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  }
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/**
 * Fuzzy similarity that tolerates a typo in any word while still rewarding
 * multi-word names: every query token picks its closest candidate token.
 */
export function fuzzyTokenScore(query, candidate) {
  const queryTokens = normalizeText(query).split(" ").filter(Boolean);
  const candidateTokens = normalizeText(candidate).split(" ").filter(Boolean);
  if (!queryTokens.length || !candidateTokens.length) return 0;

  let total = 0;
  for (const queryToken of queryTokens) {
    let best = 0;
    for (const candidateToken of candidateTokens) {
      best = Math.max(best, similarity(queryToken, candidateToken));
    }
    total += best;
  }

  return Math.max(total / queryTokens.length, similarity(query, candidate));
}

export function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const yearOf = (item) =>
  Number((item?.release_date || item?.first_air_date || "").slice(0, 4)) || 0;

const decadeOf = (year) => (year ? Math.floor(year / 10) * 10 : null);

const matchPercent = (score, topScore) =>
  clamp(Math.round(40 + 59 * (score / (topScore || 1))), 42, 99);

function dedupeReasons(reasons) {
  const seen = new Set();
  return (reasons || []).filter((reason) => {
    // Search reasons are plain strings; discovery reasons are { label } objects.
    const label = typeof reason === "string" ? reason : reason?.label;
    if (!label || seen.has(label)) return false;
    seen.add(label);
    return true;
  });
}

function normalizeCard(item, type) {
  return {
    id: item.id,
    media_type: type,
    title: item.title || item.name || "",
    name: item.name || item.title || "",
    poster_path: item.poster_path || null,
    backdrop_path: item.backdrop_path || null,
    release_date: item.release_date || item.first_air_date || "",
    first_air_date: item.first_air_date || item.release_date || "",
    vote_average: item.vote_average ?? 0,
    vote_count: item.vote_count ?? 0,
    popularity: item.popularity ?? 0,
    overview: item.overview || "",
    genre_ids: item.genre_ids || (item.genres || []).map((genre) => genre.id),
    original_language: item.original_language || null,
    origin_country: item.origin_country || [],
    adult: !!item.adult,
  };
}

// ── Taste profile ────────────────────────────────────────────────────────────

const STATUS_WEIGHT = { done: 1.35, watching: 1.2, planned: 0.9, dropped: 0.35 };

/**
 * Builds a normalised taste profile from the library. Personal ratings weigh
 * the most, status tells us whether the title was actually enjoyed, and tags
 * (directors, genres, decades…) add extra texture.
 */
export function buildTasteProfile(entries) {
  const profile = {
    size: 0,
    genres: {},
    tags: {},
    languages: {},
    types: { movie: 0, tv: 0 },
    topGenres: [],
    topTags: [],
    averageRating: null,
  };

  let ratingSum = 0;
  let ratingCount = 0;

  for (const entry of entries || []) {
    if (!entry?.id) continue;
    const status = STATUS_WEIGHT[entry.status] ?? 1;
    const vote = Number(entry.vote_average) || 0;
    const ratingWeight =
      entry.personalRating != null
        ? 0.7 + entry.personalRating / 10
        : 0.55 + Math.min(vote, 10) / 20;
    const weight = status * ratingWeight;

    profile.size += 1;
    profile.types[entry.media_type === "tv" ? "tv" : "movie"] += weight;

    for (const genre of entry.genres || []) {
      profile.genres[genre] = (profile.genres[genre] || 0) + weight;
    }
    for (const tag of entry.tags || []) {
      const key = String(tag).toLowerCase();
      profile.tags[key] = (profile.tags[key] || 0) + weight * 0.4;
    }
    if (entry.original_language) {
      profile.languages[entry.original_language] =
        (profile.languages[entry.original_language] || 0) + weight * 0.25;
    }
    if (entry.personalRating != null) {
      ratingSum += entry.personalRating;
      ratingCount += 1;
    }
  }

  const maxGenre = Object.values(profile.genres).reduce(
    (max, value) => Math.max(max, value),
    0,
  );
  if (maxGenre > 0) {
    for (const key of Object.keys(profile.genres)) {
      profile.genres[key] = profile.genres[key] / maxGenre;
    }
  }

  const maxTag = Object.values(profile.tags).reduce(
    (max, value) => Math.max(max, value),
    0,
  );
  if (maxTag > 0) {
    for (const key of Object.keys(profile.tags)) {
      profile.tags[key] = profile.tags[key] / maxTag;
    }
  }

  profile.topGenres = Object.entries(profile.genres)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([id, weight]) => ({
      id: Number(id),
      name: GENRE_NAMES[id] || `Genre ${id}`,
      weight: Number(weight.toFixed(3)),
    }));

  profile.topTags = Object.entries(profile.tags)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([value, weight]) => ({
      value,
      weight: Number(weight.toFixed(3)),
    }));

  profile.averageRating = ratingCount ? ratingSum / ratingCount : null;
  return profile;
}

export function tasteAffinity(genreIds, taste) {
  if (!taste?.size || !Array.isArray(genreIds) || genreIds.length === 0) {
    return 0;
  }
  let score = 0;
  let considered = 0;
  for (const id of genreIds.slice(0, 4)) {
    considered += 1;
    score += taste.genres[id] || 0;
  }
  if (!considered) return 0;
  return Math.min(1, score / Math.min(considered, 2));
}

export function tasteGenresLabel(genreIds, taste) {
  if (!taste?.genres) return "";
  return (genreIds || [])
    .filter((id) => (taste.genres[id] || 0) > 0.25)
    .slice(0, 2)
    .map((id) => GENRE_NAMES[id])
    .filter(Boolean)
    .join(", ");
}

// ── Query parsing ────────────────────────────────────────────────────────────

/**
 * Splits "Blade Runner 2049" from "Dune (2021)" / "Dune 2021" without mistaking
 * numbers that belong to the title for a release year.
 */
export function parseQuery(raw) {
  const fullText = String(raw || "").trim();
  let text = fullText;
  let year = null;
  const currentYear = new Date().getFullYear();

  const parenthesised = text.match(/\((\d{4})\)\s*$/);
  if (parenthesised) {
    const candidate = Number(parenthesised[1]);
    if (candidate >= 1900 && candidate <= currentYear + 3) {
      year = candidate;
      text = text.slice(0, parenthesised.index).trim();
    }
  }

  if (!year) {
    const trailing = text.match(/[,\s]+(\d{4})\s*$/);
    if (trailing) {
      const candidate = Number(trailing[1]);
      const stripped = text.slice(0, trailing.index).trim();
      if (
        candidate >= 1900 &&
        candidate <= currentYear + 3 &&
        stripped.length > 0
      ) {
        year = candidate;
        text = stripped;
      }
    }
  }

  const normalized = normalizeText(text);
  return {
    text,
    fullText,
    year,
    normalized,
    fullNormalized: normalizeText(fullText),
    tokens: normalized.split(" ").filter(Boolean),
  };
}

// ── Search ranking ───────────────────────────────────────────────────────────

function scoreCandidate(item, parsed, taste, boosts, key) {
  const title = normalizeText(item.title || item.name);
  const full = parsed.fullNormalized || parsed.normalized;
  const releaseYear = yearOf(item);
  const yearMismatch =
    !!parsed.year && releaseYear > 0 && releaseYear !== parsed.year;
  let score = 0;
  let strongTitleMatch = false;
  const reasons = [];

  if (title && title === full) {
    score += 170;
    strongTitleMatch = true;
    reasons.push("Exact title match");
  } else if (title && title === parsed.normalized) {
    score += yearMismatch ? 45 : 145;
    strongTitleMatch = true;
    reasons.push(
      yearMismatch ? "Title match (different year)" : "Exact title match",
    );
  } else if (title.startsWith(full)) {
    score += 90;
    strongTitleMatch = true;
    reasons.push("Title starts with your search");
  } else if (title.includes(full)) {
    score += 55;
    strongTitleMatch = true;
    reasons.push("Title match");
  } else if (title.startsWith(parsed.normalized)) {
    score += 60;
    strongTitleMatch = true;
    reasons.push("Title starts with your search");
  } else if (title.includes(parsed.normalized)) {
    score += 35;
    strongTitleMatch = true;
    reasons.push("Title match");
  }

  // TMDB itself is fuzzy, but its ordering is not. Re-rank by how close the
  // title really is so "Incepton" or "Pulp Ficton" still surfaces the film.
  const titleCloseness = fuzzyTokenScore(
    parsed.fullText || parsed.text,
    item.title || item.name,
  );
  if (titleCloseness >= 0.62) {
    score += titleCloseness * 60;
    if (!strongTitleMatch && titleCloseness >= 0.78) {
      reasons.push("Close match");
    }
  }

  const tokenHits = parsed.tokens.filter((token) => title.includes(token)).length;
  score += tokenHits * 12;

  if (parsed.year) {
    if (releaseYear === parsed.year) {
      score += 70;
      reasons.push(`Released ${parsed.year}`);
    } else if (Math.abs(releaseYear - parsed.year) <= 2) {
      score += 8;
    }
  }

  const affinity = tasteAffinity(item.genre_ids, taste);
  if (affinity > 0) {
    score += affinity * 34;
    const label = tasteGenresLabel(item.genre_ids, taste);
    if (label) reasons.push(`Your taste: ${label}`);
  }

  const clicks = boosts?.[key] || 0;
  if (clicks > 0) {
    score += Math.min(clicks, 5) * 18;
    reasons.push("You opened this before");
  }

  score += Math.log10((item.popularity || 0) + 1) * 10;
  score += Math.log10((item.vote_count || 0) + 1) * 5;
  score += Math.min(item.vote_average || 0, 10) * 2;

  const type = item.media_type === "tv" ? "tv" : "movie";
  const other = type === "tv" ? "movie" : "tv";
  if ((taste?.types?.[type] || 0) > (taste?.types?.[other] || 0) * 1.6) {
    score += 6;
  }

  return { score, reasons: dedupeReasons(reasons) };
}

function pickPerson(people, parsed) {
  let best = null;
  let bestScore = 0;
  let bestCloseness = 0;
  for (const person of people || []) {
    if (!person?.id || person.adult) continue;
    // TMDB localises person names. "Tarkovsky" is stored as "Andréi
    // Tarkovski" in Spanish, while a one-credit namesake keeps the English
    // spelling. Score the localised name plus the English aliases gathered by
    // the caller so the right person wins in every metadata language.
    const names = [person.name, ...(person._aliases || [])].filter(Boolean);
    const normalizedNames = names.map(normalizeText).filter(Boolean);
    if (normalizedNames.length === 0) continue;
    const closeness = Math.max(
      ...names.map((name) =>
        fuzzyTokenScore(parsed.text || parsed.fullText, name),
      ),
    );
    if (closeness < 0.58) continue;
    let score = closeness * 120;
    if (
      normalizedNames.includes(parsed.normalized) ||
      normalizedNames.includes(parsed.fullNormalized)
    ) {
      score += 30;
    } else if (
      parsed.tokens.length > 0 &&
      normalizedNames.some((name) =>
        parsed.tokens.every((token) => name.includes(token)),
      )
    ) {
      score += 20;
    }
    score += Math.log10((person.popularity || 0) + 1) * 6;
    score += Math.min(person.known_for?.length || 0, 3) * 2;
    if (score > bestScore) {
      bestScore = score;
      bestCloseness = closeness;
      best = person;
    }
  }
  // Never hijack a clear title search with an obscure person match.
  if (!best || bestScore < 55) return null;
  return {
    id: best.id,
    name: best.name,
    profile_path: best.profile_path || null,
    known_for_department: best.known_for_department || null,
    popularity: best.popularity || 0,
    known_for: (best.known_for || [])
      .slice(0, 2)
      .map((credit) => credit?.title || credit?.name)
      .filter(Boolean),
    _fuzzy: Number(bestCloseness.toFixed(2)),
    _match: Math.max(45, Math.min(99, Math.round(45 + bestCloseness * 54))),
  };
}

/**
 * Searches everything at once and returns a ranked set plus the most likely
 * match. Recommendations are fetched separately so the list appears instantly.
 */
export async function searchSmart({ query, apiKey, taste, boosts }) {
  const parsed = parseQuery(query);
  if (!apiKey || !parsed.normalized) {
    return { parsed, results: [], best: null, person: null };
  }

  // Search both forms: "Wonder Woman 1984" must find the 1984-titled film,
  // while "Dune 2021" must still find Dune through the year hint.
  const encodedFull = encodeURIComponent(parsed.fullText || parsed.text || query);
  const encodedText = encodeURIComponent(parsed.text || query);
  const empty = () => ({ results: [] });
  const requests = {
    multi: tmdbFetch(
      `/search/multi?query=${encodedFull}&include_adult=false&page=1`,
      apiKey,
    ).catch(empty),
    people: tmdbFetch(
      `/search/person?query=${encodedFull}&include_adult=false&page=1`,
      apiKey,
    ).catch(empty),
    // English names are aliases: they let a search for "Tarkovsky" find
    // "Andréi Tarkovski" even when TMDB translated his name.
    peopleAliases: tmdbFetch(
      `/search/person?query=${encodedFull}&include_adult=false&page=1`,
      apiKey,
      "en-US",
    ).catch(empty),
  };
  if (parsed.year) {
    requests.yearMovie = tmdbFetch(
      `/search/movie?query=${encodedText}&year=${parsed.year}&include_adult=false&page=1`,
      apiKey,
    ).catch(empty);
    if (parsed.normalized !== parsed.fullNormalized) {
      requests.strippedMulti = tmdbFetch(
        `/search/multi?query=${encodedText}&include_adult=false&page=1`,
        apiKey,
      ).catch(empty);
    }
  }

  // A common typo leaves at least one word intact ("Pulp Ficton", "Leonrdo
  // Dicaprio"). Searching the strongest tokens finds the right title/person
  // even when the full query returns nothing; fuzzy scoring then ranks it.
  const tokenQueries = parsed.tokens
    .filter(
      (token) => token.length >= 4 && !SEARCH_STOP_WORDS.has(token),
    )
    .sort((a, b) => b.length - a.length)
    .slice(0, 2);

  tokenQueries.forEach((token, index) => {
    requests[`tokenMulti${index}`] = tmdbFetch(
      `/search/multi?query=${encodeURIComponent(token)}&include_adult=false&page=1`,
      apiKey,
    ).catch(empty);
    requests[`tokenPeople${index}`] = tmdbFetch(
      `/search/person?query=${encodeURIComponent(token)}&include_adult=false&page=1`,
      apiKey,
    ).catch(empty);
  });

  // Single-word typos ("Incepton", "Scorcese") have no intact token. A short
  // prefix gives TMDB enough of the real name to return candidates.
  if (parsed.tokens.length === 1 && parsed.tokens[0].length >= 5) {
    const prefix = parsed.tokens[0].slice(0, 4);
    if (prefix !== parsed.tokens[0]) {
      requests.prefixMulti = tmdbFetch(
        `/search/multi?query=${encodeURIComponent(prefix)}&include_adult=false&page=1`,
        apiKey,
      ).catch(empty);
      requests.prefixPeople = tmdbFetch(
        `/search/person?query=${encodeURIComponent(prefix)}&include_adult=false&page=1`,
        apiKey,
      ).catch(empty);
    }
  }

  const settled = await Promise.all(
    Object.entries(requests).map(async ([key, request]) => [key, await request]),
  );
  const data = Object.fromEntries(settled);
  const multi = data.multi;
  const people = data.people;
  const yearData = data.yearMovie;
  const strippedData = data.strippedMulti;

  const pool = new Map();
  const add = (item, forcedType) => {
    const type = forcedType || item?.media_type;
    if (type !== "movie" && type !== "tv") return;
    if (!item?.id || item.adult) return;
    const key = `${type}_${item.id}`;
    const card = normalizeCard(item, type);
    const existing = pool.get(key);
    if (existing) {
      for (const [field, value] of Object.entries(card)) {
        if (
          existing.item[field] == null ||
          existing.item[field] === "" ||
          (Array.isArray(existing.item[field]) &&
            existing.item[field].length === 0)
        ) {
          existing.item[field] = value;
        }
      }
      return;
    }
    pool.set(key, { key, type, item: card });
  };

  for (const item of multi?.results || []) add(item);
  for (const item of yearData?.results || []) add(item, "movie");
  for (const item of strippedData?.results || []) add(item);
  for (const key of Object.keys(data)) {
    if (!key.startsWith("tokenMulti") && key !== "prefixMulti") continue;
    for (const item of data[key]?.results || []) add(item);
  }

  const scored = [...pool.values()]
    .map((candidate) => {
      const { score, reasons } = scoreCandidate(
        candidate.item,
        parsed,
        taste,
        boosts,
        candidate.key,
      );
      return { ...candidate, score, reasons };
    })
    .sort((a, b) => b.score - a.score);

  const topScore = scored[0]?.score || 1;
  const results = scored.slice(0, 14).map((candidate) => {
    const title = candidate.item.title || candidate.item.name;
    const normalizedTitle = normalizeText(title);
    const closeness = fuzzyTokenScore(
      parsed.fullText || parsed.text,
      title,
    );
    const titleAlreadyMatches =
      normalizedTitle === parsed.fullNormalized ||
      normalizedTitle === parsed.normalized ||
      (parsed.normalized && normalizedTitle.includes(parsed.normalized));
    return {
      ...candidate.item,
      _search: {
        score: Math.round(candidate.score),
        match: matchPercent(candidate.score, topScore),
        reasons: candidate.reasons.slice(0, 3),
        suggestion:
          !titleAlreadyMatches && closeness >= 0.78 ? title : null,
      },
    };
  });

  const personById = new Map();
  const addPersonCandidate = (person, alias = false) => {
    if (!person?.id) return;
    let entry = personById.get(person.id);
    if (!entry) {
      entry = { ...person, _aliases: [] };
      personById.set(person.id, entry);
    }
    if (
      alias &&
      person.name &&
      person.name !== entry.name &&
      !entry._aliases.includes(person.name)
    ) {
      entry._aliases.push(person.name);
    }
  };
  for (const person of people?.results || []) addPersonCandidate(person);
  for (const person of data.peopleAliases?.results || []) {
    addPersonCandidate(person, true);
  }
  for (const key of Object.keys(data)) {
    if (!key.startsWith("tokenPeople") && key !== "prefixPeople") continue;
    for (const person of data[key]?.results || []) addPersonCandidate(person);
  }

  return {
    parsed,
    results,
    best: results[0] || null,
    person: pickPerson([...personById.values()], parsed),
  };
}

// ── Discovery cache ──────────────────────────────────────────────────────────

function readDiscoveryCache() {
  const cache = storage.get(DISCOVERY_CACHE_KEY);
  return cache && typeof cache === "object" ? cache : {};
}

function writeDiscoveryCache(cache) {
  const entries = Object.entries(cache)
    .filter(([, entry]) => entry && Date.now() - entry.ts < DISCOVERY_TTL)
    .sort((a, b) => b[1].ts - a[1].ts)
    .slice(0, DISCOVERY_MAX);
  storage.set(DISCOVERY_CACHE_KEY, Object.fromEntries(entries));
}

export function clearDiscoveryCache() {
  storage.remove(DISCOVERY_CACHE_KEY);
}

// ── Seed extraction ──────────────────────────────────────────────────────────

function extractSeed(data, kind) {
  const isTV = kind === "tv";
  const crew = isTV
    ? data?.aggregate_credits?.crew || []
    : data?.credits?.crew || [];
  const cast = isTV
    ? data?.aggregate_credits?.cast || []
    : data?.credits?.cast || [];
  const keywords = isTV
    ? data?.keywords?.results || []
    : data?.keywords?.keywords || [];

  const directors = isTV
    ? data?.created_by || []
    : crew.filter((person) => person.job === "Director");

  return {
    id: data.id,
    type: kind,
    title: data.title || data.name || "",
    year: yearOf(data),
    decade: decadeOf(yearOf(data)),
    genreIds: (data.genres || []).map((genre) => genre.id),
    collectionId: data.belongs_to_collection?.id || null,
    collectionName: data.belongs_to_collection?.name || null,
    director: directors[0] || null,
    dop:
      crew.find((person) => person.job === "Director of Photography") ||
      null,
    composer:
      crew.find((person) => person.job === "Original Music Composer") || null,
    cast: uniqById(cast).slice(0, 4),
    creators: isTV ? data.created_by || [] : [],
    keywords: uniqById(keywords).slice(0, 6),
    companies: (data.production_companies || []).slice(0, 3),
    networks: (data.networks || []).slice(0, 3),
    language: data.original_language || null,
    vote_average: data.vote_average || 0,
  };
}

// ── Quick discovery ──────────────────────────────────────────────────────────

function addCandidate(pool, item, type, source, base, label) {
  if (!item?.id || item.adult) return;
  const key = `${type}_${item.id}`;
  const card = normalizeCard(item, type);
  const existing = pool.get(key);
  if (existing) {
    existing.base = Math.max(existing.base, base);
    existing.sources.add(source);
    if (label && !existing.labels.includes(label)) existing.labels.push(label);
    for (const [field, value] of Object.entries(card)) {
      if (
        existing.item[field] == null ||
        existing.item[field] === "" ||
        (Array.isArray(existing.item[field]) &&
          existing.item[field].length === 0)
      ) {
        existing.item[field] = value;
      }
    }
    return;
  }
  pool.set(key, {
    key,
    type,
    item: card,
    base,
    sources: new Set([source]),
    labels: label ? [label] : [],
  });
}

/**
 * Fast, explainable recommendations for one title. Uses ~6 TMDB calls and
 * caches the scored result for a day.
 */
export async function fetchDiscovery({
  type,
  id,
  apiKey,
  taste,
  limit = 12,
  seedData = null,
  force = false,
}) {
  if (!apiKey || !id) return { items: [], seed: null, cached: false };
  const kind = type === "tv" ? "tv" : "movie";
  const cacheKey = `${kind}_${id}`;

  if (!force) {
    const hit = readDiscoveryCache()[cacheKey];
    if (hit && Date.now() - hit.ts < DISCOVERY_TTL) {
      return {
        items: (hit.data.items || []).slice(0, limit),
        seed: hit.data.seed || null,
        cached: true,
      };
    }
  }

  const path =
    kind === "tv"
      ? `/tv/${id}?append_to_response=aggregate_credits,keywords,recommendations,similar`
      : `/movie/${id}?append_to_response=credits,keywords,recommendations,similar`;

  let data = seedData;
  if (!data?.credits && !data?.aggregate_credits) {
    try {
      data = await tmdbFetch(path, apiKey);
    } catch {
      return { items: [], seed: null, cached: false };
    }
  }

  const seed = extractSeed(data, kind);
  const pool = new Map();

  for (const item of data.recommendations?.results || []) {
    addCandidate(pool, item, kind, "recommendation", 24, "TMDB recommends it");
  }
  for (const item of data.similar?.results || []) {
    addCandidate(pool, item, kind, "similar", 16, "Similar on TMDB");
  }

  if (seed.collectionId) {
    try {
      const collection = await tmdbFetch(
        `/collection/${seed.collectionId}`,
        apiKey,
      );
      for (const part of collection.parts || []) {
        addCandidate(
          pool,
          part,
          "movie",
          "collection",
          36,
          `Same franchise: ${collection.name || seed.collectionName}`,
        );
      }
    } catch {
      // Missing collection never breaks recommendations.
    }
  }

  const queries = [];
  if (kind === "movie") {
    if (seed.director) {
      queries.push({
        path: `/discover/movie?with_crew=${seed.director.id}&sort_by=popularity.desc&vote_count.gte=25`,
        source: "director",
        base: 34,
        label: `Directed by ${seed.director.name}`,
      });
    }
    if (seed.dop) {
      queries.push({
        path: `/discover/movie?with_crew=${seed.dop.id}&sort_by=popularity.desc&vote_count.gte=25`,
        source: "cinematography",
        base: 30,
        label: `Cinematography by ${seed.dop.name}`,
      });
    }
    if (seed.composer) {
      queries.push({
        path: `/discover/movie?with_crew=${seed.composer.id}&sort_by=popularity.desc&vote_count.gte=25`,
        source: "composer",
        base: 26,
        label: `Music by ${seed.composer.name}`,
      });
    }
    for (const actor of seed.cast.slice(0, 2)) {
      queries.push({
        path: `/discover/movie?with_cast=${actor.id}&sort_by=popularity.desc&vote_count.gte=25`,
        source: "cast",
        base: 20,
        label: `With ${actor.name}`,
      });
    }
    if (seed.keywords.length > 0) {
      const ids = seed.keywords
        .slice(0, 3)
        .map((keyword) => keyword.id)
        .join("|");
      const names = seed.keywords
        .slice(0, 3)
        .map((keyword) => keyword.name)
        .join(", ");
      queries.push({
        path: `/discover/movie?with_keywords=${ids}&sort_by=popularity.desc&vote_count.gte=25`,
        source: "keywords",
        base: 24,
        label: `Themes: ${names}`,
      });
    }
    if (seed.companies[0]) {
      queries.push({
        path: `/discover/movie?with_companies=${seed.companies[0].id}&sort_by=popularity.desc&vote_count.gte=25`,
        source: "company",
        base: 16,
        label: `Studio: ${seed.companies[0].name}`,
      });
    }
  } else {
    for (const creator of seed.creators.slice(0, 1)) {
      queries.push({
        path: `/person/${creator.id}/tv_credits`,
        personFilter: "creator",
        source: "creator",
        base: 32,
        label: `Created by ${creator.name}`,
      });
    }
    for (const actor of seed.cast.slice(0, 2)) {
      queries.push({
        path: `/person/${actor.id}/tv_credits`,
        personFilter: "cast",
        source: "cast",
        base: 20,
        label: `With ${actor.name}`,
      });
    }
    if (seed.keywords.length > 0) {
      const ids = seed.keywords
        .slice(0, 3)
        .map((keyword) => keyword.id)
        .join("|");
      const names = seed.keywords
        .slice(0, 3)
        .map((keyword) => keyword.name)
        .join(", ");
      queries.push({
        path: `/discover/tv?with_keywords=${ids}&sort_by=popularity.desc&vote_count.gte=15`,
        source: "keywords",
        base: 24,
        label: `Themes: ${names}`,
      });
    }
    if (seed.networks[0]) {
      queries.push({
        path: `/discover/tv?with_networks=${seed.networks[0].id}&sort_by=popularity.desc&vote_count.gte=15`,
        source: "network",
        base: 18,
        label: `Network: ${seed.networks[0].name}`,
      });
    }
  }

  const results = await Promise.allSettled(
    queries.map((query) => tmdbFetch(query.path, apiKey)),
  );

  results.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const query = queries[index];
    const payload = result.value || {};
    if (query.personFilter) {
      const people = [
        ...(payload.cast || []),
        ...(payload.crew || []).filter((credit) =>
          query.personFilter === "creator"
            ? credit.job === "Creator"
            : credit.job === "Actor" || credit.job === "Actress",
        ),
      ];
      for (const credit of people) {
        addCandidate(
          pool,
          credit,
          "tv",
          query.source,
          query.base,
          query.label,
        );
      }
    } else {
      for (const item of payload.results || []) {
        addCandidate(
          pool,
          item,
          kind,
          query.source,
          query.base,
          query.label,
        );
      }
    }
  });

  const seedKey = `${kind}_${id}`;
  const scored = [...pool.values()]
    .filter((candidate) => candidate.key !== seedKey)
    .map((candidate) => {
      const reasons = candidate.labels.map((label) => ({
        type: [...candidate.sources][0] || "related",
        label,
      }));
      let score = candidate.base;

      const sharedGenres = (candidate.item.genre_ids || []).filter((genre) =>
        seed.genreIds.includes(genre),
      );
      score += Math.min(sharedGenres.length, 3) * 5;

      const affinity = tasteAffinity(candidate.item.genre_ids, taste);
      if (affinity > 0) {
        score += affinity * 30;
        if (affinity > 0.35) {
          const label = tasteGenresLabel(candidate.item.genre_ids, taste);
          if (label) {
            reasons.push({ type: "taste", label: `Fits your taste: ${label}` });
          }
        }
      }

      score += Math.log10((candidate.item.vote_count || 0) + 1) * 4;
      score += Math.min(candidate.item.vote_average || 0, 10) * 1.5;
      score += Math.min(candidate.item.popularity || 0, 100) * 0.06;

      if (
        seed.decade &&
        decadeOf(yearOf(candidate.item)) === seed.decade
      ) {
        score += 4;
      }
      if (yearOf(candidate.item) > new Date().getFullYear()) score -= 12;

      return { ...candidate, score, reasons: dedupeReasons(reasons) };
    })
    .sort((a, b) => b.score - a.score);

  // Keep the row varied: no source may fill the whole shelf.
  const perSource = new Map();
  const selected = [];
  for (const candidate of scored) {
    const main = [...candidate.sources][0] || "related";
    const count = perSource.get(main) || 0;
    if (count >= 4) continue;
    perSource.set(main, count + 1);
    selected.push(candidate);
    if (selected.length >= limit) break;
  }

  const topScore = selected[0]?.score || 1;
  const items = selected.map((candidate) => ({
    ...candidate.item,
    _why: {
      score: Math.round(candidate.score),
      match: matchPercent(candidate.score, topScore),
      reasons: candidate.reasons.slice(0, 3),
    },
  }));

  const payload = {
    items,
    seed: {
      id,
      type: kind,
      title: seed.title,
      year: seed.year,
      collection: seed.collectionName,
    },
  };

  const cache = readDiscoveryCache();
  cache[cacheKey] = { ts: Date.now(), data: payload };
  writeDiscoveryCache(cache);

  return { ...payload, cached: false };
}

// ── People picks (actor / director exploration) ──────────────────────────────

export async function fetchPersonPicks(person, apiKey, taste, limit = 8) {
  if (!person?.id || !apiKey) return [];
  try {
    const data = await tmdbFetch(
      `/person/${person.id}/combined_credits`,
      apiKey,
    );
    const pool = new Map();
    for (const credit of [...(data.cast || []), ...(data.crew || [])]) {
      const type = credit.media_type;
      if (type !== "movie" && type !== "tv") continue;
      if (!credit.id || credit.adult) continue;
      const key = `${type}_${credit.id}`;
      if (pool.has(key)) continue;
      if ((credit.vote_count || 0) < 5 && !credit.poster_path) continue;
      pool.set(key, normalizeCard(credit, type));
    }

    const scored = [...pool.values()]
      .map((card) => ({
        card,
        score:
          Math.log10((card.popularity || 0) + 1) * 12 +
          tasteAffinity(card.genre_ids, taste) * 26 +
          Math.log10((card.vote_count || 0) + 1) * 4 +
          Math.min(card.vote_average || 0, 10),
      }))
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map(({ card, score }, index) => ({
      ...card,
      _why: {
        score: Math.round(score),
        match: Math.max(55, 96 - index * 4),
        reasons: [{ type: "person", label: `With ${person.name}` }],
      },
    }));
  } catch {
    return [];
  }
}

// ── Library recommendations ──────────────────────────────────────────────────

function seedScore(entry) {
  const rating = entry.personalRating ?? entry.vote_average ?? 0;
  const status =
    entry.status === "done" ? 2 : entry.status === "watching" ? 1.5 : 0;
  return rating + status + (entry.collections?.length ? 0.4 : 0);
}

function pickSeeds(entries, max = 2) {
  const sorted = [...(entries || [])]
    .filter((entry) => entry?.id)
    .sort(
      (a, b) => seedScore(b) - seedScore(a) || (b.addedAt || 0) - (a.addedAt || 0),
    );
  const picked = [];
  const usedGenres = new Set();
  for (const entry of sorted) {
    const primary = (entry.genres || [])[0];
    if (primary && usedGenres.has(primary) && picked.length > 0) continue;
    picked.push(entry);
    if (primary) usedGenres.add(primary);
    if (picked.length >= max) break;
  }
  return picked;
}

/**
 * Builds the "For you" shelf: two strong seeds from the library give the
 * explainable, people-driven picks; one taste-only discover call broadens the
 * shelf so it does not collapse into a single filmography.
 */
export async function recommendForLibrary({
  entries,
  apiKey,
  limit = 12,
  force = false,
}) {
  const taste = buildTasteProfile(entries);
  if (!apiKey || !entries?.length) {
    return { items: [], seeds: [], taste };
  }

  const saved = new Set((entries || []).map(getWatchKey).filter(Boolean));
  const seeds = pickSeeds(entries, 2);

  const results = await Promise.allSettled(
    seeds.map((seed) =>
      fetchDiscovery({
        type: seed.media_type,
        id: seed.id,
        apiKey,
        taste,
        limit: 10,
        force,
      }),
    ),
  );

  const merged = new Map();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value.items || []) {
      const key = getWatchKey(item);
      if (!key || saved.has(key)) continue;
      const existing = merged.get(key);
      if (existing) {
        existing.score += item._why?.score || 0;
        existing.hits += 1;
        existing.reasons.push(...(item._why?.reasons || []));
      } else {
        merged.set(key, {
          item,
          score: item._why?.score || 0,
          reasons: [...(item._why?.reasons || [])],
          hits: 1,
        });
      }
    }
  }

  if (taste.topGenres.length > 0) {
    const ids = taste.topGenres
      .slice(0, 2)
      .map((genre) => genre.id)
      .join("|");
    try {
      const broad = await tmdbFetch(
        `/discover/movie?with_genres=${ids}&sort_by=vote_average.desc&vote_count.gte=400&page=1`,
        apiKey,
      );
      for (const raw of broad?.results || []) {
        if (raw.adult) continue;
        const card = normalizeCard(raw, "movie");
        const key = getWatchKey(card);
        if (!key || saved.has(key) || merged.has(key)) continue;
        const affinity = tasteAffinity(card.genre_ids, taste);
        const label = tasteGenresLabel(card.genre_ids, taste);
        merged.set(key, {
          item: card,
          score: 18 + affinity * 40,
          hits: 0,
          reasons: [
            {
              type: "taste",
              label: label ? `Because you like ${label}` : "Fits your taste",
            },
          ],
        });
      }
    } catch {
      // A failed broad query must not empty the shelf.
    }
  }

  const scored = [...merged.values()]
    .map((entry) => ({
      ...entry,
      score: entry.score + (entry.hits - 1) * 10,
    }))
    .sort((a, b) => b.score - a.score);

  const topScore = scored[0]?.score || 1;
  const items = [];
  const seen = new Set();
  const perGenre = new Map();

  for (const entry of scored) {
    const key = getWatchKey(entry.item);
    if (!key || seen.has(key)) continue;
    const primaryGenre = (entry.item.genre_ids || [])[0] || "none";
    const count = perGenre.get(primaryGenre) || 0;
    if (count >= 4) continue;
    perGenre.set(primaryGenre, count + 1);
    seen.add(key);
    items.push({
      ...entry.item,
      _why: {
        score: Math.round(entry.score),
        match: matchPercent(entry.score, topScore),
        reasons: dedupeReasons(entry.reasons).slice(0, 3),
      },
    });
    if (items.length >= limit) break;
  }

  return {
    items,
    seeds: seeds.map((seed) => seed.title || seed.name).filter(Boolean),
    taste,
  };
}

export const searchBrain = {
  normalizeText,
  parseQuery,
  buildTasteProfile,
  tasteAffinity,
  tasteGenresLabel,
  searchSmart,
  fetchDiscovery,
  fetchPersonPicks,
  recommendForLibrary,
  clearDiscoveryCache,
};

export default searchBrain;
