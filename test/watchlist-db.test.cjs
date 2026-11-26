const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "gigi-watchlist-"));
const handlers = new Map();
const electronMock = {
  app: {
    getPath: () => userData,
    on: () => {},
  },
  ipcMain: {
    handle: (channel, handler) => handlers.set(channel, handler),
  },
};

const originalLoad = Module._load;
Module._load = function mockElectron(request, parent, isMain) {
  if (request === "electron") return electronMock;
  return originalLoad.call(this, request, parent, isMain);
};
const watchlistDb = require("../src/ipc/watchlistDb.js");
Module._load = originalLoad;

test.after(() => {
  try {
    watchlistDb.close();
  } catch {}
  fs.rmSync(userData, { recursive: true, force: true });
});

function entry(id, type = "movie", title = `Title ${id}`) {
  return {
    id,
    media_type: type,
    title,
    year: "2024",
    addedAt: Date.now(),
    updatedAt: Date.now(),
    status: "planned",
    tags: ["qa"],
    collections: ["Regression"],
    genres: [18],
  };
}

test("importState restores a full library and reports the imported count", () => {
  const state = {
    version: 2,
    items: {
      movie_101: { ...entry(101, "movie", "First"), favorite: true },
      tv_202: entry(202, "tv", "Second"),
    },
    order: ["movie_101", "tv_202"],
  };

  const result = watchlistDb.importState(state, { replace: true });
  assert.equal(result.ok, true);
  assert.equal(result.imported, 2);
  assert.equal(result.error, undefined);

  const loaded = watchlistDb.loadState();
  assert.deepEqual(loaded.order, ["movie_101", "tv_202"]);
  assert.equal(loaded.items.movie_101.title, "First");
  assert.equal(loaded.items.tv_202.media_type, "tv");
  assert.deepEqual(loaded.items.movie_101.tags, ["qa"]);
  assert.equal(loaded.items.movie_101.favorite, true);
  assert.equal(loaded.items.tv_202.favorite, false);
});

test("importState accepts items missing from order and keeps replace atomic", () => {
  const state = {
    version: 2,
    items: {
      movie_303: entry(303, "movie", "Only item"),
    },
    order: [],
  };

  const result = watchlistDb.importState(state, { replace: true });
  assert.equal(result.ok, true);
  assert.equal(result.imported, 1);

  const loaded = watchlistDb.loadState();
  assert.deepEqual(Object.keys(loaded.items), ["movie_303"]);
});

test("a backup with library and playlists restores both sections", async () => {
  const state = {
    version: 2,
    items: {
      movie_404: entry(404, "movie", "Backup movie"),
      tv_505: entry(505, "tv", "Backup series"),
    },
    order: ["movie_404", "tv_505"],
  };
  const imported = watchlistDb.importState(state, { replace: true });
  assert.equal(imported.ok, true);
  assert.equal(imported.imported, 2);

  const playlist = {
    id: "pl_regression",
    name: "Regression playlist",
    moment: "evening",
    genre: "Drama",
    subgenre: "",
    terms: [],
    tags: ["Drama"],
    items: [state.items.movie_404, state.items.tv_505],
  };
  const saved = watchlistDb.savePlaylist(playlist);
  assert.equal(saved.ok, true);

  const full = watchlistDb.listPlaylistsFull();
  const restored = full.find((item) => item.id === "pl_regression");
  assert.ok(restored);
  assert.equal(restored.items.length, 2);
  assert.equal(restored.items[0].title, "Backup movie");
});
