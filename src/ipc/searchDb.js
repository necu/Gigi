// ── Search database (SQLite) ──────────────────────────────────────────────────
// A dedicated store for the search experience, separate from the library DB:
//
//   searches      – audit trail of what was searched and which result was picked
//   query_memory  – per-query usage, recency and the best result found so far
//   title_signals – click telemetry used to boost titles the user actually opens
//
// The renderer uses this to rank results, to remember the right match for a
// vague title, and to suggest searches again. Everything is best-effort: when
// node:sqlite is unavailable the renderer keeps working from localStorage.

const { app, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

const SCHEMA_VERSION = 1;
const DB_FILENAME = "streambert-search.db";
const MAX_SEARCH_ROWS = 1200;

let DatabaseSync = null;
try {
  // eslint-disable-next-line global-require
  ({ DatabaseSync } = require("node:sqlite"));
} catch {
  DatabaseSync = null;
}

let _db = null;
let _unavailableReason = null;

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS searches (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  query        TEXT NOT NULL,
  normalized   TEXT NOT NULL,
  ts           INTEGER NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'text',
  result_count INTEGER NOT NULL DEFAULT 0,
  picked_key   TEXT,
  picked_title TEXT
);

CREATE INDEX IF NOT EXISTS idx_search_normalized ON searches(normalized);
CREATE INDEX IF NOT EXISTS idx_search_ts         ON searches(ts);

CREATE TABLE IF NOT EXISTS query_memory (
  normalized TEXT PRIMARY KEY,
  query      TEXT NOT NULL,
  uses       INTEGER NOT NULL DEFAULT 0,
  last_used  INTEGER NOT NULL,
  best_key   TEXT,
  best_title TEXT
);

CREATE INDEX IF NOT EXISTS idx_query_memory_used ON query_memory(last_used);

CREATE TABLE IF NOT EXISTS title_signals (
  key          TEXT PRIMARY KEY,
  media_type   TEXT,
  title        TEXT,
  clicks       INTEGER NOT NULL DEFAULT 0,
  last_clicked INTEGER NOT NULL
);
`;

function dbFile() {
  return path.join(app.getPath("userData"), DB_FILENAME);
}

function normalize(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
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
    db.exec("PRAGMA busy_timeout = 5000");
    migrate(db);
    _db = db;
    return db;
  } catch (error) {
    _unavailableReason = error?.message || String(error);
    console.error("[search-db] open failed:", _unavailableReason);
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
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}

function handle(channel, fn) {
  ipcMain.handle(channel, (_event, payload) => {
    const db = openDb();
    if (!db) {
      return { ok: false, reason: _unavailableReason || "unavailable" };
    }
    try {
      return { ok: true, ...(fn(db, payload || {}) || {}) };
    } catch (error) {
      console.warn(`[search-db] ${channel} failed:`, error?.message || error);
      return { ok: false, reason: error?.message || "search-db-failed" };
    }
  });
}

function recordSearch(db, payload) {
  const query = String(payload.query || "").trim();
  const normalized = normalize(query);
  if (!normalized) return { ignored: true };

  const ts = Date.now();
  const kind = payload.kind || "text";
  const resultCount = Number(payload.resultCount) || 0;

  db.prepare(
    `INSERT INTO searches (query, normalized, ts, kind, result_count)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(query, normalized, ts, kind, resultCount);

  db.prepare(
    `INSERT INTO query_memory (normalized, query, uses, last_used)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(normalized) DO UPDATE SET
       uses = uses + 1,
       last_used = excluded.last_used,
       query = excluded.query`,
  ).run(normalized, query, ts);

  db.prepare(
    `DELETE FROM searches
      WHERE id NOT IN (
        SELECT id FROM searches ORDER BY ts DESC LIMIT ${MAX_SEARCH_ROWS}
      )`,
  ).run();

  return { normalized, ts };
}

function recordPick(db, payload) {
  const query = String(payload.query || "").trim();
  const normalized = normalize(query);
  const key = String(payload.key || "");
  const title = String(payload.title || "");
  const mediaType = payload.mediaType === "tv" ? "tv" : "movie";
  if (!normalized || !key) return { ignored: true };

  const ts = Date.now();

  db.prepare(
    `UPDATE searches
        SET picked_key = ?, picked_title = ?
      WHERE id = (
        SELECT id FROM searches
         WHERE normalized = ?
         ORDER BY ts DESC LIMIT 1
      )`,
  ).run(key, title, normalized);

  db.prepare(
    `INSERT INTO query_memory (normalized, query, uses, last_used, best_key, best_title)
     VALUES (?, ?, 1, ?, ?, ?)
     ON CONFLICT(normalized) DO UPDATE SET
       last_used  = excluded.last_used,
       best_key   = excluded.best_key,
       best_title = excluded.best_title`,
  ).run(normalized, query, ts, key, title);

  db.prepare(
    `INSERT INTO title_signals (key, media_type, title, clicks, last_clicked)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       clicks = clicks + 1,
       last_clicked = excluded.last_clicked,
       title = excluded.title,
       media_type = excluded.media_type`,
  ).run(key, mediaType, title, ts);

  return { key, ts };
}

function suggest(db, payload) {
  const limit = Math.min(Math.max(Number(payload.limit) || 20, 1), 50);
  const rows = db
    .prepare(
      `SELECT query, uses, last_used, best_key, best_title
         FROM query_memory
        ORDER BY last_used DESC
        LIMIT ?`,
    )
    .all(limit);
  return {
    suggestions: rows.map((row) => ({
      query: row.query,
      uses: row.uses,
      lastUsed: row.last_used,
      bestKey: row.best_key || null,
      bestTitle: row.best_title || null,
    })),
  };
}

function boosts(db) {
  const rows = db
    .prepare(
      `SELECT key, clicks FROM title_signals
        WHERE clicks > 0
        ORDER BY clicks DESC
        LIMIT 500`,
    )
    .all();
  return {
    boosts: Object.fromEntries(rows.map((row) => [row.key, row.clicks])),
  };
}

function stats(db) {
  const searches =
    Number(db.prepare("SELECT COUNT(*) AS n FROM searches").get()?.n) || 0;
  const queries =
    Number(db.prepare("SELECT COUNT(*) AS n FROM query_memory").get()?.n) || 0;
  const picks =
    Number(
      db.prepare("SELECT COUNT(*) AS n FROM searches WHERE picked_key IS NOT NULL")
        .get()?.n,
    ) || 0;
  const titles =
    Number(db.prepare("SELECT COUNT(*) AS n FROM title_signals").get()?.n) || 0;
  return { searches, queries, picks, titles };
}

function clear(db) {
  db.exec("DELETE FROM searches");
  db.exec("DELETE FROM query_memory");
  db.exec("DELETE FROM title_signals");
  return { cleared: true };
}

function register() {
  ipcMain.handle("search-db:available", () => ({
    ok: true,
    available: DatabaseSync != null,
  }));

  handle("search-db:record", recordSearch);
  handle("search-db:record-pick", recordPick);
  handle("search-db:suggest", suggest);
  handle("search-db:boosts", boosts);
  handle("search-db:stats", stats);
  handle("search-db:clear", clear);
}

module.exports = { register };
