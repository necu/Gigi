import { useMemo } from "react";
import SmartCard from "./SmartCard";
import { imgUrl } from "../utils/api";
import { useLibraryRecommendations } from "../utils/useLibraryBrain";

function groupSagas(entries) {
  const map = new Map();
  for (const entry of entries || []) {
    for (const name of entry.collections || []) {
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(entry);
    }
  }
  return [...map.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([name, list]) => {
      const sorted = [...list].sort(
        (a, b) => Number(a.year || 0) - Number(b.year || 0),
      );
      const posters = sorted
        .map((entry) => entry.poster_path)
        .filter(Boolean)
        .slice(0, 3);
      return {
        name,
        count: list.length,
        posters,
        movies: sorted.filter((entry) => entry.media_type === "movie").length,
        series: sorted.filter((entry) => entry.media_type === "tv").length,
      };
    })
    .sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name),
    );
}

/** Franchises detected in the library, each one acting as a playlist. */
export function SagaShelf({ entries, onOpenPlaylist }) {
  const sagas = useMemo(() => groupSagas(entries), [entries]);
  if (!sagas.length || !onOpenPlaylist) return null;

  return (
    <div className="smart-shelf">
      <div className="smart-shelf__head">
        <div>
          <div className="section-title">Sagas & playlists</div>
          <div className="smart-shelf__sub">
            Franchises detected in your library. Open one to load every part as a
            playlist.
          </div>
        </div>
      </div>
      <div className="smart-strip">
        {sagas.map((saga) => (
          <button
            key={saga.name}
            type="button"
            className="saga-tile"
            onClick={() => onOpenPlaylist(saga.name)}
            aria-label={`Open ${saga.name} playlist, ${saga.count} titles`}
          >
            <div className="saga-tile__poster">
              {saga.posters[0] ? (
                <img
                  src={imgUrl(saga.posters[0], "w185")}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <span className="saga-tile__placeholder">🎞</span>
              )}
              <span className="saga-tile__count">{saga.count}</span>
            </div>
            <div className="saga-tile__name" title={saga.name}>
              {saga.name}
            </div>
            <div className="saga-tile__meta">
              {saga.movies > 0 ? `${saga.movies} films` : ""}
              {saga.movies > 0 && saga.series > 0 ? " · " : ""}
              {saga.series > 0 ? `${saga.series} series` : ""}
              {" · playlist"}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Taste-driven picks; every card carries the reason it was chosen. */
export function ForYouShelf({
  entries,
  apiKey,
  isSaved,
  onToggleSave,
  onAddMany,
  onSelect,
}) {
  const { items, seeds, loading, error, reload } = useLibraryRecommendations({
    entries,
    apiKey,
  });

  if (!apiKey || !entries?.length) return null;
  if (!loading && !error && items.length === 0) return null;

  const pending = items.filter((item) => !isSaved?.(item));

  return (
    <div className="smart-shelf">
      <div className="smart-shelf__head">
        <div>
          <div className="section-title">Recommended for you</div>
          <div className="smart-shelf__sub">
            {seeds.length > 0
              ? `Because you saved ${seeds.join(" and ")} — cast, directors, music, photography and themes.`
              : "Built from your ratings, genres and the people in your library."}
          </div>
        </div>
        <div className="smart-shelf__actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={reload}
            disabled={loading}
          >
            {loading ? "Finding…" : "Refresh"}
          </button>
          {pending.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onAddMany?.(pending)}
            >
              Save all ({pending.length})
            </button>
          )}
        </div>
      </div>

      {loading && items.length === 0 ? (
        <div className="smart-strip">
          {Array.from({ length: 6 }).map((_, index) => (
            <div className="smart-mini smart-mini--skeleton" key={index}>
              <div className="smart-mini__poster" />
              <div className="smart-skeleton-line" />
              <div className="smart-skeleton-line smart-skeleton-line--short" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="smart-empty">{error}</div>
      ) : (
        <div className="smart-strip">
          {items.map((item) => (
            <SmartCard
              key={`${item.media_type}_${item.id}`}
              item={item}
              saved={!!isSaved?.(item)}
              onOpen={onSelect}
              onSave={onToggleSave}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default { SagaShelf, ForYouShelf };
