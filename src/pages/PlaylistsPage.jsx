import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChipInput from "../components/ChipInput";
import { FilmIcon, PlaylistIcon, SearchIcon } from "../components/Icons";
import { imgUrl } from "../utils/api";
import {
  PLAYLIST_GENRES,
  PLAYLIST_MOMENTS,
  PLAYLIST_TERM_IDEAS,
  buildPlaylist,
  momentForNow,
} from "../utils/playlistBrain";
import { getWatchKey } from "../utils/watchlist";
import { usePlaylists } from "../utils/usePlaylists";
import { useT } from "../utils/i18n";
import { storage } from "../utils/storage";

const uniq = (values) => [...new Set((values || []).filter(Boolean))];

function emptyDraft() {
  return {
    name: "",
    type: "movie",
    moment: momentForNow(),
    genre: "",
    subgenre: "",
    terms: [],
  };
}

function autoName(draft, t) {
  const moment = t(`playlist.moment.${draft.moment}.label`);
  const focus =
    draft.genre ||
    draft.subgenre.trim() ||
    draft.terms[0] ||
    t("playlist.slowPicks");
  return `${moment} · ${focus}`;
}

function yearOf(item) {
  return (
    item?.year || (item?.release_date || item?.first_air_date || "").slice(0, 4)
  );
}

function isPersonPlaylist(playlist) {
  return playlist?.kind === "person" && Boolean(playlist?.meta?.personId);
}

function playlistCover(playlist) {
  if (isPersonPlaylist(playlist)) {
    return playlist.meta.profilePath || playlist.posterPath;
  }
  return playlist?.posterPath || null;
}

