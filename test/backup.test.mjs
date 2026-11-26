import test from "node:test";
import assert from "node:assert/strict";

const calls = {
  importState: [],
  savePlaylist: [],
};

globalThis.localStorage = {
  values: new Map(),
  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  },
  setItem(key, value) {
    this.values.set(key, String(value));
  },
  removeItem(key) {
    this.values.delete(key);
  },
};

globalThis.window = {
  electron: {
    watchlistDb: {
      async importState(state, options) {
        calls.importState.push({ state, options });
        return { ok: true, imported: Object.keys(state.items || {}).length };
      },
      async playlistsFull() {
        return [];
      },
      async savePlaylist(playlist) {
        calls.savePlaylist.push(playlist);
        return { ok: true, playlist };
      },
      async deletePlaylist() {
        return { ok: true };
      },
    },
  },
};

const backup = await import("../src/utils/backup.js");

test("restoreFullBackup sends the library with replace and restores playlists", async () => {
  const playlist = {
    id: "pl_backup",
    name: "Backup playlist",
    items: [{ id: 1, media_type: "movie", title: "One" }],
  };
  const result = await backup.restoreFullBackup({
    version: 2,
    data: { librarySort: "title" },
    library: {
      version: 2,
      items: { movie_1: { id: 1, media_type: "movie", title: "One" } },
      order: ["movie_1"],
    },
    playlists: [playlist],
  });

  assert.equal(result.restoredLibrary, true);
  assert.equal(result.restoredPlaylists, 1);
  assert.deepEqual(result.warnings, []);
  assert.equal(calls.importState.length, 1);
  assert.equal(calls.importState[0].options.replace, true);
  assert.equal(calls.savePlaylist.length, 1);
  assert.equal(calls.savePlaylist[0].id, "pl_backup");
  assert.equal(
    globalThis.localStorage.getItem("streambert_librarySort"),
    '"title"',
  );
});

test("validateBackup rejects newer versions and invalid library sections", () => {
  assert.throws(
    () => backup.validateBackup({ version: backup.BACKUP_VERSION + 1, data: {} }),
    /newer Gigi version/,
  );
  assert.throws(
    () => backup.validateBackup({ version: 2, data: {}, library: { order: [] } }),
    /Invalid library section/,
  );
  assert.throws(
    () => backup.validateBackup({ version: 2, data: {}, playlists: "nope" }),
    /Invalid playlists section/,
  );
});

test("restoreBackupData only writes known keys", () => {
  globalThis.localStorage.setItem("streambert_librarySort", '"added"');
  backup.restoreBackupData({ librarySort: "rating", arbitrary: "ignored" });
  assert.equal(
    globalThis.localStorage.getItem("streambert_librarySort"),
    '"rating"',
  );
  assert.equal(
    globalThis.localStorage.getItem("streambert_arbitrary"),
    null,
  );
});
