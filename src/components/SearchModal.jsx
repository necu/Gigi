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
import { departmentKey } from "../utils/people";
import useFocusTrap from "../utils/useFocusTrap";
import { useT } from "../utils/i18n";

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
  onOpenPerson,
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
  const t = useT();

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

        if (
          (result.results || []).length > 0 ||
          result.person
        ) {
          searchDb.record({
            query: trimmed,
            resultCount:
              (result.results || []).length + (result.person ? 1 : 0),
            kind: result.person && !result.best ? "person" : "text",
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
        setError(t("search.failed"));
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

  const handleOpenPerson = useCallback(() => {
    if (!data?.person) return;
    onOpenPerson?.(data.person);
    onClose?.();
  }, [data, onOpenPerson, onClose]);

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
    if (!results.length) {
      if (event.key === "Enter" && data?.person) {
        event.preventDefault();
        handleOpenPerson();
      }
      return;
    }
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
      aria-label={t("search.aria")}
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
            placeholder={t("search.placeholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            aria-label={t("search.aria")}
            aria-autocomplete="list"
          />
          {query ? (
            <button
              className="btn btn-ghost btn-icon"
              onClick={() => setQuery("")}
              aria-label={t("search.clear")}
            >
              <CloseIcon />
            </button>
          ) : (
            <button
              className="btn btn-ghost btn-icon"
              onClick={onClose}
              aria-label={t("search.close")}
            >
              <CloseIcon />
            </button>
          )}
        </div>

        {loading && <div className="search-loading-bar" aria-hidden="true" />}

        <div className="search-results" ref={resultsRef}>
          {offline && (
            <div className="search-offline">
              🌐 {t("search.offline")}
            </div>
          )}

          <span className="sr-only" role="status">
            {loading
              ? t("search.searching")
              : best
                ? t(
                    results.length === 1
                      ? "search.resultCount"
                      : "search.resultCountPlural",
                    { n: results.length },
                  )
                : ""}
          </span>

          {loading && !best && <SearchSkeleton />}

          {!loading && error && <div className="search-empty">{error}</div>}

          {!loading && !error && query.trim() && !best && !data?.person && (
            <div className="search-empty">
              {t("search.noMatches", { query: query.trim() })}
            </div>
          )}

          {best?._search?.suggestion && (
            <div className="search-correction">
              <span>{t("search.closest")}</span>{" "}
              <button
                type="button"
                onClick={() => setQuery(best._search.suggestion)}
              >
                {best._search.suggestion}
              </button>
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
                      {t("search.best")}
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
                        best.media_type === "tv"
                          ? t("search.series")
                          : t("search.movie"),
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
                      {t("search.open")}
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
                      {savedFor(best)
                        ? t("search.saved")
                        : t("search.addLibrary")}
                    </button>
                  </div>
                </div>
              </div>

              {others.length > 0 && (
                <div className="search-section">
                  <div className="search-section__title">
                    {t("search.more")}
                  </div>
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
                                item.media_type === "tv"
                                  ? t("search.series")
                                  : t("search.movie"),
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
                              saved
                                ? t("search.removeFromLibrary")
                                : t("search.addToLibrary")
                            }
                            aria-label={
                              saved
                                ? t("search.removeFromLibrary")
                                : t("search.addToLibrary")
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

          {data?.person && (
            <div className="search-section search-section--person">
              <div className="search-person">
                <div className="search-person__photo">
                  {data.person.profile_path ? (
                    <img
                      src={imgUrl(data.person.profile_path, "w185")}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <span>{data.person.name?.[0] || "?"}</span>
                  )}
                </div>
                <div className="search-person__info">
                  <div className="search-person__kicker">
                    {data.person._match
                      ? t("search.personMatch", { n: data.person._match })
                      : t("search.person")}
                  </div>
                  <div className="search-person__name">
                    {data.person.name}
                  </div>
                  <div className="search-person__meta">
                    {[
                      data.person.known_for_department
                        ? departmentKey(data.person.known_for_department)
                          ? t(
                              `person.dept.${departmentKey(
                                data.person.known_for_department,
                              )}`,
                            )
                          : data.person.known_for_department
                        : null,
                      data.person.known_for?.length
                        ? t("search.personKnownFor", {
                            titles: data.person.known_for.join(", "),
                          })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  {data.person._fuzzy < 0.98 && (
                    <div className="search-person__note">
                      {t("search.interpreted", { name: data.person.name })}
                    </div>
                  )}
                </div>
                <div className="search-person__actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleOpenPerson}
                  >
                    {t("search.openProfile")}
                  </button>
                </div>
              </div>

              {personPicks.length > 0 && (
                <>
                  <div
                    className="search-section__head"
                    style={{ marginTop: 14 }}
                  >
                    <div>
                      <div className="search-section__title">
                        {t("search.with", { name: data.person.name })}
                      </div>
                      <div className="search-section__sub">
                        {t("search.withSub")}
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost"
                      onClick={() => handleSaveAll(personPicks)}
                    >
                      {t("search.saveAll")}
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
                </>
              )}
            </div>
          )}

          {(recs.loading || recs.items.length > 0) && (
            <div className="search-section search-section--recs">
              <div className="search-section__head">
                <div>
                  <div className="search-section__title">
                    {recs.seedTitle
                      ? t("search.because", { title: recs.seedTitle })
                      : t("search.alsoLike")}
                  </div>
                  <div className="search-section__sub">
                    {t("search.recsSub")}
                  </div>
                </div>
                {recs.items.length > 0 && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => handleSaveAll(recs.items)}
                  >
                    {t("search.saveAll")}
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
                <span className="search-history-label">
                  {t("search.again")}
                </span>
                <button
                  className="search-history-clear"
                  onClick={clearMemory}
                >
                  {t("search.clearAll")}
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
                    <span
                      className="search-history-best"
                      title={t("search.bestMatchTitle")}
                    >
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
                {t("search.hintTitle")}
              </div>
              <p>
                {t("search.hintBody")}
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
            <kbd>↓</kbd> {t("search.navigate")}
          </span>
          <span>
            <kbd>Enter</kbd> {t("search.open")}
          </span>
          <span>
            <kbd>Esc</kbd> {t("common.close")}
          </span>
          {results.length > 0 && (
            <span className="search-keybar__count">
              {t(
                results.length === 1
                  ? "search.resultCount"
                  : "search.resultCountPlural",
                { n: results.length },
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
