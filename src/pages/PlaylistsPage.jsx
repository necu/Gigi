import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChipInput from "../components/ChipInput";
import { FilmIcon, PlaylistIcon, SearchIcon } from "../components/Icons";
import { imgUrl } from "../utils/api";
import {
  PLAYLIST_GENRES,
  PLAYLIST_MOMENTS,
  PLAYLIST_TERM_IDEAS,
  buildPlaylist,
  momentById,
  momentForNow,
} from "../utils/playlistBrain";
import { getWatchKey } from "../utils/watchlist";
import { usePlaylists } from "../utils/usePlaylists";

const uniq = (values) => [...new Set((values || []).filter(Boolean))];

function emptyDraft() {
  return {
    name: "",
    moment: momentForNow(),
    genre: "",
    subgenre: "",
    terms: [],
  };
}

function autoName(draft) {
  const moment = momentById(draft.moment);
  const focus =
    draft.genre ||
    draft.subgenre.trim() ||
    draft.terms[0] ||
    "slow picks";
  return `${moment.label} · ${focus}`;
}

function yearOf(item) {
  return (
    item?.year || (item?.release_date || item?.first_air_date || "").slice(0, 4)
  );
}

function itemsToMap(items) {
  const map = new Map();
  for (const item of items || []) {
    const key = getWatchKey(item);
    if (key) map.set(key, item);
  }
  return map;
}

function libraryTags(watchlist) {
  const counts = new Map();
  for (const entry of Object.values(watchlist?.items || {})) {
    for (const tag of entry.tags || []) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([tag]) => tag);
}

function PlaylistPickCard({ item, selected, onToggle, onOpen }) {
  const title = item.title || item.name || "Untitled";
  const reason = item._why?.reasons?.[0]?.label;
  const match = item._why?.match;

  return (
    <article className={`playlist-pick${selected ? " is-selected" : ""}`}>
      <button
        type="button"
        className="playlist-pick__poster"
        onClick={() => onToggle(item)}
        aria-label={selected ? `Remove ${title}` : `Add ${title}`}
      >
        {item.poster_path ? (
          <img src={imgUrl(item.poster_path, "w342")} alt="" loading="lazy" />
        ) : (
          <span className="playlist-pick__placeholder">
            <FilmIcon />
          </span>
        )}
        {match != null && (
          <span className="playlist-pick__match">{match}%</span>
        )}
        <span className="playlist-pick__check">{selected ? "✓" : "+"}</span>
      </button>
      <div className="playlist-pick__body">
        <div className="playlist-pick__title" title={title}>
          {title}
        </div>
        <div className="playlist-pick__meta">
          {yearOf(item) || "—"} · Movie
        </div>
        {reason && <div className="playlist-pick__reason">{reason}</div>}
        <div className="playlist-pick__actions">
          <button
            type="button"
            className="playlist-pick__add"
            onClick={() => onToggle(item)}
          >
            {selected ? "Added" : "Add"}
          </button>
          <button
            type="button"
            className="playlist-pick__details"
            onClick={() => onOpen?.(item)}
          >
            Details
          </button>
        </div>
      </div>
    </article>
  );
}

