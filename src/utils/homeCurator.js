// ── Home content curation ─────────────────────────────────────────────────────
// Home rows should feel edited, not like a raw TMDB dump. These helpers remove
// unreleased titles, prefer titles with a meaningful vote sample and rank by a
// weighted score instead of raw popularity alone.

const DAY = 24 * 60 * 60 * 1000;

export function homeItemKey(item) {
  return `${item?.media_type || "movie"}_${item?.id}`;
}

export function isReleased(item, now = Date.now()) {
  const raw = item?.release_date || item?.first_air_date;
  if (!raw) return true;
  const time = new Date(`${raw}T23:59:59`).getTime();
  if (!Number.isFinite(time)) return true;
  return time <= now + DAY;
}

export function qualityScore(item) {
  const rating = Math.max(0, Math.min(10, Number(item?.vote_average) || 0));
  const votes = Math.max(0, Number(item?.vote_count) || 0);
  const popularity = Math.max(0, Number(item?.popularity) || 0);

  // Bayesian-style weighted rating: a 9.6 with 30 votes should not beat a
  // long-standing 8.8 with thousands of votes. Popularity is only a small
  // tie-breaker so acclaimed older titles are not buried.
  const priorRating = 6.8;
  const priorVotes = 250;
  const weightedRating =
    (rating * votes + priorRating * priorVotes) / (votes + priorVotes);
  const popularityBoost = Math.min(1.2, Math.log10(popularity + 1) * 0.3);
  return weightedRating + popularityBoost;
}

function uniqueItems(items) {
  const seen = new Set();
  const unique = [];
  for (const item of items || []) {
    if (!item || item.id == null) continue;
    const key = homeItemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

/**
 * Returns the best released titles first. If a row has too few titles that pass
 * the strict quality bar, the rest of the released pool fills the row instead
 * of leaving an empty or half-empty shelf.
 */
export function curateHomeItems(
  items,
  {
    limit = 12,
    minRating = 6.2,
    minVotes = 20,
    requireReleased = true,
    relaxWhenSmall = true,
  } = {},
) {
  const unique = uniqueItems(items).filter(
    (item) => !requireReleased || isReleased(item),
  );
  const ranked = unique.sort(
    (a, b) => qualityScore(b) - qualityScore(a),
  );
  const strong = ranked.filter((item) => {
    const rating = Number(item.vote_average) || 0;
    const votes = Number(item.vote_count) || 0;
    return rating >= minRating && votes >= minVotes;
  });

  const pool =
    strong.length >= Math.min(4, limit) || !relaxWhenSmall
      ? strong
      : ranked;
  return pool.slice(0, limit);
}

/** Merge curated sources without duplicates, preserving the primary order. */
export function mergeUniqueItems(primary, secondary, limit = 12) {
  return uniqueItems([...(primary || []), ...(secondary || [])]).slice(0, limit);
}

/**
 * Interleave movies and series so a mixed row represents both. If one side has
 * fewer titles, the remaining slots go to the other side instead of leaving a
 * hole in the shelf.
 */
export function balanceMediaTypes(items, limit = 12) {
  const movies = [];
  const tv = [];
  for (const item of items || []) {
    if (item?.media_type === "tv") tv.push(item);
    else if (item?.media_type === "movie") movies.push(item);
  }

  const balanced = [];
  const max = Math.max(movies.length, tv.length);
  for (let index = 0; index < max && balanced.length < limit; index += 1) {
    if (movies[index]) balanced.push(movies[index]);
    if (tv[index] && balanced.length < limit) balanced.push(tv[index]);
  }
  return balanced.slice(0, limit);
}
