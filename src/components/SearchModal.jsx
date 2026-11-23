import { useCallback, useEffect, useRef, useState } from "react";
import { imgUrl } from "../utils/api";
import { SearchIcon, CloseIcon } from "./Icons";
import SmartCard from "./SmartCard";
import {
  searchSmart,
  fetchDiscovery,
  fetchPersonPicks,
} from "../utils/searchBrain";
import { searchDb } from "../utils/searchDb";
import { getWatchKey } from "../utils/watchlist";
import useFocusTrap from "../utils/useFocusTrap";

const EMPTY_RECS = { items: [], loading: false, seedTitle: "" };

const yearOf = (item) =>
  (item?.release_date || item?.first_air_date || "").slice(0, 4);

const SEARCH_SUGGESTIONS = ["Dune 2021", "Alien", "Bong Joon-ho"];

function SearchSkeleton() {
  return (
    <div className="search-skeleton" aria-hidden="true">
      <div className="search-skeleton__hero">
        <div className="search-skeleton__poster" />
        <div className="search-skeleton__lines">
          <span className="search-skeleton__line search-skeleton__line--short" />
          <span className="search-skeleton__line search-skeleton__line--title" />
          <span className="search-skeleton__line" />
          <span className="search-skeleton__line search-skeleton__line--tiny" />
        </div>
      </div>
      {Array.from({ length: 3 }).map((_, index) => (
        <div className="search-skeleton__row" key={index}>
          <div className="search-skeleton__thumb" />
          <div className="search-skeleton__lines">
            <span className="search-skeleton__line" />
            <span className="search-skeleton__line search-skeleton__line--tiny" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SearchModal({
  apiKey,
  onSelect,
  onClose,
  offline,
  taste,
  isSaved,
  onToggleSave,
  onAddMany,
}) {
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [recs, setRecs] = useState(EMPTY_RECS);
  const [personPicks, setPersonPicks] = useState([]);
  const [memory, setMemory] = useState([]);
  const [boosts, setBoosts] = useState({});
  const [savedMap, setSavedMap] = useState({});
  const [highlight, setHighlight] = useState(0);

  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const resultsRef = useRef(null);
  const requestRef = useRef(0);
  const recRequestRef = useRef(0);
  const tasteRef = useRef(taste);
  tasteRef.current = taste;
  const boostsRef = useRef(boosts);
  boostsRef.current = boosts;

  useFocusTrap(dialogRef, { onEscape: onClose });

  useEffect(() => {
    const active = resultsRef.current?.querySelector(
      ".search-hero.is-active, .search-row.is-active",
    );
    active?.scrollIntoView({ block: "nearest" });
  }, [highlight, data]);

  useEffect(() => {
    let mounted = true;
    searchDb.suggest(20).then((list) => {
      if (mounted) setMemory(list || []);
    });
    searchDb.boosts().then((map) => {
      if (mounted) setBoosts(map || {});
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2 || !apiKey) {
      requestRef.current += 1;
      recRequestRef.current += 1;
      setData(null);
      setLoading(false);
      setRecs(EMPTY_RECS);
      setPersonPicks([]);
      setError(null);
      return;
    }

    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);

    const timer = setTimeout(async () => {
      try {
        const result = await searchSmart({
          query: trimmed,
          apiKey,
          taste: tasteRef.current,
          boosts: boostsRef.current,
        });
        if (requestId !== requestRef.current) return;

        setData(result);
        setLoading(false);
        setHighlight(0);

        if ((result.results || []).length > 0) {
          searchDb.record({
            query: trimmed,
            resultCount: result.results.length,
            kind: "text",
          });
        }

        if (result.best) {
          const recId = ++recRequestRef.current;
          const seedTitle = result.best.title || result.best.name;
          setRecs({ items: [], loading: true, seedTitle });
          fetchDiscovery({
            type: result.best.media_type,
            id: result.best.id,
            apiKey,
            taste: tasteRef.current,
            limit: 10,
          })
            .then((response) => {
              if (recId !== recRequestRef.current) return;
              setRecs({
                items: response.items || [],
                loading: false,
                seedTitle,
              });
            })
            .catch(() => {
              if (recId === recRequestRef.current) {
                setRecs({ items: [], loading: false, seedTitle: "" });
              }
            });
        } else {
          recRequestRef.current += 1;
          setRecs(EMPTY_RECS);
        }

        if (result.person) {
          fetchPersonPicks(result.person, apiKey, tasteRef.current, 8)
            .then((items) => {
              if (requestId === requestRef.current) setPersonPicks(items);
            })
            .catch(() => {});
        } else {
          setPersonPicks([]);
        }
      } catch {
        if (requestId !== requestRef.current) return;
        setData({ results: [], best: null, person: null, parsed: null });
        setLoading(false);
        setError("Search failed. Check your connection and try again.");
      }
    }, 320);

    return () => clearTimeout(timer);
  }, [query, apiKey]);

  const savedFor = useCallback(
    (item) => {
      const key = getWatchKey(item);
      if (!key) return false;
      if (Object.prototype.hasOwnProperty.call(savedMap, key)) {
        return savedMap[key];
      }
      return !!isSaved?.(item);
    },
    [savedMap, isSaved],
  );

  const handleToggleSave = useCallback(
    (item) => {
      const key = getWatchKey(item);
      if (!key) return;
      const currently = savedFor(item);
      onToggleSave?.(item);
      setSavedMap((previous) => ({ ...previous, [key]: !currently }));
    },
    [savedFor, onToggleSave],
  );

  const handleOpen = useCallback(
    (item) => {
      if (!item) return;
      const trimmed = query.trim();
      if (trimmed) {
        searchDb.recordPick({
          query: trimmed,
          key: getWatchKey(item),
          title: item.title || item.name,
          mediaType: item.media_type,
        });
      }
      onSelect?.(item);
      onClose?.();
    },
    [query, onSelect, onClose],
  );

  const handleSaveAll = (items) => {
    const fresh = (items || []).filter((item) => !savedFor(item));
    if (fresh.length === 0) return;
    onAddMany?.(fresh);
    setSavedMap((previous) => {
      const next = { ...previous };
      for (const item of fresh) {
        const key = getWatchKey(item);
        if (key) next[key] = true;
      }
      return next;
    });
  };

  const clearMemory = async () => {
    await searchDb.clear();
    setMemory([]);
  };

  const handleMemoryPick = (term) => {
    setQuery(term);
    inputRef.current?.focus();
  };

  const results = data?.results || [];
  const best = data?.best || null;
  const others = results.slice(1, 9);

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose?.();
      return;
    }
    if (!results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => Math.min(current + 1, results.length - 1));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
    }
    if (event.key === "Enter") {
      event.preventDefault();
      handleOpen(results[Math.min(highlight, results.length - 1)]);
    }
  };

  const showMemory = !query.trim() && memory.length > 0;

  return (
    <div
      ref={dialogRef}
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Search movies, series and people"
      tabIndex={-1}
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="search-box search-box--smart">
        <div className="search-input-wrap">
          <SearchIcon />
          <input
            ref={inputRef}
            data-autofocus
            className="search-input"
            placeholder="Search a title, a name, or “Dune 2021”…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Search movies, series and people"
            aria-autocomplete="list"
          />
          {query ? (
            <button
              className="btn btn-ghost btn-icon"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <CloseIcon />
            </button>
          ) : (
            <button
              className="btn btn-ghost btn-icon"
              onClick={onClose}
              aria-label="Close search"
            >
              <CloseIcon />
            </button>
          )}
        </div>

        {loading && <div className="search-loading-bar" aria-hidden="true" />}

        <div className="search-results" ref={resultsRef}>
          {offline && (
            <div className="search-offline">
              🌐 No internet, search is unavailable offline.
            </div>
          )}

          <span className="sr-only" role="status">
            {loading
              ? "Searching"
              : best
                ? `${results.length} results`
                : ""}
          </span>

          {loading && !best && <SearchSkeleton />}

          {!loading && error && <div className="search-empty">{error}</div>}

          {!loading && !error && query.trim() && !best && (
            <div className="search-empty">
              No matches for “{query.trim()}”. Try fewer words or add a year.
            </div>
          )}

          {best && (
            <>
              <div
                className={`search-hero${highlight === 0 ? " is-active" : ""}`}
                onClick={() => handleOpen(best)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleOpen(best);
                }}
              >
                <div
                  className="search-hero__bg"
                  style={
                    best.backdrop_path || best.poster_path
                      ? {
                          backgroundImage: `url(${imgUrl(
                            best.backdrop_path || best.poster_path,
                            "w780",
                          )})`,
                        }
                      : undefined
                  }
                />
                <div className="search-hero__content">
                  <div className="search-hero__poster">
                    {best.poster_path ? (
                      <img
                        src={imgUrl(best.poster_path, "w185")}
                        alt={best.title || best.name}
                      />
                    ) : (
                      <span>🎞</span>
                    )}
                  </div>
                  <div className="search-hero__info">
                    <div className="search-hero__kicker">
                      Best match
                      {best._search?.match != null
                        ? ` · ${best._search.match}%`
                        : ""}
                    </div>
                    <div className="search-hero__title">
                      {best.title || best.name}
                    </div>
                    <div className="search-hero__meta">
                      {[
                        yearOf(best),
                        best.media_type === "tv" ? "Series" : "Movie",
                        best.vote_average
                          ? `★ ${Number(best.vote_average).toFixed(1)}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    <div className="search-reasons">
                      {(best._search?.reasons || []).map((reason, index) => (
                        <span
                          className="search-reason"
                          key={`${reason}-${index}`}
                        >
                          {reason}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="search-hero__actions">
                    <button
                      className="btn btn-primary"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleOpen(best);
                      }}
                    >
                      Open
                    </button>
                    <button
                      className={`btn ${
                        savedFor(best) ? "btn-secondary" : "btn-ghost"
                      }`}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleToggleSave(best);
                      }}
                    >
                      {savedFor(best) ? "Saved" : "+ Library"}
                    </button>
                  </div>
                </div>
              </div>

              {others.length > 0 && (
                <div className="search-section">
                  <div className="search-section__title">More matches</div>
                  <div className="search-rows">
                    {others.map((item, index) => {
                      const saved = savedFor(item);
                      const active = highlight === index + 1;
                      return (
                        <div
                          key={`${item.media_type}_${item.id}`}
                          className={`search-row${active ? " is-active" : ""}`}
                          onClick={() => handleOpen(item)}
                          role="button"
                          tabIndex={0}
                          aria-current={active ? "true" : undefined}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              handleOpen(item);
                            }
                          }}
                        >
                          <div className="search-row__poster">
                            {item.poster_path ? (
                              <img
                                src={imgUrl(item.poster_path, "w92")}
                                alt=""
                                loading="lazy"
                              />
                            ) : (
                              <span>🎞</span>
                            )}
                          </div>
                          <div className="search-row__main">
                            <div className="search-row__title">
                              {item.title || item.name}
                            </div>
                            <div className="search-row__meta">
                              {[
                                yearOf(item),
                                item.media_type === "tv" ? "Series" : "Movie",
                                item.vote_average
                                  ? `★ ${Number(item.vote_average).toFixed(1)}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                            {item._search?.reasons?.[0] && (
                              <div className="search-row__reason">
                                {item._search.reasons[0]}
                              </div>
                            )}
                          </div>
                          <button
                            className={`search-row__save${
                              saved ? " is-saved" : ""
                            }`}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleToggleSave(item);
                            }}
                            title={
                              saved ? "Remove from library" : "Add to library"
                            }
                            aria-label={
                              saved ? "Remove from library" : "Add to library"
                            }
                          >
                            {saved ? "✓" : "+"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {data?.person && personPicks.length > 0 && (
            <div className="search-section">
              <div className="search-section__head">
                <div>
                  <div className="search-section__title">
                    With {data.person.name}
                  </div>
                  <div className="search-section__sub">
                    Explore the filmography without leaving the search.
                  </div>
                </div>
                <button
                  className="btn btn-ghost"
                  onClick={() => handleSaveAll(personPicks)}
                >
                  Save all
                </button>
              </div>
              <div className="smart-strip">
                {personPicks.map((item) => (
                  <SmartCard
                    key={`${item.media_type}_${item.id}`}
                    item={item}
                    saved={savedFor(item)}
                    onOpen={handleOpen}
                    onSave={handleToggleSave}
                  />
                ))}
              </div>
            </div>
          )}

          {(recs.loading || recs.items.length > 0) && (
            <div className="search-section search-section--recs">
              <div className="search-section__head">
                <div>
                  <div className="search-section__title">
                    {recs.seedTitle
                      ? `Because you're looking for ${recs.seedTitle}`
                      : "You may also like"}
                  </div>
                  <div className="search-section__sub">
                    Cast, directors, music, photography, themes and your own
                    taste — not just “similar”.
                  </div>
                </div>
                {recs.items.length > 0 && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => handleSaveAll(recs.items)}
                  >
                    Save all
                  </button>
                )}
              </div>

              {recs.loading && recs.items.length === 0 ? (
                <div className="smart-strip">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <div
                      className="smart-mini smart-mini--skeleton"
                      key={index}
                    >
                      <div className="smart-mini__poster" />
                      <div className="smart-skeleton-line" />
                      <div className="smart-skeleton-line smart-skeleton-line--short" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="smart-strip">
                  {recs.items.map((item) => (
                    <SmartCard
                      key={`${item.media_type}_${item.id}`}
                      item={item}
                      saved={savedFor(item)}
                      onOpen={handleOpen}
                      onSave={handleToggleSave}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {showMemory && !loading && (
            <div className="search-history">
              <div className="search-history-header">
                <span className="search-history-label">Search again</span>
                <button
                  className="search-history-clear"
                  onClick={clearMemory}
                >
                  Clear all
                </button>
              </div>
              {memory.map((entry) => (
                <div
                  key={entry.query}
                  className="search-history-item"
                  onClick={() => handleMemoryPick(entry.query)}
                >
                  <span className="search-history-icon">
                    <SearchIcon />
                  </span>
                  <span className="search-history-term">{entry.query}</span>
                  {entry.bestTitle && (
                    <span className="search-history-best" title="Best match">
                      {entry.bestTitle}
                    </span>
                  )}
                  {entry.uses > 1 && (
                    <span className="search-history-count">{entry.uses}×</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {!query.trim() && memory.length === 0 && (
            <div className="search-hint">
              <div className="search-hint__icon">
                <SearchIcon />
              </div>
              <div className="search-hint__title">
                Find a title. Get the whole universe.
              </div>
              <p>
                Type any part of a title, or a name. Results carry their own
                recommendations and every card saves with one click.
              </p>
              <div className="search-suggestions">
                {SEARCH_SUGGESTIONS.map((term) => (
                  <button
                    key={term}
                    type="button"
                    className="search-suggestion"
                    onClick={() => handleMemoryPick(term)}
                  >
                    {term}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="search-keybar" aria-hidden="true">
          <span className="search-keybar__group">
            <kbd>↑</kbd>
            <kbd>↓</kbd> Navigate
          </span>
          <span>
            <kbd>Enter</kbd> Open
          </span>
          <span>
            <kbd>Esc</kbd> Close
          </span>
          {results.length > 0 && (
            <span className="search-keybar__count">
              {results.length} result{results.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
