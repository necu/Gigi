import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  memo,
} from "react";
import MediaCard from "../components/MediaCard";
import WatchlistEditModal from "../components/WatchlistEditModal";
import { ForYouShelf, SagaShelf } from "../components/LibrarySmart";
import { imgUrl } from "../utils/api";
import { EyeIcon, SearchIcon, WatchedIcon } from "../components/Icons";
import { useRatings, getRatingForItem } from "../utils/useRatings";
import { isRestricted } from "../utils/ageRating";
import { storage, STORAGE_KEYS } from "../utils/storage";
import {
  buildWatchlistView,
  getWatchKey,
  SORT_OPTIONS,
  WATCH_STATUSES,
} from "../utils/watchlist";
import {
  BUILTIN_LIBRARY_VIEWS,
  deleteLibraryView,
  loadLibraryViews,
  saveLibraryView,
} from "../utils/libraryViews";
import {
  getSagaCustomOrder,
  getSagaOrderOption,
  getSagaOrderOptions,
  getSagaOrderPreference,
  moveSagaEntry,
  saveSagaCustomOrder,
  saveSagaOrderPreference,
  sagaEntryKey,
  sortSagaEntries,
} from "../utils/sagaOrder";

const TYPE_TABS = [
  { id: "all", label: "All" },
  { id: "movie", label: "Movies" },
  { id: "tv", label: "Series" },
  { id: "anime", label: "Anime" },
];

