// ── Watchlist database (SQLite) ───────────────────────────────────────────────
// Durable, queryable backing store for the watchlist / library.
//
// Uses `node:sqlite` (Node 22+ / Electron 35+), which ships inside Electron:
// no native module, no rebuild, no postinstall. FTS5 provides full-text search
// across title, overview, notes, tags and collections.
//
// The renderer keeps an optimistic in-memory copy for instant UI; this module
// is the source of truth on disk. Every mutation is written in a transaction
// and the FTS index is refreshed incrementally.

const { app, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");

const SCHEMA_VERSION = 2;
const DB_FILENAME = "streambert.db";

let DatabaseSync = null;
try {
  // eslint-disable-next-line global-require
  ({ DatabaseSync } = require("node:sqlite"));
} catch {
  DatabaseSync = null;
}

let _db = null;
let _dbPath = null;
let _unavailableReason = null;

// ── Schema ───────────────────────────────────────────────────────────────────

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS entries (
  key               TEXT PRIMARY KEY,
  tmdb_id           INTEGER NOT NULL,
  media_type        TEXT NOT NULL CHECK (media_type IN ('movie','tv')),
  title             TEXT NOT NULL DEFAULT '',
  poster_path       TEXT,
  backdrop_path     TEXT,
  year              TEXT NOT NULL DEFAULT '',
  vote_average      REAL,
  vote_count        INTEGER,
  popularity        REAL,
  overview          TEXT NOT NULL DEFAULT '',
  original_language TEXT,
  origin_country    TEXT NOT NULL DEFAULT '[]',
  genres            TEXT NOT NULL DEFAULT '[]',
  is_anime          INTEGER NOT NULL DEFAULT 0,
  runtime           INTEGER,
  added_at          INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'planned',
  personal_rating   REAL,
  notes             TEXT NOT NULL DEFAULT '',
  last_episode      TEXT,
  position          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_entries_position   ON entries(position);
CREATE INDEX IF NOT EXISTS idx_entries_status     ON entries(status);
CREATE INDEX IF NOT EXISTS idx_entries_media_type ON entries(media_type);
CREATE INDEX IF NOT EXISTS idx_entries_added      ON entries(added_at);
CREATE INDEX IF NOT EXISTS idx_entries_rating     ON entries(personal_rating);

CREATE TABLE IF NOT EXISTS collections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS entry_collections (
  entry_key     TEXT NOT NULL REFERENCES entries(key) ON DELETE CASCADE,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_key, collection_id)
);

CREATE INDEX IF NOT EXISTS idx_entry_collections_collection
  ON entry_collections(collection_id);

CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS entry_tags (
  entry_key TEXT NOT NULL REFERENCES entries(key) ON DELETE CASCADE,
  tag_id    INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_key, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag_id);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  entry_key UNINDEXED,
  title,
  overview,
  notes,
  tags,
  collections,
  tokenize = 'unicode61 remove_diacritics 2'
);
`;

// Mood playlists are independent from the watchlist: they store a snapshot of
// each chosen title, so a playlist still works even if the title was never
// saved to the library or was later removed.
const SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS playlists (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  moment         TEXT NOT NULL DEFAULT 'any',
  genre          TEXT NOT NULL DEFAULT '',
  subgenre       TEXT NOT NULL DEFAULT '',
  terms          TEXT NOT NULL DEFAULT '[]',
  tags           TEXT NOT NULL DEFAULT '[]',
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  last_opened_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_playlists_updated ON playlists(updated_at);

CREATE TABLE IF NOT EXISTS playlist_items (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  entry_key   TEXT NOT NULL,
  item        TEXT NOT NULL,
  position    INTEGER NOT NULL,
  added_at    INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, entry_key)
);

CREATE INDEX IF NOT EXISTS idx_playlist_items_position
  ON playlist_items(playlist_id, position);
`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function jsonParse(value, fallback) {
  if (value == null) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asInt(value) {
  const n = asNumber(value);
  return n == null ? null : Math.round(n);
}

function uniq(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function toBoolInt(value) {
  return value ? 1 : 0;
}

function normalizeKey(key, entry) {
  if (key) return String(key);
  if (!entry || entry.id == null) return null;
  const type = entry.media_type === "tv" ? "tv" : "movie";
  return `${type}_${entry.id}`;
}

function dbFile() {
  return path.join(app.getPath("userData"), DB_FILENAME);
}

function isAvailable() {
  return DatabaseSync != null;
}

function openDb() {
  if (_db) return _db;
  if (!DatabaseSync) {
    _unavailableReason = "node:sqlite is not available in this Electron build";
    return null;
  }
  try {
    const file = dbFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");
    migrate(db);
    _db = db;
    _dbPath = file;
    return db;
  } catch (error) {
    _unavailableReason = error?.message || String(error);
    console.error("[watchlist-db] open failed:", _unavailableReason);
    _db = null;
    return null;
  }
}

function migrate(db) {
  let current = 0;
  try {
    current = Number(db.prepare("PRAGMA user_version").get()?.user_version) || 0;
  } catch {
    current = 0;
  }
  if (current >= SCHEMA_VERSION) return;
  db.exec("BEGIN");
  try {
    if (current < 1) {
      db.exec(SCHEMA_V1);
      current = 1;
    }
    if (current < 2) {
      db.exec(SCHEMA_V2);
      current = 2;
    }
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}

function tx(db, fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}

// ── Row ⇄ entry ──────────────────────────────────────────────────────────────

function rowToEntry(row) {
  return {
    id: row.tmdb_id,
    media_type: row.media_type,
    title: row.title || "",
    poster_path: row.poster_path || null,
    backdrop_path: row.backdrop_path || null,
    year: row.year || "",
    vote_average: row.vote_average,
    vote_count: row.vote_count,
    popularity: row.popularity,
    overview: row.overview || "",
    original_language: row.original_language || null,
    origin_country: jsonParse(row.origin_country, []),
    genres: jsonParse(row.genres, []),
    isAnime: !!row.is_anime,
    runtime: row.runtime,
    addedAt: row.added_at,
    updatedAt: row.updated_at,
    status: row.status || "planned",
    tags: [],
    collections: [],
    personalRating: row.personal_rating,
    notes: row.notes || "",
    lastEpisode: jsonParse(row.last_episode, null),
  };
}

function entryToParams(entry, key) {
  const mediaType = entry.media_type === "tv" ? "tv" : "movie";
  return [
    key,
    asInt(entry.id),
    mediaType,
    entry.title || "",
    entry.poster_path || null,
    entry.backdrop_path || null,
    entry.year != null ? String(entry.year) : "",
    asNumber(entry.vote_average),
    asInt(entry.vote_count),
    asNumber(entry.popularity),
    entry.overview || "",
    entry.original_language || null,
    JSON.stringify(uniq(entry.origin_country)),
    JSON.stringify(uniq(entry.genres)),
    toBoolInt(entry.isAnime),
    asInt(entry.runtime),
    asInt(entry.addedAt) ?? Date.now(),
    asInt(entry.updatedAt) ?? Date.now(),
    entry.status || "planned",
    asNumber(entry.personalRating),
    entry.notes || "",
    entry.lastEpisode ? JSON.stringify(entry.lastEpisode) : null,
  ];
}

// ── Tag / collection sync ────────────────────────────────────────────────────

function setEntryTags(db, key, tags) {
  db.prepare("DELETE FROM entry_tags WHERE entry_key = ?").run(key);
  const ensure = db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)");
  const link = db.prepare(
    "INSERT OR IGNORE INTO entry_tags (entry_key, tag_id) SELECT ?, id FROM tags WHERE name = ? COLLATE NOCASE",
  );
  for (const tag of uniq(tags)) {
    ensure.run(tag);
    link.run(key, tag);
  }
}

function setEntryCollections(db, key, collections) {
  db.prepare("DELETE FROM entry_collections WHERE entry_key = ?").run(key);
  const ensure = db.prepare(
    "INSERT OR IGNORE INTO collections (name, created_at) VALUES (?, ?)",
  );
  const link = db.prepare(
    "INSERT OR IGNORE INTO entry_collections (entry_key, collection_id) SELECT ?, id FROM collections WHERE name = ? COLLATE NOCASE",
  );
  for (const name of uniq(collections)) {
    ensure.run(name, Date.now());
    link.run(key, name);
  }
}

function refreshFts(db, key) {
  const row = db
    .prepare(
      `SELECT e.key, e.title, e.overview, e.notes,
              (SELECT group_concat(t.name, ' ') FROM entry_tags et
                 JOIN tags t ON t.id = et.tag_id
                WHERE et.entry_key = e.key) AS tags,
              (SELECT group_concat(c.name, ' ') FROM entry_collections ec
                 JOIN collections c ON c.id = ec.collection_id
                WHERE ec.entry_key = e.key) AS collections
         FROM entries e WHERE e.key = ?`,
    )
    .get(key);
  db.prepare("DELETE FROM entries_fts WHERE entry_key = ?").run(key);
  if (!row) return;
  db.prepare(
    `INSERT INTO entries_fts (entry_key, title, overview, notes, tags, collections)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    row.key,
    row.title || "",
    row.overview || "",
    row.notes || "",
    row.tags || "",
    row.collections || "",
  );
}

// ── Core reads ───────────────────────────────────────────────────────────────

function readTagsMap(db) {
  const map = {};
  const rows = db
    .prepare(
      `SELECT et.entry_key, t.name FROM entry_tags et
         JOIN tags t ON t.id = et.tag_id
        ORDER BY t.name COLLATE NOCASE`,
    )
    .all();
  for (const row of rows) {
    (map[row.entry_key] ||= []).push(row.name);
  }
  return map;
}

function readCollectionsMap(db) {
  const map = {};
  const rows = db
    .prepare(
      `SELECT ec.entry_key, c.name FROM entry_collections ec
         JOIN collections c ON c.id = ec.collection_id
        ORDER BY c.name COLLATE NOCASE`,
    )
    .all();
  for (const row of rows) {
    (map[row.entry_key] ||= []).push(row.name);
  }
  return map;
}

function loadState() {
  const db = openDb();
  if (!db) return null;
  const rows = db
    .prepare("SELECT * FROM entries ORDER BY position ASC, added_at ASC")
    .all();
  const tags = readTagsMap(db);
  const collections = readCollectionsMap(db);
  const items = {};
  const order = [];
  let updatedAt = 0;
  for (const row of rows) {
    const entry = rowToEntry(row);
    entry.tags = tags[row.key] || [];
    entry.collections = collections[row.key] || [];
    items[row.key] = entry;
    order.push(row.key);
    if (entry.updatedAt > updatedAt) updatedAt = entry.updatedAt;
  }
  return {
    version: 2,
    items,
    order,
    updatedAt: updatedAt || Date.now(),
  };
}

function getEntry(key) {
  const db = openDb();
  if (!db) return null;
  const row = db.prepare("SELECT * FROM entries WHERE key = ?").get(key);
  if (!row) return null;
  const entry = rowToEntry(row);
  entry.tags = db
    .prepare(
      `SELECT t.name FROM entry_tags et JOIN tags t ON t.id = et.tag_id
        WHERE et.entry_key = ? ORDER BY t.name COLLATE NOCASE`,
    )
    .all(key)
    .map((r) => r.name);
  entry.collections = db
    .prepare(
      `SELECT c.name FROM entry_collections ec
         JOIN collections c ON c.id = ec.collection_id
        WHERE ec.entry_key = ? ORDER BY c.name COLLATE NOCASE`,
    )
    .all(key)
    .map((r) => r.name);
  return entry;
}

function nextPosition(db) {
  const row = db.prepare("SELECT COALESCE(MAX(position), -1) AS p FROM entries").get();
  return (Number(row?.p) || 0) + 1;
}

// ── Mutations ────────────────────────────────────────────────────────────────

const INSERT_SQL = `INSERT INTO entries (
  key, tmdb_id, media_type, title, poster_path, backdrop_path, year,
  vote_average, vote_count, popularity, overview, original_language,
  origin_country, genres, is_anime, runtime, added_at, updated_at, status,
  personal_rating, notes, last_episode, position
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

const UPDATE_SQL = `UPDATE entries SET
  tmdb_id = ?, media_type = ?, title = ?, poster_path = ?, backdrop_path = ?,
  year = ?, vote_average = ?, vote_count = ?, popularity = ?, overview = ?,
  original_language = ?, origin_country = ?, genres = ?, is_anime = ?,
  runtime = ?, added_at = ?, updated_at = ?, status = ?, personal_rating = ?,
  notes = ?, last_episode = ?
WHERE key = ?`;

function writeEntry(db, key, entry, position) {
  const params = entryToParams(entry, key);
  const existing = db
    .prepare("SELECT position FROM entries WHERE key = ?")
    .get(key);
  if (existing) {
    // entryToParams starts with the key (used by INSERT); UPDATE expects the
    // key last and no position column.
    const updateParams = params.slice(1);
    db.prepare(UPDATE_SQL).run(...updateParams, key);
  } else {
    db.prepare(INSERT_SQL).run(...params, position);
  }
  setEntryTags(db, key, entry.tags);
  setEntryCollections(db, key, entry.collections);
  refreshFts(db, key);
  return key;
}

function upsertEntry(entry, patch) {
  const db = openDb();
  if (!db) return { ok: false, error: _unavailableReason };
  const key = normalizeKey(null, entry);
  if (!key) return { ok: false, error: "invalid entry" };
  const merged = { ...entry, ...(patch || {}) };
  const now = Date.now();
  const existing = getEntry(key);
  if (existing) {
    merged.addedAt = existing.addedAt;
    merged.updatedAt = now;
  } else {
    merged.addedAt = asInt(merged.addedAt) ?? now;
    merged.updatedAt = asInt(merged.updatedAt) ?? now;
  }
  try {
    tx(db, () => writeEntry(db, key, merged, nextPosition(db)));
    return { ok: true, key, entry: getEntry(key) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function updateEntry(key, patch) {
  const db = openDb();
  if (!db) return { ok: false, error: _unavailableReason };
  const existing = getEntry(key);
  if (!existing) return { ok: false, error: "not found" };
  const merged = { ...existing, ...patch, addedAt: existing.addedAt, updatedAt: Date.now() };
  try {
    const position = db
      .prepare("SELECT position FROM entries WHERE key = ?")
      .get(key)?.position;
    tx(db, () => writeEntry(db, key, merged, position ?? nextPosition(db)));
    return { ok: true, key, entry: getEntry(key) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function removeEntry(key) {
  const db = openDb();
  if (!db) return { ok: false, error: _unavailableReason };
  try {
    tx(db, () => {
      db.prepare("DELETE FROM entries WHERE key = ?").run(key);
      db.prepare("DELETE FROM entries_fts WHERE entry_key = ?").run(key);
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function removeEntries(keys) {
  const db = openDb();
  if (!db) return { ok: false, error: _unavailableReason };
  const list = uniq(keys);
  if (list.length === 0) return { ok: true, removed: 0 };
  try {
    tx(db, () => {
      const del = db.prepare("DELETE FROM entries WHERE key = ?");
      const delFts = db.prepare("DELETE FROM entries_fts WHERE entry_key = ?");
      for (const key of list) {
        del.run(key);
        delFts.run(key);
      }
    });
    return { ok: true, removed: list.length };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function restoreEntry(entry, index) {
  const db = openDb();
  if (!db) return { ok: false, error: _unavailableReason };
  const key = normalizeKey(null, entry);
  if (!key) return { ok: false, error: "invalid entry" };
  const target = Math.max(0, asInt(index) ?? 0);
  try {
    tx(db, () => {
      db.prepare("UPDATE entries SET position = position + 1 WHERE position >= ?").run(
        target,
      );
      writeEntry(db, key, entry, target);
    });
    return { ok: true, key, entry: getEntry(key) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function reorder(keys) {
  const db = openDb();
  if (!db) return { ok: false, error: _unavailableReason };
  const list = uniq(keys);
  try {
    tx(db, () => {
      const update = db.prepare("UPDATE entries SET position = ? WHERE key = ?");
      list.forEach((key, index) => update.run(index, key));
      // Append any entry that the caller did not mention.
      const known = new Set(list);
      const rest = db
        .prepare("SELECT key FROM entries ORDER BY position ASC, added_at ASC")
        .all()
        .map((r) => r.key)
        .filter((key) => !known.has(key));
      rest.forEach((key, index) => update.run(list.length + index, key));
    });
    return { ok: true, count: list.length };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function bulkUpdate(keys, patch) {
  const db = openDb();
  if (!db) return { ok: false, error: _unavailableReason };
  const list = uniq(keys);
  try {
    tx(db, () => {
      for (const key of list) {
        const existing = getEntry(key);
        if (!existing) continue;
        const merged = {
          ...existing,
          ...patch,
          addedAt: existing.addedAt,
          updatedAt: Date.now(),
        };
        const position = db
          .prepare("SELECT position FROM entries WHERE key = ?")
          .get(key)?.position;
        writeEntry(db, key, merged, position ?? nextPosition(db));
      }
    });
    return { ok: true, count: list.length };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// ── Mood playlists ───────────────────────────────────────────────────────────

const PLAYLIST_MOMENTS = new Set([
  "any",
  "morning",
  "afternoon",
  "evening",
  "night",
]);

function normalizePlaylistItem(item) {
  if (!item || item.id == null) return null;
  const mediaType = item.media_type === "tv" ? "tv" : "movie";
  const year =
    item.year ||
    (item.release_date || item.first_air_date || "").slice(0, 4) ||
    "";
  const genreIds = Array.isArray(item.genre_ids)
    ? item.genre_ids
    : Array.isArray(item.genres)
      ? item.genres
          .map((genre) => (typeof genre === "number" ? genre : genre?.id))
          .filter((id) => id != null)
      : [];
  return {
    id: item.id,
    media_type: mediaType,
    title: item.title || item.name || "",
    name: item.name || item.title || "",
    poster_path: item.poster_path || null,
    backdrop_path: item.backdrop_path || null,
    year: String(year),
    release_date: item.release_date || "",
    first_air_date: item.first_air_date || "",
    vote_average: asNumber(item.vote_average) ?? 0,
    vote_count: asInt(item.vote_count) ?? 0,
    popularity: asNumber(item.popularity) ?? 0,
    overview: item.overview || "",
    genre_ids: uniq(genreIds.map((id) => Number(id)).filter(Number.isFinite)),
    original_language: item.original_language || null,
    origin_country: Array.isArray(item.origin_country)
      ? item.origin_country
      : [],
    runtime: asInt(item.runtime),
  };
}

function normalizePlaylist(input) {
  const source = input || {};
  const now = Date.now();
  const items = [];
  const seen = new Set();
  for (const raw of source.items || []) {
    const item = normalizePlaylistItem(raw);
    if (!item) continue;
    const key = `${item.media_type}_${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return {
    id: String(source.id || randomUUID()),
    name:
      String(source.name || "")
        .trim()
        .slice(0, 120) || "Untitled playlist",
    moment: PLAYLIST_MOMENTS.has(source.moment) ? source.moment : "any",
    genre: String(source.genre || "").trim().slice(0, 80),
    subgenre: String(source.subgenre || "").trim().slice(0, 160),
    terms: uniq(source.terms || [])
      .map((term) => String(term).trim())
      .filter(Boolean)
      .slice(0, 30),
    tags: uniq(source.tags || [])
      .map((tag) => String(tag).trim())
      .filter(Boolean)
      .slice(0, 40),
    createdAt: asInt(source.createdAt) ?? now,
    items,
  };
}

function playlistRow(row) {
  return {
    id: row.id,
    name: row.name,
    moment: row.moment,
    genre: row.genre,
    subgenre: row.subgenre,
    terms: jsonParse(row.terms, []),
    tags: jsonParse(row.tags, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
    itemCount: Number(row.item_count) || 0,
    posterPath: row.poster_path || null,
  };
}

function listPlaylists() {
  const db = openDb();
  if (!db) return [];
  const rows = db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM playlist_items pi
                      WHERE pi.playlist_id = p.id) AS item_count
         FROM playlists p
        ORDER BY COALESCE(p.last_opened_at, p.updated_at) DESC, p.name COLLATE NOCASE`,
    )
    .all();
  const firstPoster = db.prepare(
    "SELECT item FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC LIMIT 1",
  );
  return rows.map((row) => {
    const first = firstPoster.get(row.id);
    const item = first ? jsonParse(first.item, null) : null;
    return {
      ...playlistRow(row),
      posterPath: item?.poster_path || null,
    };
  });
}

function listPlaylistsFull() {
  const db = openDb();
  if (!db) return [];
  const rows = db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM playlist_items pi
                      WHERE pi.playlist_id = p.id) AS item_count
         FROM playlists p
        ORDER BY COALESCE(p.last_opened_at, p.updated_at) DESC, p.name COLLATE NOCASE`,
    )
    .all();
  const itemRows = db
    .prepare(
      `SELECT playlist_id, item FROM playlist_items
        ORDER BY playlist_id ASC, position ASC`,
    )
    .all();
  const itemsByPlaylist = new Map();
  for (const itemRow of itemRows) {
    const item = jsonParse(itemRow.item, null);
    if (!item) continue;
    if (!itemsByPlaylist.has(itemRow.playlist_id)) {
      itemsByPlaylist.set(itemRow.playlist_id, []);
    }
    itemsByPlaylist.get(itemRow.playlist_id).push(item);
  }
  return rows.map((row) => {
    const items = itemsByPlaylist.get(row.id) || [];
    return {
      ...playlistRow({ ...row, item_count: items.length }),
      posterPath: items.find((item) => item.poster_path)?.poster_path || null,
      items,
    };
  });
}

function getPlaylist(id) {
  const db = openDb();
  if (!db) return null;
  const row = db.prepare("SELECT * FROM playlists WHERE id = ?").get(id);
  if (!row) return null;
  const itemRows = db
    .prepare(
      "SELECT item FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC",
    )
    .all(id);
  const items = itemRows
    .map((entry) => jsonParse(entry.item, null))
    .filter(Boolean);
  return {
    ...playlistRow({ ...row, item_count: items.length }),
    posterPath: items.find((item) => item.poster_path)?.poster_path || null,
    items,
  };
}

function savePlaylist(playlist) {
  const db = openDb();
  if (!db) return { ok: false, error: _unavailableReason };
  const data = normalizePlaylist(playlist);
  const now = Date.now();
  try {
    tx(db, () => {
      const existing = db
        .prepare("SELECT created_at FROM playlists WHERE id = ?")
        .get(data.id);
      const createdAt = existing?.created_at || data.createdAt || now;
      db.prepare(
        `INSERT INTO playlists
           (id, name, moment, genre, subgenre, terms, tags, created_at, updated_at, last_opened_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           moment = excluded.moment,
           genre = excluded.genre,
           subgenre = excluded.subgenre,
           terms = excluded.terms,
           tags = excluded.tags,
           updated_at = excluded.updated_at`,
      ).run(
        data.id,
        data.name,
        data.moment,
        data.genre,
        data.subgenre,
        JSON.stringify(data.terms),
        JSON.stringify(data.tags),
        createdAt,
        now,
      );
      db.prepare("DELETE FROM playlist_items WHERE playlist_id = ?").run(
        data.id,
      );
      const insert = db.prepare(
        `INSERT INTO playlist_items
           (playlist_id, entry_key, item, position, added_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      data.items.forEach((item, index) => {
        insert.run(
          data.id,
          `${item.media_type}_${item.id}`,
          JSON.stringify(item),
          index,
          now,
        );
      });
    });
    return { ok: true, playlist: getPlaylist(data.id) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function deletePlaylist(id) {
  const db = openDb();
  if (!db) return { ok: false, error: _unavailableReason };
  try {
    db.prepare("DELETE FROM playlists WHERE id = ?").run(id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function touchPlaylist(id) {
  const db = openDb();
  if (!db) return { ok: false, error: _unavailableReason };
  try {
    db.prepare("UPDATE playlists SET last_opened_at = ? WHERE id = ?").run(
      Date.now(),
      id,
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// ── Import / export ──────────────────────────────────────────────────────────

function importState(state, options = {}) {
  const db = openDb();
  if (!db) return { ok: false, error: _unavailableReason };
  if (!state || !state.items) return { ok: false, error: "invalid state" };
  const replace = options.replace === true;
  const order = Array.isArray(state.order) && state.order.length
    ? state.order
    : Object.keys(state.items);
  try {
    tx(db, () => {
      if (replace) {
        db.exec("DELETE FROM entries");
        db.exec("DELETE FROM entries_fts");
        db.exec("DELETE FROM entry_tags");
        db.exec("DELETE FROM entry_collections");
        db.exec("DELETE FROM tags");
        db.exec("DELETE FROM collections");
      }
      let position = replace ? 0 : nextPosition(db);
      for (const key of order) {
        const entry = state.items[key];
        if (!entry) continue;
        writeEntry(db, key, entry, position++);
      }
      // Anything present in items but missing from order.
      for (const [key, entry] of Object.entries(state.items)) {
        if (order.includes(key)) continue;
        writeEntry(db, key, entry, position++);
      }
    });
    return { ok: true, imported: position };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function exportState() {
  return loadState();
}

// ── Facets / stats ───────────────────────────────────────────────────────────

function getStats() {
  const db = openDb();
  if (!db) {
    return {
      available: false,
      error: _unavailableReason,
      path: null,
      entries: 0,
      tags: 0,
      collections: 0,
      byType: { movie: 0, tv: 0, anime: 0 },
      byStatus: {},
      sizeBytes: 0,
    };
  }
  const entries = Number(
    db.prepare("SELECT COUNT(*) AS n FROM entries").get()?.n || 0,
  );
  const byType = {
    movie: Number(
      db
        .prepare("SELECT COUNT(*) AS n FROM entries WHERE media_type = 'movie'")
        .get()?.n || 0,
    ),
    tv: Number(
      db
        .prepare("SELECT COUNT(*) AS n FROM entries WHERE media_type = 'tv'")
        .get()?.n || 0,
    ),
    anime: Number(
      db.prepare("SELECT COUNT(*) AS n FROM entries WHERE is_anime = 1").get()?.n ||
        0,
    ),
  };
  const byStatus = {};
  for (const row of db
    .prepare("SELECT status, COUNT(*) AS n FROM entries GROUP BY status")
    .all()) {
    byStatus[row.status] = Number(row.n) || 0;
  }
  const tags = Number(db.prepare("SELECT COUNT(*) AS n FROM tags").get()?.n || 0);
  const collections = Number(
    db.prepare("SELECT COUNT(*) AS n FROM collections").get()?.n || 0,
  );
  let sizeBytes = 0;
  try {
    sizeBytes = fs.statSync(_dbPath).size;
  } catch {}
  return {
    available: true,
    path: _dbPath,
    entries,
    tags,
    collections,
    byType,
    byStatus,
    sizeBytes,
    schemaVersion: SCHEMA_VERSION,
  };
}

function listTags() {
  const db = openDb();
  if (!db) return [];
  return db
    .prepare(
      `SELECT t.name AS value, COUNT(et.entry_key) AS count
         FROM tags t LEFT JOIN entry_tags et ON et.tag_id = t.id
        GROUP BY t.id ORDER BY count DESC, t.name COLLATE NOCASE`,
    )
    .all()
    .map((r) => ({ value: r.value, count: Number(r.count) || 0 }));
}

function listCollections() {
  const db = openDb();
  if (!db) return [];
  return db
    .prepare(
      `SELECT c.id, c.name AS value, COUNT(ec.entry_key) AS count
         FROM collections c LEFT JOIN entry_collections ec ON ec.collection_id = c.id
        GROUP BY c.id ORDER BY c.name COLLATE NOCASE`,
    )
    .all()
    .map((r) => ({ id: r.id, value: r.value, count: Number(r.count) || 0 }));
}

function renameCollection(from, to) {
  const db = openDb();
  if (!db) return { ok: false, error: _unavailableReason };
  const next = String(to || "").trim();
  if (!next) return { ok: false, error: "empty name" };
  try {
    tx(db, () => {
      const row = db
        .prepare("SELECT id FROM collections WHERE name = ? COLLATE NOCASE")
        .get(from);
      if (!row) return;
      const clash = db
        .prepare("SELECT id FROM collections WHERE name = ? COLLATE NOCASE")
        .get(next);
      if (clash && clash.id !== row.id) {
        // Merge into the existing collection.
        db.prepare(
          "UPDATE OR IGNORE entry_collections SET collection_id = ? WHERE collection_id = ?",
        ).run(clash.id, row.id);
        db.prepare("DELETE FROM collections WHERE id = ?").run(row.id);
      } else {
        db.prepare("UPDATE collections SET name = ? WHERE id = ?").run(next, row.id);
      }
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function deleteCollection(name) {
  const db = openDb();
  if (!db) return { ok: false, error: _unavailableReason };
  try {
    db.prepare("DELETE FROM collections WHERE name = ? COLLATE NOCASE").run(name);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function pruneOrphans() {
  const db = openDb();
  if (!db) return { ok: false, error: _unavailableReason };
  try {
    tx(db, () => {
      db.exec("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM entry_tags)");
      db.exec(
        "DELETE FROM collections WHERE id NOT IN (SELECT collection_id FROM entry_collections)",
      );
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// ── Full-text search ─────────────────────────────────────────────────────────

function escapeFtsQuery(query) {
  return String(query || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `"${token.replace(/"/g, '""')}"*`)
    .join(" ");
}

/**
 * Server-side search/filter/sort. The renderer mostly filters in memory for
 * instant feedback, but this powers large libraries and external consumers.
 */
function search(options = {}) {
  const db = openDb();
  if (!db) return { ok: false, error: _unavailableReason, items: [], total: 0 };
  const {
    query = "",
    types = [],
    statuses = [],
    tags = [],
    collection = null,
    sort = "manual",
    dir = "asc",
    limit = 500,
    offset = 0,
  } = options;

  const where = [];
  const params = [];
  let ftsJoin = "";
  const fts = escapeFtsQuery(query);
  if (fts) {
    ftsJoin = "JOIN entries_fts ON entries_fts.entry_key = e.key";
    where.push("entries_fts MATCH ?");
    params.push(fts);
  }
  if (types.length) {
    const clauses = [];
    for (const type of types) {
      if (type === "movie") clauses.push("e.media_type = 'movie'");
      else if (type === "tv") clauses.push("e.media_type = 'tv'");
      else if (type === "anime") clauses.push("e.is_anime = 1");
    }
    if (clauses.length) where.push(`(${clauses.join(" OR ")})`);
  }
  if (statuses.length) {
    where.push(`e.status IN (${statuses.map(() => "?").join(",")})`);
    params.push(...statuses);
  }
  if (collection) {
    where.push(
      `e.key IN (SELECT ec.entry_key FROM entry_collections ec
                  JOIN collections c ON c.id = ec.collection_id
                 WHERE c.name = ? COLLATE NOCASE)`,
    );
    params.push(collection);
  }
  if (tags.length) {
    where.push(
      `e.key IN (SELECT et.entry_key FROM entry_tags et
                  JOIN tags t ON t.id = et.tag_id
                 WHERE t.name IN (${tags.map(() => "?").join(",")}))`,
    );
    params.push(...tags);
  }

  const direction = dir === "desc" ? "DESC" : "ASC";
  const orderBy = {
    added: `e.added_at ${direction}`,
    title: `e.title COLLATE NOCASE ${direction}`,
    rating: `COALESCE(e.personal_rating, e.vote_average, 0) ${direction}`,
    year: `CAST(e.year AS INTEGER) ${direction}`,
    status: `e.status ${direction}`,
  }[sort] || "e.position ASC";

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const base = `FROM entries e ${ftsJoin} ${whereSql}`;
  try {
    const total = Number(
      db.prepare(`SELECT COUNT(*) AS n ${base}`).get(...params)?.n || 0,
    );
    const rows = db
      .prepare(`SELECT e.* ${base} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(...params, Math.max(1, Math.min(2000, Number(limit) || 500)), Math.max(0, Number(offset) || 0));
    const tagsMap = readTagsMap(db);
    const collectionsMap = readCollectionsMap(db);
    const items = rows.map((row) => {
      const entry = rowToEntry(row);
      entry.tags = tagsMap[row.key] || [];
      entry.collections = collectionsMap[row.key] || [];
      return entry;
    });
    return { ok: true, items, total };
  } catch (error) {
    return { ok: false, error: error.message, items: [], total: 0 };
  }
}

// ── Maintenance ──────────────────────────────────────────────────────────────

function integrityCheck() {
  const db = openDb();
  if (!db) return { ok: false, error: _unavailableReason };
  try {
    const rows = db.prepare("PRAGMA integrity_check").all();
    return { ok: true, result: rows.map((r) => r.integrity_check) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function checkpoint() {
  const db = openDb();
  if (!db) return { ok: false, error: _unavailableReason };
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function close() {
  if (!_db) return;
  try {
    _db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch {}
  try {
    _db.close();
  } catch {}
  _db = null;
}

// ── IPC ──────────────────────────────────────────────────────────────────────

function register() {
  ipcMain.handle("watchlist-db:available", () => ({
    available: isAvailable(),
    error: _unavailableReason,
    path: _dbPath || null,
  }));

  ipcMain.handle("watchlist-db:load", () => {
    try {
      const state = loadState();
      if (!state) {
        return { ok: false, error: _unavailableReason, state: null };
      }
      return { ok: true, state, stats: getStats() };
    } catch (error) {
      return { ok: false, error: error.message, state: null };
    }
  });

  ipcMain.handle("watchlist-db:upsert", (_, { entry, patch }) => {
    try {
      return upsertEntry(entry, patch);
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("watchlist-db:update", (_, { key, patch }) => {
    try {
      return updateEntry(key, patch);
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("watchlist-db:remove", (_, { key }) => {
    try {
      return removeEntry(key);
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("watchlist-db:remove-many", (_, { keys }) => {
    try {
      return removeEntries(keys);
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("watchlist-db:restore", (_, { entry, index }) => {
    try {
      return restoreEntry(entry, index);
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("watchlist-db:reorder", (_, { order }) => {
    try {
      return reorder(order);
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("watchlist-db:bulk-update", (_, { keys, patch }) => {
    try {
      return bulkUpdate(keys, patch);
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("watchlist-db:import", (_, { state, options }) => {
    try {
      return importState(state, options);
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("watchlist-db:export", () => {
    try {
      return { ok: true, state: exportState() };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("watchlist-db:search", (_, options) => {
    try {
      return search(options);
    } catch (error) {
      return { ok: false, error: error.message, items: [], total: 0 };
    }
  });

  ipcMain.handle("watchlist-db:stats", () => getStats());
  ipcMain.handle("watchlist-db:tags", () => listTags());
  ipcMain.handle("watchlist-db:collections", () => listCollections());
  ipcMain.handle("watchlist-db:playlists", () => listPlaylists());
  ipcMain.handle("watchlist-db:playlists-full", () => listPlaylistsFull());
  ipcMain.handle("watchlist-db:playlist-get", (_, { id }) => getPlaylist(id));
  ipcMain.handle("watchlist-db:playlist-save", (_, { playlist }) =>
    savePlaylist(playlist),
  );
  ipcMain.handle("watchlist-db:playlist-delete", (_, { id }) =>
    deletePlaylist(id),
  );
  ipcMain.handle("watchlist-db:playlist-touch", (_, { id }) =>
    touchPlaylist(id),
  );
  ipcMain.handle("watchlist-db:rename-collection", (_, { from, to }) =>
    renameCollection(from, to),
  );
  ipcMain.handle("watchlist-db:delete-collection", (_, { name }) =>
    deleteCollection(name),
  );
  ipcMain.handle("watchlist-db:prune", () => pruneOrphans());
  ipcMain.handle("watchlist-db:integrity", () => integrityCheck());
  ipcMain.handle("watchlist-db:checkpoint", () => checkpoint());

  app.on("before-quit", close);
}

module.exports = {
  register,
  close,
  isAvailable,
  getStats,
  // exported for tests / tooling
  loadState,
  importState,
  search,
  listPlaylists,
  listPlaylistsFull,
  getPlaylist,
  savePlaylist,
  deletePlaylist,
  touchPlaylist,
};
