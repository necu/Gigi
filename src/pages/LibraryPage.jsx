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
import SectionFrame from "../components/SectionFrame";
import { ForYouShelf, SagaShelf } from "../components/LibrarySmart";
import { useT } from "../utils/i18n";
import { loadSectionOrder, saveSectionOrder } from "../utils/sectionLayout";
import {
  VibeCloudModal,
  VibeFilterPanel,
} from "../components/LibraryMoodExplorer";
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
import {
  hasVibeContext,
  loadVibeFilters,
  normalizeVibeFilters,
  saveVibeFilters,
} from "../utils/vibeTags";

const TYPE_TABS = [
  { id: "all", labelKey: "library.all" },
  { id: "movie", labelKey: "library.movies" },
  { id: "tv", labelKey: "library.series" },
  { id: "anime", labelKey: "library.anime" },
];

const LIBRARY_PANELS = ["sagas", "foryou", "vibe", "watchlist", "continue"];
const LIBRARY_TOP_PANELS = ["sagas", "foryou", "vibe"];
const LIBRARY_BOTTOM_PANELS = ["watchlist", "continue"];

function relativeWatched(ts) {
  const value = Number(ts) || 0;
  if (!value) return "";
  const diff = Math.max(0, Date.now() - value);
  if (diff < 60_000) return "ahora";
  if (diff < 3_600_000) return `hace ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `hace ${Math.floor(diff / 3_600_000)} h`;
  if (diff < 7 * 86_400_000) return `hace ${Math.floor(diff / 86_400_000)} d`;
  return new Date(value).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
  });
}

/**
 * Permanently visible, minimal watch-history strip. It sticks to the top of
 * the library while scrolling and always shows the last titles played.
 */
function WatchHistoryRail({ history = [], watched, onSelect, onRemoveHistory }) {
  return (
    <section className="history-rail" aria-label="Watch history">
      <div className="history-rail__head">
        <div>
          <div className="history-rail__eyebrow">Watch history</div>
          <h2 className="history-rail__title">Lo último que has reproducido</h2>
        </div>
        <span className="history-rail__count">{history.length}</span>
      </div>
      {history.length > 0 ? (
        <div className="history-rail__list">
          {history.slice(0, 10).map((item) => {
            const pk =
              item.media_type === "movie"
                ? `movie_${item.id}`
                : `tv_${item.id}_s${item.season}e${item.episode}`;
            const isWatched = !!watched?.[pk];
            return (
              <div className="history-pill" key={`${pk}_${item.watchedAt}`}>
                <button
                  type="button"
                  className="history-pill__main"
                  onClick={() => onSelect(item)}
                  title={item.title}
                >
                  <span className="history-pill__poster">
                    {item.poster_path ? (
                      <img
                        src={imgUrl(item.poster_path, "w92")}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span>{item.title?.slice(0, 1) || "?"}</span>
                    )}
                  </span>
                  <span className="history-pill__copy">
                    <b>
                      {item.title}
                      {isWatched && <WatchedIcon size={12} />}
                    </b>
                    <small>
                      {item.media_type === "tv" &&
                      item.season != null &&
                      item.episode != null
                        ? `S${item.season}E${item.episode}${
                            item.episodeName ? ` · ${item.episodeName}` : ""
                          }`
                        : "Película"}
                      {" · "}
                      {relativeWatched(item.watchedAt)}
                    </small>
                  </span>
                </button>
                {onRemoveHistory && (
                  <button
                    type="button"
                    className="history-pill__remove"
                    onClick={() => onRemoveHistory(item)}
                    title="Quitar del historial"
                    aria-label={`Quitar ${item.title} del historial`}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="history-rail__empty">
          Cuando empieces a ver algo, aquí quedará lo último que has
          reproducido.
        </div>
      )}
    </section>
  );
}

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
  const [vibeFilters, setVibeFilters] = useState(() =>
    loadVibeFilters(storage),
  );
  const [showVibeCloud, setShowVibeCloud] = useState(false);
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
  const [panelOrder, setPanelOrder] = useState(() =>
    loadSectionOrder("library", LIBRARY_PANELS),
  );
  const t = useT();

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

  const movePanelWithin = useCallback((ids, id, delta) => {
    setPanelOrder((current) => {
      const group = current.filter((panelId) => ids.includes(panelId));
      const from = group.indexOf(id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= group.length) return current;
      const targetId = group[to];
      const next = [...current];
      const a = next.indexOf(id);
      const b = next.indexOf(targetId);
      [next[a], next[b]] = [next[b], next[a]];
      saveSectionOrder("library", next);
      return next;
    });
  }, []);
  const moveTopPanel = useCallback(
    (id, delta) => movePanelWithin(LIBRARY_TOP_PANELS, id, delta),
    [movePanelWithin],
  );
  const moveBottomPanel = useCallback(
    (id, delta) => movePanelWithin(LIBRARY_BOTTOM_PANELS, id, delta),
    [movePanelWithin],
  );
  const topPanelOrder = panelOrder.filter((id) =>
    LIBRARY_TOP_PANELS.includes(id),
  );
  const bottomPanelOrder = panelOrder.filter((id) =>
    LIBRARY_BOTTOM_PANELS.includes(id),
  );
  const hasSagaShelf = useMemo(() => {
    const counts = new Map();
    for (const entry of savedEntries) {
      for (const name of entry.collections || []) {
        counts.set(name, (counts.get(name) || 0) + 1);
      }
    }
    return [...counts.values()].some((count) => count >= 2);
  }, [savedEntries]);

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
    setVibeFilters({});
    saveVibeFilters(storage, {});
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
        tagGroups: vibeFilters,
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
      vibeFilters,
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
  }, [
    typeTab,
    statusFilter,
    tagFilter,
    vibeFilters,
    collectionFilter,
    query,
  ]);

  const missingVibeCount = useMemo(
    () => savedEntries.filter((entry) => !hasVibeContext(entry)).length,
    [savedEntries],
  );
  const autoTagAttemptedRef = useRef(false);

  // The mood cloud is only useful when the whole library has context tags.
  // Backfill quietly in the background the first time the library is opened,
  // with a cooldown so a temporary TMDB failure does not cause a loop.
  useEffect(() => {
    if (!apiKey || !missingVibeCount || organizing) return;
    if (autoTagAttemptedRef.current) return;
    const lastAttempt = Number(storage.get("vibeAutoTagAt")) || 0;
    if (Date.now() - lastAttempt < 6 * 60 * 60 * 1000) return;
    autoTagAttemptedRef.current = true;
    storage.set("vibeAutoTagAt", Date.now());
    onOrganize?.({ auto: true });
  }, [apiKey, missingVibeCount, organizing, onOrganize]);

  const handleVibeChange = useCallback(
    (next) => {
      const normalized = normalizeVibeFilters(next);
      setVibeFilters(normalized);
      saveVibeFilters(storage, normalized);
      setActiveView("");
    },
    [],
  );

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
    Object.values(vibeFilters).some(Boolean) ||
    collectionFilter;

  const clearFilters = () => {
    setQuery("");
    setTypeTab("all");
    setStatusFilter("all");
    setTagFilter(null);
    setVibeFilters({});
    saveVibeFilters(storage, {});
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
    const nextVibeFilters = normalizeVibeFilters(filters.vibeFilters);
    setVibeFilters(nextVibeFilters);
    saveVibeFilters(storage, nextVibeFilters);
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
      vibeFilters,
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
          <div className="library-kicker">{t("library.kicker")}</div>
          <h1 className="library-title">{t("library.title")}</h1>
          <div className="library-stats">
            <span className="library-stat">
              <b>{facets.total}</b> {t("library.saved")}
            </span>
            <span className="library-stat">
              <b>{facets.statuses.planned}</b> {t("library.planned")}
            </span>
            <span className="library-stat">
              <b>{facets.statuses.watching}</b> {t("library.watching")}
            </span>
            <span className="library-stat library-stat--accent">
              <b>{facets.statuses.done}</b> {t("library.completed")}
            </span>
          </div>
        </div>
        <div className="library-header-actions">
          {onOrganize && (
            <button
              className="btn btn-ghost"
              onClick={() => onOrganize?.({})}
              disabled={organizing}
              title="Re-derive genres, directors, decades and franchises for the library"
            >
              {organizing
                ? `${t("library.organizing")}${
                    organizeProgress?.total
                      ? ` ${organizeProgress.done}/${organizeProgress.total}`
                      : "…"
                  }`
                : `✨ ${t("library.organize")}`}
            </button>
          )}
          {selectMode && (
            <button className="btn btn-ghost" onClick={selectAllVisible}>
              {t("library.selectAll")}
            </button>
          )}
          <button
            className={`btn ${selectMode ? "btn-secondary" : "btn-ghost"}`}
            onClick={() => {
              if (selectMode) clearSelection();
              else setSelectMode(true);
            }}
          >
            {selectMode ? t("library.cancelSelection") : t("library.select")}
          </button>
        </div>
      </div>

      <div className="library-panels">
        {hasSagaShelf && (
          <SectionFrame
            id="sagas"
            index={topPanelOrder.indexOf("sagas")}
            count={topPanelOrder.length}
            onMove={moveTopPanel}
            order={topPanelOrder.indexOf("sagas")}
            className="library-smart"
          >
            <SagaShelf
              entries={savedEntries}
              onOpenPlaylist={onOpenPlaylist}
            />
          </SectionFrame>
        )}

        {savedEntries.length > 0 && apiKey && (
          <SectionFrame
            id="foryou"
            index={topPanelOrder.indexOf("foryou")}
            count={topPanelOrder.length}
            onMove={moveTopPanel}
            order={topPanelOrder.indexOf("foryou")}
            className="library-smart"
          >
            <ForYouShelf
              entries={savedEntries}
              apiKey={apiKey}
              isSaved={isSaved}
              onToggleSave={onToggleSave}
              onAddMany={onAddMany}
              onSelect={onSelect}
            />
          </SectionFrame>
        )}

        {savedEntries.length > 0 && (
          <SectionFrame
            id="vibe"
            index={topPanelOrder.indexOf("vibe")}
            count={topPanelOrder.length}
            onMove={moveTopPanel}
            order={topPanelOrder.indexOf("vibe")}
          >
            <VibeFilterPanel
              entries={savedEntries}
              active={vibeFilters}
              onChange={handleVibeChange}
              onExpand={() => setShowVibeCloud(true)}
              organizing={organizing}
              progress={organizeProgress}
              missingCount={missingVibeCount}
            />
          </SectionFrame>
        )}
      </div>

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
            placeholder={t("library.search")}
            aria-label={t("library.searchAria")}
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
            {t(tab.labelKey)}
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

      <div className="library-panels library-panels--bottom">
      {facets.total > 0 && (
        <SectionFrame
          id="watchlist"
          index={bottomPanelOrder.indexOf("watchlist")}
          count={bottomPanelOrder.length}
          onMove={moveBottomPanel}
          order={bottomPanelOrder.indexOf("watchlist")}
        >
        <div className="library-section">
          <div className="library-section-title">
            {t("library.title")} ({view.filtered}
            {view.filtered !== facets.total ? ` / ${facets.total}` : ""})
          </div>

          {view.filtered === 0 ? (
            <div className="library-empty-filter">
              <p>{t("library.empty")}</p>
              <button className="btn btn-ghost" onClick={clearFilters}>
                {t("library.resetFilters")}
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
        </SectionFrame>
      )}

      {inProgress.length > 0 && (
        <SectionFrame
          id="continue"
          index={bottomPanelOrder.indexOf("continue")}
          count={bottomPanelOrder.length}
          onMove={moveBottomPanel}
          order={bottomPanelOrder.indexOf("continue")}
        >
        <div className="library-section">
          <div className="library-section-title">{t("home.continue")}</div>
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
        </SectionFrame>
      )}
      </div>

      {history.length === 0 && facets.total === 0 && (
        <div className="empty-state">
          <EyeIcon />
          <h3>Nothing here yet</h3>
          <p>
            Start watching a movie or series and your history will appear here.
          </p>
        </div>
      )}

      <VibeCloudModal
        open={showVibeCloud}
        entries={savedEntries}
        active={vibeFilters}
        onChange={handleVibeChange}
        onClose={() => setShowVibeCloud(false)}
        onSelect={onSelect}
      />

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
