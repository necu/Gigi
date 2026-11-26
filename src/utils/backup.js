// ── Backup & Restore Utilities ────────────────────────────────────────────────
// Single source of truth for which keys are included in backups.
// Used by manual export/import (SettingsPage) and scheduled backups (App.jsx).

import watchlistDb, { hasWatchlistDb } from "./watchlistDb.js";

const PREFIX = "streambert_";
export const BACKUP_VERSION = 2;

// All localStorage keys (without prefix) that are included in backups
export const BACKUP_KEYS = [
  // Watch data
  "watchlist",
  "saved",
  "savedOrder",
  "history",
  "progress",
  "watched",
  // UI / layout preferences
  "homeRowOrder",
  "homeRowVisible",
  "homeViewMode",
  "spotlightMode",
  "spotlightDismissed",
  "favoritePeople",
  "favoritePlaylists",
  "startPage",
  "libraryViews",
  // Player preferences
  "playerSource",
  "hianimeDubMode",
  "introSkipMode",
  // Other Stuff
  "ageLimit",
  "ratingCountry",
  "watchedThreshold",
  "autoplayNextEnabled",
  "autoplayNextDuration",
  "autoplayNextLayout",
  // Subtitles
  "subtitleDownload",
  "subtitleLang",
  // Paths & folders
  "downloadPath",
  "downloaderFolder",
  // Misc settings
  "invidiousBase",
  "autoCheckUpdates",
  // Search history
  "searchHistory",
  // Appearance & behaviour
  "accentColor",
  "fontSize",
  "compactMode",
  "reduceAnimations",
  "librarySort",
  "historyEnabled",
  // TMDB metadata language (e.g. "de-DE")
  "tmdbLang",
  // Notification preferences
  "notifyDownloadComplete",
  "notifyNewEpisode",
  // Episode-release cache
  "episodeReleaseCache",
];

/**
 * Reads all backup keys from localStorage and returns a plain data object.
 * Null values are omitted to keep exports clean.
 */
export function collectBackupData() {
  const data = {};
  for (const key of BACKUP_KEYS) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw !== null) data[key] = JSON.parse(raw);
    } catch {
      // skip unparseable entries
    }
  }
  return data;
}

/**
 * Writes a data object back into localStorage.
 * Only keys present in BACKUP_KEYS are written (no arbitrary injection).
 */
export function restoreBackupData(data) {
  if (!data || typeof data !== "object") throw new Error("Invalid backup data");
  for (const key of BACKUP_KEYS) {
    if (data[key] !== undefined && data[key] !== null) {
      localStorage.setItem(PREFIX + key, JSON.stringify(data[key]));
    }
  }
}

/**
 * Builds a complete backup. In addition to localStorage settings it includes
 * the SQLite library and playlists, which are the source of truth in Electron.
 */
export async function collectFullBackup() {
  const data = collectBackupData();
  let library = null;
  let playlists = [];
  let appVersion = null;

  try {
    const exported = await watchlistDb.exportState();
    if (exported?.ok && exported.state) library = exported.state;
  } catch (error) {
    console.warn("[backup] Could not export the library:", error?.message || error);
  }

  if (hasWatchlistDb()) {
    try {
      const result = await watchlistDb.playlistsFull();
      if (Array.isArray(result)) playlists = result;
    } catch (error) {
      console.warn("[backup] Could not export playlists:", error?.message || error);
    }
  }

  try {
    appVersion = (await window.electron?.getAppVersion?.()) || null;
  } catch {
    // Version information is optional.
  }

  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion,
    data,
    library,
    playlists,
  };
}

/**
 * Validates a backup before touching any persisted data.
 */
export function validateBackup(backup) {
  if (!backup || typeof backup !== "object" || Array.isArray(backup)) {
    throw new Error("Invalid backup file.");
  }
  if (!backup.data || typeof backup.data !== "object") {
    throw new Error("Invalid backup file, missing data field.");
  }
  if (
    backup.version !== undefined &&
    (!Number.isInteger(backup.version) || backup.version < 1)
  ) {
    throw new Error("Invalid backup version.");
  }
  if (backup.version > BACKUP_VERSION) {
    throw new Error(
      `This backup was made by a newer Gigi version (v${backup.version}).`,
    );
  }
  if (
    backup.library !== undefined &&
    backup.library !== null &&
    (!backup.library.items || typeof backup.library.items !== "object")
  ) {
    throw new Error("Invalid library section in backup.");
  }
  if (backup.playlists !== undefined && backup.playlists !== null) {
    if (!Array.isArray(backup.playlists)) {
      throw new Error("Invalid playlists section in backup.");
    }
    if (backup.playlists.length > 5000) {
      throw new Error("Backup contains too many playlists.");
    }
  }
  return backup;
}

/**
 * Restores both localStorage preferences and the SQLite library/playlists.
 * Legacy v1 backups only contain `data` and continue to work unchanged.
 */
export async function restoreFullBackup(backup) {
  const valid = validateBackup(backup);
  restoreBackupData(valid.data);

  const warnings = [];
  let restoredLibrary = false;
  let restoredPlaylists = 0;

  if (valid.library) {
    const result = await watchlistDb.importState(valid.library, { replace: true });
    if (result?.ok) {
      restoredLibrary = true;
    } else if (result === null) {
      warnings.push("SQLite library is unavailable; local watch data was restored.");
    } else {
      throw new Error(result.error || "Could not restore the library.");
    }
  }

  let playlistsComplete = true;
  if (Array.isArray(valid.playlists)) {
    const wantedIds = new Set();
    for (const playlist of valid.playlists) {
      if (!playlist || !playlist.id) {
        warnings.push("Skipped an invalid playlist in the backup.");
        playlistsComplete = false;
        continue;
      }
      wantedIds.add(playlist.id);
      const result = await watchlistDb.savePlaylist(playlist);
      if (result?.ok) {
        restoredPlaylists += 1;
      } else if (result === null) {
        warnings.push("SQLite playlists are unavailable.");
        playlistsComplete = false;
        break;
      } else {
        warnings.push(
          `Could not restore playlist “${playlist.name || playlist.id}”.`,
        );
        playlistsComplete = false;
      }
    }

    // A full restore should not leave playlists that are absent from the
    // backup behind. Only prune when every backup playlist was restored.
    if (playlistsComplete) {
      const existing = await watchlistDb.playlistsFull();
      if (Array.isArray(existing)) {
        for (const playlist of existing) {
          if (playlist?.id && !wantedIds.has(playlist.id)) {
            const result = await watchlistDb.deletePlaylist(playlist.id);
            if (!result?.ok) {
              warnings.push(
                `Could not remove playlist “${playlist.name || playlist.id}”.`,
              );
            }
          }
        }
      }
    }
  }

  return { restoredLibrary, restoredPlaylists, warnings };
}
