// ── IPC: Player launch, window controls, auto-updater ─────────────────────────

const { ipcMain, shell, app } = require("electron");
const PLAYER_MENU_GUARD_JS = require("./playerGuard");
// Player WebContents whose console/media bridge was already attached.
const playerMediaHooked = new WeakSet();
const { spawn, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");
const os = require("os");

let _updateAbortController = null;

// ── Trusted release sources for the auto-updater ──────────────────────────────
// Same validation logic applies to every entry below, adding a new source
// means adding a row here, not a new code path.
//
// IMPORTANT: GitHub and Codeberg use completely different asset URL structures:
//   GitHub:   https://github.com/<owner>/<repo>/releases/download/<tag>/<file>
const TRUSTED_UPDATE_SOURCES = [
  {
    id: "github",
    origin: "https://github.com",
    // Must match the full repo path so an attacker can't use
    // a different repo on github.com to serve a malicious binary.
    pathPrefix: "/necu/Gigi/releases/download/",
    redirectHosts: [
      "github.com",
      "objects.githubusercontent.com",
      "release-assets.githubusercontent.com",
    ],
  },
];

// Returns the matching trusted source for a parsed URL, or null.
function findTrustedUpdateSource(parsedUrl) {
  return (
    TRUSTED_UPDATE_SOURCES.find(
      (s) =>
        parsedUrl.origin === s.origin &&
        parsedUrl.pathname.startsWith(s.pathPrefix),
    ) || null
  );
}

// ── Stream metadata (Referer / UA) remembered per captured m3u8 URL ──────────
// The session hook in index.js records these so "open in external player" can
// send the same headers the embedded player used. Capped to avoid unbounded growth.
const binCache = new Map(); // bare binary name -> resolved path | null
const streamMeta = new Map(); // url -> { referer, origin, userAgent }
const STREAM_META_MAX = 50;
// Header values end up in player command lines / config: strip control chars
// (no header or option injection via CR/LF) and cap the length.
const CONTROL_CHARS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  "g",
);
const cleanHeader = (v, max = 4096) =>
  typeof v === "string" ? v.replace(CONTROL_CHARS, "").slice(0, max) : "";

function hasStreamMeta(url) {
  return streamMeta.has(url);
}

