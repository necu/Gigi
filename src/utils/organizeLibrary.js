// ── Library organiser ─────────────────────────────────────────────────────────
// Re-derives tags and franchise collections for entries that were added before
// the smart categoriser existed (or saved with too little metadata).
//
// Runs a small worker pool so a large library does not blast TMDB with one
// request per title at once. Every patch is a merge: manual tags stay.

import { tmdbFetch } from "./api";
import { getWatchKey } from "./watchlist";
import { mergeSmartPatch, smartPatchFor } from "./autoCategorize";

const CONCURRENCY = 3;

export async function organizeEntries({
  entries,
  apiKey,
  limit = 40,
  onProgress,
}) {
  if (!apiKey) return { patches: [], scanned: 0, changed: 0, failed: 0 };

  const targets = (entries || [])
    .filter((entry) => entry?.id)
    .filter((entry) => {
      const tags = entry.tags || [];
      const collections = entry.collections || [];
      return collections.length === 0 || tags.length < 4;
    })
    .slice(0, limit);

  if (targets.length === 0) {
    return { patches: [], scanned: 0, changed: 0, failed: 0 };
  }

  const patches = [];
  let cursor = 0;
  let done = 0;
  let failed = 0;

  async function worker() {
    while (cursor < targets.length) {
      const entry = targets[cursor];
      cursor += 1;

      try {
        const path =
          entry.media_type === "tv"
            ? `/tv/${entry.id}?append_to_response=aggregate_credits,keywords`
            : `/movie/${entry.id}?append_to_response=credits,keywords`;
        const details = await tmdbFetch(path, apiKey);
        const merged = mergeSmartPatch(
          entry,
          smartPatchFor(entry, details, entry.media_type),
        );
        const hasNew =
          merged.tags.some((tag) => !(entry.tags || []).includes(tag)) ||
          merged.collections.some(
            (name) => !(entry.collections || []).includes(name),
          );
        if (hasNew) {
          patches.push({ key: getWatchKey(entry), patch: merged });
        }
      } catch {
        // A title that cannot be enriched now can be retried on the next run.
        failed += 1;
      }

      done += 1;
      onProgress?.({ done, total: targets.length });
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(CONCURRENCY, targets.length) },
      () => worker(),
    ),
  );

  return {
    patches,
    scanned: targets.length,
    changed: patches.length,
    failed,
  };
}

export default organizeEntries;