export default function PlaylistsPage({
  apiKey,
  taste,
  watchlist,
  onSelect,
}) {
  const {
    playlists,
    loading: loadingList,
    save,
    load,
    remove,
    touch,
  } = usePlaylists();

  const [draft, setDraft] = useState(emptyDraft);
  const [activeId, setActiveId] = useState(null);
  const [selected, setSelected] = useState(() => new Map());
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const requestRef = useRef(0);
  const resultsRef = useRef(null);

  const tagIdeas = useMemo(
    () => uniq([...PLAYLIST_TERM_IDEAS, ...libraryTags(watchlist)]),
    [watchlist],
  );

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 2800);
    return () => clearTimeout(timer);
  }, [notice]);

  const selectedItems = useMemo(() => [...selected.values()], [selected]);

  const newPlaylist = useCallback(() => {
    requestRef.current += 1;
    setActiveId(null);
    setDraft(emptyDraft());
    setSelected(new Map());
    setResults([]);
    setError(null);
    setNotice(null);
    setLoading(false);
  }, []);

  const openPlaylist = useCallback(
    async (summary) => {
      requestRef.current += 1;
      setLoading(false);
      setError(null);
      setNotice(null);
      setResults([]);
      setActiveId(summary.id);
      const full = await load(summary.id);
      if (!full) {
        setError("Could not open this playlist. Try again.");
        return;
      }
      setDraft({
        name: full.name || "",
        moment: full.moment || "any",
        genre: full.genre || "",
        subgenre: full.subgenre || "",
        terms: Array.isArray(full.terms) ? full.terms : [],
      });
      setSelected(itemsToMap(full.items));
      touch(summary.id);
    },
    [load, touch],
  );

  const generate = useCallback(async () => {
    if (!apiKey) {
      setError("Add your TMDB API key in Settings to discover films.");
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const result = await buildPlaylist({
        apiKey,
        taste,
        moment: draft.moment,
        genre: draft.genre,
        subgenre: draft.subgenre,
        terms: draft.terms,
        limit: 30,
      });
      if (requestId !== requestRef.current) return;
      setResults(result.items || []);
      if (!result.items?.length) {
        setError("No films matched that mood. Try fewer terms or another genre.");
      }
    } catch {
      if (requestId === requestRef.current) {
        setError("Could not reach TMDB. Check your connection and try again.");
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [apiKey, draft, taste]);

  useEffect(() => {
    if (loading || results.length === 0) return;
    const timer = setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
    return () => clearTimeout(timer);
  }, [loading, results.length]);

  const toggleItem = useCallback((item) => {
    const key = getWatchKey(item);
    if (!key) return;
    setSelected((previous) => {
      const next = new Map(previous);
      if (next.has(key)) next.delete(key);
      else next.set(key, item);
      return next;
    });
  }, []);

  const saveCurrent = useCallback(async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const items = selectedItems;
      const tags = uniq([
        momentById(draft.moment).label,
        draft.genre,
        draft.subgenre,
        ...draft.terms,
      ]);
      const saved = await save({
        id: activeId || undefined,
        name: draft.name.trim() || autoName(draft),
        moment: draft.moment,
        genre: draft.genre,
        subgenre: draft.subgenre,
        terms: draft.terms,
        tags,
        items,
      });
      setActiveId(saved.id);
      setDraft((previous) => ({ ...previous, name: saved.name }));
      setNotice(
        items.length > 0
          ? `Saved “${saved.name}” with ${items.length} film${
              items.length === 1 ? "" : "s"
            }.`
          : `Saved “${saved.name}”. You can add films later.`,
      );
    } catch {
      setError("Could not save this playlist.");
    } finally {
      setSaving(false);
    }
  }, [activeId, draft, save, selectedItems]);

  const deleteCurrent = useCallback(async () => {
    if (!activeId) return;
    const current = playlists.find((playlist) => playlist.id === activeId);
    if (
      !window.confirm(
        `Delete “${current?.name || draft.name || "this playlist"}”?`,
      )
    ) {
      return;
    }
    await remove(activeId);
    newPlaylist();
  }, [activeId, draft.name, newPlaylist, playlists, remove]);

  const openFirst = useCallback(() => {
    if (selectedItems[0]) onSelect?.(selectedItems[0]);
  }, [onSelect, selectedItems]);

  return (
    <div className="fade-in playlists-page">
      <header className="playlists-header">
        <div>
          <div className="library-kicker">Watch by moment</div>
          <h1 className="library-title">Playlists</h1>
          <p className="playlists-sub">
            Start from the hour, a genre or a vague idea. Keep only the films
            that fit, save the definition, and continue it whenever you want.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={newPlaylist}>
          + New playlist
        </button>
      </header>

      <div className="playlists-layout">
        <aside className="playlists-rail">
          <div className="playlists-rail__head">
            <span>Saved playlists</span>
            <span>{playlists.length}</span>
          </div>
          {loadingList ? (
            <div className="playlist-rail-skeleton">
              <div />
              <div />
              <div />
            </div>
          ) : playlists.length === 0 ? (
            <div className="playlist-rail-empty">
              <PlaylistIcon />
              <p>Nothing saved yet. Build one for tonight.</p>
            </div>
          ) : (
            <div className="playlist-rail-list">
              {playlists.map((playlist) => (
                <button
                  key={playlist.id}
                  type="button"
                  className={`playlist-rail-item${
                    activeId === playlist.id ? " is-active" : ""
                  }`}
                  onClick={() => openPlaylist(playlist)}
                >
                  <span className="playlist-rail-item__poster">
                    {playlist.posterPath ? (
                      <img
                        src={imgUrl(playlist.posterPath, "w185")}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <FilmIcon />
                    )}
                  </span>
                  <span className="playlist-rail-item__body">
                    <span className="playlist-rail-item__name">
                      {playlist.name}
                    </span>
                    <span className="playlist-rail-item__meta">
                      {momentById(playlist.moment).label} ·{" "}
                      {playlist.genre || "Mixed"} · {playlist.itemCount || 0}{" "}
                      films
                    </span>
                    {playlist.tags?.length > 0 && (
                      <span className="playlist-rail-item__tags">
                        {playlist.tags.slice(0, 2).join(" · ")}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </aside>

        <main className="playlists-main">
          <section className="playlist-studio">
            <div className="playlist-studio__head">
              <div>
                <div className="playlist-studio__eyebrow">
                  {activeId ? "Continue playlist" : "New playlist"}
                </div>
                <h2 className="playlist-studio__title">
                  {draft.name || "What are you in the mood for?"}
                </h2>
                <p className="playlist-studio__sub">
                  Pick a moment, a genre and as many loose terms as you like.
                  Then choose the films that belong in this playlist.
                </p>
              </div>
              <span className="playlist-studio__badge">
                {selected.size} film{selected.size === 1 ? "" : "s"}
              </span>
            </div>

            <div className="playlist-form">
              <label className="playlist-field playlist-field--name">
                <span>Playlist name</span>
                <input
                  className="playlist-input"
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      name: event.target.value,
                    }))
                  }
                  placeholder={autoName(draft)}
                />
              </label>

              <div className="playlist-field">
                <span className="playlist-label">When are you watching?</span>
                <div className="playlist-moments">
                  {PLAYLIST_MOMENTS.map((moment) => (
                    <button
                      key={moment.id}
                      type="button"
                      className={`playlist-moment${
                        draft.moment === moment.id ? " is-active" : ""
                      }`}
                      onClick={() =>
                        setDraft((previous) => ({
                          ...previous,
                          moment: moment.id,
                        }))
                      }
                      aria-pressed={draft.moment === moment.id}
                    >
                      <span className="playlist-moment__short">
                        {moment.short}
                      </span>
                      <span className="playlist-moment__label">
                        {moment.label}
                      </span>
                      <span className="playlist-moment__hint">
                        {moment.hint}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="playlist-form__row">
                <label className="playlist-field">
                  <span>Genre</span>
                  <select
                    className="playlist-select"
                    value={draft.genre}
                    onChange={(event) =>
                      setDraft((previous) => ({
                        ...previous,
                        genre: event.target.value,
                      }))
                    }
                  >
                    <option value="">Mixed genres</option>
                    {PLAYLIST_GENRES.map((genre) => (
                      <option key={genre.id} value={genre.name}>
                        {genre.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="playlist-field">
                  <span>Subcategory or mood</span>
                  <input
                    className="playlist-input"
                    value={draft.subgenre}
                    onChange={(event) =>
                      setDraft((previous) => ({
                        ...previous,
                        subgenre: event.target.value,
                      }))
                    }
                    placeholder="slow-burn space horror, cozy mystery…"
                  />
                </label>
              </div>

              <ChipInput
                label="Terms that define it"
                placeholder="space, heist, practical effects…"
                values={draft.terms}
                onChange={(terms) =>
                  setDraft((previous) => ({ ...previous, terms }))
                }
                suggestions={tagIdeas}
              />

              <div className="playlist-form__actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={generate}
                  disabled={loading}
                >
                  <SearchIcon />
                  {loading ? "Finding films…" : "Find films"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setDraft(emptyDraft())}
                >
                  Reset mood
                </button>
                {!apiKey && (
                  <span className="playlist-error">
                    TMDB key needed in Settings.
                  </span>
                )}
              </div>
            </div>
          </section>

          {error && <div className="playlist-error playlist-error--block">{error}</div>}
          {notice && <div className="playlist-notice">{notice}</div>}

          <div className="playlist-workbench">
            <section className="playlist-results" ref={resultsRef}>
              <div className="playlist-results__head">
                <div>
                  <h3>Films for this moment</h3>
                  <p>
                    {loading
                      ? "Reading the mood…"
                      : results.length > 0
                        ? `${results.length} candidates. Add only the ones you want.`
                        : "Describe a moment and find candidates."}
                  </p>
                </div>
                {results.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={generate}
                    disabled={loading}
                  >
                    Refresh
                  </button>
                )}
              </div>

              {loading ? (
                <div className="playlist-result-grid">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <div className="playlist-pick playlist-pick--skeleton" key={index}>
                      <div className="playlist-pick__poster" />
                      <div className="playlist-pick__body">
                        <div className="playlist-skeleton-line" />
                        <div className="playlist-skeleton-line playlist-skeleton-line--short" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : results.length > 0 ? (
                <div className="playlist-result-grid">
                  {results.map((item) => (
                    <PlaylistPickCard
                      key={`${item.media_type}_${item.id}`}
                      item={item}
                      selected={selected.has(getWatchKey(item))}
                      onToggle={toggleItem}
                      onOpen={onSelect}
                    />
                  ))}
                </div>
              ) : (
                <div className="playlist-empty">
                  <div className="playlist-empty__icon">
                    <PlaylistIcon />
                  </div>
                  <h4>No list yet</h4>
                  <p>
                    Choose a moment, a genre or a few terms. The list will keep
                    its reasoning, and you can keep only the films that fit.
                  </p>
                </div>
              )}
            </section>

            <aside className="playlist-picks">
              <div className="playlist-picks__head">
                <span>In this playlist</span>
                <b>{selected.size}</b>
              </div>
              <div className="playlist-picks__list">
                {selectedItems.length === 0 ? (
                  <p className="playlist-picks__empty">
                    Add films from the list. They will stay here when you save
                    and come back.
                  </p>
                ) : (
                  selectedItems.map((item) => (
                    <div
                      className="playlist-pick-row"
                      key={`${item.media_type}_${item.id}`}
                    >
                      <button
                        type="button"
                        className="playlist-pick-row__poster"
                        onClick={() => onSelect?.(item)}
                        aria-label={`Open ${item.title || item.name}`}
                      >
                        {item.poster_path ? (
                          <img
                            src={imgUrl(item.poster_path, "w92")}
                            alt=""
                            loading="lazy"
                          />
                        ) : (
                          <FilmIcon />
                        )}
                      </button>
                      <div className="playlist-pick-row__body">
                        <div className="playlist-pick-row__title">
                          {item.title || item.name}
                        </div>
                        <div className="playlist-pick-row__meta">
                          {yearOf(item) || "—"} · Movie
                        </div>
                      </div>
                      <button
                        type="button"
                        className="playlist-pick-row__remove"
                        onClick={() => toggleItem(item)}
                        aria-label={`Remove ${item.title || item.name}`}
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="playlist-picks__footer">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={saveCurrent}
                  disabled={saving}
                >
                  {saving
                    ? "Saving…"
                    : activeId
                      ? "Save changes"
                      : selected.size > 0
                        ? "Save playlist"
                        : "Save definition"}
                </button>
                {selected.size > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={openFirst}
                  >
                    Open first
                  </button>
                )}
                {activeId && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={deleteCurrent}
                  >
                    Delete
                  </button>
                )}
              </div>
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}