function playlistMetaLine(playlist, t) {
  if (isPersonPlaylist(playlist)) {
    const meta = playlist.meta || {};
    const years =
      meta.yearStart && meta.yearEnd
        ? `${meta.yearStart}–${meta.yearEnd}`
        : null;
    return [
      meta.filterLabel || t("playlist.filmography"),
      years,
      (playlist.itemCount || 0) === 1
        ? t("playlist.creditOne")
        : t("playlist.credits", { n: playlist.itemCount || 0 }),
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return `${t(`playlist.moment.${playlist.moment || "any"}.label`)} · ${
    playlist.genre || t("playlist.mixed")
  } · ${
    (playlist.itemCount || 0) === 1
      ? t("playlist.filmOne")
      : t("playlist.filmsCount", { n: playlist.itemCount || 0 })
  }`;
}

function itemsToMap(items) {
  const map = new Map();
  for (const item of items || []) {
    const key = getWatchKey(item);
    if (key) map.set(key, item);
  }
  return map;
}

function releaseDateOf(item) {
  return item?.release_date || item?.first_air_date || "";
}

function sortByRelease(items) {
  return [...(items || [])].sort((a, b) => {
    const dateA = releaseDateOf(a);
    const dateB = releaseDateOf(b);
    if (!dateA && !dateB) {
      return String(a?.title || a?.name || "").localeCompare(
        String(b?.title || b?.name || ""),
      );
    }
    if (!dateA) return 1;
    if (!dateB) return -1;
    return (
      dateA.localeCompare(dateB) ||
      String(a?.title || a?.name || "").localeCompare(
        String(b?.title || b?.name || ""),
      )
    );
  });
}

function playbackKey(item) {
  if (!item?.id) return null;
  if (item.media_type === "tv") {
    if (item.season != null && item.episode != null) {
      return `tv_${item.id}_s${item.season}e${item.episode}`;
    }
    return `tv_${item.id}`;
  }
  return `movie_${item.id}`;
}

function isItemWatched(item, watched, progress) {
  const key = playbackKey(item);
  if (!key) return false;
  if (watched?.[key]) return true;
  const pct = Number(progress?.[key]);
  return Number.isFinite(pct) && pct >= 90;
}

function downloadPlaylist(playlist, items) {
  const payload = {
    version: 1,
    kind: "gigi-playlist",
    exportedAt: new Date().toISOString(),
    name: playlist?.name || "Playlist",
    moment: playlist?.moment || "any",
    genre: playlist?.genre || "",
    subgenre: playlist?.subgenre || "",
    terms: playlist?.terms || [],
    tags: playlist?.tags || [],
    meta: playlist?.meta || {},
    items: items || [],
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeName = String(payload.name || "playlist")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  link.href = url;
  link.download = `${safeName || "playlist"}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const t = useT();
  const title = item.title || item.name || t("person.untitled");
  const reason = item._why?.reasons?.[0]?.label;
  const match = item._why?.match;

  return (
    <article className={`playlist-pick${selected ? " is-selected" : ""}`}>
      <button
        type="button"
        className="playlist-pick__poster"
        onClick={() => onToggle(item)}
        aria-label={
          selected
            ? t("playlist.removeTitle", { title })
            : t("playlist.addTitle", { title })
        }
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
          {yearOf(item) || "—"} ·{" "}
          {item.media_type === "tv" ? t("person.series") : t("person.movie")}
        </div>
        {reason && <div className="playlist-pick__reason">{reason}</div>}
        <div className="playlist-pick__actions">
          <button
            type="button"
            className="playlist-pick__add"
            onClick={() => onToggle(item)}
          >
            {selected ? t("playlist.added") : t("playlist.add")}
          </button>
          <button
            type="button"
            className="playlist-pick__details"
            onClick={() => onOpen?.(item)}
          >
            {t("playlist.details")}
          </button>
        </div>
      </div>
    </article>
  );
}

function PersonPlaylistCard({ item, onSelect }) {
  const t = useT();
  const title = item.title || item.name || t("person.untitled");
  const year = yearOf(item);
  const type =
    item.media_type === "tv" ? t("person.series") : t("person.movie");
  const roles = Array.isArray(item.roles) ? item.roles.filter(Boolean) : [];

  return (
    <article className="playlist-person-card">
      <button
        type="button"
        className="playlist-person-card__poster"
        onClick={() => onSelect?.(item)}
        aria-label={t("playlist.openTitle", { title })}
      >
        {item.poster_path ? (
          <img
            src={imgUrl(item.poster_path, "w342")}
            alt=""
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="playlist-person-card__placeholder">
            <FilmIcon />
          </span>
        )}
        <span className="playlist-person-card__type">{type}</span>
      </button>
      <div className="playlist-person-card__title" title={title}>
        {title}
      </div>
      <div className="playlist-person-card__meta">
        {year || "—"} · {type}
      </div>
      {roles.length > 0 && (
        <div className="playlist-person-card__role" title={roles.join(" · ")}>
          {roles.slice(0, 2).join(" · ")}
        </div>
      )}
    </article>
  );
}

function PersonPlaylistView({
  playlist,
  items,
  onSelect,
  onOpenProfile,
  onDelete,
}) {
  const t = useT();
  const meta = playlist.meta || {};
  const groups = useMemo(() => {
    const map = new Map();
    for (const item of sortByRelease(items)) {
      const year = Number(yearOf(item));
      const key = year
        ? `${Math.floor(year / 10) * 10}s`
        : t("playlist.undated");
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return [...map.entries()];
  }, [items, t]);
  const years =
    meta.yearStart && meta.yearEnd
      ? `${meta.yearStart}–${meta.yearEnd}`
      : null;
  const name = meta.personName || playlist.name || t("playlist.filmography");
  const metaLine = [
    meta.filterLabel || t("playlist.filmography"),
    meta.department && meta.department !== meta.filterLabel
      ? meta.department
      : null,
    years,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <section className="playlist-person">
        <div className="playlist-person__portrait">
          {meta.profilePath ? (
            <img src={imgUrl(meta.profilePath, "h632")} alt="" />
          ) : (
            <span>{name[0] || "?"}</span>
          )}
        </div>
        <div className="playlist-person__body">
          <div className="playlist-studio__eyebrow">
            {t("playlist.filmographyPlaylist")}
          </div>
          <h2 className="playlist-person__name">{name}</h2>
          <div className="playlist-person__meta">{metaLine}</div>
          <p className="playlist-person__sub">
            {items.length === 1
              ? t("playlist.personSubOne")
              : t("playlist.personSub", { n: items.length })}
            {meta.filterLabel
              ? t("playlist.personFiltered", { label: meta.filterLabel })
              : ""}
          </p>
          <div className="playlist-person__actions">
            {meta.personId && onOpenProfile && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  onOpenProfile({ id: meta.personId, name })
                }
              >
                {t("playlist.openProfile")}
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={onDelete}
              >
                {t("playlist.deletePlaylist")}
              </button>
            )}
          </div>
        </div>
      </section>

      {groups.length === 0 ? (
        <div className="playlist-person-empty">
          {t("playlist.noCredits")}
        </div>
      ) : (
        <div className="playlist-person-timeline">
          {groups.map(([label, group]) => (
            <section className="playlist-person-decade" key={label}>
              <div className="playlist-person-decade__head">
                <h3>{label}</h3>
                <span>
                  {group.length === 1
                    ? t("playlist.creditOne")
                    : t("playlist.credits", { n: group.length })}
                </span>
              </div>
              <div className="playlist-person-grid">
                {group.map((item) => (
                  <PersonPlaylistCard
                    key={`${item.media_type}_${item.id}`}
                    item={item}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

export default function PlaylistsPage({
  apiKey,
  taste,
  watchlist,
  onSelect,
  onPlayQueue,
  onOpenPerson,
  watched = {},
  progress = {},
  onMarkWatched,
  onMarkUnwatched,
  initialPlaylistId = null,
}) {
  const {
    playlists,
    loading: loadingList,
    save,
    load,
    remove,
    touch,
  } = usePlaylists();
  const t = useT();

  const [draft, setDraft] = useState(emptyDraft);
  const [activeId, setActiveId] = useState(null);
  const [activePlaylist, setActivePlaylist] = useState(null);
  const [selected, setSelected] = useState(() => new Map());
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [undoDelete, setUndoDelete] = useState(null);
  const [dragKey, setDragKey] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);
  const [favoritePlaylistIds, setFavoritePlaylistIds] = useState(() => {
    const saved = storage.get("favoritePlaylists");
    return new Set(Array.isArray(saved) ? saved : []);
  });
  const requestRef = useRef(0);
  const resultsRef = useRef(null);
  const importRef = useRef(null);
  const undoDeleteTimerRef = useRef(null);

  const tagIdeas = useMemo(
    () => uniq([...PLAYLIST_TERM_IDEAS, ...libraryTags(watchlist)]),
    [watchlist],
  );

  const orderedPlaylists = useMemo(
    () =>
      [...playlists].sort(
        (a, b) =>
          Number(favoritePlaylistIds.has(b.id)) -
          Number(favoritePlaylistIds.has(a.id)),
      ),
    [favoritePlaylistIds, playlists],
  );

  const toggleFavoritePlaylist = useCallback((playlistId) => {
    setFavoritePlaylistIds((current) => {
      const next = new Set(current);
      if (next.has(playlistId)) next.delete(playlistId);
      else next.add(playlistId);
      storage.set("favoritePlaylists", [...next]);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 2800);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => () => {
    if (undoDeleteTimerRef.current) clearTimeout(undoDeleteTimerRef.current);
  }, []);

  const selectedItems = useMemo(() => [...selected.values()], [selected]);

  const newPlaylist = useCallback(() => {
    requestRef.current += 1;
    setActiveId(null);
    setActivePlaylist(null);
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
      setActivePlaylist(null);
      setActiveId(summary.id);
      const full = await load(summary.id);
      if (!full) {
        setError(t("playlist.openError"));
        return;
      }
      setActivePlaylist(full);
      setDraft({
        name: full.name || "",
        type: full.meta?.mediaType || "movie",
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
      setError(t("playlist.apiKeyError"));
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
        mediaType: draft.type,
        limit: 30,
      });
      if (requestId !== requestRef.current) return;
      setResults(result.items || []);
      if (!result.items?.length) {
        setError(t("playlist.noMatches"));
      }
    } catch {
      if (requestId === requestRef.current) {
        setError(t("playlist.tmdbError"));
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
        t(`playlist.moment.${draft.moment}.label`),
        draft.genre,
        draft.subgenre,
        ...draft.terms,
      ]);
      const saved = await save({
        id: activeId || undefined,
        name: draft.name.trim() || autoName(draft, t),
        kind: activePlaylist?.kind || "mood",
        meta: { ...activePlaylist?.meta, mediaType: draft.type },
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
        items.length === 1
          ? t("playlist.savedNoticeOne", { name: saved.name })
          : items.length > 1
            ? t("playlist.savedNotice", {
                name: saved.name,
                n: items.length,
              })
            : t("playlist.savedEmpty", { name: saved.name }),
      );
    } catch {
      setError(t("playlist.saveError"));
    } finally {
      setSaving(false);
    }
  }, [activeId, activePlaylist, draft, save, selectedItems]);

  const initialPlaylistOpenedRef = useRef(false);
  useEffect(() => {
    if (initialPlaylistOpenedRef.current || !initialPlaylistId || loadingList)
      return;
    const target = playlists.find(
      (playlist) => playlist.id === initialPlaylistId,
    );
    if (!target) return;
    initialPlaylistOpenedRef.current = true;
    openPlaylist(target);
  }, [initialPlaylistId, loadingList, playlists, openPlaylist]);

  const deleteCurrent = useCallback(async () => {
    if (!activeId) return;
    const current = playlists.find((playlist) => playlist.id === activeId);
    setDeleteTarget({
      id: activeId,
      name: current?.name || draft.name || t("playlist.thisPlaylist"),
      playlist: activePlaylist,
    });
  }, [activeId, activePlaylist, draft.name, playlists, t]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const removed = deleteTarget;
    await remove(removed.id);
    setDeleteTarget(null);
    newPlaylist();
    if (undoDeleteTimerRef.current) clearTimeout(undoDeleteTimerRef.current);
    setUndoDelete({ playlist: removed.playlist, name: removed.name });
    setNotice(t("playlist.deletedNotice"));
    undoDeleteTimerRef.current = setTimeout(() => setUndoDelete(null), 12000);
  }, [deleteTarget, newPlaylist, remove, t]);

  const undoRemove = useCallback(async () => {
    if (!undoDelete?.playlist) return;
    if (undoDeleteTimerRef.current) clearTimeout(undoDeleteTimerRef.current);
    const restored = await save(undoDelete.playlist);
    setUndoDelete(null);
    setActiveId(restored.id);
    setActivePlaylist(restored);
    setDraft({
      name: restored.name || "",
      type: restored.meta?.mediaType || "movie",
      moment: restored.moment || "any",
      genre: restored.genre || "",
      subgenre: restored.subgenre || "",
      terms: Array.isArray(restored.terms) ? restored.terms : [],
    });
    setSelected(itemsToMap(restored.items));
    setNotice(t("playlist.actionRestored", { name: restored.name }));
  }, [save, t, undoDelete]);

  const playAll = useCallback(() => {
    if (!selectedItems.length) return;
    if (onPlayQueue) onPlayQueue(selectedItems, 0);
    else onSelect?.(selectedItems[0]);
  }, [onPlayQueue, onSelect, selectedItems]);

  const shufflePlay = useCallback(() => {
    if (!selectedItems.length) return;
    const index = Math.floor(Math.random() * selectedItems.length);
    if (onPlayQueue) onPlayQueue(selectedItems, index);
    else onSelect?.(selectedItems[index]);
  }, [onPlayQueue, onSelect, selectedItems]);

  const firstUnwatched = useMemo(
    () => selectedItems.find((item) => !isItemWatched(item, watched, progress)) || null,
    [progress, selectedItems, watched],
  );
  const watchedCount = useMemo(
    () => selectedItems.filter((item) => isItemWatched(item, watched, progress)).length,
    [progress, selectedItems, watched],
  );
  const watchedPercent = selectedItems.length
    ? Math.round((watchedCount / selectedItems.length) * 100)
    : 0;

  const continuePlaylist = useCallback(() => {
    if (!firstUnwatched) return;
    const index = selectedItems.indexOf(firstUnwatched);
    if (onPlayQueue) onPlayQueue(selectedItems, Math.max(0, index));
    else onSelect?.(firstUnwatched);
  }, [firstUnwatched, onPlayQueue, onSelect, selectedItems]);

  const toggleWatched = useCallback(
    (item) => {
      const key = playbackKey(item);
      if (!key) return;
      if (isItemWatched(item, watched, progress)) onMarkUnwatched?.(key);
      else onMarkWatched?.(key);
    },
    [onMarkUnwatched, onMarkWatched, progress, watched],
  );

  const exportCurrent = useCallback(() => {
    downloadPlaylist(activePlaylist || { name: draft.name, ...draft }, selectedItems);
    setNotice(t("playlist.actionExportDone"));
  }, [activePlaylist, draft, selectedItems, t]);

  const importPlaylist = useCallback(
    async (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const items = Array.isArray(parsed?.items) ? parsed.items : [];
        if (!items.length) throw new Error("empty playlist");
        const saved = await save({
          name: parsed.name || file.name.replace(/\.json$/i, ""),
          moment: parsed.moment || "any",
          genre: parsed.genre || "",
          subgenre: parsed.subgenre || "",
          terms: Array.isArray(parsed.terms) ? parsed.terms : [],
          tags: Array.isArray(parsed.tags) ? parsed.tags : [],
          meta: parsed.meta && typeof parsed.meta === "object" ? parsed.meta : {},
          items,
        });
        setActiveId(saved.id);
        setActivePlaylist(saved);
        setDraft({
          name: saved.name || "",
          type: saved.meta?.mediaType || "movie",
          moment: saved.moment || "any",
          genre: saved.genre || "",
          subgenre: saved.subgenre || "",
          terms: Array.isArray(saved.terms) ? saved.terms : [],
        });
        setSelected(itemsToMap(saved.items));
        setNotice(t("playlist.actionImportDone"));
      } catch {
        setError(t("playlist.actionImportError"));
      }
    },
    [save, t],
  );

  const moveSelected = useCallback((key, delta) => {
    setSelected((previous) => {
      const entries = [...previous.entries()];
      const from = entries.findIndex(([entryKey]) => entryKey === key);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= entries.length) return previous;
      const [entry] = entries.splice(from, 1);
      entries.splice(to, 0, entry);
      return new Map(entries);
    });
  }, []);

  const moveSelectedTo = useCallback((key, targetKey) => {
    if (!key || !targetKey || key === targetKey) return;
    setSelected((previous) => {
      const entries = [...previous.entries()];
      const from = entries.findIndex(([entryKey]) => entryKey === key);
      const to = entries.findIndex(([entryKey]) => entryKey === targetKey);
      if (from < 0 || to < 0) return previous;
      const [entry] = entries.splice(from, 1);
      entries.splice(to, 0, entry);
      return new Map(entries);
    });
  }, []);

  const sortSelectedBy = useCallback((field) => {
    setSelected((previous) => {
      const entries = [...previous.entries()];
      entries.sort(([, a], [, b]) => {
        if (field === "year") {
          return (
            (Number(yearOf(a)) || Number.MAX_SAFE_INTEGER) -
            (Number(yearOf(b)) || Number.MAX_SAFE_INTEGER)
          );
        }
        return (Number(b.vote_average) || 0) - (Number(a.vote_average) || 0);
      });
      return new Map(entries);
    });
  }, []);

  return (
    <div className="fade-in playlists-page">
      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        className="playlist-import-input"
        onChange={importPlaylist}
      />
      <header className="playlists-header">
        <div>
          <div className="library-kicker">{t("playlist.kicker")}</div>
          <h1 className="library-title">{t("playlist.title")}</h1>
          <p className="playlists-sub">{t("playlist.sub")}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={newPlaylist}>
          {t("playlist.new")}
        </button>
      </header>

      <div className="playlists-layout">
        <aside className="playlists-rail">
          <div className="playlists-rail__head">
            <span>{t("playlist.saved")}</span>
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
              <p>{t("playlist.nothing")}</p>
            </div>
          ) : (
            <div className="playlist-rail-list">
              {orderedPlaylists.map((playlist) => (
                <div key={playlist.id} className="playlist-rail-row">
                <button
                  type="button"
                  className={`playlist-rail-item${
                    activeId === playlist.id ? " is-active" : ""
                  }`}
                  onClick={() => openPlaylist(playlist)}
                >
                  <span className="playlist-rail-item__poster">
                    {playlistCover(playlist) ? (
                      <img
                        src={imgUrl(playlistCover(playlist), "w185")}
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
                      {playlistMetaLine(playlist, t)}
                    </span>
                    {playlist.tags?.length > 0 && (
                      <span className="playlist-rail-item__tags">
                        {playlist.tags.slice(0, 2).join(" · ")}
                      </span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  className={`playlist-rail-star${
                    favoritePlaylistIds.has(playlist.id) ? " is-favorite" : ""
                  }`}
                  onClick={() => toggleFavoritePlaylist(playlist.id)}
                  aria-label={
                    favoritePlaylistIds.has(playlist.id)
                      ? t("playlist.unfavorite")
                      : t("playlist.favorite")
                  }
                  title={
                    favoritePlaylistIds.has(playlist.id)
                      ? t("playlist.unfavorite")
                      : t("playlist.favorite")
                  }
                >
                  {favoritePlaylistIds.has(playlist.id) ? "♥" : "♡"}
                </button>
                </div>
              ))}
            </div>
          )}
        </aside>

        <main className="playlists-main">
          {activeId && selectedItems.length > 0 && (
            <section className="playlist-actionbar" aria-label={t("playlist.actions")}>
              <div className="playlist-actionbar__progress">
                <div className="playlist-actionbar__progress-copy">
                  <b>{t("playlist.progress", { done: watchedCount, total: selectedItems.length })}</b>
                  <span>{t("playlist.progressHint")}</span>
                </div>
                <div
                  className="playlist-actionbar__bar"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={watchedPercent}
                >
                  <span style={{ width: `${watchedPercent}%` }} />
                </div>
              </div>
              <div className="playlist-actionbar__buttons">
                <button type="button" className="btn btn-primary" onClick={playAll}>
                  ▶ {t("playlist.actionPlayAll")}
                </button>
                <button type="button" className="btn btn-ghost" onClick={shufflePlay}>
                  ⤨ {t("playlist.actionShuffle")}
                </button>
                {firstUnwatched && (
                  <button type="button" className="btn btn-ghost" onClick={continuePlaylist}>
                    {t("playlist.actionContinue")}
                  </button>
                )}
                <button type="button" className="btn btn-ghost" onClick={exportCurrent}>
                  {t("playlist.actionExport")}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => importRef.current?.click()}
                >
                  {t("playlist.actionImport")}
                </button>
              </div>
            </section>
          )}
          {isPersonPlaylist(activePlaylist) ? (
            <PersonPlaylistView
              playlist={activePlaylist}
              items={selectedItems}
              onSelect={onSelect}
              onOpenProfile={onOpenPerson}
              onDelete={deleteCurrent}
            />
          ) : (
            <>
          <section className="playlist-studio">
            <div className="playlist-studio__head">
              <div>
                <div className="playlist-studio__eyebrow">
                  {activeId
                    ? t("playlist.continue")
                    : t("playlist.newEyebrow")}
                </div>
                <h2 className="playlist-studio__title">
                  {draft.name || t("playlist.whatMood")}
                </h2>
                <p className="playlist-studio__sub">
                  {t("playlist.studioSub")}
                </p>
              </div>
              <span className="playlist-studio__badge">
                {selected.size === 1
                  ? t("playlist.filmOne")
                  : t("playlist.films", { n: selected.size })}
              </span>
            </div>

            <div className="playlist-form">
              <label className="playlist-field playlist-field--name">
                <span>{t("playlist.name")}</span>
                <input
                  className="playlist-input"
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      name: event.target.value,
                    }))
                  }
                  placeholder={autoName(draft, t)}
                />
              </label>

              <div className="playlist-field">
                <span className="playlist-label">{t("playlist.type")}</span>
                <div className="playlist-moments playlist-moments--types">
                  {[
                    { id: "movie", key: "playlist.typeMovie" },
                    { id: "tv", key: "playlist.typeTV" },
                    { id: "anime", key: "playlist.typeAnime" },
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`playlist-moment${
                        draft.type === option.id ? " is-active" : ""
                      }`}
                      onClick={() =>
                        setDraft((previous) => ({
                          ...previous,
                          type: option.id,
                        }))
                      }
                      aria-pressed={draft.type === option.id}
                    >
                      <span className="playlist-moment__short">
                        {option.id === "movie"
                          ? t("playlist.typeFilm")
                          : option.id === "tv"
                            ? t("playlist.typeTv")
                            : t("playlist.typeAnime")}
                      </span>
                      <span className="playlist-moment__label">
                        {t(option.key)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="playlist-field">
                <span className="playlist-label">{t("playlist.moment")}</span>
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
                        {t(`playlist.moment.${moment.id}.short`)}
                      </span>
                      <span className="playlist-moment__label">
                        {t(`playlist.moment.${moment.id}.label`)}
                      </span>
                      <span className="playlist-moment__hint">
                        {t(`playlist.moment.${moment.id}.hint`)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="playlist-form__row">
                <label className="playlist-field">
                  <span>{t("playlist.genre")}</span>
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
                    <option value="">{t("playlist.mixedGenres")}</option>
                    {PLAYLIST_GENRES.map((genre) => (
                      <option key={genre.id} value={genre.name}>
                        {t(`genre.${genre.id}`) || genre.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="playlist-field">
                  <span>{t("playlist.subgenre")}</span>
                  <input
                    className="playlist-input"
                    value={draft.subgenre}
                    onChange={(event) =>
                      setDraft((previous) => ({
                        ...previous,
                        subgenre: event.target.value,
                      }))
                    }
                    placeholder={t("playlist.subgenrePlaceholder")}
                  />
                </label>
              </div>

              <ChipInput
                label={t("playlist.terms")}
                placeholder={t("playlist.termsPlaceholder")}
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
                  {loading ? t("playlist.finding") : t("playlist.find")}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setDraft(emptyDraft())}
                >
                  {t("playlist.reset")}
                </button>
                {!apiKey && (
                  <span className="playlist-error">
                    {t("playlist.keyNeeded")}
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
                  <h3>{t("playlist.filmsForMoment")}</h3>
                  <p>
                    {loading
                      ? t("playlist.readingMood")
                      : results.length > 0
                        ? t("playlist.candidates", { n: results.length })
                        : t("playlist.describe")}
                  </p>
                </div>
                {results.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={generate}
                    disabled={loading}
                  >
                    {t("playlist.refresh")}
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
                  <h4>{t("playlist.noList")}</h4>
                  <p>{t("playlist.noListBody")}</p>
                </div>
              )}
            </section>

            <aside className="playlist-picks">
              <div className="playlist-picks__head">
                <span>{t("playlist.inPlaylist")}</span>
                <b>{selected.size}</b>
              </div>
              {selectedItems.length > 1 && (
                <div className="playlist-picks__sort">
                  <button type="button" onClick={() => sortSelectedBy("year")}>
                    {t("playlist.sortYear")}
                  </button>
                  <button
                    type="button"
                    onClick={() => sortSelectedBy("rating")}
                  >
                    {t("playlist.sortRating")}
                  </button>
                </div>
              )}
              <div className="playlist-picks__list">
                {selectedItems.length === 0 ? (
                  <p className="playlist-picks__empty">
                    {t("playlist.picksEmpty")}
                  </p>
                ) : (
                  selectedItems.map((item) => (
                    <div
                      className={`playlist-pick-row${
                        dragKey === getWatchKey(item) ? " is-dragging" : ""
                      }${
                        dragOverKey === getWatchKey(item) ? " is-drop-target" : ""
                      }`}
                      key={`${item.media_type}_${item.id}`}
                      draggable
                      onDragStart={(event) => {
                        const key = getWatchKey(item);
                        setDragKey(key);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", key);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDragOverKey(getWatchKey(item));
                      }}
                      onDragLeave={() => setDragOverKey(null)}
                      onDrop={(event) => {
                        event.preventDefault();
                        const key =
                          event.dataTransfer.getData("text/plain") || dragKey;
                        moveSelectedTo(key, getWatchKey(item));
                        setDragKey(null);
                        setDragOverKey(null);
                      }}
                      onDragEnd={() => {
                        setDragKey(null);
                        setDragOverKey(null);
                      }}
                    >
                      <button
                        type="button"
                        className="playlist-pick-row__poster"
                        onClick={() => onSelect?.(item)}
                        aria-label={t("playlist.openTitle", {
                          title: item.title || item.name,
                        })}
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
                          {yearOf(item) || "—"} ·{" "}
                          {item.media_type === "tv" ? t("person.series") : t("person.movie")}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="playlist-pick-row__remove"
                        onClick={() => toggleItem(item)}
                        aria-label={t("playlist.removeTitle", {
                          title: item.title || item.name,
                        })}
                      >
                        ×
                      </button>
                      <div className="playlist-pick-row__order">
                        <button
                          type="button"
                          onClick={() => moveSelected(getWatchKey(item), -1)}
                          aria-label={t("playlist.moveUp")}
                          title={t("playlist.moveUp")}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveSelected(getWatchKey(item), 1)}
                          aria-label={t("playlist.moveDown")}
                          title={t("playlist.moveDown")}
                        >
                          ↓
                        </button>
                      </div>
                      <button
                        type="button"
                        className={`playlist-pick-row__watched${
                          isItemWatched(item, watched, progress) ? " is-watched" : ""
                        }`}
                        onClick={() => toggleWatched(item)}
                        aria-label={
                          isItemWatched(item, watched, progress)
                            ? t("playlist.markUnwatched")
                            : t("playlist.markWatched")
                        }
                        title={
                          isItemWatched(item, watched, progress)
                            ? t("playlist.markUnwatched")
                            : t("playlist.markWatched")
                        }
                      >
                        ✓
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
                    ? t("playlist.saving")
                    : activeId
                      ? t("playlist.saveChanges")
                      : selected.size > 0
                        ? t("playlist.savePlaylist")
                        : t("playlist.saveDefinition")}
                </button>
                {selected.size > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={playAll}
                  >
                    {t("playlist.openFirst")}
                  </button>
                )}
                {activeId && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={deleteCurrent}
                  >
                    {t("playlist.delete")}
                  </button>
                )}
              </div>
            </aside>
          </div>
            </>
          )}
        </main>
      </div>

      {deleteTarget && (
        <div className="playlist-confirm-backdrop" role="presentation">
          <div
            className="playlist-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="playlist-confirm-title"
          >
            <h3 id="playlist-confirm-title">{t("playlist.confirmTitle")}</h3>
            <p>{t("playlist.confirmBody", { name: deleteTarget.name })}</p>
            <div className="playlist-confirm__actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setDeleteTarget(null)}
              >
                {t("playlist.cancel")}
              </button>
              <button type="button" className="btn btn-danger" onClick={confirmDelete}>
                {t("playlist.confirmDelete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {undoDelete && (
        <div className="playlist-undo" role="status">
          <span>{t("playlist.deletedNotice")}</span>
          <button type="button" className="btn btn-ghost" onClick={undoRemove}>
            {t("playlist.undo")}
          </button>
        </div>
      )}
    </div>
  );
}
