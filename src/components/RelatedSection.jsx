import { useEffect, useMemo, useState } from "react";
import { imgUrl } from "../utils/api";
import { useRelated } from "../utils/useRelated";
import {
  BookmarkFillIcon,
  BookmarkIcon,
  CloseIcon,
  FilmIcon,
  TVIcon,
} from "./Icons";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "collection", label: "Franchise" },
  { id: "person", label: "People" },
  { id: "cinematography", label: "Photography" },
  { id: "cast", label: "Cast" },
  { id: "keywords", label: "Themes" },
  { id: "genres", label: "Genres" },
  { id: "company", label: "Studio" },
  { id: "network", label: "Network" },
];

const PERSON_TYPES = new Set([
  "director",
  "creator",
  "writer",
  "composer",
  "editor",
]);

function matchesFilter(item, filter) {
  if (filter === "all") return true;
  const reasons = item._related?.reasons || [];
  if (filter === "person") {
    return reasons.some((reason) => PERSON_TYPES.has(reason.type));
  }
  return reasons.some((reason) => reason.type === filter);
}

function matchPercent(score, topScore) {
  if (!topScore) return 50;
  return Math.max(45, Math.min(99, Math.round((score / topScore) * 99)));
}

function RelatedCard({
  item,
  topScore,
  onSelect,
  isSaved,
  onToggleSave,
  detailed = false,
}) {
  const title = item.title || item.name;
  const year = (item.release_date || item.first_air_date || "").slice(0, 4);
  const reasons = item._related?.reasons || [];
  const score = item._related?.score || 0;
  const saved = isSaved?.(item);

  return (
    <div
      className={`related-card${detailed ? " related-card--detailed" : ""}`}
      onClick={() => onSelect?.(item)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.(item);
        }
      }}
      title={reasons.map((r) => r.label).join(" · ")}
    >
      <div className="related-poster">
        {item.poster_path ? (
          <img
            src={imgUrl(item.poster_path, "w342")}
            alt={title}
            loading="lazy"
          />
        ) : (
          <div className="related-no-poster">
            {item.media_type === "tv" ? <TVIcon /> : <FilmIcon />}
          </div>
        )}
        <span className="related-match">{matchPercent(score, topScore)}%</span>
        {onToggleSave && (
          <button
            className={`related-save${saved ? " is-saved" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSave(item);
            }}
            title={saved ? "Remove from watchlist" : "Add to watchlist"}
            aria-label={saved ? "Remove from watchlist" : "Add to watchlist"}
          >
            {saved ? <BookmarkFillIcon /> : <BookmarkIcon />}
          </button>
        )}
      </div>
      <div className="related-title" title={title}>
        {title}
      </div>
      <div className="related-meta">
        {year || "—"} · {item.media_type === "tv" ? "Series" : "Movie"}
      </div>
      <div className="related-reasons">
        {reasons.slice(0, detailed ? 4 : 2).map((reason, index) => (
          <span
            key={`${reason.type}-${index}`}
            className={`related-reason related-reason--${reason.type}`}
          >
            {reason.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function RelatedSection({
  type,
  id,
  apiKey,
  onSelect,
  isSaved,
  onToggleSave,
}) {
  const { items, loading, error, seed, reload } = useRelated(
    type,
    id,
    apiKey,
    24,
  );
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!explorerOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setExplorerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [explorerOpen]);

  const topScore = items[0]?._related?.score || 0;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (!matchesFilter(item, filter)) return false;
      if (!needle) return true;
      const haystack = [
        item.title,
        item.name,
        item.overview,
        ...(item._related?.reasons || []).map((r) => r.label),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [items, filter, query]);

  if (!apiKey) return null;

  if (loading && items.length === 0) {
    return (
      <div className="section related-section">
        <div className="related-header">
          <div>
            <div className="section-title">Related</div>
            <div className="related-sub">
              Looking for connections across cast, crew, themes and studios…
            </div>
          </div>
        </div>
        <div className="related-row">
          {Array.from({ length: 6 }).map((_, index) => (
            <div className="related-card related-card--skeleton" key={index}>
              <div className="related-poster" />
              <div className="related-skeleton-line" />
              <div className="related-skeleton-line related-skeleton-line--short" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || items.length === 0) return null;

  return (
    <>
      <div className="section related-section">
        <div className="related-header">
          <div>
            <div className="section-title">Related</div>
            <div className="related-sub">
              {seed?.collection
                ? `Franchise, cast and themes shared with ${seed.title}`
                : `Calculated from cast, crew, themes, studio and more`}
            </div>
          </div>
          <button
            className="btn btn-ghost related-explore-btn"
            onClick={() => setExplorerOpen(true)}
          >
            Explore all ({items.length})
          </button>
        </div>
        <div className="related-row">
          {items.slice(0, 14).map((item) => (
            <RelatedCard
              key={`${item.media_type}_${item.id}`}
              item={item}
              topScore={topScore}
              onSelect={onSelect}
              isSaved={isSaved}
              onToggleSave={onToggleSave}
            />
          ))}
        </div>
      </div>

      {explorerOpen && (
        <div
          className="related-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Connections with ${seed?.title || "this title"}`}
          onClick={() => setExplorerOpen(false)}
        >
          <div className="related-modal" onClick={(e) => e.stopPropagation()}>
            <div className="related-modal-header">
              <div>
                <div className="related-modal-title">
                  Connections with {seed?.title || "this title"}
                </div>
                <div className="related-modal-sub">
                  Every card explains why it belongs here.
                </div>
              </div>
              <div className="related-modal-actions">
                <button
                  className="btn btn-ghost"
                  onClick={reload}
                  title="Recompute the graph"
                >
                  Refresh
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setExplorerOpen(false)}
                  aria-label="Close related explorer"
                >
                  <CloseIcon />
                </button>
              </div>
            </div>

            <div className="related-toolbar">
              <input
                className="related-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by title, person, theme…"
              />
              <div className="related-filters">
                {FILTERS.map((option) => (
                  <button
                    key={option.id}
                    className={`related-filter${filter === option.id ? " active" : ""}`}
                    onClick={() => setFilter(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="related-modal-body">
              {filtered.length === 0 ? (
                <div className="related-empty">
                  No connections match this filter.
                </div>
              ) : (
                <div className="related-grid">
                  {filtered.map((item) => (
                    <RelatedCard
                      key={`${item.media_type}_${item.id}`}
                      item={item}
                      topScore={topScore}
                      onSelect={(selected) => {
                        setExplorerOpen(false);
                        onSelect?.(selected);
                      }}
                      isSaved={isSaved}
                      onToggleSave={onToggleSave}
                      detailed
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