function rememberStreamMeta(url, meta = {}) {
  if (typeof url !== "string" || !url) return;
  if (!streamMeta.has(url) && streamMeta.size >= STREAM_META_MAX) {
    streamMeta.delete(streamMeta.keys().next().value);
  }
  const web = (v) => (/^https?:\/\//i.test(v) ? v : "");
  streamMeta.set(url, {
    referer: web(cleanHeader(meta.referer, 2048)),
    origin: web(cleanHeader(meta.origin, 512)),
    userAgent: cleanHeader(meta.userAgent, 512),
  });
}

const isHttpUrl = (u) => {
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
};

function register(getMainWindow, { writeSecretMigration }) {
  // ── Open file at specific timestamp in mpv / VLC ─────────────────────────

  // Extensions considered safe to pass to an external media player.
  // This also gates the shell.openPath fallback.
  const ALLOWED_MEDIA_EXTENSIONS = new Set([
    ".mp4",
    ".mkv",
    ".avi",
    ".mov",
    ".webm",
    ".m4v",
    ".ts",
    ".m2ts",
    ".m3u8",
  ]);

  const ALLOWED_SUBTITLE_EXTENSIONS = new Set([
    ".srt",
    ".ass",
    ".ssa",
    ".vtt",
    ".sub",
    ".idx",
    ".sup",
  ]);

  // Validate a path: must have an allowed extension and must resolve to a
  // real absolute path (prevents path-traversal tricks like "../../bin/sh").
  const validateMediaPath = (p, allowedExts) => {
    if (typeof p !== "string" || !p) return null;
    const ext = path.extname(p).toLowerCase();
    if (!allowedExts.has(ext)) return null;
    try {
      // fs.realpathSync throws if the file doesn't exist
      const real = fs.realpathSync(p);
      // Re-check extension after resolving symlinks
      if (!allowedExts.has(path.extname(real).toLowerCase())) return null;
      return real;
    } catch {
      return null;
    }
  };

  ipcMain.handle(
    "open-path-at-time",
    (_, { filePath, seconds, subtitlePaths }) => {
      // ── Validate filePath ─────────────────────────────────────────────────
      const safeFilePath = validateMediaPath(
        filePath,
        ALLOWED_MEDIA_EXTENSIONS,
      );
      if (!safeFilePath) return; // silently drop invalid paths

      const sec = Math.floor(seconds || 0);
      const platform = process.platform;

      const resolveBin = (bin) => {
        if (path.isAbsolute(bin)) return fs.existsSync(bin) ? bin : null;
        const whichCmd = platform === "win32" ? "where" : "which";
        try {
          const result = spawnSync(whichCmd, [bin], { encoding: "utf8" });
          if (result.status === 0 && result.stdout.trim()) {
            return result.stdout.trim().split("\n")[0].trim();
          }
        } catch {}
        return null;
      };

      const tryLaunch = (bin, args) => {
        const resolved = resolveBin(bin);
        if (!resolved) return false;
        try {
          spawn(resolved, args, { detached: true, stdio: "ignore" }).unref();
          return true;
        } catch {
          return false;
        }
      };

      const vlcPaths =
        platform === "win32"
          ? [
              "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",
              "C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe",
              "vlc",
            ]
          : platform === "darwin"
            ? ["/Applications/VLC.app/Contents/MacOS/VLC", "vlc"]
            : ["/usr/bin/vlc", "/usr/local/bin/vlc", "/snap/bin/vlc", "vlc"];

      const mpvPaths =
        platform === "win32"
          ? ["mpv", "C:\\Program Files\\mpv\\mpv.exe"]
          : platform === "darwin"
            ? ["/opt/homebrew/bin/mpv", "/usr/local/bin/mpv", "mpv"]
            : ["/usr/bin/mpv", "/usr/local/bin/mpv", "/snap/bin/mpv", "mpv"];

      // ── Validate subtitle paths ───────────────────────────────────────────
      // Each subtitle path is independently validated.
      const subFilePaths = Array.isArray(subtitlePaths)
        ? subtitlePaths
            .map((sp) => (typeof sp === "string" ? sp : sp?.path))
            .map((sp) => validateMediaPath(sp, ALLOWED_SUBTITLE_EXTENSIONS))
            .filter(Boolean)
        : [];
      const mpvSubArgs = subFilePaths.map((p) => `--sub-file=${p}`);
      const vlcSubArgs =
        subFilePaths.length > 0 ? [`--sub-file=${subFilePaths[0]}`] : [];

      if (sec > 0) {
        for (const mpv of mpvPaths) {
          if (tryLaunch(mpv, [`--start=${sec}`, ...mpvSubArgs, safeFilePath]))
            return;
        }
        for (const vlc of vlcPaths) {
          if (
            tryLaunch(vlc, [`--start-time=${sec}`, ...vlcSubArgs, safeFilePath])
          )
            return;
        }
      } else if (mpvSubArgs.length > 0) {
        for (const mpv of mpvPaths) {
          if (tryLaunch(mpv, [...mpvSubArgs, safeFilePath])) return;
        }
        for (const vlc of vlcPaths) {
          if (tryLaunch(vlc, [...vlcSubArgs, safeFilePath])) return;
        }
      }
      shell.openPath(safeFilePath);
    },
  );

  // ── Open a live stream URL (m3u8) in an external player (mpv / VLC) ────────
  ipcMain.handle("open-stream-external", async (_, { url, title, subtitles } = {}) => {
    if (!isHttpUrl(url)) return { ok: false, error: "Invalid stream URL" };

    const platform = process.platform;
    const meta = streamMeta.get(url) || {};
    const safeTitle =
      typeof title === "string" ? title.replace(/[\r\n]/g, " ").slice(0, 200) : "";
    const subUrls = (Array.isArray(subtitles) ? subtitles : [])
      .map((s) => (typeof s === "string" ? s : s?.url))
      .filter(isHttpUrl);

    const resolveBin = (bin) => {
      if (path.isAbsolute(bin)) return fs.existsSync(bin) ? bin : null;
      if (binCache.has(bin)) return binCache.get(bin);
      try {
        const r = spawnSync(platform === "win32" ? "where" : "which", [bin], {
          encoding: "utf8",
        });
        if (r.status === 0 && r.stdout.trim()) {
          const found = r.stdout.trim().split(/\r?\n/)[0].trim();
          binCache.set(bin, found);
          return found;
        }
      } catch {}
      return null;
    };
    // Launch and wait for a short time.
    // The player's output goes to a log FILE (not a pipe) so it is fully
    // independent of this app: quitting Gigi will not close the player
    const tryLaunch = (bin, args) => {
      const resolved = resolveBin(bin);
      if (!resolved) return Promise.resolve(null);
      return new Promise((resolve) => {
        const logPath = path.join(
          os.tmpdir(),
          `gigi_player_${process.pid}_${Date.now()}.log`,
        );
        let fd = null;
        let done = false;
        const finish = (v) => {
          if (done) return;
          done = true;
          resolve(v);
        };
        const closeFd = () => {
          if (fd !== null) {
            try {
              fs.closeSync(fd);
            } catch {}
            fd = null;
          }
        };
        const removeLog = () => {
          try {
            fs.unlinkSync(logPath);
          } catch {}
        };
        try {
          fd = fs.openSync(logPath, "a", 0o600);
          const child = spawn(resolved, args, {
            detached: true,
            stdio: ["ignore", fd, fd],
            windowsHide: false,
          });
          child.on("error", () => {
            closeFd();
            removeLog();
            finish(null);
          });
          child.on("exit", (code, signal) => {
            closeFd();
            let text = "";
            try {
              text = fs.readFileSync(logPath, "utf8").slice(-4000);
            } catch {}
            removeLog();
            const lines = text
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter(Boolean);
            const key = [...lines]
              .reverse()
              .find((l) =>
                /error|failed|forbidden|denied|unable|invalid|unknown option/i.test(l),
              );
            const tail = lines.slice(-3).join(" | ");
            const detail = key && !tail.includes(key) ? `${key} | ${tail}` : tail;
            // After the startup window this only cleans up; finish() is a no-op
            finish({
              failed: true,
              error: `${detail || "No output"} (exit ${code ?? signal})`.slice(0, 400),
            });
          });
          setTimeout(() => {
            if (done) return;
            closeFd(); // the child keeps its own copy of the descriptor
            child.unref();
            finish({ failed: false });
          }, 2500);
        } catch {
          closeFd();
          removeLog();
          finish(null);
        }
      });
    };

    const mpvPaths =
      platform === "win32"
        ? ["mpv", "C:\\Program Files\\mpv\\mpv.exe"]
        : platform === "darwin"
          ? ["/opt/homebrew/bin/mpv", "/usr/local/bin/mpv", "mpv"]
          : ["/usr/bin/mpv", "/usr/local/bin/mpv", "/snap/bin/mpv", "mpv"];
    const vlcPaths =
      platform === "win32"
        ? [
            "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",
            "C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe",
            "vlc",
          ]
        : platform === "darwin"
          ? ["/Applications/VLC.app/Contents/MacOS/VLC", "vlc"]
          : ["/usr/bin/vlc", "/usr/local/bin/vlc", "/snap/bin/vlc", "vlc"];

    const mpvArgs = ["--ytdl=no", "--msg-level=all=warn"];
    if (meta.referer) mpvArgs.push(`--referrer=${meta.referer}`);
    if (meta.userAgent) mpvArgs.push(`--user-agent=${meta.userAgent}`);
    if (meta.origin) mpvArgs.push(`--http-header-fields=Origin: ${meta.origin}`);
    if (safeTitle) mpvArgs.push(`--force-media-title=${safeTitle}`);
    subUrls.forEach((u) => mpvArgs.push(`--sub-file=${u}`));
    mpvArgs.push("--", url);

    // VLC cannot load remote subtitle files via CLI, so subtitles are skipped.
    const vlcArgs = [];
    if (meta.referer) vlcArgs.push(`--http-referrer=${meta.referer}`);
    if (meta.userAgent) vlcArgs.push(`--http-user-agent=${meta.userAgent}`);
    if (safeTitle) vlcArgs.push(`--meta-title=${safeTitle}`);
    vlcArgs.push(url);

    let lastError = null;
    for (const bin of mpvPaths) {
      const r = await tryLaunch(bin, mpvArgs);
      if (!r) continue;
      if (!r.failed) return { ok: true, player: "mpv" };
      lastError = r.error;
      break; // mpv exists but failed; the same stream would fail in VLC too
    }
    if (!lastError) {
      for (const bin of vlcPaths) {
        const r = await tryLaunch(bin, vlcArgs);
        if (!r) continue;
        if (!r.failed) return { ok: true, player: "vlc" };
        lastError = r.error;
        break;
      }
    }
    if (lastError) {
      const sent = [
        meta.referer && "Referer",
        meta.origin && "Origin",
        meta.userAgent && "User-Agent",
      ].filter(Boolean);
      return {
        ok: false,
        error: `${lastError} [sent: ${sent.join(", ") || "no captured headers"}]`,
      };
    }
    return {
      ok: false,
      error: "No external player found. Install mpv or VLC and try again.",
    };
  });

  // ── Window controls (custom Windows titlebar) ─────────────────────────────
  ipcMain.handle("window-minimize", () => {
    const mw = getMainWindow();
    if (mw && !mw.isDestroyed()) mw.minimize();
  });

  ipcMain.handle("window-toggle-maximize", () => {
    const mw = getMainWindow();
    if (!mw || mw.isDestroyed()) return;
    if (mw.isMaximized()) mw.unmaximize();
    else mw.maximize();
  });

  ipcMain.handle("window-close", () => {
    const mw = getMainWindow();
    if (mw && !mw.isDestroyed()) mw.close();
  });

  ipcMain.handle("window-is-maximized", () => {
    const mw = getMainWindow();
    return mw ? mw.isMaximized() : false;
  });

  // Push maximize state to the renderer so WindowTitlebar doesn't need to poll
  const pushMaximized = (v) => {
    const mw = getMainWindow();
    if (mw && !mw.isDestroyed()) mw.webContents.send("window-maximized", v);
  };
  const mwForEvents = getMainWindow();
  if (mwForEvents) {
    mwForEvents.on("maximize", () => pushMaximized(true));
    mwForEvents.on("unmaximize", () => pushMaximized(false));
    mwForEvents.on("enter-full-screen", () => pushMaximized(true));
    mwForEvents.on("leave-full-screen", () => pushMaximized(false));
  }

  ipcMain.handle("quit-app", () => {
    const mw = getMainWindow();
    if (mw && !mw.isDestroyed()) mw.close();
  });

  ipcMain.handle("get-platform", () => process.platform);

  // ── Get video duration via ffprobe ────────────────────────────────────────
  ipcMain.handle("get-video-duration", async (_, filePath) => {
    if (!filePath) return { ok: false };
    const platform = process.platform;

    // Probe paths for ffprobe
    const probePaths =
      platform === "win32"
        ? ["ffprobe", "C:\\ffmpeg\\bin\\ffprobe.exe"]
        : platform === "darwin"
          ? ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "ffprobe"]
          : ["/usr/bin/ffprobe", "/usr/local/bin/ffprobe", "ffprobe"];

    for (const probe of probePaths) {
      try {
        const result = spawnSync(
          probe,
          [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            filePath,
          ],
          { encoding: "utf8", timeout: 8000 },
        );
        if (result.status === 0) {
          const secs = parseFloat(result.stdout.trim());
          if (!isNaN(secs) && secs > 0) return { ok: true, duration: secs };
        }
      } catch {}
    }

    // Fallback: try ffmpeg -i and parse Duration line
    const ffmpegPaths =
      platform === "win32"
        ? ["ffmpeg", "C:\\ffmpeg\\bin\\ffmpeg.exe"]
        : platform === "darwin"
          ? ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"]
          : ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"];

    for (const ff of ffmpegPaths) {
      try {
        const r = spawnSync(ff, ["-i", filePath], {
          encoding: "utf8",
          timeout: 8000,
        });
        const combined = (r.stdout || "") + (r.stderr || "");
        const m = combined.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
        if (m) {
          const secs =
            parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
          if (secs > 0) return { ok: true, duration: secs };
        }
      } catch {}
    }

    return { ok: false };
  });

  // ── Auto-updater ──────────────────────────────────────────────────────────
  ipcMain.handle("detect-update-format", () => {
    if (process.platform === "win32") return "exe";
    if (process.platform === "darwin") return "dmg";
    if (process.platform === "linux") {
      if (process.env.APPIMAGE) return "appimage";
      const isArch =
        spawnSync("which", ["pacman"], { encoding: "utf8" }).status === 0;
      return isArch ? "pacman" : "deb";
    }
    return null;
  });

  ipcMain.handle("download-and-install-update", async (_, { url, format }) => {
    try {
      const ALLOWED_FORMATS = [
        "exe",
        "deb",
        "pacman",
        "dmg",
        "dmg_arm64",
        "appimage",
      ];
      if (!ALLOWED_FORMATS.includes(format)) {
        return { ok: false, error: "Invalid format" };
      }

      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        return { ok: false, error: "Invalid URL" };
      }

      // Same check for every trusted source (GitHub, Codeberg, ...)
      // see TRUSTED_UPDATE_SOURCES above.
      const trustedSource = findTrustedUpdateSource(parsed);
      if (!trustedSource) {
        return { ok: false, error: "Unauthorized update source" };
      }
      const ALLOWED_REDIRECT_HOSTS = trustedSource.redirectHosts;

      _updateAbortController = new AbortController();
      const { signal } = _updateAbortController;

      const ext =
        format === "exe"
          ? ".exe"
          : format === "deb"
            ? ".deb"
            : format === "pacman"
              ? ".pacman"
              : format === "dmg"
                ? ".dmg"
                : ".AppImage";
      const destPath = path.join(os.tmpdir(), `gigi-update${ext}`);

      await new Promise((resolve, reject) => {
        if (signal.aborted) return reject(new Error("Cancelled"));

        const doRequest = (reqUrl, redirectDepth = 0) => {
          // Guard against infinite redirect loops.
          if (redirectDepth > 5) {
            return reject(new Error("Too many redirects"));
          }
          let reqParsed;
          try {
            reqParsed = new URL(reqUrl);
          } catch {
            return reject(new Error("Invalid redirect URL"));
          }
          if (!ALLOWED_REDIRECT_HOSTS.includes(reqParsed.hostname)) {
            return reject(
              new Error(`Untrusted redirect host: ${reqParsed.hostname}`),
            );
          }

          const lib = reqUrl.startsWith("https") ? https : http;
          const req = lib.get(
            reqUrl,
            {
              headers: {
                "User-Agent": "Gigi-AutoUpdater",
                Accept: "application/octet-stream",
              },
            },
            (res) => {
              if (
                res.statusCode >= 300 &&
                res.statusCode < 400 &&
                res.headers.location
              ) {
                res.resume();
                const next = res.headers.location.startsWith("http")
                  ? res.headers.location
                  : new URL(res.headers.location, reqUrl).toString();
                doRequest(next, redirectDepth + 1);
                return;
              }
              if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode}`));
              }

              const total = parseInt(res.headers["content-length"] || "0", 10);
              let downloaded = 0;
              const file = fs.createWriteStream(destPath);

              res.on("data", (chunk) => {
                if (signal.aborted) {
                  req.destroy();
                  file.destroy();
                  reject(new Error("Cancelled"));
                  return;
                }
                downloaded += chunk.length;
                file.write(chunk);
                const percent =
                  total > 0 ? Math.round((downloaded / total) * 100) : 0;
                const mb = (downloaded / 1e6).toFixed(1);
                const totalMb =
                  total > 0 ? `/ ${(total / 1e6).toFixed(1)} MB` : "";
                const mw = getMainWindow();
                if (mw && !mw.isDestroyed()) {
                  mw.webContents.send("update-progress", {
                    percent,
                    label: `Downloading… ${mb} MB ${totalMb}`,
                  });
                }
              });
              res.on("end", () => {
                file.end();
                file.on("finish", resolve);
                file.on("error", reject);
              });
              res.on("error", reject);
              req.on("error", reject);
            },
          );
          req.on("error", reject);
        };

        doRequest(url);
      });

      if (signal.aborted) return { ok: false, error: "Cancelled" };

      // ── Helper: send "Installing…" to renderer ──────────────────────────────
      const sendInstalling = () => {
        const mw = getMainWindow();
        if (mw && !mw.isDestroyed()) {
          mw.webContents.send("update-progress", {
            percent: 100,
            label: "Installing…",
          });
        }
      };

      if (format === "appimage") {
        sendInstalling();
        fs.chmodSync(destPath, 0o755);
        const currentAppImage = process.env.APPIMAGE;
        if (currentAppImage) {
          const scriptPath = path.join(os.tmpdir(), "gigi-update.sh");
          const pid = process.pid;
          const target = currentAppImage;
          const scriptContent =
            [
              "#!/bin/sh",
              `while kill -0 ${pid} 2>/dev/null; do sleep 0.2; done`,
              `mv -f "${destPath}" "${target}"`,
              `chmod +x "${target}"`,
              `"${target}" &`,
            ].join("\n") + "\n";
          fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });
          spawn("sh", [scriptPath], {
            detached: true,
            stdio: "ignore",
          }).unref();
        } else {
          spawn(destPath, [], { detached: true, stdio: "ignore" }).unref();
        }
        writeSecretMigration();
        app.exit(0);
      } else if (format === "pacman") {
        sendInstalling();
        // Give the renderer a moment to process the IPC message and show
        // "Installing…" before spawnSync blocks the main thread
        await new Promise((r) => setTimeout(r, 150));
        fs.chmodSync(destPath, 0o644);
        const pacmanLaunchers = [
          { bin: "pkexec", args: ["pacman", "-U", "--noconfirm", destPath] },
          { bin: "pamac-installer", args: [destPath] },
        ];
        let launched = false;
        for (const { bin, args } of pacmanLaunchers) {
          try {
            const which = spawnSync("which", [bin], { encoding: "utf8" });
            if (which.status !== 0) continue;
            // spawnSync, to wait for pacman to finish before relaunching
            const result = spawnSync(bin, args, { stdio: "inherit" });
            if (result.status === 0) {
              launched = true;
              break;
            }
          } catch {
            continue;
          }
        }
        if (launched) {
          writeSecretMigration();
          app.relaunch();
          app.exit(0);
        } else {
          shell.openPath(destPath);
        }
      } else if (format === "deb") {
        sendInstalling();
        await new Promise((r) => setTimeout(r, 150));
        fs.chmodSync(destPath, 0o644);
        const debLaunchers = [
          { bin: "pkexec", args: ["dpkg", "-i", destPath] },
          { bin: "pkexec", args: ["apt", "install", "-y", destPath] },
          { bin: "gdebi-gtk", args: [destPath] },
          { bin: "pkexec", args: ["gdebi", "-n", destPath] },
        ];
        let launched = false;
        for (const { bin, args } of debLaunchers) {
          try {
            const which = spawnSync(
              process.platform === "win32" ? "where" : "which",
              [bin],
              { encoding: "utf8" },
            );
            if (which.status !== 0) continue;
            // spawnSync, to wait for dpkg to finish before relaunching
            const result = spawnSync(bin, args, { stdio: "inherit" });
            if (result.status === 0) {
              launched = true;
              break;
            }
          } catch {
            continue;
          }
        }
        if (launched) {
          writeSecretMigration();
          app.relaunch();
          app.exit(0);
        } else {
          shell.openPath(destPath);
        }
      } else if (format === "exe") {
        sendInstalling();
        spawn(destPath, [], { detached: true, stdio: "ignore" }).unref();
        app.exit(0);
      } else if (format === "dmg") {
        sendInstalling();
        spawn("hdiutil", ["attach", destPath], {
          detached: true,
          stdio: "ignore",
        }).unref();
      }

      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      _updateAbortController = null;
    }
  });

  ipcMain.handle("cancel-update", () => {
    _updateAbortController?.abort();
  });

  // ── Proxy release-note images through the main process ───────────────────
  // Codeberg (and GitHub) release images are blocked by Electron's renderer
  // CSP. Fetch them here in the main process and return a base64 data-URI.

  const ALLOWED_IMAGE_HOSTS = new Set([
    "codeberg.org",
    "github.com",
    "user-images.githubusercontent.com",
    "private-user-images.githubusercontent.com",
    "objects.githubusercontent.com",
  ]);
  const IMAGE_SIZE_LIMIT = 10 * 1024 * 1024; // 10 MB

  const fetchImageSecure = (url, resolve, redirectDepth = 0) => {
    if (redirectDepth > 1) return resolve(null);
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return resolve(null);
    }
    if (parsed.protocol !== "https:") return resolve(null);
    if (!ALLOWED_IMAGE_HOSTS.has(parsed.hostname)) return resolve(null);

    https
      .get(
        url,
        { headers: { "User-Agent": "Gigi-ReleaseNotes" } },
        (res) => {
          if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume();
            const next = res.headers.location.startsWith("http")
              ? res.headers.location
              : new URL(res.headers.location, url).toString();
            return fetchImageSecure(next, resolve, redirectDepth + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return resolve(null);
          }
          const ct = res.headers["content-type"] || "";
          if (!ct.startsWith("image/")) {
            res.resume();
            return resolve(null);
          }

          const chunks = [];
          let total = 0;
          res.on("data", (c) => {
            total += c.length;
            if (total > IMAGE_SIZE_LIMIT) {
              res.destroy();
              return resolve(null);
            }
            chunks.push(c);
          });
          res.on("end", () =>
            resolve(
              `data:${ct};base64,${Buffer.concat(chunks).toString("base64")}`,
            ),
          );
          res.on("error", () => resolve(null));
        },
      )
      .on("error", () => resolve(null));
  };

  ipcMain.handle(
    "fetch-release-image",
    (_, { url }) => new Promise((resolve) => fetchImageSecure(url, resolve)),
  );

  // ── Query video progress across all webview frames ────────────────────────
  // executeJavaScript on a webview only reaches the top frame.
  // VidSrc / 2embed nest the player inside cross-origin iframes, iterate
  // all frames from the main process where same-origin restrictions don't apply.
  ipcMain.handle("query-video-progress", async (_, webContentsId) => {
    try {
      const { webContents } = require("electron");
      const wc = webContents.fromId(webContentsId);
      if (!wc || wc.isDestroyed()) return null;

      // Recursively collect all frames
      const allFrames = [];
      const collect = (frame) => {
        allFrames.push(frame);
        for (const child of frame.frames || []) collect(child);
      };
      collect(wc.mainFrame);

      const JS = `
        (() => {
          // DeVideoSrc exposes window.meinecloudPlayer (sync getters). Prefer it,
          // fall back to the plain <video> lookup if it is missing / async.
          const P = window.meinecloudPlayer;
          if (P && typeof P.getCurrentTime === 'function') {
            try {
              const t = P.getCurrentTime();
              const d = P.getDuration();
              const paused = P.getPaused();
              if (typeof t === 'number' && typeof d === 'number' && typeof paused === 'boolean') {
                if (!(d > 0) || d === Infinity || paused) return null;
                return { currentTime: t, duration: d, recentUserSeek: false, lastUserSeekTo: null };
              }
            } catch (e) {}
          }
          const v = document.querySelector('video');
          if (!v || !v.duration || v.duration === Infinity || v.paused) return null;
          if (!v._seekTracked) {
            v._seekTracked = true;
            v.addEventListener('seeked', () => {
              v._lastUserSeek = Date.now();
              v._lastUserSeekTo = v.currentTime;
            });
          }
          return {
            currentTime: v.currentTime,
            duration: v.duration,
            recentUserSeek: v._lastUserSeek ? (Date.now() - v._lastUserSeek < 6000) : false,
            lastUserSeekTo: v._lastUserSeekTo ?? null,
          };
        })()
      `;

      for (const frame of allFrames) {
        try {
          const result = await frame.executeJavaScript(JS);
          if (result && result.duration > 0) return result;
        } catch {}
      }
      return null;
    } catch {
      return null;
    }
  });

  // ── Control the video inside any nested player iframe ───────────────────
  // A webview.executeJavaScript only reaches the top frame. Sources such as
  // VidSrc nest the real <video> in a cross-origin iframe, so the custom
  // player deck needs the same frame-walking trick as query-video-progress.
  // Only the largest video in the frame is controlled; ads and background
  // previews are ignored.
  ipcMain.handle("control-video", async (_, { webContentsId, action, value }) => {
    try {
      const { webContents } = require("electron");
      const wc = webContents.fromId(webContentsId);
      if (!wc || wc.isDestroyed()) return null;

      const allFrames = [];
      const collect = (frame) => {
        allFrames.push(frame);
        for (const child of frame.frames || []) collect(child);
      };
      collect(wc.mainFrame);

      // Providers commonly fullscreen a cross-origin iframe. A webview-level
      // executeJavaScript only reaches the top frame, so leave the guest's
      // native fullscreen from every frame instead.
      if (action === "exit-fullscreen") {
        const results = await Promise.all(
          allFrames.map(async (frame) => {
            try {
              return await frame.executeJavaScript(
                "(() => { try { if (document.fullscreenElement) { const p = document.exitFullscreen?.(); if (p && p.catch) p.catch(() => {}); return true; } } catch (e) {} return false; })()",
              );
            } catch {
              return false;
            }
          }),
        );
        return results.some(Boolean);
      }

      const STATE_JS = `
        (() => {
          const videos = Array.from(document.querySelectorAll('video'));
          if (!videos.length) return null;
          videos.sort((a, b) => {
            const area = (v) => Math.max(1, v.clientWidth || 0) * Math.max(1, v.clientHeight || 0);
            return area(b) - area(a);
          });
          const v = videos[0];
          const area = Math.max(1, v.clientWidth || 0) * Math.max(1, v.clientHeight || 0);
          const visible = (el) => {
            if (!el || !el.getBoundingClientRect) return false;
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return r.width > 4 && r.height > 4 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0.01;
          };
          // Only real menu containers count. Provider settings drawers and
          // subtitle panels stay in the DOM while closed and used to hide the
          // deck forever with the old broad class match.
          const menuOpen = !!window.__gigiMenuOpen || Array.from(document.querySelectorAll('[role="menu"], [role="listbox"], [class*="dropdown"], [class*="Dropdown"], [aria-expanded="true"]')).some((el) => {
            if (el === v || !visible(el)) return false;
            const r = el.getBoundingClientRect();
            const onScreen = r.bottom > 0 && r.right > 0 && r.left < innerWidth && r.top < innerHeight;
            if (!onScreen) return false;
            return el.querySelectorAll('button, [role="menuitem"], li').length >= 2;
          });
          return {
            found: true,
            area,
            paused: !!v.paused,
            currentTime: Number.isFinite(v.currentTime) ? v.currentTime : 0,
            duration: Number.isFinite(v.duration) ? v.duration : 0,
            volume: Number.isFinite(v.volume) ? v.volume : 1,
            muted: !!v.muted,
            playbackRate: Number.isFinite(v.playbackRate) ? v.playbackRate : 1,
            readyState: v.readyState || 0,
            menuOpen,
          };
        })()
      `;

      let targetFrame = null;
      let state = null;
      let bestScore = -1;
      for (const frame of allFrames) {
        try {
          const result = await frame.executeJavaScript(STATE_JS);
          if (result?.found) {
            const score =
              (Number(result.area) || 0) * 10 +
              Math.min(Number(result.duration) || 0, 7200);
            if (score > bestScore) {
              bestScore = score;
              targetFrame = frame;
              state = result;
            }
          }
        } catch {}
      }
      if (!targetFrame) return null;
      if (!action || action === "state") return state;

      // The provider's bottom deck is hidden so only our deck shows, but its
      // quality/audio/subtitle drawer must stay reachable. #settingsBtn is
      // usually display:none yet its handler still toggles that drawer.
      if (action === "provider-menu") {
        const MENU_JS = `(() => {
          const visible = (el) => {
            if (!el || !el.getBoundingClientRect) return false;
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            return r.width > 80 && r.height > 80 && r.right > 0 && r.bottom > 0 &&
              r.left < innerWidth && r.top < innerHeight &&
              s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) > 0.05;
          };
          const panels = Array.from(document.querySelectorAll(
            '#settingsPanel, #subtitlesPanel, .settings-view, .subs-panel, [class*="settings-panel"], [class*="quality-menu"], [class*="qualityMenu"]'
          ));
          const triggers = [
            '#settingsBtn', '#lbQuality', '#lbSubs', '#subtitlesBtn',
            'button[aria-label*="setting" i]', 'button[aria-label*="subtitles" i]',
            'button[aria-label*="caption" i]', 'button[aria-label*="quality" i]',
            'button[aria-label*="audio" i]', '[role="button"][aria-label*="setting" i]',
            '[role="button"][aria-label*="subtitles" i]', '[data-tip*="quality" i]',
            '[data-tip*="subtitle" i]'
          ];
          let trigger = null;
          for (const sel of triggers) {
            const el = document.querySelector(sel);
            if (el) { trigger = el; break; }
          }
          if (!trigger) {
            const re = /quality|calidad|subtitle|subtit|caption|audio|setting|ajustes|track|idioma|language/i;
            trigger = Array.from(document.querySelectorAll('button, [role="button"]')).find((el) => {
              const label = [el.id, el.className, el.getAttribute('aria-label'), el.getAttribute('title'), el.innerText].filter(Boolean).join(' ');
              return re.test(label);
            }) || null;
          }
          if (!trigger) return { ok: false, open: panels.some(visible) };
          trigger.click();
          return { ok: true, open: panels.some(visible), id: trigger.id || null };
        })()`;
        const frames = [targetFrame, ...allFrames.filter((frame) => frame !== targetFrame)];
        for (const frame of frames) {
          try {
            const result = await frame.executeJavaScript(MENU_JS, true);
            if (result?.ok) {
              // Let the drawer finish its short transition before returning.
              await new Promise((resolve) => setTimeout(resolve, 220));
              return result;
            }
          } catch {}
        }
        // No known settings trigger: briefly reveal the provider's own deck
        // instead of silently dropping quality/audio/subtitle access.
        try {
          await targetFrame.executeJavaScript(
            "(() => { const d = document.documentElement; d.setAttribute('data-gigi-show-chrome', '1'); clearTimeout(window.__gigiChromeReveal); window.__gigiChromeReveal = setTimeout(() => d.removeAttribute('data-gigi-show-chrome'), 10000); return true; })()",
            true,
          );
          return { ok: true, revealed: true };
        } catch {}
        return { ok: false };
      }

      // The provider's own deck is hidden, and with it the "Volume boost"
      // switch (Off / 2× / 3×) that made dialogue audible. Its controls still
      // exist in the settings drawer, so the deck can drive them directly.
      if (action === "audio-boost") {
        const wanted = [1, 2, 3].includes(Number(value)) ? Number(value) : 0;
        const boostJs = (want) => `(() => {
          const buttons = Array.from(document.querySelectorAll(
            '#boostRow button[data-boost], .seg.boost button[data-boost], [class*="boost"] button[data-boost]'
          ));
          if (!buttons.length) return { supported: false };
          const read = () => {
            const active = buttons.find((b) => b.classList.contains('active')) ||
              buttons.find((b) => b.getAttribute('aria-pressed') === 'true');
            return active ? Number(active.dataset.boost) || 1 : 1;
          };
          const before = read();
          if (!${want}) return { supported: true, level: before };
          const target = buttons.find((b) => Number(b.dataset.boost) === ${want});
          if (!target) return { supported: true, level: before };
          if (!target.classList.contains('active')) target.click();
          return { supported: true, level: ${want} };
        })()`;
        const frames = [targetFrame, ...allFrames.filter((frame) => frame !== targetFrame)];
        for (const frame of frames) {
          try {
            const result = await frame.executeJavaScript(boostJs(wanted), true);
            if (!result?.supported) continue;
            if (!wanted) return result;
            // Let the provider re-render its active class, then report the
            // value it actually applied instead of assuming it worked.
            await new Promise((resolve) => setTimeout(resolve, 140));
            try {
              const confirmed = await frame.executeJavaScript(boostJs(0), true);
              if (confirmed?.supported) return confirmed;
            } catch {}
            return result;
          } catch {}
        }
        return { supported: false };
      }

      // Native text tracks expose writable cue times. Providers that render
      // subtitles in their own DOM report unsupported, so the deck can reset
      // the control instead of pretending the delay worked.
      if (action === "subtitle-delay") {
        const offset = Number(value);
        const delay = Number.isFinite(offset)
          ? Math.max(-10, Math.min(10, offset))
          : 0;
        const DELAY_JS = `(() => {
          const videos = Array.from(document.querySelectorAll('video'));
          videos.sort((a, b) => {
            const area = (v) => Math.max(1, v.clientWidth || 0) * Math.max(1, v.clientHeight || 0);
            return area(b) - area(a);
          });
          const v = videos[0];
          if (!v || !v.textTracks) return { supported: false, cues: 0, delay: 0 };
          let cues = 0;
          for (const track of Array.from(v.textTracks)) {
            if (!track.cues) continue;
            for (const cue of Array.from(track.cues)) {
              if (cue.__gigiStart == null) cue.__gigiStart = cue.startTime;
              if (cue.__gigiEnd == null) cue.__gigiEnd = cue.endTime;
              cue.startTime = Math.max(0, cue.__gigiStart + ${delay});
              cue.endTime = Math.max(0, cue.__gigiEnd + ${delay});
              cues += 1;
            }
          }
          return { supported: cues > 0, cues, delay: ${delay} };
        })()`;
        try {
          return await targetFrame.executeJavaScript(DELAY_JS, true);
        } catch {
          return { supported: false, cues: 0, delay: 0 };
        }
      }

      const safeNumber = Number(value);
      let command = "";
      if (action === "toggle-play") {
        // Read the current state inside the frame. Deciding from the earlier
        // snapshot made two quick clicks both resolve to "play".
        command = "if (v.paused) { v.play().catch(() => {}); } else { v.pause(); }";
      } else if (action === "seek") {
        command = `v.currentTime = Math.max(0, Math.min(v.duration || 1e9, v.currentTime + ${Number.isFinite(safeNumber) ? safeNumber : 0}));`;
      } else if (action === "seek-to") {
        command = `v.currentTime = Math.max(0, Math.min(v.duration || 1e9, ${Number.isFinite(safeNumber) ? safeNumber : 0}));`;
      } else if (action === "set-volume") {
        command = `v.volume = Math.max(0, Math.min(1, ${Number.isFinite(safeNumber) ? safeNumber : 1})); v.muted = false;`;
      } else if (action === "toggle-mute") {
        command = "v.muted = !v.muted;";
      } else if (action === "set-rate") {
        command = `v.playbackRate = Math.max(0.25, Math.min(4, ${Number.isFinite(safeNumber) ? safeNumber : 1}));`;
      } else if (action === "play") {
        command = "v.play().catch(() => {});";
      } else if (action === "pause") {
        command = "v.pause();";
      }

      if (!command) return state;
      try {
        await targetFrame.executeJavaScript(
          `(() => { const videos = Array.from(document.querySelectorAll('video'));
            if (!videos.length) return null;
            videos.sort((a, b) => {
              const area = (v) => Math.max(1, v.clientWidth || 0) * Math.max(1, v.clientHeight || 0);
              return area(b) - area(a);
            });
            const v = videos[0]; ${command}
            return { currentTime: v.currentTime, paused: v.paused };
          })()`,
        );
      } catch {}

      // Read the resulting state after the command so the deck never invents
      // a local value that disagrees with the real video element.
      try {
        return await targetFrame.executeJavaScript(STATE_JS);
      } catch {
        return state;
      }
    } catch {
      return null;
    }
  });

  // The quality/audio menus live inside the provider's iframe. Inject the
  // outside-click guard into every frame, and make it idempotent so the deck
  // can safely call this on dom-ready and while a stream is playing.
  ipcMain.handle("install-player-guard", async (_, webContentsId) => {
    try {
      const { webContents } = require("electron");
      const wc = webContents.fromId(webContentsId);
      if (!wc || wc.isDestroyed()) return false;

      // Forward the media events reported by the injected guard. The prefix
      // check keeps ordinary site logs out of the IPC channel.
      if (!playerMediaHooked.has(wc)) {
        playerMediaHooked.add(wc);
        wc.on("console-message", (event, level, message) => {
          const text =
            typeof event?.message === "string"
              ? event.message
              : typeof message === "string"
                ? message
                : typeof level === "string"
                  ? level
                  : "";
          if (!text) return;
          const target = getMainWindow?.();
          if (!target || target.isDestroyed?.()) return;
          if (text.startsWith("__GIGI_MEDIA__")) {
            try {
              const state = JSON.parse(text.slice("__GIGI_MEDIA__".length));
              // Drop the legacy `menuOpen` field if an older guard is loaded.
              delete state.menuOpen;
              target.webContents.send("player-media-state", {
                wcId: wc.id,
                state,
              });
            } catch {}
          } else if (text.includes("__GIGI_TOGGLE_FULLSCREEN__")) {
            target.webContents.send("player-command", {
              wcId: wc.id,
              command: "toggle-fullscreen",
            });
          } else if (text.includes("__GIGI_EXIT_FULLSCREEN__")) {
            target.webContents.send("player-command", {
              wcId: wc.id,
              command: "exit-fullscreen",
            });
          } else if (text.includes("__GIGI_POINTER__")) {
            target.webContents.send("player-command", {
              wcId: wc.id,
              command: "pointer-move",
            });
          }
        });
      }

      const allFrames = [];
      const collect = (frame) => {
        allFrames.push(frame);
        for (const child of frame.frames || []) collect(child);
      };
      collect(wc.mainFrame);

      await Promise.all(
        allFrames.map(async (frame) => {
          try {
            await frame.executeJavaScript(PLAYER_MENU_GUARD_JS);
          } catch {}
        }),
      );
      return true;
    } catch {
      return false;
    }
  });
}

// ── Central audio-device-change recovery (macOS HDMI/TV fix) ─────────────────
// When the user switches audio output (e.g. Speakers → HDMI TV), Chromium
// suspends every AudioContext in every session.

function registerAudioDeviceRecovery() {
  if (process.platform !== "darwin") return; // only needed on macOS

  const { session, webContents, ipcMain: ipc } = require("electron");

  const RECOVERY_JS = `
    (() => {
      async function recoverAudio() {
        const ctxs = window.__audioContexts || [];
        for (const ctx of ctxs) {
          try { if (ctx.state === 'suspended') await ctx.resume(); } catch {}
        }
        const v = document.querySelector('video');
        if (!v || v.paused) return;
        const t = v.currentTime;
        try {
          v.pause();
          await new Promise(r => setTimeout(r, 80));
          v.currentTime = t;
          await v.play();
        } catch {}
      }
      recoverAudio();
    })()
  `;

  const recoverAllWebContents = () => {
    for (const wc of webContents.getAllWebContents()) {
      if (wc.isDestroyed()) continue;
      wc.executeJavaScript(RECOVERY_JS).catch(() => {});
      try {
        for (const frame of wc.mainFrame?.framesInSubtree ?? []) {
          try {
            frame.executeJavaScript(RECOVERY_JS);
          } catch {}
        }
      } catch {}
    }
  };

  // Hook 1: Chromium's built-in device-selection event
  session.defaultSession.on(
    "select-audio-device",
    (event, details, callback) => {
      callback(""); // let Chromium pick the default, don't block
      setTimeout(recoverAllWebContents, 150);
    },
  );

  // Hook 2: renderer sends this when navigator.mediaDevices fires "devicechange"
  ipc.on("audio-device-changed", () => setTimeout(recoverAllWebContents, 150));
}

module.exports = {
  register,
  registerAudioDeviceRecovery,
  rememberStreamMeta,
  hasStreamMeta,
};