function LibraryPage({
  watchlist,
  librarySort,
  history,
  inProgress,
  progress,
  onSelect,
  watched,
  onMarkWatched,
  onMarkUnwatched,
  onRemoveHistory,
  onRemove,
  onRemoveMany,
  onUpdate,
  onUpdateMany,
  onReorder,
  apiKey,
  focusCollection,
  isSaved,
  onToggleSave,
  onAddMany,
  onOrganize,
  organizing = false,
  organizeProgress,
  onOpenPlaylist,
}) {
  const [sort, setSort] = useState(librarySort || "manual");
  const [dir, setDir] = useState("asc");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [typeTab, setTypeTab] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState(null);
  const [collectionFilter, setCollectionFilter] = useState("");
  const [sagaOrder, setSagaOrder] = useState("release");
  const [sagaCustomOrder, setSagaCustomOrder] = useState([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [editingKey, setEditingKey] = useState(null);
  const [customViews, setCustomViews] = useState(() => loadLibraryViews());
  const [activeView, setActiveView] = useState("all");
  const [showSaveView, setShowSaveView] = useState(false);
  const [viewName, setViewName] = useState("");

  const dragKey = useRef(null);
  const [dragOverKey, setDragOverKey] = useState(null);

  useEffect(() => {
    setSort(librarySort || "manual");
  }, [librarySort]);

  // A saga opened from a movie page lands here as a ready playlist.
  useEffect(() => {
    if (!focusCollection) return;
    setCollectionFilter(focusCollection);
    setTypeTab("all");
    setStatusFilter("all");
    setTagFilter(null);
    setQuery("");
    setActiveView("");
    // A playlist reads in release order, without changing the saved global
    // sort preference.
    setSort("year");
    setDir("asc");
  }, [focusCollection]);

  // Restore the last order chosen for this particular saga.
  useEffect(() => {
    if (!collectionFilter) {
      setSagaOrder("release");
      setSagaCustomOrder([]);
      return;
    }
    setSagaOrder(getSagaOrderPreference(collectionFilter));
    setSagaCustomOrder(getSagaCustomOrder(collectionFilter));
  }, [collectionFilter]);

  // useWatchlist() returns a fresh API object on every App render. Derive from
  // the stable state object instead so unrelated renders (downloads, toasts,
  // etc.) do not rebuild the whole library view.
  const watchlistState = watchlist.state || watchlist;
  const savedEntries = useMemo(
    () =>
      (watchlistState.order || [])
        .map((key) => watchlistState.items[key])
        .filter(Boolean),
    [watchlistState],
  );

  const allItems = useMemo(
    () => [...inProgress, ...savedEntries],
    [inProgress, savedEntries],
  );
  const { ratingsMap, ageLimitSetting } = useRatings(allItems);

  const getRating = useCallback(
    (item) => getRatingForItem(item, ratingsMap),
    [ratingsMap],
  );
  const itemRestricted = useCallback(
    (item) => isRestricted(getRating(item).minAge, ageLimitSetting),
    [getRating, ageLimitSetting],
  );

  const baseView = useMemo(
    () =>
      buildWatchlistView(watchlistState, {
        query: deferredQuery,
        types: typeTab === "all" ? [] : [typeTab],
        statuses: statusFilter === "all" ? [] : [statusFilter],
        tags: tagFilter ? [tagFilter] : [],
        collection: collectionFilter || null,
        sort,
        dir,
      }),
    [
      watchlistState,
      deferredQuery,
      typeTab,
      statusFilter,
      tagFilter,
      collectionFilter,
      sort,
      dir,
    ],
  );

  const view = useMemo(() => {
    if (!collectionFilter) return baseView;
    return {
      ...baseView,
      items: sortSagaEntries(
        baseView.items,
        sagaOrder,
        collectionFilter,
        sagaCustomOrder,
      ),
    };
  }, [baseView, collectionFilter, sagaOrder, sagaCustomOrder]);

  const sagaOptions = useMemo(
    () => (collectionFilter ? getSagaOrderOptions(collectionFilter) : []),
    [collectionFilter],
  );
  const sagaOption = collectionFilter
    ? getSagaOrderOption(collectionFilter, sagaOrder)
    : null;

  const facets = view.facets;

  // Filters change what is visible, so a stale selection would be confusing.
  useEffect(() => {
    setSelected(new Set());
  }, [typeTab, statusFilter, tagFilter, collectionFilter, query]);

  const handleSortChange = (value) => {
    setSort(value);
    setActiveView("");
    storage.set(STORAGE_KEYS.LIBRARY_SORT, value);
    window.dispatchEvent(
      new CustomEvent("streambert:library-sort-changed", { detail: value }),
    );
  };

  const handleSagaOrderChange = (value) => {
    if (!collectionFilter) return;
    setSagaOrder(value);
    saveSagaOrderPreference(collectionFilter, value);
    if (value === "custom") {
      const next = view.items.map(sagaEntryKey);
      setSagaCustomOrder(next);
      saveSagaCustomOrder(collectionFilter, next);
    }
  };

  const moveSaga = (key, delta) => {
    if (!collectionFilter || sagaOrder !== "custom") return;
    const base = sagaCustomOrder.length
      ? sagaCustomOrder
      : view.items.map(sagaEntryKey);
    const next = moveSagaEntry(base, key, delta);
    setSagaCustomOrder(next);
    saveSagaCustomOrder(collectionFilter, next);
  };

  const toggleSelect = useCallback((key) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearSelection = () => {
    setSelected(new Set());
    setSelectMode(false);
  };

  const selectAllVisible = () => {
    setSelected(new Set(view.items.map((entry) => getWatchKey(entry))));
  };

  const bulkSetStatus = (status) => {
    if (onUpdateMany) onUpdateMany([...selected], { status });
    else for (const key of selected) onUpdate(key, { status });
  };

  const bulkRemove = () => {
    const keys = [...selected];
    onRemoveMany(keys);
    clearSelection();
  };

  const handleDrop = (targetKey) => {
    const fromKey = dragKey.current;
    dragKey.current = null;
    setDragOverKey(null);
    if (!fromKey || fromKey === targetKey) return;

    // In a saga's custom order, reordering must not disturb the global
    // watchlist order. Persist the sequence for this saga only.
    if (collectionFilter && sagaOrder === "custom") {
      const base = sagaCustomOrder.length
        ? [...sagaCustomOrder]
        : view.items.map(sagaEntryKey);
      const next = base.filter((key) => key !== fromKey);
      const toIndex = next.indexOf(targetKey);
      if (toIndex === -1) return;
      next.splice(toIndex, 0, fromKey);
      setSagaCustomOrder(next);
      saveSagaCustomOrder(collectionFilter, next);
      return;
    }

    const order = [...(watchlist.order || [])];
    const fromIndex = order.indexOf(fromKey);
    const toIndex = order.indexOf(targetKey);
    if (fromIndex === -1 || toIndex === -1) return;
    order.splice(fromIndex, 1);
    order.splice(toIndex, 0, fromKey);
    onReorder(order);
  };

  const isSagaCustom =
    Boolean(collectionFilter) && sagaOrder === "custom";
  const dragEnabled =
    !selectMode && (collectionFilter ? isSagaCustom : sort === "manual");

  const editingEntry = editingKey ? watchlist.items[editingKey] : null;
  const hasFilters =
    query ||
    typeTab !== "all" ||
    statusFilter !== "all" ||
    tagFilter ||
    collectionFilter;

  const clearFilters = () => {
    setQuery("");
    setTypeTab("all");
    setStatusFilter("all");
    setTagFilter(null);
    setCollectionFilter("");
    setActiveView("all");
  };

  const allViews = useMemo(
    () => [...BUILTIN_LIBRARY_VIEWS, ...customViews],
    [customViews],
  );

  const applyView = (view) => {
    if (!view) return;
    const filters = view.filters || {};
    setActiveView(view.id);
    setQuery(filters.query || "");
    setTypeTab(filters.typeTab || "all");
    setStatusFilter(filters.statusFilter || "all");
    setTagFilter(filters.tagFilter || null);
    setCollectionFilter(filters.collectionFilter || "");
    if (filters.sort) setSort(filters.sort);
    if (filters.dir) setDir(filters.dir);
  };

  const handleSaveView = () => {
    if (!viewName.trim()) return;
    const saved = saveLibraryView(viewName, {
      query,
      typeTab,
      statusFilter,
      tagFilter,
      collectionFilter,
      sort,
      dir,
    });
    setCustomViews(loadLibraryViews());
    setActiveView(saved.id);
    setViewName("");
    setShowSaveView(false);
  };

  const handleDeleteView = () => {
    if (!activeView.startsWith("custom-")) return;
    deleteLibraryView(activeView);
    setCustomViews(loadLibraryViews());
    applyView(BUILTIN_LIBRARY_VIEWS[0]);
  };

  return (
    <div className="fade-in library-page">
      <div className="library-header">
        <div className="library-heading">
          <div className="library-kicker">Your collection</div>
          <h1 className="library-title">My Library</h1>
          <div className="library-stats">
            <span className="library-stat">
              <b>{facets.total}</b> saved
            </span>
            <span className="library-stat">
              <b>{facets.statuses.planned}</b> planned
            </span>
            <span className="library-stat">
              <b>{facets.statuses.watching}</b> watching
            </span>
            <span className="library-stat library-stat--accent">
              <b>{facets.statuses.done}</b> completed
            </span>
          </div>
        </div>
        <div className="library-header-actions">
          {onOrganize && (
            <button
              className="btn btn-ghost"
              onClick={onOrganize}
              disabled={organizing}
              title="Re-derive genres, directors, decades and franchises for the library"
            >
              {organizing
                ? `Organizing${
                    organizeProgress?.total
                      ? ` ${organizeProgress.done}/${organizeProgress.total}`
                      : "…"
                  }`
                : "✨ Organize"}
            </button>
          )}
          {selectMode && (
            <button className="btn btn-ghost" onClick={selectAllVisible}>
              Select all
            </button>
          )}
          <button
            className={`btn ${selectMode ? "btn-secondary" : "btn-ghost"}`}
            onClick={() => {
              if (selectMode) clearSelection();
              else setSelectMode(true);
            }}
          >
            {selectMode ? "Cancel selection" : "Select"}
          </button>
        </div>
      </div>

      {savedEntries.length > 0 && (
        <div className="library-smart">
          <SagaShelf entries={savedEntries} onOpenPlaylist={onOpenPlaylist} />

          <ForYouShelf
            entries={savedEntries}
            apiKey={apiKey}
            isSaved={isSaved}
            onToggleSave={onToggleSave}
            onAddMany={onAddMany}
            onSelect={onSelect}
          />
        </div>
      )}

      {collectionFilter && (
        <div className="library-playlist-banner">
          <span className="library-playlist-icon">▶</span>
          <div className="library-playlist-text">
            <div className="library-playlist-name">{collectionFilter}</div>
            <div className="library-playlist-meta">
              {view.filtered} title{view.filtered === 1 ? "" : "s"} ·{" "}
              {sagaOption?.label || "Release order"}
            </div>
            {sagaOption?.description && (
              <div className="library-playlist-note">
                {sagaOption.description}
              </div>
            )}
          </div>
          <div className="saga-order-picker">
            <label htmlFor="saga-order">Order</label>
            <select
              id="saga-order"
              className="saga-order-select"
              value={sagaOrder}
              onChange={(event) => handleSagaOrderChange(event.target.value)}
            >
              {sagaOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setCollectionFilter("");
              setActiveView("");
            }}
          >
            Close playlist
          </button>
        </div>
      )}

      <div className="library-toolbar">
        <div className="library-search">
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveView("");
            }}
            placeholder="Search your watchlist…"
            aria-label="Search your watchlist"
          />
          {query && (
            <button
              className="library-search-clear"
              onClick={() => {
                setQuery("");
                setActiveView("");
              }}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>

        <div className="library-sort">
          <select
            value={sort}
            onChange={(event) => handleSortChange(event.target.value)}
            aria-label="Sort library"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            className="btn btn-ghost"
            disabled={sort === "manual"}
            onClick={() => {
              setDir((current) => (current === "asc" ? "desc" : "asc"));
              setActiveView("");
            }}
            title={dir === "asc" ? "Ascending" : "Descending"}
            aria-label={dir === "asc" ? "Sort descending" : "Sort ascending"}
          >
            {dir === "asc" ? "↑" : "↓"}
          </button>
        </div>

        <div className="library-views">
          <div className="library-view-picker">
            <label htmlFor="library-view">View</label>
            <select
              id="library-view"
              value={activeView}
              onChange={(event) => {
                const view = allViews.find(
                  (candidate) => candidate.id === event.target.value,
                );
                if (view) applyView(view);
                else setActiveView("");
              }}
              aria-label="Saved library view"
            >
              <option value="">Custom filters</option>
              <optgroup label="Presets">
                {BUILTIN_LIBRARY_VIEWS.map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.name}
                  </option>
                ))}
              </optgroup>
              {customViews.length > 0 && (
                <optgroup label="My views">
                  {customViews.map((view) => (
                    <option key={view.id} value={view.id}>
                      {view.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {activeView.startsWith("custom-") && (
              <button
                type="button"
                className="library-view-delete"
                onClick={handleDeleteView}
                title="Delete this saved view"
                aria-label="Delete this saved view"
              >
                ×
              </button>
            )}
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setShowSaveView((current) => !current)}
            title="Save the current filters as a reusable view"
          >
            Save view
          </button>
        </div>
      </div>

      {showSaveView && (
        <div className="library-view-save">
          <input
            autoFocus
            value={viewName}
            onChange={(event) => setViewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleSaveView();
              } else if (event.key === "Escape") {
                setShowSaveView(false);
                setViewName("");
              }
            }}
            maxLength={40}
            placeholder="Name this view, e.g. Short anime"
            aria-label="Name this library view"
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSaveView}
            disabled={!viewName.trim()}
          >
            Save
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setShowSaveView(false);
              setViewName("");
            }}
          >
            Cancel
          </button>
        </div>
      )}

      <div className="library-tabs" role="tablist" aria-label="Library type">
        {TYPE_TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={typeTab === tab.id}
            className={`library-tab${typeTab === tab.id ? " active" : ""}`}
            onClick={() => {
              setTypeTab(tab.id);
              setActiveView("");
            }}
          >
            {tab.label}
            <span className="library-tab-count">
              {tab.id === "all"
                ? facets.total
                : tab.id === "anime"
                  ? facets.anime
                  : tab.id === "movie"
                    ? facets.movies
                    : facets.tv}
            </span>
          </button>
        ))}
      </div>

      <div className="library-filters">
        <button
          className={`filter-chip${statusFilter === "all" ? " active" : ""}`}
          onClick={() => {
            setStatusFilter("all");
            setActiveView("");
          }}
          aria-pressed={statusFilter === "all"}
        >
          All statuses
        </button>
        {WATCH_STATUSES.map((status) => (
          <button
            key={status.id}
            className={`filter-chip${statusFilter === status.id ? " active" : ""}`}
            style={{ "--chip-color": status.color }}
            onClick={() => {
              setStatusFilter(status.id);
              setActiveView("");
            }}
            aria-pressed={statusFilter === status.id}
          >
            <span className="filter-dot" />
            {status.label}
            <span className="filter-count">{facets.statuses[status.id]}</span>
          </button>
        ))}

        {facets.collections.length > 0 && (
          <select
            className="filter-select"
            value={collectionFilter}
            onChange={(event) => {
              setCollectionFilter(event.target.value);
              setActiveView("");
            }}
            aria-label="Filter by collection"
          >
            <option value="">All collections</option>
            {facets.collections.map((collection) => (
              <option key={collection.value} value={collection.value}>
                {collection.value} ({collection.count})
              </option>
            ))}
          </select>
        )}

        {hasFilters && (
          <button
            className="filter-chip filter-chip--clear"
            onClick={clearFilters}
          >
            Reset filters <span aria-hidden="true">×</span>
          </button>
        )}
      </div>

      {facets.tags.length > 0 && (
        <div className="library-tags">
          {facets.tags.slice(0, 14).map((tag) => (
            <button
              key={tag.value}
              className={`tag-chip${tagFilter === tag.value ? " active" : ""}`}
              onClick={() => {
                setTagFilter((current) =>
                  current === tag.value ? null : tag.value,
                );
                setActiveView("");
              }}
              aria-pressed={tagFilter === tag.value}
            >
              {tag.value}
              <span>{tag.count}</span>
            </button>
          ))}
        </div>
      )}

      {facets.total > 0 && (
        <div className="library-section">
          <div className="library-section-title">
            Watchlist ({view.filtered}
            {view.filtered !== facets.total ? ` of ${facets.total}` : ""})
          </div>

          {view.filtered === 0 ? (
            <div className="library-empty-filter">
              <p>No titles match these filters.</p>
              <button className="btn btn-ghost" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          ) : (
            <div className="cards-grid">
              {view.items.map((entry, index) => {
                const key = getWatchKey(entry);
                const rating = getRating(entry);
                const restricted = itemRestricted(entry);
                const isTV = entry.media_type === "tv";
                const progressKey = `${isTV ? "tv" : "movie"}_${entry.id}`;
                return (
                  <div
                    key={key}
                    className={`library-card${dragOverKey === key ? " drag-over" : ""}${selected.has(key) ? " selected" : ""}`}
                    draggable={dragEnabled}
                    onDragStart={(event) => {
                      dragKey.current = key;
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      dragKey.current = null;
                      setDragOverKey(null);
                    }}
                    onDragOver={(event) => {
                      if (!dragEnabled) return;
                      event.preventDefault();
                      setDragOverKey(key);
                    }}
                    onDragLeave={() =>
                      setDragOverKey((current) =>
                        current === key ? null : current,
                      )
                    }
                    onDrop={(event) => {
                      event.preventDefault();
                      handleDrop(key);
                    }}
                  >
                    <MediaCard
                      item={entry}
                      onClick={() =>
                        selectMode ? toggleSelect(key) : onSelect(entry)
                      }
                      progress={progress[progressKey] || 0}
                      watched={watched}
                      onMarkWatched={onMarkWatched}
                      onMarkUnwatched={onMarkUnwatched}
                      ageRating={rating.cert}
                      restricted={restricted}
                      isSaved
                      onToggleSave={() => onRemove(key)}
                      onEdit={() => setEditingKey(key)}
                      selectable={selectMode}
                      selected={selected.has(key)}
                      onToggleSelect={() => toggleSelect(key)}
                    />
                    {isSagaCustom && (
                      <div className="saga-card-order">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={(event) => {
                            event.stopPropagation();
                            moveSaga(key, -1);
                          }}
                          aria-label="Move earlier in this saga"
                          title="Move earlier"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={index === view.items.length - 1}
                          onClick={(event) => {
                            event.stopPropagation();
                            moveSaga(key, 1);
                          }}
                          aria-label="Move later in this saga"
                          title="Move later"
                        >
                          ↓
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {inProgress.length > 0 && (
        <div className="library-section">
          <div className="library-section-title">Continue Watching</div>
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
                  key={pk}
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
      )}

      {history.length > 0 && (
        <div className="library-section">
          <div className="library-section-title">Watch History</div>
          <div className="history-rows">
            {history.map((item) => {
              const pk =
                item.media_type === "movie"
                  ? `movie_${item.id}`
                  : `tv_${item.id}_s${item.season}e${item.episode}`;
              const isWatched = !!watched?.[pk];
              return (
                <div
                  key={`${pk}_${item.watchedAt}`}
                  className="history-row"
                  onClick={() => onSelect(item)}
                >
                  <div className="history-thumb">
                    {item.poster_path && (
                      <img
                        src={imgUrl(item.poster_path, "w92")}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      {item.title}
                      {isWatched && <WatchedIcon size={16} />}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text3)" }}>
                      {item.media_type === "tv" &&
                        item.season != null &&
                        item.episode != null && (
                          <>
                            {`S${item.season}E${item.episode}`}
                            {item.episodeName ? ` · ${item.episodeName}` : ""}
                            {" · "}
                          </>
                        )}
                      {new Date(item.watchedAt).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </div>
                  </div>
                  <span
                    className={`search-result-type ${item.media_type === "tv" ? "type-tv" : "type-movie"}`}
                  >
                    {item.media_type === "tv" ? "Series" : "Movie"}
                  </span>
                  {onRemoveHistory && (
                    <button
                      className="history-remove-btn"
                      title="Remove from history"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemoveHistory(item);
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {history.length === 0 && facets.total === 0 && (
        <div className="empty-state">
          <EyeIcon />
          <h3>Nothing here yet</h3>
          <p>
            Start watching a movie or series and your history will appear here.
          </p>
        </div>
      )}

      {selected.size > 0 && (
        <div className="bulk-bar" role="region" aria-label="Bulk actions">
          <div className="bulk-count">
            {selected.size} selected
            {hasFilters ? ` · filtered view` : ""}
          </div>
          <div className="bulk-actions">
            {WATCH_STATUSES.map((status) => (
              <button
                key={status.id}
                className="btn btn-ghost"
                onClick={() => bulkSetStatus(status.id)}
              >
                <span
                  className="filter-dot"
                  style={{ "--chip-color": status.color }}
                />
                {status.label}
              </button>
            ))}
            <button className="btn btn-danger" onClick={bulkRemove}>
              Remove
            </button>
            <button className="btn btn-ghost" onClick={clearSelection}>
              Clear
            </button>
          </div>
        </div>
      )}

      {editingEntry && (
        <WatchlistEditModal
          entry={editingEntry}
          onClose={() => setEditingKey(null)}
          onSave={(patch) => onUpdate(editingKey, patch)}
          allTags={facets.tags.map((tag) => tag.value)}
          allCollections={facets.collections.map(
            (collection) => collection.value,
          )}
        />
      )}
    </div>
  );
}

export default memo(LibraryPage);
