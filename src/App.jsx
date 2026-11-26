import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  lazy,
  Suspense,
} from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import WindowTitlebar from "./components/WindowTitlebar";
import { storage, secureStorage, STORAGE_KEYS } from "./utils/storage";
import {
  applyAccentColor,
  applyTheme,
  ACCENT_PRESETS,
} from "./utils/appearance";
import { collectFullBackup } from "./utils/backup";
import {
  tmdbFetch,
  setApiErrorHandlers,
  imgUrl,
  isAnimeContent,
} from "./utils/api";
import { clearAppCaches } from "./utils/storage";
import { useWatchlist } from "./utils/useWatchlist";
import { getWatchKey } from "./utils/watchlist";
import { mergeSmartPatch, smartPatchFor } from "./utils/autoCategorize";
import { buildTasteProfile } from "./utils/searchBrain";
import { organizeEntries } from "./utils/organizeLibrary";
import {
  readDiscordRpcSettings,
  applyDiscordRpcEnabled,
  sendWatchingActivity,
  sendIdleActivity,
  clearActivity as clearDiscordActivity,
} from "./utils/discordPresence";

import Sidebar from "./components/Sidebar";
import SetupScreen from "./components/SetupScreen";
import CloseConfirmModal from "./components/CloseConfirmModal";
import WatchHistoryRail from "./components/WatchHistoryRail";
import { getAppLanguage, useT } from "./utils/i18n";
import { useGamepadNav } from "./utils/useGamepadNav";

// Modals that are only needed after a user action are split out of the shell
// chunk. Ctrl+F or the update banner pays for them on first use.
const SearchModal = lazy(() => import("./components/SearchModal"));
const CommandPalette = lazy(() => import("./components/CommandPalette"));
const UpdateModal = lazy(() => import("./components/UpdateModal"));
const KeyboardShortcutsModal = lazy(
  () => import("./components/KeyboardShortcutsModal"),
);

// Lazy-loaded pages: each chunk is only downloaded when the user first visits
const HomePage = lazy(() => import("./pages/HomePage"));
const MoviePage = lazy(() => import("./pages/MoviePage"));
const TVPage = lazy(() => import("./pages/TVPage"));
const LibraryPage = lazy(() => import("./pages/LibraryPage"));
const PlaylistsPage = lazy(() => import("./pages/PlaylistsPage"));
const PersonPage = lazy(() => import("./pages/PersonPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const DownloadsPage = lazy(() => import("./pages/DownloadsPage"));
import {
  checkForUpdatesWithFallback,
  DEFAULT_UPDATE_SOURCE,
} from "./utils/updates";

export default function App() {
  const t = useT();
  // apiKey loaded async from secure storage (OS keychain)
  const [apiKey, setApiKey] = useState(null);
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState("checking"); // 'checking' | 'ok' | 'invalid_token' | 'unreachable'
  const [page, setPage] = useState(() => storage.get("startPage") || "home");
  const [selected, setSelected] = useState(null);
  const [playQueue, setPlayQueue] = useState(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [dlSearchOpen, setDlSearchOpen] = useState(false);
  const [librarySort, setLibrarySort] = useState(
    () => storage.get(STORAGE_KEYS.LIBRARY_SORT) || "manual",
  );
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [platform, setPlatform] = useState(null);

  // Keep <html lang> in sync with the selected app language.
  useEffect(() => {
    document.documentElement.setAttribute("lang", getAppLanguage());
  }, []);

  // Navigation history stack for Ctrl+Z back navigation
  const [navStack, setNavStack] = useState([]);

  const watchlist = useWatchlist();
  const watchlistRef = useRef(watchlist);
  watchlistRef.current = watchlist;

  // Taste profile: drives search ranking and the "For you" shelf. Recomputed
  // only when the library changes, never on unrelated re-renders.
  const taste = useMemo(
    () => buildTasteProfile(Object.values(watchlist.state.items || {})),
    [watchlist.state],
  );

  const savedEntries = useMemo(
    () =>
      (watchlist.state.order || [])
        .map((key) => watchlist.state.items[key])
        .filter(Boolean),
    [watchlist.state],
  );

  const [progress, setProgress] = useState(() => storage.get("progress") || {});
  const [history, setHistory] = useState(() => storage.get("history") || []);
  const [watched, setWatched] = useState(() => storage.get("watched") || {});
  const [favoritePeople, setFavoritePeople] = useState(
    () => {
      const saved = storage.get("favoritePeople");
      return Array.isArray(saved) ? saved : [];
    },
  );
  const [toast, setToast] = useState(null);
  const [organizing, setOrganizing] = useState(false);
  const [organizeProgress, setOrganizeProgress] = useState(null);
  const [updateBanner, setUpdateBanner] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  // null | "checking" | { entries: object[] } | "none"
  const [episodeCheckStatus, setEpisodeCheckStatus] = useState(null);
  const episodeDismissTimerRef = useRef(null);

  const [trending, setTrending] = useState([]);
  const [trendingTV, setTrendingTV] = useState([]);
  const [loadingHome, setLoadingHome] = useState(false);
  const [offline, setOffline] = useState(() => !navigator.onLine);

  // ── Player accent + subtitle lang ─────────────────────────────────────────
  // Computed once here and passed as a prop to MoviePage / TVPage so neither
  // page needs to touch storage.  Refreshed via "streambert:player-settings-changed".
  const readPlayerSettings = () => {
    const accentId = storage.get(STORAGE_KEYS.ACCENT_COLOR) || "red";
    const inPlayer = storage.get(STORAGE_KEYS.ACCENT_IN_PLAYER) !== false; // default true
    const accentHex = inPlayer
      ? (ACCENT_PRESETS.find((p) => p.id === accentId)?.color ?? null)
      : null;
    const subtitleLang = storage.get(STORAGE_KEYS.SUBTITLE_LANG) || null;
    return { accentColor: accentHex, subtitleLang };
  };
  const [playerSettings, setPlayerSettings] = useState(readPlayerSettings);

  // ── Discord Rich Presence ──────────────────────────────────────────────────
  // Off by default. `watchingEpisode` is filled in by TVPage (season/episode
  // of whatever is currently open) via onEpisodeChange; MoviePage needs no
  // extra data since title/poster already live on `selected`.
  const [discordSettings, setDiscordSettings] = useState(
    readDiscordRpcSettings,
  );
  const [watchingEpisode, setWatchingEpisode] = useState(null);
  const watchStartRef = useRef(null);

  // ── Scheduled backup: run on startup if due ─────────────────────────────────
  useEffect(() => {
    if (!window.electron?.onScheduledBackupRequested) return;
    const handler = window.electron.onScheduledBackupRequested(async () => {
      try {
        const settings = await window.electron.getScheduledBackupSettings();
        if (!settings?.enabled || !settings?.path) return;
        const backup = await collectFullBackup();
        await window.electron.performScheduledBackup({ backup, settings });
      } catch {
        // silently ignore errors on scheduled backup
      }
    });
    return () => window.electron.offScheduledBackupRequested(handler);
  }, []);

  // ── Post-update cache flush ───────────────────────────────────────────────
  // On every start, compare the running version against the last-seen version.
  // If they differ the app was just updated -> clear all caches to prevent problems
  useEffect(() => {
    if (!window.electron?.getAppVersion) return;
    window.electron.getAppVersion().then((version) => {
      const lastVersion = localStorage.getItem("streambert_lastVersion");
      if (lastVersion && lastVersion !== version) {
        clearAppCaches();
      }
      localStorage.setItem("streambert_lastVersion", version);
    });
  }, []);

  // ── Startup update check (deferred) ──────────────────────────────────────
  // Network work must not compete with the first paint or the initial TMDB
  // request. Wait for an idle slot, with a fallback timer for browsers that do
  // not expose requestIdleCallback.
  useEffect(() => {
    if (!storage.get("autoCheckUpdates")) return;
    let cancelled = false;
    let idleId = null;
    let timer = null;

    const run = () => {
      if (cancelled) return;
      const source =
        storage.get(STORAGE_KEYS.UPDATE_SOURCE) || DEFAULT_UPDATE_SOURCE;
      checkForUpdatesWithFallback(source)
        .then((r) => {
          if (!cancelled && r.hasUpdate) setUpdateBanner(r);
        })
        .catch(() => {}); // silently ignore network errors
    };

    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(run, { timeout: 5000 });
    } else {
      timer = setTimeout(run, 2000);
    }

    return () => {
      cancelled = true;
      if (idleId != null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (timer) clearTimeout(timer);
    };
  }, []);

  // ── Startup: new-episode notification check ──────────────────────────────
  // Only runs once the API key has been loaded from secure storage (i.e. the
  // app is fully started and past the setup screen). Shows an in-app status
  // pill while checking, then either a result card or a brief "nothing new" message.
  useEffect(() => {
    if (!apiKeyLoaded) return;
    if (!watchlist.ready) return;
    const notifyPref = storage.get(STORAGE_KEYS.NOTIFY_NEW_EPISODE);
    if (notifyPref === false || notifyPref === 0) return;

    let cancelled = false;

    async function checkNewEpisodes() {
      // Small grace period so the UI has fully painted before start
      await new Promise((r) => setTimeout(r, 1200));
      if (cancelled) return;

      if (!apiKey || cancelled) return;

      const tvSeries = Object.values(watchlist.items).filter(
        (item) => item && item.media_type === "tv" && item.id,
      );
      if (!tvSeries.length) return;

      // Only re-check entries older than 12 h
      const cache = storage.get(STORAGE_KEYS.EPISODE_RELEASE_CACHE) || {};
      const now = Date.now();
      const CACHE_TTL = 12 * 60 * 60 * 1000;
      const toCheck = tvSeries.filter(
        (s) => !cache[s.id] || now - (cache[s.id].checkedAt || 0) > CACHE_TTL,
      );

      if (!toCheck.length) {
        setEpisodeCheckStatus("none");
        episodeDismissTimerRef.current = setTimeout(() => {
          if (!cancelled) setEpisodeCheckStatus(null);
        }, 2000);
        return;
      }

      // Only show loading pill when there's actually something to check
      setEpisodeCheckStatus("checking");

      const BATCH = 3;
      // Each entry: { title, season, id, seriesItem }
      const newEpisodeEntries = [];

      for (let i = 0; i < toCheck.length && !cancelled; i += BATCH) {
        const batch = toCheck.slice(i, i + BATCH);
        await Promise.all(
          batch.map(async (series) => {
            try {
              const data = await tmdbFetch(`/tv/${series.id}`, apiKey);
              if (cancelled) return;

              const prev = cache[series.id] || {};
              const lastEp = data.last_episode_to_air;
              const lastDate = lastEp?.air_date || null;
              const isFirstCheck = !prev.checkedAt;

              // Parse air_date strings as local midnight to avoid UTC offset issues
              const parseLocalDate = (d) => {
                if (!d) return null;
                const [y, m, day] = d.split("-").map(Number);
                return new Date(y, m - 1, day);
              };

              const todayLocal = new Date();
              todayLocal.setHours(0, 0, 0, 0);
              const sevenDaysAgo = new Date(todayLocal);
              sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

              if (isFirstCheck) {
                // First time: notify if latest episode aired in last 7 days
                const lastParsed = parseLocalDate(lastDate);
                if (lastParsed && lastParsed >= sevenDaysAgo) {
                  newEpisodeEntries.push({
                    title:
                      series.title ||
                      series.name ||
                      data.name ||
                      "Unknown series",
                    season: lastEp?.season_number ?? null,
                    id: series.id,
                    seriesItem: series,
                  });
                }
              } else {
                // Subsequent checks: notify when last_episode_to_air changed
                // (new episode aired) compared to what got cached.
                // Migration: old cache entries only have nextEpDate, not lastEpDate.
                // In that case treat as first check to avoid false positives.
                const prevLastDate = prev.lastEpDate ?? null;
                const isMigratingOldCache =
                  prev.checkedAt && prevLastDate === null;

                if (isMigratingOldCache) {
                  // Just update the cache with lastEpDat
                } else {
                  const lastParsed = parseLocalDate(lastDate);
                  const prevParsed = parseLocalDate(prevLastDate);

                  const isNewEpisode =
                    lastDate &&
                    lastDate !== prevLastDate &&
                    lastParsed &&
                    lastParsed >= sevenDaysAgo &&
                    (!prevParsed || lastParsed > prevParsed);

                  if (isNewEpisode) {
                    newEpisodeEntries.push({
                      title:
                        series.title ||
                        series.name ||
                        data.name ||
                        "Unknown series",
                      season: lastEp?.season_number ?? null,
                      id: series.id,
                      seriesItem: series,
                    });
                  }
                }
              }

              cache[series.id] = {
                lastEpDate: lastDate,
                // keep nextEpDate for reference but don't use it for detection
                nextEpDate: data.next_episode_to_air?.air_date || null,
                checkedAt: now,
              };
            } catch {}
          }),
        );
        if (i + BATCH < toCheck.length && !cancelled) {
          await new Promise((r) => setTimeout(r, 400));
        }
      }

      if (cancelled) return;

      storage.set(STORAGE_KEYS.EPISODE_RELEASE_CACHE, cache);

      if (newEpisodeEntries.length === 0) {
        setEpisodeCheckStatus("none");
        // Auto-dismiss after 2 s
        episodeDismissTimerRef.current = setTimeout(() => {
          if (!cancelled) setEpisodeCheckStatus(null);
        }, 2000);
        return;
      }

      // Show in-app result card
      setEpisodeCheckStatus({ entries: newEpisodeEntries });

      // Also fire OS notification
      if (window.electron?.showNotification) {
        const names = newEpisodeEntries.map((e) => e.title);
        const body =
          names.length === 1
            ? `${names[0]} has a new episode.`
            : `${names.slice(0, 3).join(", ")}${
                names.length > 3 ? ` and ${names.length - 3} more` : ""
              } have new episodes.`;
        window.electron.showNotification({
          title: "New episodes available",
          body,
          silent: false,
        });
      }
    }

    checkNewEpisodes().catch(() => {
      if (!cancelled) setEpisodeCheckStatus(null);
    });
    return () => {
      cancelled = true;
      clearTimeout(episodeDismissTimerRef.current);
    };
  }, [apiKeyLoaded, watchlist.ready]);

  // ── Downloads state ──────────────────────────────────────────────────────
  const [downloads, setDownloads] = useState([]);
  const [highlightDownload, setHighlightDownload] = useState(null);
  const [closeConfirm, setCloseConfirm] = useState(null); // { count }

  // ── Load API key from secure storage on startup ──
  useEffect(() => {
    let mounted = true;
    secureStorage.get("apikey").then((val) => {
      if (!mounted) return;
      setApiKey(val || null);
      setApiKeyLoaded(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // ── Detect platform for Windows titlebar ──────────────────────────────────
  useEffect(() => {
    if (!window.electron?.getPlatform) return;
    let mounted = true;
    window.electron.getPlatform().then((p) => {
      if (!mounted) return;
      setPlatform(p);
      if (p === "win32" || p === "linux") {
        document.documentElement.setAttribute("data-win-titlebar", "1");
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Listen for close confirmation request from main process
  useEffect(() => {
    if (!window.electron) return;
    const handler = window.electron.onConfirmClose((data) =>
      setCloseConfirm(data),
    );
    return () => window.electron.offConfirmClose(handler);
  }, []);

  // ── Register global API error handlers ──────────────────────────────────
  // Fire on any tmdbFetch call that returns 401/403 or network failure
  useEffect(() => {
    setApiErrorHandlers(
      () => setApiKeyStatus("invalid_token"), // 401 / 403
      () => setApiKeyStatus("unreachable"), // network failure
    );
  }, []);

  // ── Validate stored API key on startup ───────────────────────────────────
  useEffect(() => {
    if (!apiKey) {
      setApiKeyStatus("ok");
      return;
    }
    setApiKeyStatus("checking");
    const controller = new AbortController();
    fetch("https://api.themoviedb.org/3/configuration", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })
      .then((res) => {
        if (res.status === 401 || res.status === 403)
          setApiKeyStatus("invalid_token");
        else setApiKeyStatus("ok");
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setApiKeyStatus("unreachable");
      });
    return () => controller.abort();
  }, [apiKey]);

  // Load persisted downloads on startup + immediately prune missing files
  useEffect(() => {
    if (!window.electron) return;
    let mounted = true;
    window.electron.getDownloads().then(async (list) => {
      if (!mounted || !Array.isArray(list)) return;

      const pruned = [...list];
      const toRemove = new Set();

      await Promise.all(
        pruned.map(async (d) => {
          if (d.status !== "completed" || !d.filePath) return;
          const exists = await window.electron.fileExists(d.filePath);
          if (!exists) {
            // File gone, remove from registry silently
            window.electron.deleteDownload({ id: d.id, filePath: null });
            toRemove.add(d.id);
            return;
          }
          // Prune subtitle paths that no longer exist
          if (
            d.subtitlePaths?.length > 0 &&
            window.electron.pruneSubtitlePaths
          ) {
            const res = await window.electron.pruneSubtitlePaths(d.id);
            if (res?.ok) d.subtitlePaths = res.subtitlePaths;
          }
        }),
      );

      if (mounted) setDownloads(pruned.filter((d) => !toRemove.has(d.id)));
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Listen for live progress events from main process
  useEffect(() => {
    if (!window.electron) return;
    const handler = window.electron.onDownloadProgress((update) => {
      // ── Desktop notification ──────────────────────
      if (
        update.status === "completed" &&
        storage.get(STORAGE_KEYS.NOTIFY_DOWNLOAD_COMPLETE) !== false &&
        window.electron.showNotification
      ) {
        window.electron.showNotification({
          title: "Download complete",
          body: update.name || "Your download has finished.",
          silent: false,
        });
      }

      setDownloads((prev) => {
        const idx = prev.findIndex((d) => d.id === update.id);
        if (idx === -1) {
          // Unknown id: either the entry was deleted (stale event after SIGKILL)
          // or a genuine race on first event.
          if (!update.name) return prev;
          return [update, ...prev];
        }
        const updated = [...prev];
        updated[idx] = { ...updated[idx], ...update };
        return updated;
      });
    });
    return () => window.electron.offDownloadProgress(handler);
  }, []);

  const handleDownloadStarted = useCallback((newEntry) => {
    setDownloads((prev) => {
      // Guard: if a progress event already added this id (race), just update it
      const idx = prev.findIndex((d) => d.id === newEntry.id);
      if (idx !== -1) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], ...newEntry };
        return updated;
      }
      return [newEntry, ...prev];
    });
  }, []);

  const handleDeleteDownload = useCallback((id) => {
    setDownloads((prev) => prev.filter((d) => d.id !== id));
  }, []);

  // Active download count for sidebar badge
  const activeDownloadCount = useMemo(
    () => downloads.filter((d) => d.status === "downloading").length,
    [downloads],
  );

  // ── Trending, single shared fetch fn avoids code duplication ────────────
  // Results are cached in localStorage for 30 min to avoid redundant API calls
  // and to keep trending data out of RAM between restarts.
  // The cache stores the active metadata language; if it differs from the
  // current setting the cache is treated as stale and data is re-fetched.
  const fetchTrending = useCallback(() => {
    if (!apiKey) return;
    const cached = storage.get("trendingCache");
    const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
    const currentLang = storage.get(STORAGE_KEYS.TMDB_LANG) || "en-US";
    if (
      cached &&
      cached.ts &&
      cached.lang === currentLang &&
      Date.now() - cached.ts < CACHE_TTL
    ) {
      setTrending(cached.movies || []);
      setTrendingTV(cached.tv || []);
      return;
    }
    setLoadingHome(true);
    Promise.all([
      tmdbFetch("/trending/movie/week", apiKey),
      tmdbFetch("/trending/tv/week", apiKey),
    ])
      .then(([m, t]) => {
        const movies = m.results || [];
        const tv = t.results || [];
        setTrending(movies);
        setTrendingTV(tv);
        storage.set("trendingCache", {
          movies,
          tv,
          ts: Date.now(),
          lang: currentLang,
        });
      })
      .catch(() => {})
      .finally(() => setLoadingHome(false));
  }, [apiKey]);

  useEffect(() => {
    fetchTrending();
  }, [fetchTrending]);

  const retryHome = useCallback(() => {
    if (offline) return;
    fetchTrending();
  }, [offline, fetchTrending]);

  // ── Sync librarySort when changed from Settings ───────────────────────────
  useEffect(() => {
    const handler = (e) => setLibrarySort(e.detail);
    window.addEventListener("streambert:library-sort-changed", handler);
    return () =>
      window.removeEventListener("streambert:library-sort-changed", handler);
  }, []);

  // ── Re-fetch trending immediately when metadata language changes ──────────
  useEffect(() => {
    const handler = () => fetchTrending();
    window.addEventListener("streambert:tmdb-lang-changed", handler);
    return () =>
      window.removeEventListener("streambert:tmdb-lang-changed", handler);
  }, [fetchTrending]);

  // ── Refresh player settings (accent + subtitle lang) after save ───────────
  useEffect(() => {
    const handler = () => setPlayerSettings(readPlayerSettings());
    window.addEventListener("streambert:player-settings-changed", handler);
    return () =>
      window.removeEventListener("streambert:player-settings-changed", handler);
  }, []);

  // ── Discord Rich Presence: sync settings + connect/disconnect ─────────────
  useEffect(() => {
    applyDiscordRpcEnabled(discordSettings.enabled);
    if (!discordSettings.enabled) clearDiscordActivity();
  }, [discordSettings.enabled]);

  useEffect(() => {
    const handler = () => setDiscordSettings(readDiscordRpcSettings());
    window.addEventListener("streambert:discord-rpc-settings-changed", handler);
    return () =>
      window.removeEventListener(
        "streambert:discord-rpc-settings-changed",
        handler,
      );
  }, []);

  // Reset episode info + elapsed-time anchor whenever the open title changes
  useEffect(() => {
    setWatchingEpisode(null);
    watchStartRef.current = Date.now();
  }, [selected?.id, selected?.media_type]);

  // Push the current activity to Discord whenever what's on screen changes
  useEffect(() => {
    if (!discordSettings.enabled) return;
    if ((page === "movie" || page === "tv") && selected) {
      const title = selected.title || selected.name || "";
      let subtitle = page === "movie" ? "Movie" : "Series";
      if (page === "tv" && watchingEpisode) {
        subtitle = `S${watchingEpisode.season} · E${watchingEpisode.episode}`;
      }
      sendWatchingActivity(
        {
          title,
          subtitle,
          posterUrl: imgUrl(selected.poster_path, "w500"),
          startedAt: watchStartRef.current,
        },
        discordSettings,
      );
    } else {
      sendIdleActivity(discordSettings);
    }
  }, [page, selected, watchingEpisode, discordSettings]);
  useEffect(() => {
    // Accent colour
    const accent = storage.get(STORAGE_KEYS.ACCENT_COLOR) || "red";
    applyAccentColor(accent);
    // Theme
    const theme = storage.get(STORAGE_KEYS.THEME) || "dark";
    const customVars = storage.get(STORAGE_KEYS.CUSTOM_THEME_VARS) || null;
    applyTheme(theme, customVars);
    // Font size
    const font = storage.get(STORAGE_KEYS.FONT_SIZE) || "normal";
    const zoomMap = { sm: 0.85, normal: 1, lg: 1.15 };
    const factor = zoomMap[font] ?? 1;
    if (window.electron?.setZoomFactor) window.electron.setZoomFactor(factor);
    // Compact mode
    const compact = !!storage.get(STORAGE_KEYS.COMPACT_MODE);
    document.body.classList.toggle("compact-mode", compact);
    // Reduce animations
    const noAnim = !!storage.get(STORAGE_KEYS.REDUCE_ANIMATIONS);
    document.body.classList.toggle("no-anim", noAnim);
  }, []);
  useEffect(() => {
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // ── Navigation ────────────────────────────────────────────────────────────
  // Refs so navigate/navigateBack never need page/selected as deps
  const pageRef = useRef(page);
  const selectedRef = useRef(selected);
  // Last position reported by an inline player. Kept in a ref (not state) so
  // five-second progress ticks never re-render the whole app shell.
  const playerSessionRef = useRef(null);
  const playerBackHandlerRef = useRef(null);
  const handlePlaybackSession = useCallback((session) => {
    playerSessionRef.current = session;
  }, []);
  // Pages with an open inline player register here so the global Back button
  // (sidebar, Ctrl+Z, gamepad B) closes the player before leaving the title.
  const registerPlayerBack = useCallback((handler) => {
    playerBackHandlerRef.current = handler;
    return () => {
      if (playerBackHandlerRef.current === handler) {
        playerBackHandlerRef.current = null;
      }
    };
  }, []);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const readMainScroll = useCallback(() => {
    if (typeof document === "undefined") return 0;
    return document.querySelector(".main")?.scrollTop || 0;
  }, []);

  const restoreMainScroll = useCallback((top) => {
    if (typeof document === "undefined") return;
    const apply = () => {
      const scroller = document.querySelector(".main");
      if (scroller) scroller.scrollTop = Math.max(0, Number(top) || 0);
    };
    // Lazy pages mount one or two frames later; restore after both paints so
    // Back returns to the exact place the user left, not just the same page.
    requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(apply);
    });
    setTimeout(apply, 140);
  }, []);

  const navigateBack = useCallback(() => {
    if (typeof playerBackHandlerRef.current === "function") {
      const handler = playerBackHandlerRef.current;
      playerBackHandlerRef.current = null;
      handler();
      return;
    }
    setNavStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setPage(last.page);
      setSelected(last.selected);
      if (last.page !== "movie" && last.page !== "tv") {
        playerSessionRef.current = null;
      }
      restoreMainScroll(last.scrollTop);
      if (typeof gc === "function") {
        requestIdleCallback(() => gc(), { timeout: 2000 });
      }
      return prev.slice(0, -1);
    });
  }, [restoreMainScroll]);

  const navigate = useCallback((pg, data = null, session = null) => {
    // Settings is a detour: keep the player position so Back can resume it.
    // Every other destination is a real navigation and ends the session,
    // unless the caller supplies a session to resume (watch history).
    if (session) playerSessionRef.current = session;
    else if (pg !== "settings") playerSessionRef.current = null;
    setNavStack((prev) => [
      ...prev,
      {
        page: pageRef.current,
        selected: selectedRef.current,
        scrollTop: readMainScroll(),
      },
    ]);
    setSelected(data);
    setPage(pg);
    setShowSearch(false);
    // After navigating away, the previous page's component unmounts
    if (typeof gc === "function") {
      requestIdleCallback(() => gc(), { timeout: 2000 });
    }
  }, [readMainScroll]);

  // Clicking the permanent history rail reopens the exact title/episode and
  // resumes the second where it was left. Pages already know how to restore a
  // `resumeSession`, so this only has to seed it before navigating.
  const openHistoryEntry = useCallback(
    (entry) => {
      if (!entry?.id) return;
      const pageName = entry.media_type === "tv" ? "tv" : "movie";
      const progressKey =
        pageName === "movie"
          ? `movie_${entry.id}`
          : `tv_${entry.id}_s${entry.season}e${entry.episode}`;
      const time = Number(storage.get("dlTime_" + progressKey)) || 0;
      navigate(
        pageName,
        {
          ...entry,
          media_type: pageName,
          season: entry.season ?? null,
          episode: entry.episode ?? null,
        },
        {
          page: pageName,
          id: entry.id,
          season: entry.season ?? null,
          episode: entry.episode ?? null,
          playing: true,
          paused: false,
          time,
          source: storage.get("playerSource"),
        },
      );
      // The detail page mounts asynchronously and the player only exists after
      // metadata arrives. Wait for it, then bring it into view and focus it.
      let attempts = 0;
      const focusPlayer = () => {
        const wrap = document.querySelector(".player-wrap");
        if (wrap) {
          wrap.scrollIntoView({ behavior: "smooth", block: "center" });
          wrap.setAttribute("tabindex", "-1");
          try {
            wrap.focus({ preventScroll: true });
            const webview = wrap.querySelector("webview");
            webview?.focus?.();
          } catch {}
          return;
        }
        if (attempts++ < 40) setTimeout(focusPlayer, 250);
        else document.querySelector(".main")?.scrollTo({ top: 0 });
      };
      setTimeout(focusPlayer, 220);
    },
    [navigate],
  );

  const openSearch = useCallback(() => setShowSearch(true), []);
  const openShortcuts = useCallback(() => setShowShortcuts(true), []);

  // Opens a reusable actor / director / crew profile. The page itself chooses
  // the filmography filters from the person's departments.
  const openPerson = useCallback(
    (person) => {
      if (person?.id) navigate("person", person);
    },
    [navigate],
  );

  // Opens the Playlists page focused on a playlist saved from a person page.
  const openSavedPlaylist = useCallback(
    (playlistId) => {
      navigate("playlists", playlistId ? { playlistId } : null);
    },
    [navigate],
  );

  // Loads a franchise as a playlist: the library page filters on the saved
  // saga collection and shows every part in release order by default.
  const openPlaylist = useCallback(
    (collection) => {
      if (collection) navigate("history", { collection });
    },
    [navigate],
  );

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setShowCommandPalette(false);
        setShowSearch(true);
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "p"
      ) {
        e.preventDefault();
        setShowCommandPalette((current) => !current);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        if (pageRef.current === "downloads") {
          e.preventDefault();
          setDlSearchOpen(true);
        }
      }
      if (e.key === "Escape") {
        setShowSearch(false);
        setShowShortcuts(false);
        setShowCommandPalette(false);
      }
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        const tag = (e.target?.tagName || "").toUpperCase();
        if (
          tag !== "INPUT" &&
          tag !== "TEXTAREA" &&
          !document.querySelector(".player-deck, .player-deck-handle-wrap")
        ) {
          e.preventDefault();
          setShowShortcuts((v) => !v);
        }
      }
      // Ctrl+Z / Cmd+Z → navigate back
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        navigateBack();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "r") {
        e.preventDefault();
        window.location.reload();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigateBack]);

  // ── Controller / gamepad navigation ─────────────────────────────────────
  const [gamepadEnabled, setGamepadEnabled] = useState(
    () => storage.get(STORAGE_KEYS.GAMEPAD_ENABLED) !== false, // default on
  );
  useEffect(() => {
    const handler = () =>
      setGamepadEnabled(storage.get(STORAGE_KEYS.GAMEPAD_ENABLED) !== false);
    window.addEventListener("streambert:gamepad-settings-changed", handler);
    return () =>
      window.removeEventListener(
        "streambert:gamepad-settings-changed",
        handler,
      );
  }, []);
  const gamepadToastedRef = useRef(false);
  const { connected: gamepadConnected } = useGamepadNav({
    enabled: gamepadEnabled,
    onBack: navigateBack,
    onOpenSearch: openSearch,
  });
  useEffect(() => {
    if (!gamepadEnabled) return;
    if (gamepadConnected && !gamepadToastedRef.current) {
      gamepadToastedRef.current = true;
      // showToast is defined further below in this component; effects only
      // run after the full render, so it's already initialized by then.
      showToast(t("app.toast.controllerConnected"));
    }
    if (!gamepadConnected) gamepadToastedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gamepadConnected, gamepadEnabled]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const toastTimerRef = useRef(null);
  const showToast = useCallback((message, action = null) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(action ? { message, action } : message);
    toastTimerRef.current = setTimeout(
      () => setToast(null),
      action ? 5000 : 2500,
    );
  }, []);

  const getMediaType = useCallback(
    (item) => item.media_type || (item.first_air_date ? "tv" : "movie"),
    [],
  );

  const handleSelectResult = useCallback(
    (item) => {
      setPlayQueue(null);
      navigate(item.media_type === "tv" ? "tv" : "movie", item);
    },
    [navigate],
  );

  const startPlaylistQueue = useCallback(
    (items, startIndex = 0) => {
      const queue = (items || []).filter(Boolean);
      if (queue.length === 0) return;
      const index = Math.min(Math.max(0, startIndex), queue.length - 1);
      const item = queue[index];
      setPlayQueue({ items: queue, index });
      navigate(item.media_type === "tv" ? "tv" : "movie", item);
    },
    [navigate],
  );

  const playNextInQueue = useCallback(() => {
    if (!playQueue) return false;
    const next = playQueue.index + 1;
    if (next >= playQueue.items.length) {
      setPlayQueue(null);
      showToast(t("playlist.queueFinished"));
      return false;
    }
    const item = playQueue.items[next];
    setPlayQueue({ ...playQueue, index: next });
    navigate(item.media_type === "tv" ? "tv" : "movie", item);
    return true;
  }, [navigate, playQueue, showToast, t]);

  const saveApiKey = useCallback((key) => {
    secureStorage.set("apikey", key);
    setApiKey(key);
  }, []);

  const changeApiKey = useCallback(() => {
    secureStorage.set("apikey", "");
    setApiKey(null);
    setApiKeyLoaded(true);
    setSkipped(false);
  }, []);

  // ── Watchlist ────────────────────────────────────────────────────────────
  // Enrich saved entries in the background so the related engine has genres,
  // runtime and overview even when a title is saved straight from a card.
  const enrichWatchlistEntry = useCallback(
    async (item) => {
      if (!apiKey) return;
      const key = getWatchKey(item);
      if (!key) return;
      const type = item.media_type === "tv" ? "tv" : "movie";
      try {
        const details = await tmdbFetch(
          type === "tv"
            ? `/tv/${item.id}?append_to_response=aggregate_credits,keywords`
            : `/movie/${item.id}?append_to_response=credits,keywords`,
          apiKey,
        );
        if (!details) return;
        const current = watchlistRef.current.items[key] || item;
        // Genre, director, decade, language and franchise land in the entry's
        // own category, without touching tags the user wrote by hand.
        const smart = mergeSmartPatch(
          current,
          smartPatchFor(item, details, type),
        );
        watchlistRef.current.update(key, {
          title: details.title || details.name || item.title || item.name,
          poster_path: details.poster_path || item.poster_path || null,
          backdrop_path: details.backdrop_path || item.backdrop_path || null,
          overview: details.overview || item.overview || "",
          vote_average: details.vote_average ?? item.vote_average ?? null,
          vote_count: details.vote_count ?? item.vote_count ?? null,
          popularity: details.popularity ?? item.popularity ?? null,
          original_language:
            details.original_language || item.original_language || null,
          origin_country:
            details.origin_country || item.origin_country || [],
          genres: Array.isArray(details.genres)
            ? details.genres.map((genre) => genre.id)
            : [],
          isAnime: isAnimeContent(details),
          runtime:
            details.runtime ??
            details.episode_run_time?.[0] ??
            item.runtime ??
            null,
          year:
            (details.release_date || details.first_air_date || "").slice(0, 4) ||
            item.year ||
            "",
          ...smart,
        });
      } catch {
        // Offline or invalid token: keep the light metadata from the card.
      }
    },
    [apiKey],
  );

  const toggleSave = useCallback(
    (item) => {
      const key = getWatchKey(item);
      if (!key) return;
      const wl = watchlistRef.current;
      const entry = wl.items[key] || null;
      const index = entry ? wl.order.indexOf(key) : 0;
      // Categorise instantly from whatever metadata the card already has; the
      // background enrichment adds director / franchise a moment later.
      const immediate = smartPatchFor(item, null, getMediaType(item));
      const patch = immediate.tags.length
        ? {
            tags: [
              ...new Set([...(entry?.tags || []), ...immediate.tags]),
            ],
          }
        : undefined;
      const removed = wl.toggle(item, patch);

      if (removed) {
        showToast(t("app.toast.removedTitle", { title: entry?.title || item.title || item.name }), {
          label: t("app.undo"),
          onClick: () => watchlistRef.current.restore(entry, index),
        });
      } else {
        showToast(t("app.toast.addedWatchlist", { title: item.title || item.name }));
        enrichWatchlistEntry(item);
      }
    },
    [showToast, enrichWatchlistEntry],
  );

  /** Adds a batch (saga, search picks) with one toast and background enrichment. */
  const addItemsSmart = useCallback(
    (items, options = {}) => {
      if (!items?.length) return [];
      const wl = watchlistRef.current;
      const added = [];
      const seen = new Set();
      // Only the saga's own name groups every part together. Individual TMDB
      // collections are added per title by the background enrichment, so an
      // Alien film is never filed under "Predator Collection".
      const sagaNames = options.saga?.name ? [options.saga.name] : [];

      for (const item of items) {
        const key = getWatchKey(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const existing = wl.items[key];
        const patch = {};

        if (sagaNames.length > 0) {
          patch.collections = [
            ...new Set([...(existing?.collections || []), ...sagaNames]),
          ];
        }
        const derived = smartPatchFor(item, null, getMediaType(item));
        if (derived.tags.length > 0) {
          patch.tags = [
            ...new Set([...(existing?.tags || []), ...derived.tags]),
          ];
        }

        const entry = wl.add(
          item,
          Object.keys(patch).length > 0 ? patch : undefined,
        );
        if (entry) added.push(entry);
      }

      if (added.length === 0) {
        showToast(t("app.toast.alreadyInLibrary"));
        return [];
      }

      showToast(
        options.saga
          ? t("app.toast.addedTitles", { n: added.length, name: options.saga.name })
          : t("app.toast.addedTitlesLibrary", { n: added.length }),
      );
      // Fire-and-forget: the TMDB queue caps concurrency, and each entry gets
      // its director / franchise / decade tags when the details arrive.
      for (const entry of added) enrichWatchlistEntry(entry);
      return added;
    },
    [enrichWatchlistEntry, getMediaType, showToast],
  );

  const organizeLibrary = useCallback(async (options = {}) => {
    if (!apiKey || organizing) return;
    const entries = Object.values(watchlistRef.current.items || {});
    if (entries.length === 0) {
      showToast(t("app.toast.nothingToOrganize"));
      return;
    }

    setOrganizing(true);
    setOrganizeProgress({ done: 0, total: 0 });
    try {
      const result = await organizeEntries({
        entries,
        apiKey,
        // The manual button is a full migration; the automatic pass is capped
        // so opening the library never starts an unbounded TMDB crawl.
        limit: options.auto ? 1000 : entries.length,
        onProgress: (progress) => setOrganizeProgress(progress),
      });

      for (const { key, patch } of result.patches) {
        watchlistRef.current.update(key, patch);
      }

      if (result.patches.length === 0) {
        if (result.failed > 0 && result.failed === result.scanned) {
          showToast(t("app.toast.cannotReachTmdb"));
        } else {
          showToast(
            result.scanned === 0
              ? t("app.toast.alreadyCategorized")
              : t("app.toast.scannedOk"),
          );
        }
      } else {
        showToast(t("app.toast.organizedTitles", { n: result.patches.length }));
      }
    } catch {
      showToast(t("app.toast.organizeFailed"));
    } finally {
      setOrganizing(false);
      setOrganizeProgress(null);
    }
  }, [apiKey, organizing, showToast]);

  const removeSavedWithUndo = useCallback(
    (itemOrKey) => {
      const wl = watchlistRef.current;
      const key =
        typeof itemOrKey === "string" ? itemOrKey : getWatchKey(itemOrKey);
      if (!key) return;
      const entry = wl.items[key];
      if (!entry) return;
      const index = wl.order.indexOf(key);
      wl.remove(key);
      showToast(t("app.toast.removedTitle", { title: entry.title }), {
        label: t("app.undo"),
        onClick: () => watchlistRef.current.restore(entry, index),
      });
    },
    [showToast],
  );

  const removeSavedMany = useCallback(
    (keys) => {
      const wl = watchlistRef.current;
      const snapshot = (keys || [])
        .map((key) => ({
          key,
          entry: wl.items[key],
          index: wl.order.indexOf(key),
        }))
        .filter((item) => item.entry && item.index >= 0)
        .sort((a, b) => a.index - b.index);
      if (snapshot.length === 0) return;
      wl.removeMany(snapshot.map((item) => item.key));
      showToast(
        t("app.toast.removedTitles", { n: snapshot.length }),
        {
          label: t("app.undo"),
          onClick: () =>
            snapshot.forEach(({ entry, index }) =>
              watchlistRef.current.restore(entry, index),
            ),
        },
      );
    },
    [showToast],
  );

  const isSaved = useCallback((item) => {
    const key = getWatchKey(item);
    return !!(key && watchlistRef.current.items[key]);
  }, []);

  const isFavorite = useCallback((item) => {
    const key = getWatchKey(item);
    return !!watchlistRef.current.items[key]?.favorite;
  }, []);

  const toggleFavorite = useCallback(
    (item) => {
      const key = getWatchKey(item);
      if (!key) return;
      const entry = watchlistRef.current.items[key];
      if (!entry) {
        const saved = watchlistRef.current.add(item, { favorite: true });
        if (saved)
          showToast(t("toast.favoriteAdded", { title: saved.title }));
        return;
      }
      const next = !entry.favorite;
      watchlistRef.current.update(key, { favorite: next });
      showToast(
        t(next ? "toast.favoriteAdded" : "toast.favoriteRemoved", {
          title: entry.title,
        }),
      );
    },
    [showToast, t],
  );

  const isFavoritePerson = useCallback(
    (personId) =>
      favoritePeople.some(
        (person) => Number(person.id) === Number(personId),
      ),
    [favoritePeople],
  );

  const toggleFavoritePerson = useCallback(
    (person) => {
      if (!person?.id) return;
      setFavoritePeople((current) => {
        const exists = current.some(
          (item) => Number(item.id) === Number(person.id),
        );
        const next = exists
          ? current.filter((item) => Number(item.id) !== Number(person.id))
          : [
              {
                id: person.id,
                name: person.name || "",
                profile_path: person.profile_path || null,
                known_for_department: person.known_for_department || "",
              },
              ...current,
            ];
        storage.set("favoritePeople", next);
        return next;
      });
      showToast(
        t(
          isFavoritePerson(person.id)
            ? "toast.favoritePersonRemoved"
            : "toast.favoritePersonAdded",
          { name: person.name || "" },
        ),
      );
    },
    [isFavoritePerson, showToast, t],
  );

  const bulkUpdateSaved = useCallback((keys, patch) => {
    watchlistRef.current.updateMany(keys, patch);
  }, []);

  const addHistory = useCallback((item) => {
    // Respect the "disable watch history" setting
    const historyEnabled = storage.get(STORAGE_KEYS.HISTORY_ENABLED);
    if (historyEnabled === 0 || historyEnabled === false) return;
    const entry = {
      id: item.id,
      title: item.title || item.name,
      poster_path: item.poster_path,
      media_type: getMediaType(item),
      watchedAt: Date.now(),
      // Store as numbers so the progress key always matches exactly
      season: item.season != null ? Number(item.season) : null,
      episode: item.episode != null ? Number(item.episode) : null,
      episodeName: item.episodeName || null,
    };
    // Functional update - never reads stale history from closure
    setHistory((prev) => {
      // For TV: dedupe per episode (same show+season+episode).
      // For movies: dedupe by id+media_type as before.
      const filtered = prev.filter((h) => {
        if (h.id !== entry.id || h.media_type !== entry.media_type) return true;
        if (entry.media_type === "tv") {
          return !(h.season === entry.season && h.episode === entry.episode);
        }
        return false;
      });
      const next = [entry, ...filtered].slice(0, 100);
      storage.set("history", next);
      return next;
    });
  }, []); // no deps needed

  const saveProgress = useCallback((key, pct) => {
    // Functional update - without this, TVPage's setInterval keeps spreading
    // the progress object from when the interval was created, overwriting
    // saves from other episodes (classic stale closure bug).
    setProgress((prev) => {
      if (prev[key] === pct) return prev; // no change - skip write
      const next = { ...prev, [key]: pct };
      storage.set("progress", next);
      return next;
    });
  }, []); // no deps needed

  const markWatched = useCallback((key) => {
    setWatched((prev) => {
      const next = { ...prev, [key]: true };
      storage.set("watched", next);
      return next;
    });
  }, []);

  const markUnwatched = useCallback((key) => {
    setWatched((prev) => {
      const next = { ...prev };
      delete next[key];
      storage.set("watched", next);
      return next;
    });
  }, []);

  const removeHistory = useCallback((item) => {
    setHistory((prev) => {
      const next = prev.filter((h) => {
        if (h.id !== item.id || h.media_type !== item.media_type) return true;
        if (item.media_type === "tv") {
          return !(h.season === item.season && h.episode === item.episode);
        }
        return false;
      });
      storage.set("history", next);
      return next;
    });
  }, []);

  // Memoized, avoids re-filtering on every download-progress event
  // Pre-compute progress keys for history items once; only re-runs when history changes.
  const historyWithKeys = useMemo(
    () =>
      history
        .filter((h) => {
          if (h.media_type === "tv" && (h.season == null || h.episode == null))
            return false;
          return true;
        })
        .map((h) => ({
          ...h,
          _pk:
            h.media_type === "movie"
              ? `movie_${h.id}`
              : `tv_${h.id}_s${h.season}e${h.episode}`,
        })),
    [history],
  );

  // Filter by progress/watched
  const inProgress = useMemo(
    () =>
      historyWithKeys.filter((h) => {
        if (watched[h._pk]) return false;
        const pct = progress[h._pk];
        return pct != null && pct > 2 && pct < 98;
      }),
    [historyWithKeys, progress, watched],
  );

  // Stable handler
  const handleGoToDownloads = useCallback(
    (id) => {
      setHighlightDownload(id || null);
      navigate("downloads");
    },
    [navigate],
  );

  if (!apiKeyLoaded) return null; // wait for secure storage to resolve
  if (!apiKey && !skipped)
    return <SetupScreen onSave={saveApiKey} onSkip={() => setSkipped(true)} />;

  const hasCustomTitlebar = platform === "win32" || platform === "linux";

  return (
    <ErrorBoundary>
      {hasCustomTitlebar && <WindowTitlebar />}
      <div>
        <Sidebar
          page={page}
          onNavigate={navigate}
          onSearch={openSearch}
          activeDownloads={activeDownloadCount}
          canGoBack={navStack.length > 0}
          onBack={navigateBack}
          onShowShortcuts={openShortcuts}
        />

        <div className="main">
          {/* ── API key status banner ── */}
          {/* Suspense boundary: lazy page chunks are fetched on first visit */}
          {apiKeyStatus === "invalid_token" && (
            <div className="api-status-banner api-status-error">
              <span>⚠ {t("app.apiInvalid")}</span>
              <button className="api-status-btn" onClick={changeApiKey}>
                {t("app.apiUpdate")}
              </button>
            </div>
          )}
          {apiKeyStatus === "unreachable" && (
            <div className="api-status-banner api-status-warn">
              <span>⚠ {t("app.apiUnreachable")}</span>
              <button
                className="api-status-btn"
                onClick={() =>
                  setApiKeyStatus("checking") || window.location.reload()
                }
              >
                {t("app.apiRetry")}
              </button>
            </div>
          )}
          <WatchHistoryRail
            history={history}
            watched={watched}
            onSelect={openHistoryEntry}
            onRemoveHistory={removeHistory}
          />
          <Suspense
            fallback={
              <div
                style={{
                  color: "var(--text2)",
                  padding: 48,
                  textAlign: "center",
                  fontSize: 15,
                }}
              >
                {t("common.loading")}
              </div>
            }
          >
            {page === "home" && (
              <HomePage
                trending={trending}
                trendingTV={trendingTV}
                loading={loadingHome}
                onSelect={handleSelectResult}
                progress={progress}
                inProgress={inProgress}
                offline={offline}
                onRetry={retryHome}
                watched={watched}
                onMarkWatched={markWatched}
                onMarkUnwatched={markUnwatched}
                history={history}
                apiKey={apiKey}
                savedEntries={savedEntries}
                isSaved={isSaved}
                onToggleSave={toggleSave}
                isFavorite={isFavorite}
                onToggleFavorite={toggleFavorite}
                favoritePeople={favoritePeople}
                onOpenPerson={openPerson}
                onOpenTag={(tag) => navigate("history", { tag })}
              />
            )}
            {page === "movie" && selected && (
              <MoviePage
                key={`movie-${selected.id}`}
                item={selected}
                apiKey={apiKey}
                playerSettings={playerSettings}
                onSave={() => toggleSave(selected)}
                isSaved={isSaved(selected)}
                onHistory={addHistory}
                progress={progress}
                saveProgress={saveProgress}
                onBack={() => navigate("home")}
                onSettings={(section) =>
                  navigate("settings", { section: section || null })
                }
                resumeSession={playerSessionRef.current}
                onPlaybackSession={handlePlaybackSession}
                registerPlayerBack={registerPlayerBack}
                onDownloadStarted={handleDownloadStarted}
                watched={watched}
                onMarkWatched={markWatched}
                onMarkUnwatched={markUnwatched}
                downloads={downloads}
                onGoToDownloads={handleGoToDownloads}
                onSelect={handleSelectResult}
                isSavedItem={isSaved}
                onToggleSaveItem={toggleSave}
                onAddSaga={addItemsSmart}
                onOpenPlaylist={openPlaylist}
                onOpenPerson={openPerson}
                onPlayNext={playQueue ? playNextInQueue : null}
              />
            )}
            {page === "tv" && selected && (
              <TVPage
                key={`tv-${selected.id}`}
                item={selected}
                apiKey={apiKey}
                playerSettings={playerSettings}
                onSave={() => toggleSave(selected)}
                isSaved={isSaved(selected)}
                onHistory={addHistory}
                progress={progress}
                saveProgress={saveProgress}
                onBack={() => navigate("home")}
                onSettings={(section) =>
                  navigate("settings", { section: section || null })
                }
                resumeSession={playerSessionRef.current}
                onPlaybackSession={handlePlaybackSession}
                registerPlayerBack={registerPlayerBack}
                onDownloadStarted={handleDownloadStarted}
                watched={watched}
                onMarkWatched={markWatched}
                onMarkUnwatched={markUnwatched}
                downloads={downloads}
                onGoToDownloads={handleGoToDownloads}
                onEpisodeChange={setWatchingEpisode}
                onSelect={handleSelectResult}
                isSavedItem={isSaved}
                onToggleSaveItem={toggleSave}
                onOpenPerson={openPerson}
                onPlayNext={playQueue ? playNextInQueue : null}
              />
            )}
            {page === "history" && (
              <LibraryPage
                watchlist={watchlist.state}
                librarySort={librarySort}
                history={history}
                inProgress={inProgress}
                progress={progress}
                onSelect={handleSelectResult}
                watched={watched}
                onMarkWatched={markWatched}
                onMarkUnwatched={markUnwatched}
                onRemoveHistory={removeHistory}
                onRemove={removeSavedWithUndo}
                onRemoveMany={removeSavedMany}
                onUpdate={watchlist.update}
                onUpdateMany={bulkUpdateSaved}
                onReorder={watchlist.reorder}
                apiKey={apiKey}
                focusCollection={selected?.collection || null}
                focusTag={selected?.tag || null}
                isSaved={isSaved}
                onToggleSave={toggleSave}
                isFavorite={isFavorite}
                onToggleFavorite={toggleFavorite}
                onAddMany={addItemsSmart}
                onOrganize={organizeLibrary}
                organizing={organizing}
                organizeProgress={organizeProgress}
                onOpenPlaylist={openPlaylist}
              />
            )}
            {page === "playlists" && (
              <PlaylistsPage
                apiKey={apiKey}
                taste={taste}
                watchlist={watchlist.state}
                onSelect={handleSelectResult}
                onPlayQueue={startPlaylistQueue}
                watched={watched}
                progress={progress}
                onMarkWatched={markWatched}
                onMarkUnwatched={markUnwatched}
                initialPlaylistId={selected?.playlistId || null}
                onOpenPerson={openPerson}
              />
            )}
            {page === "person" && selected && (
              <PersonPage
                person={selected}
                apiKey={apiKey}
                onBack={navigateBack}
                onSelect={handleSelectResult}
                isSaved={isSaved}
                onToggleSave={toggleSave}
                onOpenSavedPlaylist={openSavedPlaylist}
                isFavoritePerson={isFavoritePerson}
                onToggleFavoritePerson={toggleFavoritePerson}
              />
            )}
            {page === "settings" && (
              <SettingsPage
                apiKey={apiKey}
                onChangeApiKey={changeApiKey}
                initialSection={selected?.section}
              />
            )}
            {page === "downloads" && (
              <DownloadsPage
                downloads={downloads}
                onDeleteDownload={handleDeleteDownload}
                onHistory={addHistory}
                onSaveProgress={saveProgress}
                progress={progress}
                watched={watched}
                onMarkWatched={markWatched}
                onMarkUnwatched={markUnwatched}
                highlightId={highlightDownload}
                onClearHighlight={() => setHighlightDownload(null)}
                onSelect={handleSelectResult}
                searchOpen={dlSearchOpen}
                onSearchClose={() => setDlSearchOpen(false)}
                onSettings={(section) =>
                  navigate("settings", { section: section || null })
                }
                onUpdateDownload={(id, updates) =>
                  setDownloads((prev) =>
                    prev.map((d) => (d.id === id ? { ...d, ...updates } : d)),
                  )
                }
              />
            )}
          </Suspense>
        </div>

        <Suspense fallback={null}>
          {showSearch && (
            <SearchModal
              apiKey={apiKey}
              onSelect={handleSelectResult}
              onOpenPerson={openPerson}
              onClose={() => setShowSearch(false)}
              offline={offline}
              taste={taste}
              isSaved={isSaved}
              onToggleSave={toggleSave}
              onAddMany={addItemsSmart}
            />
          )}
        </Suspense>
        {updateBanner && (
          <div
            style={{
              position: "fixed",
              top: hasCustomTitlebar ? 32 : 0,
              left: 0,
              right: 0,
              zIndex: 9999,
              background: "rgba(229,9,20,0.92)",
              backdropFilter: "blur(8px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              padding: "10px 24px",
              boxShadow: "0 2px 16px rgba(0,0,0,0.4)",
              fontSize: 14,
              fontWeight: 500,
              color: "#fff",
            }}
          >
            <span>🎉 Gigi v{updateBanner.latest} is available!</span>
            <button
              onClick={() => setShowUpdateModal(true)}
              style={{
                color: "#fff",
                fontWeight: 700,
                background: "rgba(255,255,255,0.18)",
                border: "1px solid rgba(255,255,255,0.4)",
                borderRadius: 6,
                padding: "4px 12px",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Install Update
            </button>
            <button
              onClick={() => setUpdateBanner(null)}
              style={{
                background: "transparent",
                border: "none",
                color: "rgba(255,255,255,0.7)",
                cursor: "pointer",
                fontSize: 18,
                lineHeight: 1,
                padding: "0 4px",
              }}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}
        <Suspense fallback={null}>
          {showUpdateModal && updateBanner && (
            <UpdateModal
              updateInfo={updateBanner}
              activeDownloads={activeDownloadCount}
              onClose={() => setShowUpdateModal(false)}
            />
          )}
        </Suspense>
        {toast && (
          <div className="toast">
            <span>{typeof toast === "string" ? toast : toast.message}</span>
            {typeof toast === "object" && toast.action && (
              <button
                className="toast-action"
                onClick={() => {
                  toast.action.onClick?.();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}

        {/* ── Episode check status pill / result card ── */}
        {episodeCheckStatus && (
          <div
            style={{
              position: "fixed",
              bottom: 24,
              left: "calc(var(--sidebar) + 24px)",
              zIndex: 500,
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              animation: "slideUp 0.3s ease",
              minWidth: 260,
              maxWidth: 400,
            }}
          >
            {episodeCheckStatus === "checking" && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 18px",
                  fontSize: 14,
                  color: "var(--text2)",
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 14,
                    height: 14,
                    border: "2px solid var(--text3)",
                    borderTopColor: "var(--red)",
                    borderRadius: "50%",
                    animation: "spin 0.7s linear infinite",
                    flexShrink: 0,
                  }}
                />
                Checking for new episodes…
              </div>
            )}

            {episodeCheckStatus === "none" && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 18px",
                  fontSize: 14,
                  color: "var(--text3)",
                }}
              >
                <span style={{ fontSize: 16 }}>✓</span>
                No new episodes found
              </div>
            )}

            {episodeCheckStatus?.entries && (
              <div style={{ padding: "14px 18px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 10,
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "var(--text)",
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                    }}
                  >
                    <span style={{ color: "var(--red)", fontSize: 15 }}>
                      🎬
                    </span>
                    New episode
                    {episodeCheckStatus.entries.length > 1 ? "s" : ""} available
                  </div>
                  <button
                    onClick={() => {
                      clearTimeout(episodeDismissTimerRef.current);
                      setEpisodeCheckStatus(null);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--text3)",
                      cursor: "pointer",
                      fontSize: 18,
                      lineHeight: 1,
                      padding: "0 2px",
                    }}
                    aria-label="Dismiss"
                  >
                    ×
                  </button>
                </div>
                <ul
                  style={{
                    margin: 0,
                    padding: 0,
                    listStyle: "none",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  {episodeCheckStatus.entries.slice(0, 5).map((entry) => (
                    <li
                      key={entry.id}
                      className="episode-check-item"
                      onClick={() => {
                        clearTimeout(episodeDismissTimerRef.current);
                        navigate("tv", {
                          ...entry.seriesItem,
                          season: entry.season ?? 1,
                        });
                        setEpisodeCheckStatus(null);
                      }}
                      style={{
                        fontSize: 13,
                        color: "var(--text2)",
                        padding: "5px 0",
                        paddingBottom: 7,
                        borderBottom: "1px solid var(--border)",
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                        borderRadius: 4,
                        transition: "color 0.15s",
                      }}
                    >
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {entry.title}
                      </span>
                      {entry.season != null && (
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--text3)",
                            background: "var(--surface3)",
                            borderRadius: 4,
                            padding: "1px 6px",
                            flexShrink: 0,
                          }}
                        >
                          Season {entry.season}
                        </span>
                      )}
                    </li>
                  ))}
                  {episodeCheckStatus.entries.length > 5 && (
                    <li
                      style={{
                        fontSize: 12,
                        color: "var(--text3)",
                        paddingTop: 2,
                      }}
                    >
                      +{episodeCheckStatus.entries.length - 5} more
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
        {closeConfirm && (
          <CloseConfirmModal
            count={closeConfirm.count}
            onConfirm={() => {
              setCloseConfirm(null);
              window.electron.respondClose(true);
            }}
            onCancel={() => {
              setCloseConfirm(null);
              window.electron.respondClose(false);
            }}
          />
        )}
        <Suspense fallback={null}>
          {showCommandPalette && (
            <CommandPalette
              onClose={() => setShowCommandPalette(false)}
              onNavigate={navigate}
              onSearch={openSearch}
              onShowShortcuts={openShortcuts}
            />
          )}
        </Suspense>
        <Suspense fallback={null}>
          {showShortcuts && (
            <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />
          )}
        </Suspense>
      </div>
    </ErrorBoundary>
  );
}
