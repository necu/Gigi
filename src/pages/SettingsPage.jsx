import { useState, useEffect, useRef } from "react";
import UpdateModal from "../components/UpdateModal";
import {
  storage,
  STORAGE_KEYS,
  secureStorage,
  isElectron,
  clearAppCaches,
} from "../utils/storage";
import { clearTmdbCache } from "../utils/api";
import {
  ACCENT_PRESETS,
  applyAccentColor,
  THEME_PRESETS,
  applyTheme,
  DEFAULT_CUSTOM_VARS,
} from "../utils/appearance";
import { SUBTITLE_LANGUAGES } from "../utils/subtitles";
import { DEFAULT_INVIDIOUS_BASE } from "../components/TrailerModal";
import { RATING_COUNTRIES } from "../utils/ageRating";
import { WarningIcon } from "../components/Icons";
import {
  checkForUpdatesWithFallback,
  UPDATE_SOURCES,
  DEFAULT_UPDATE_SOURCE,
} from "../utils/updates";
import {
  HOME_ROWS,
  loadHomeLayout,
  loadHomeViewMode,
  saveHomeViewMode,
} from "../utils/homeLayout";
import {
  collectFullBackup,
  restoreFullBackup,
  validateBackup,
} from "../utils/backup";
import { formatBytes } from "../utils/storage";
import { watchlistDb } from "../utils/watchlistDb";
import {
  loadPlayerPreferences,
  savePlayerPreferences,
  getIntroSkipMode,
} from "../utils/playerPreferences";
import {
  APP_LANGUAGES,
  setAppLanguage,
  translate,
  useAppLanguage,
  useT,
} from "../utils/i18n";

// Settings is made of many small components; a module-level helper keeps the
// translation calls uniform without adding a hook to every one of them.
const tr = (key, vars) => translate(key, vars);

// ── Custom Select ─────────────────────────────────────────────────────────────
function SettingsSelect({ value, onChange, options, style }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selectedLabel =
    options.find((o) => String(o.value) === String(value))?.label ?? value;

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div
      ref={ref}
      style={{ position: "relative", display: "inline-block", ...style }}
    >
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 28,
          padding: "9px 14px",
          background: open ? "var(--surface3)" : "var(--surface2)",
          border: `1px solid ${open ? "var(--red)" : "var(--border)"}`,
          boxShadow: open ? "0 0 0 3px rgba(229,9,20,0.12)" : "none",
          borderRadius: 8,
          color: "var(--text)",
          fontFamily: "var(--font-body)",
          fontSize: 14,
          cursor: "pointer",
          whiteSpace: "nowrap",
          minWidth: 0,
          transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.background = "var(--surface3)";
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.background = "var(--surface2)";
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {selectedLabel}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text3)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            flexShrink: 0,
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 999,
            background: "var(--surface3)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
            minWidth: "100%",
            maxHeight: 280,
            overflowY: "auto",
            padding: "4px",
          }}
        >
          {options.map((o) => {
            const active = String(o.value) === String(value);
            return (
              <div
                key={o.value}
                onMouseDown={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                style={{
                  padding: "8px 12px",
                  fontSize: 14,
                  borderRadius: 7,
                  cursor: "pointer",
                  color: active ? "var(--red)" : "var(--text)",
                  background: active ? "rgba(229,9,20,0.10)" : "transparent",
                  fontWeight: active ? 600 : 400,
                  transition: "background 0.1s, color 0.1s",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => {
                  if (!active)
                    e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = "transparent";
                }}
              >
                {o.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Start page config ─────────────────────────────────────────────────────────

// Age limit options: null = none, or specific ages
const ageLimitOptions = () => [
  { value: "", label: tr("settings.age.none") },
  { value: "0", label: tr("settings.age.0") },
  { value: "7", label: tr("settings.age.7") },
  { value: "12", label: tr("settings.age.12") },
  { value: "13", label: tr("settings.age.13") },
  { value: "15", label: tr("settings.age.15") },
  { value: "16", label: tr("settings.age.16") },
  { value: "17", label: tr("settings.age.17") },
  { value: "18", label: tr("settings.age.18") },
];

// ── Confirmation Dialog ───────────────────────────────────────────────────────
function ResetConfirmDialog({ onConfirm, onCancel }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "36px 40px",
          maxWidth: 460,
          width: "90%",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        }}
      >
        {/* Warning icon */}
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "rgba(229,9,20,0.12)",
            border: "1px solid rgba(229,9,20,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 20,
          }}
        >
          <WarningIcon size={24} />
        </div>

        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 26,
            letterSpacing: 1,
            marginBottom: 10,
          }}
        >
          {tr("settings.resetGigi")}
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--text2)",
            lineHeight: 1.7,
            marginBottom: 28,
          }}
        >
          This will permanently delete all your settings, watch history, saved
          titles, progress data, and cached data. Your downloaded video files
          will{" "}
          <span style={{ color: "var(--text)", fontWeight: 600 }}>not</span> be
          deleted.
          <br />
          <br />
          <span style={{ color: "var(--red)" }}>
            {tr("settings.thisActionCannotBeUndone")}
          </span>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <button
            className="btn btn-ghost"
            style={{ flex: 1 }}
            onClick={onCancel}
          >
            {tr("settings.cancel")}
          </button>
          <button
            className="btn"
            style={{
              flex: 1,
              background: "var(--red)",
              color: "#fff",
              border: "none",
              fontWeight: 600,
            }}
            onClick={onConfirm}
          >
            {tr("settings.yesResetEverything")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Generic Confirm Dialog ───────────────────────────────────────────────────
function ConfirmDialog({
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "36px 40px",
          maxWidth: 460,
          width: "90%",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "rgba(229,9,20,0.12)",
            border: "1px solid rgba(229,9,20,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 20,
          }}
        >
          <WarningIcon size={24} />
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 22,
            letterSpacing: 1,
            marginBottom: 10,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--text2)",
            lineHeight: 1.7,
            marginBottom: 28,
          }}
        >
          {description}
          <br />
          <br />
          <span style={{ color: "var(--red)" }}>
            {tr("settings.thisActionCannotBeUndone")}
          </span>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button
            className="btn btn-ghost"
            style={{ flex: 1 }}
            onClick={onCancel}
          >
            {tr("settings.cancel")}
          </button>
          <button
            className="btn"
            style={{
              flex: 1,
              background: "var(--red)",
              color: "#fff",
              border: "none",
              fontWeight: 600,
            }}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Toggle Switch ─────────────────────────────────────────────────────────────
function Toggle({ value, onChange, title }) {
  return (
    <button
      onClick={() => onChange(!value)}
      title={title}
      style={{
        background: value ? "var(--red)" : "var(--surface2)",
        border: "1px solid " + (value ? "var(--red)" : "var(--border)"),
        borderRadius: 20,
        width: 40,
        height: 22,
        cursor: "pointer",
        position: "relative",
        flexShrink: 0,
        transition: "background 0.2s, border-color 0.2s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: value ? 20 : 2,
          width: 16,
          height: 16,
          background: "#fff",
          borderRadius: "50%",
          transition: "left 0.2s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        }}
      />
    </button>
  );
}

// ── Status Badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  if (!status) return null;
  const isError = status.startsWith("✕");
  return (
    <div
      style={{
        marginTop: 10,
        fontSize: 13,
        fontWeight: 500,
        color: isError ? "var(--red)" : "#48c774",
      }}
    >
      {status}
    </div>
  );
}

// ── Clean Row ─────────────────────────────────────────────────────────────────
function CleanRow({
  title,
  description,
  buttonLabel,
  onAction,
  danger,
  sizeLabel,
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [hovered, setHovered] = useState(false);

  const handle = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await onAction();
      if (result?.cancelled) {
        // User dismissed the confirm dialog
        return;
      }
      setStatus(result?.msg || "✓ Done");
      setTimeout(() => setStatus(null), 4000);
    } catch (e) {
      setStatus("✕ " + (e.message || "Something went wrong"));
      setTimeout(() => setStatus(null), 4000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 24,
      }}
    >
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: "var(--text)",
            marginBottom: 4,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          {title}
          {sizeLabel && (
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text2)",
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "3px 10px",
                letterSpacing: 0.2,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {sizeLabel}
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, color: "var(--text3)", lineHeight: 1.6 }}>
          {description}
        </div>
        <StatusBadge status={status} />
      </div>
      <div style={{ flexShrink: 0, paddingTop: 2 }}>
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={handle}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={
            danger
              ? {
                  color: hovered ? "#fff" : "var(--red)",
                  background: hovered ? "rgba(229,9,20,0.85)" : "transparent",
                  borderColor: hovered ? "transparent" : "rgba(229,9,20,0.35)",
                  opacity: busy ? 0.5 : 1,
                  transition: "all 0.2s",
                }
              : { opacity: busy ? 0.5 : 1 }
          }
        >
          {busy ? tr("settings.working") : buttonLabel}
        </button>
      </div>
    </div>
  );
}

// ── Language Section ──────────────────────────────────────────────────────────
function LanguageSection() {
  const t = useT();
  const language = useAppLanguage();

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">{t("settings.language")}</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        {t("settings.languageDesc")}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {APP_LANGUAGES.map((option) => {
          const active = language === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setAppLanguage(option.id)}
              aria-pressed={active}
              style={{
                minWidth: 150,
                padding: "12px 16px",
                borderRadius: 10,
                border: `1.5px solid ${active ? "var(--red)" : "var(--border)"}`,
                background: active
                  ? "color-mix(in srgb, var(--red) 14%, var(--surface2))"
                  : "var(--surface2)",
                color: active ? "var(--text)" : "var(--text2)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 18,
                font: "inherit",
                fontSize: 14,
                fontWeight: active ? 700 : 500,
                transition: "border-color 0.15s, background 0.15s",
              }}
            >
              <span>{option.label}</span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: 0.6,
                  color: active ? "var(--red)" : "var(--text3)",
                }}
              >
                {option.short}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Version & Update Section ──────────────────────────────────────────────────
function VersionSection() {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null); // { latest, current, url, hasUpdate } | { error }
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [autoCheck, setAutoCheck] = useState(() => {
    const stored = storage.get(STORAGE_KEYS.AUTO_CHECK_UPDATES);
    return stored === null || stored === undefined ? true : !!stored;
  });
  const [autoSaved, setAutoSaved] = useState(false);
  const [currentVersion, setCurrentVersion] = useState("0.0.0");
  const [updateSource, setUpdateSource] = useState(() => {
    const stored = storage.get(STORAGE_KEYS.UPDATE_SOURCE);
    return UPDATE_SOURCES[stored] ? stored : DEFAULT_UPDATE_SOURCE;
  });

  useEffect(() => {
    if (window.electron?.getAppVersion) {
      window.electron.getAppVersion().then((v) => {
        setCurrentVersion(v);
      });
    }
  }, []);

  const runCheck = async () => {
    setChecking(true);
    setResult(null);
    try {
      const r = await checkForUpdatesWithFallback(updateSource);
      setResult(r);
    } catch (e) {
      setResult({
        error:
          e.message ||
          `Could not reach ${UPDATE_SOURCES[updateSource]?.label || "the update server"}.`,
      });
    } finally {
      setChecking(false);
    }
  };

  const changeSource = (src) => {
    setUpdateSource(src);
    storage.set(STORAGE_KEYS.UPDATE_SOURCE, src);
    setResult(null);
  };

  const toggleAuto = (val) => {
    setAutoCheck(val);
    storage.set(STORAGE_KEYS.AUTO_CHECK_UPDATES, val ? 1 : 0);
    setAutoSaved(true);
    setTimeout(() => setAutoSaved(false), 1800);
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">{tr("settings.appVersion")}</div>

      {/* Version row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: "var(--text3)" }}>
            {tr("settings.currentVersion")}
          </span>
          <code
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "var(--text)",
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "4px 12px",
            }}
          >
            v{currentVersion}
          </code>
        </div>

        <button
          className="btn btn-ghost"
          disabled={checking}
          onClick={runCheck}
          style={{ opacity: checking ? 0.6 : 1 }}
        >
          {checking ? tr("settings.checking") : tr("settings.checkUpdates")}
        </button>

        {/* Update source toggle */}
        <div
          style={{
            display: "inline-flex",
            border: "1px solid var(--border)",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          {Object.values(UPDATE_SOURCES).map((src) => (
            <button
              key={src.id}
              onClick={() => changeSource(src.id)}
              disabled={checking}
              title={`Check for updates via ${src.label}`}
              style={{
                border: "none",
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 600,
                cursor: checking ? "not-allowed" : "pointer",
                background:
                  updateSource === src.id ? "var(--red)" : "var(--surface2)",
                color: updateSource === src.id ? "#fff" : "var(--text3)",
              }}
            >
              {src.label}
            </button>
          ))}
        </div>

        {result && !result.error && result.hasUpdate && (
          <button
            onClick={() => setShowUpdateModal(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "rgba(229,9,20,0.12)",
              border: "1px solid rgba(229,9,20,0.4)",
              color: "var(--red)",
              borderRadius: 8,
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              transition: "background 0.2s",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "rgba(229,9,20,0.22)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "rgba(229,9,20,0.12)")
            }
          >
            🎉 v{result.latest} {tr("settings.updateAvailable")}
          </button>
        )}

        {result?.usedFallback && (
          <span style={{ fontSize: 12, color: "var(--text3)" }}>
            ({UPDATE_SOURCES[result.fallbackFrom]?.label || result.fallbackFrom}{" "}
            unavailable, used {result.sourceLabel} instead)
          </span>
        )}

        {result && !result.error && !result.hasUpdate && (
          <span style={{ fontSize: 13, color: "#48c774", fontWeight: 500 }}>
            {tr("settings.upToDate")}
          </span>
        )}

        {result?.error && (
          <span style={{ fontSize: 13, color: "var(--red)" }}>
            ✕ {result.error}
          </span>
        )}
      </div>

      {showUpdateModal && result?.hasUpdate && (
        <UpdateModal
          updateInfo={result}
          onClose={() => setShowUpdateModal(false)}
        />
      )}

      {/* Auto-check toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <Toggle
          value={autoCheck}
          onChange={toggleAuto}
          title={autoCheck ? "Disable auto-check" : "Enable auto-check"}
        />
        <div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>
            {tr("settings.checkForUpdatesOnStartup")}
          </div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
            {tr("settings.autoCheckDesc")}
          </div>
        </div>
        {autoSaved && (
          <span style={{ fontSize: 12, color: "#48c774" }}>✓ {tr("settings.saved")}</span>
        )}
      </div>
    </div>
  );
}

// ── Home Layout Section ───────────────────────────────────────────────────────
function HomeLayoutSection() {
  const [order, setOrder] = useState(() => {
    const { order: o } = loadHomeLayout();
    return o;
  });
  const [visible, setVisible] = useState(() => {
    const { visible: v } = loadHomeLayout();
    return v;
  });
  const [viewMode, setViewMode] = useState(() => loadHomeViewMode());
  const [saved, setSaved] = useState(false);
  const dragItem = useRef(null);
  const dragOver = useRef(null);

  const handleDragStart = (idx) => {
    dragItem.current = idx;
  };
  const handleDragEnter = (idx) => {
    dragOver.current = idx;
  };
  const handleDragEnd = () => {
    const newOrder = [...order];
    const dragged = newOrder.splice(dragItem.current, 1)[0];
    newOrder.splice(dragOver.current, 0, dragged);
    dragItem.current = null;
    dragOver.current = null;
    setOrder(newOrder);
  };

  const toggleVisible = (id) => {
    setVisible((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSave = () => {
    storage.set(STORAGE_KEYS.HOME_ROW_ORDER, order);
    storage.set(STORAGE_KEYS.HOME_ROW_VISIBLE, visible);
    saveHomeViewMode(viewMode);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const rowLabels = Object.fromEntries(HOME_ROWS.map((r) => [r.id, r.label]));

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">{tr("settings.homePageLayout")}</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        {tr("settings.homeLayoutDesc")}
      </div>

      {/* ── View mode selector ── */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text2)",
            marginBottom: 8,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {tr("settings.rowDisplayStyle")}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {[
            {
              value: "carousel",
              label: tr("settings.view.carousel"),
              desc: tr("settings.view.carouselDesc"),
            },
            {
              value: "list",
              label: tr("settings.view.list"),
              desc: tr("settings.view.listDesc"),
            },
          ].map(({ value, label, desc }) => (
            <button
              key={value}
              onClick={() => setViewMode(value)}
              style={{
                flex: 1,
                maxWidth: 220,
                padding: "10px 14px",
                borderRadius: 8,
                border: `2px solid ${viewMode === value ? "var(--red)" : "var(--border)"}`,
                background:
                  viewMode === value
                    ? "color-mix(in srgb, var(--red) 12%, var(--surface))"
                    : "var(--surface)",
                color: viewMode === value ? "var(--text)" : "var(--text2)",
                cursor: "pointer",
                textAlign: "left",
                transition: "border-color 0.15s, background 0.15s",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14 }}>{label}</div>
              <div
                style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}
              >
                {desc}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxWidth: 480,
        }}
      >
        {order.map((id, idx) => (
          <div
            key={id}
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragEnter={() => handleDragEnter(idx)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => e.preventDefault()}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "10px 14px",
              cursor: "grab",
              opacity: visible[id] ? 1 : 0.45,
              transition: "opacity 0.2s",
              userSelect: "none",
            }}
          >
            {/* Drag handle */}
            <span
              style={{
                color: "var(--text3)",
                fontSize: 16,
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              ⠿
            </span>

            {/* Label */}
            <span
              style={{
                flex: 1,
                fontSize: 14,
                fontWeight: 500,
                color: "var(--text)",
              }}
            >
              {tr(`homeRow.${id}`) || rowLabels[id] || id}
            </span>

            {/* Toggle */}
            <Toggle
              value={visible[id]}
              onChange={() => toggleVisible(id)}
              title={visible[id] ? tr("settings.hideRow") : tr("settings.showRow")}
            />
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 16,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <button className="btn btn-primary" onClick={handleSave}>
          {tr("settings.saveLayout")}
        </button>
        {saved && (
          <span style={{ fontSize: 13, color: "#48c774" }}>✓ {tr("settings.saved")}</span>
        )}
      </div>
    </div>
  );
}

// ── Scheduled Backup Section ──────────────────────────────────────────────────
const frequencyOptions = () => [
  { value: "startup", label: tr("settings.freq.startup") },
  { value: "daily", label: tr("settings.freq.daily") },
  { value: "weekly", label: tr("settings.freq.weekly") },
  { value: "monthly", label: tr("settings.freq.monthly") },
];

function ScheduledBackupSection() {
  const [enabled, setEnabled] = useState(false);
  const [backupPath, setBackupPath] = useState("");
  const [keepCount, setKeepCount] = useState(5);
  const [frequency, setFrequency] = useState("startup");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isElectron) {
      setLoading(false);
      return;
    }
    window.electron.getScheduledBackupSettings().then((s) => {
      if (s) {
        setEnabled(!!s.enabled);
        setBackupPath(s.path || "");
        setKeepCount(s.keepCount ?? 5);
        setFrequency(s.frequency || "startup");
      }
      setLoading(false);
    });
  }, []);

  const pickFolder = async () => {
    if (!isElectron) return;
    const folder = await window.electron.pickFolder();
    if (folder) setBackupPath(folder);
  };

  const handleSave = async () => {
    if (!isElectron) return;
    const settings = {
      enabled,
      path: backupPath,
      keepCount: Math.max(1, Math.min(99, Number(keepCount) || 5)),
      frequency,
      lastRun: null,
    };
    // preserve lastRun from existing settings
    const existing = await window.electron.getScheduledBackupSettings();
    if (existing?.lastRun) settings.lastRun = existing.lastRun;
    await window.electron.setScheduledBackupSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!isElectron || loading) return null;

  return (
    <div
      style={{
        marginTop: 28,
        padding: "20px 22px",
        background: "var(--surface2)",
        border: "1px solid var(--border)",
        borderRadius: 10,
      }}
    >
      {/* Header row with toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: enabled ? 20 : 0,
        }}
      >
        <Toggle value={enabled} onChange={setEnabled} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
            {tr("settings.scheduledBackups")}
          </div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
            {tr("settings.automaticallySaveABackupFileOnASchedule")}
          </div>
        </div>
      </div>

      {enabled && (
        <>
          {/* Backup path */}
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--text2)",
                marginBottom: 6,
              }}
            >
              {tr("settings.backupFolder")}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                className="apikey-input"
                style={{ flex: 1, marginBottom: 0 }}
                placeholder="/home/you/Backups"
                value={backupPath}
                onChange={(e) => setBackupPath(e.target.value)}
              />
              <button
                className="btn btn-ghost"
                style={{ padding: "7px 14px", fontSize: 13 }}
                onClick={pickFolder}
              >
                {tr("settings.browse")}
              </button>
            </div>
          </div>

          {/* Frequency + Keep count row */}
          <div
            style={{
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
              marginBottom: 16,
            }}
          >
            <div style={{ flex: 1, minWidth: 160 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text2)",
                  marginBottom: 6,
                }}
              >
                {tr("settings.frequency")}
              </div>
              <SettingsSelect
                value={frequency}
                onChange={(v) => setFrequency(v)}
                options={frequencyOptions()}
                style={{ width: "100%" }}
              />
            </div>

            <div style={{ flex: 1, minWidth: 120 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text2)",
                  marginBottom: 6,
                }}
              >
                {tr("settings.keepLastNBackups")}
              </div>
              <input
                type="number"
                min={1}
                max={99}
                className="apikey-input"
                style={{ width: "100%", marginBottom: 0 }}
                value={keepCount}
                onChange={(e) => setKeepCount(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button className="btn btn-primary" onClick={handleSave}>
              {tr("settings.save")}
            </button>
            {saved && (
              <span style={{ fontSize: 13, color: "#48c774" }}>✓ {tr("settings.saved")}</span>
            )}
          </div>
        </>
      )}

      {!enabled && (
        <div
          style={{ display: "flex", justifyContent: "flex-end", marginTop: 0 }}
        >
          {/* empty, toggle handles everything */}
        </div>
      )}
    </div>
  );
}

// ── Backup & Restore ─────────────────────────────────────────────────────────
function LibraryMaintenanceSection() {
  const [stats, setStats] = useState(null);
  const [playlistCount, setPlaylistCount] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const [nextStats, playlists] = await Promise.all([
      watchlistDb.stats(),
      watchlistDb.playlists(),
    ]);
    setStats(nextStats);
    setPlaylistCount(Array.isArray(playlists) ? playlists.length : null);
  };

  useEffect(() => {
    refresh();
  }, []);

  const run = async (action) => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await action();
      if (!result?.ok) {
        setStatus("✕ " + (result?.error || "The database is unavailable."));
      }
      await refresh();
    } catch (error) {
      setStatus("✕ " + (error?.message || "The operation failed."));
    } finally {
      setBusy(false);
    }
  };

  const checkIntegrity = () =>
    run(async () => {
      const result = await watchlistDb.integrity();
      const healthy =
        result?.ok &&
        Array.isArray(result.result) &&
        result.result.every((value) => value === "ok");
      setStatus(
        healthy
          ? "✓ Library database is healthy."
          : "✕ Integrity check reported an issue.",
      );
      return result;
    });

  const optimize = () =>
    run(async () => {
      const result = await watchlistDb.checkpoint();
      if (result?.ok) setStatus("✓ Database optimized.");
      return result;
    });

  const cleanUp = () =>
    run(async () => {
      const result = await watchlistDb.prune();
      if (result?.ok) setStatus("✓ Unused tags and collections removed.");
      return result;
    });

  const stat = (label, value) => (
    <div
      style={{
        minWidth: 92,
        padding: "10px 12px",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--surface2)",
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
        {label}
      </div>
    </div>
  );

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">{tr("settings.libraryDatabase")}</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        {tr("settings.databaseDesc")}
      </div>

      {stats?.available ? (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {stat(tr("settings.stats.titles"), stats.entries)}
            {stat(tr("settings.stats.tags"), stats.tags)}
            {stat(tr("settings.stats.collections"), stats.collections)}
            {stat(tr("settings.stats.playlists"), playlistCount ?? "—")}
            {stat(tr("settings.stats.onDisk"), formatBytes(stats.sizeBytes || 0))}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              className="btn btn-primary"
              onClick={checkIntegrity}
              disabled={busy}
            >
              {tr("settings.checkIntegrity")}
            </button>
            <button className="btn btn-ghost" onClick={optimize} disabled={busy}>
              {tr("settings.optimize")}
            </button>
            <button className="btn btn-ghost" onClick={cleanUp} disabled={busy}>
              {tr("settings.cleanUnusedTags")}
            </button>
          </div>
          {stats.path && (
            <div
              style={{
                marginTop: 12,
                fontSize: 11,
                color: "var(--text3)",
                wordBreak: "break-all",
              }}
            >
              {stats.path}
            </div>
          )}
        </>
      ) : (
        <div
          style={{
            padding: "12px 14px",
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--surface2)",
            color: "var(--text3)",
            fontSize: 13,
          }}
        >
          {tr("settings.sqliteFallback")}
        </div>
      )}

      {status && (
        <div
          style={{
            marginTop: 12,
            fontSize: 13,
            color: status.startsWith("✕") ? "var(--red)" : "#48c774",
          }}
        >
          {status}
        </div>
      )}
    </div>
  );
}

function BackupRestoreSection({ onRestored }) {
  const [restoreStatus, setRestoreStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    setBusy(true);
    try {
      const backup = await collectFullBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gigi-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setRestoreStatus(
        `✓ Exported settings, library and ${backup.playlists?.length || 0} playlist(s).`,
      );
      setTimeout(() => setRestoreStatus(null), 5000);
    } catch (err) {
      setRestoreStatus("✕ " + (err.message || "Could not export backup."));
    } finally {
      setBusy(false);
    }
  };

  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const backup = validateBackup(JSON.parse(ev.target.result));
        const result = await restoreFullBackup(backup);
        const suffix = result.warnings.length
          ? ` (${result.warnings[0]})`
          : "";
        setRestoreStatus(`✓ Backup restored${suffix}: reloading…`);
        setTimeout(() => window.location.reload(), 1400);
        onRestored?.();
      } catch (err) {
        setRestoreStatus("✕ " + (err.message || "Could not read backup file."));
        setTimeout(() => setRestoreStatus(null), 5000);
      } finally {
        setBusy(false);
      }
    };
    reader.onerror = () => {
      setRestoreStatus("✕ Could not read the selected file.");
      setBusy(false);
    };
    reader.readAsText(file);
    // Reset input so same file can be re-selected
    e.target.value = "";
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">{tr("settings.backupAndRestore")}</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 20,
          lineHeight: 1.6,
        }}
      >
        {tr("settings.backupDesc")}
      </div>
      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <button
          className="btn btn-primary"
          onClick={handleExport}
          disabled={busy}
        >
          {busy ? tr("settings.working") : `⬆ ${tr("settings.exportBackup")}`}
        </button>
        <label
          aria-disabled={busy}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 18px",
            background: "var(--surface2)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text)",
            cursor: busy ? "wait" : "pointer",
            opacity: busy ? 0.65 : 1,
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--surface)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "var(--surface2)")
          }
        >
          ⬇ {tr("settings.importBackup")}
          <input
            type="file"
            accept=".json,application/json"
            onChange={handleImport}
            disabled={busy}
            style={{ display: "none" }}
          />
        </label>
        {restoreStatus && (
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: restoreStatus.startsWith("✕") ? "var(--red)" : "#48c774",
            }}
          >
            {restoreStatus}
          </span>
        )}
      </div>
      <ScheduledBackupSection />
    </div>
  );
}

// ── Start Page Section ────────────────────────────────────────────────────────
// ── Appearance Section ────────────────────────────────────────────────────────
function AppearanceSection() {
  const t = useT();
  const [accent, setAccent] = useState(
    () => storage.get(STORAGE_KEYS.ACCENT_COLOR) || "red",
  );
  const [fontSize, setFontSize] = useState(
    () => storage.get(STORAGE_KEYS.FONT_SIZE) || "normal",
  );
  const [compact, setCompact] = useState(
    () => !!storage.get(STORAGE_KEYS.COMPACT_MODE),
  );
  const [noAnim, setNoAnim] = useState(
    () => !!storage.get(STORAGE_KEYS.REDUCE_ANIMATIONS),
  );
  const [gamepadEnabled, setGamepadEnabled] = useState(
    () => storage.get(STORAGE_KEYS.GAMEPAD_ENABLED) !== false,
  );
  const [accentInPlayer, setAccentInPlayer] = useState(
    () => storage.get(STORAGE_KEYS.ACCENT_IN_PLAYER) !== false,
  );
  const [theme, setTheme] = useState(
    () => storage.get(STORAGE_KEYS.THEME) || "dark",
  );
  const [customVars, setCustomVars] = useState(
    () =>
      storage.get(STORAGE_KEYS.CUSTOM_THEME_VARS) || { ...DEFAULT_CUSTOM_VARS },
  );
  const [showCustomEditor, setShowCustomEditor] = useState(false);
  const [saved, setSaved] = useState(false);

  // Remember the committed (saved) values to revert on unmount if unsaved
  const committedRef = useRef({
    accent: storage.get(STORAGE_KEYS.ACCENT_COLOR) || "red",
    theme: storage.get(STORAGE_KEYS.THEME) || "dark",
    customVars: storage.get(STORAGE_KEYS.CUSTOM_THEME_VARS) || {
      ...DEFAULT_CUSTOM_VARS,
    },
  });
  const savedRef = useRef(false);

  // Revert live preview when leaving without saving
  useEffect(() => {
    return () => {
      if (!savedRef.current) {
        const { accent, theme, customVars } = committedRef.current;
        applyAccentColor(accent);
        applyTheme(theme, theme === "custom" ? customVars : null);
      }
    };
  }, []);

  const handleThemeSelect = (id) => {
    setTheme(id);
    if (id !== "custom") {
      applyTheme(id);
    } else {
      applyTheme("custom", customVars);
      setShowCustomEditor(true);
    }
  };

  const handleCustomVarChange = (prop, value) => {
    const next = { ...customVars, [prop]: value };
    setCustomVars(next);
    applyTheme("custom", next);
  };

  const handleSave = () => {
    storage.set(STORAGE_KEYS.ACCENT_COLOR, accent);
    storage.set(STORAGE_KEYS.ACCENT_IN_PLAYER, accentInPlayer);
    storage.set(STORAGE_KEYS.FONT_SIZE, fontSize);
    storage.set(STORAGE_KEYS.COMPACT_MODE, compact ? 1 : 0);
    storage.set(STORAGE_KEYS.REDUCE_ANIMATIONS, noAnim ? 1 : 0);
    storage.set(STORAGE_KEYS.GAMEPAD_ENABLED, gamepadEnabled);
    window.dispatchEvent(new CustomEvent("streambert:gamepad-settings-changed"));
    storage.set(STORAGE_KEYS.THEME, theme);
    if (theme === "custom") {
      storage.set(STORAGE_KEYS.CUSTOM_THEME_VARS, customVars);
    }
    // Apply immediately
    applyAccentColor(accent);
    applyTheme(theme, theme === "custom" ? customVars : null);
    const zoomMap = { sm: 0.85, normal: 1, lg: 1.15 };
    if (window.electron?.setZoomFactor)
      window.electron.setZoomFactor(zoomMap[fontSize] ?? 1);
    document.body.classList.toggle("compact-mode", compact);
    document.body.classList.toggle("no-anim", noAnim);
    // Mark as saved so the cleanup effect doesn't revert
    savedRef.current = true;
    committedRef.current = { accent, theme, customVars };
    // Notify App.jsx so playerSettings prop (accent + lang) is refreshed
    window.dispatchEvent(new CustomEvent("streambert:player-settings-changed"));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const CUSTOM_VAR_LABELS = {
    "--bg": "Background",
    "--surface": "Surface",
    "--surface2": "Surface 2",
    "--surface3": "Surface 3",
    "--border": "Border",
    "--text": "Text",
    "--text2": "Text 2",
    "--text3": "Text 3",
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">{t("settings.appearance")}</div>

      {/* Theme */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text2)",
            marginBottom: 10,
          }}
        >
          {t("settings.theme")}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {THEME_PRESETS.map((t) => (
            <button
              key={t.id}
              onClick={() => handleThemeSelect(t.id)}
              title={tr(`settings.themeDesc.${t.id}`)}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                padding: "10px 14px",
                borderRadius: "var(--radius)",
                background:
                  theme === t.id
                    ? "color-mix(in srgb, var(--red) 15%, var(--surface2))"
                    : "var(--surface2)",
                border:
                  theme === t.id
                    ? "1.5px solid var(--red)"
                    : "1.5px solid var(--border)",
                cursor: "pointer",
                transition: "border-color 0.15s, background 0.15s",
                minWidth: 70,
              }}
            >
              {/* Mini preview swatch */}
              <div
                style={{
                  width: 40,
                  height: 28,
                  borderRadius: 4,
                  background:
                    t.id === "custom"
                      ? `linear-gradient(135deg, ${customVars["--bg"]} 50%, ${customVars["--surface2"]} 50%)`
                      : t.vars
                        ? `linear-gradient(135deg, ${t.vars["--bg"]} 50%, ${t.vars["--surface2"]} 50%)`
                        : "var(--surface3)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: theme === t.id ? 600 : 400,
                  color: theme === t.id ? "var(--text)" : "var(--text2)",
                  whiteSpace: "nowrap",
                }}
              >
                {t.label}
              </span>
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 8 }}>
          {tr(`settings.themeDesc.${theme}`)}
        </div>
      </div>

      {/* Custom theme editor */}
      {theme === "custom" && (
        <div style={{ marginBottom: 24 }}>
          <button
            onClick={() => setShowCustomEditor((v) => !v)}
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: "5px 12px", marginBottom: 12 }}
          >
            {showCustomEditor ? "▲" : "▼"} {t("settings.customColours")}
          </button>
          {showCustomEditor && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                gap: 12,
                padding: 16,
                background: "var(--surface2)",
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
              }}
            >
              {Object.entries(CUSTOM_VAR_LABELS).map(([prop, label]) => (
                <div
                  key={prop}
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <input
                    type="color"
                    value={customVars[prop] || "#000000"}
                    onChange={(e) =>
                      handleCustomVarChange(prop, e.target.value)
                    }
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 4,
                      border: "1px solid var(--border)",
                      cursor: "pointer",
                      background: "none",
                      padding: 2,
                      flexShrink: 0,
                    }}
                  />
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--text)",
                        fontWeight: 500,
                      }}
                    >
                      {label}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text3)",
                        fontFamily: "monospace",
                      }}
                    >
                      {customVars[prop]}
                    </div>
                  </div>
                </div>
              ))}
              <div
                style={{
                  gridColumn: "1 / -1",
                  display: "flex",
                  gap: 8,
                  marginTop: 4,
                }}
              >
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: "5px 12px" }}
                  onClick={() => {
                    setCustomVars({ ...DEFAULT_CUSTOM_VARS });
                    applyTheme("custom", DEFAULT_CUSTOM_VARS);
                  }}
                >
                  {t("settings.resetDefaults")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Accent Colour */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text2)",
            marginBottom: 10,
          }}
        >
          {t("settings.accent")}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {ACCENT_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setAccent(p.id);
                applyAccentColor(p.id);
              }}
              title={p.label}
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: p.color,
                border:
                  accent === p.id
                    ? `3px solid var(--text)`
                    : "3px solid transparent",
                outline: accent === p.id ? `2px solid ${p.color}` : "none",
                outlineOffset: 2,
                cursor: "pointer",
                transition: "transform 0.15s",
                transform: accent === p.id ? "scale(1.15)" : "scale(1)",
                flexShrink: 0,
              }}
            />
          ))}
        </div>
        <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 8 }}>
          {ACCENT_PRESETS.find((p) => p.id === accent)?.label} ·{" "}
          {t("settings.accentDesc")}
        </div>
        {/* Accent in streaming player */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 14,
          }}
        >
          <Toggle value={accentInPlayer} onChange={setAccentInPlayer} />
          <div>
            <div
              style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}
            >
              {t("settings.accentInPlayer")}
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
              {t("settings.accentPlayerDesc")}
            </div>
          </div>
        </div>
      </div>

      {/* Font Size */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text2)",
            marginBottom: 10,
          }}
        >
          {t("settings.fontSize")}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { id: "sm", label: t("settings.small") },
            { id: "normal", label: t("settings.normal") },
            { id: "lg", label: t("settings.large") },
          ].map((o) => (
            <button
              key={o.id}
              onClick={() => setFontSize(o.id)}
              className={
                fontSize === o.id ? "btn btn-primary" : "btn btn-ghost"
              }
              style={{
                padding: "7px 18px",
                fontSize: o.id === "sm" ? 12 : o.id === "lg" ? 16 : 14,
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Toggles */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Toggle value={compact} onChange={setCompact} />
          <div>
            <div
              style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}
            >
              {t("settings.compactGrid")}
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
              {t("settings.compactGridDesc")}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Toggle value={noAnim} onChange={setNoAnim} />
          <div>
            <div
              style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}
            >
              {t("settings.reduceAnimations")}
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
              {t("settings.reduceAnimationsDesc")}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Toggle value={gamepadEnabled} onChange={setGamepadEnabled} />
          <div>
            <div
              style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}
            >
              {t("settings.controller")}
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
              {t("settings.controllerDesc")}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn-primary" onClick={handleSave}>
          {t("common.save")}
        </button>
        {saved && (
          <span style={{ fontSize: 13, color: "#48c774" }}>
            ✓ {t("settings.saved")}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Library & Privacy Section ─────────────────────────────────────────────────
function LibraryPrivacySection() {
  const [sort, setSort] = useState(
    () => storage.get(STORAGE_KEYS.LIBRARY_SORT) || "manual",
  );
  const [historyEnabled, setHistoryEnabled] = useState(() => {
    const v = storage.get(STORAGE_KEYS.HISTORY_ENABLED);
    return v === 0 || v === false ? false : true;
  });
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    storage.set(STORAGE_KEYS.LIBRARY_SORT, sort);
    storage.set(STORAGE_KEYS.HISTORY_ENABLED, historyEnabled ? 1 : 0);
    window.dispatchEvent(
      new CustomEvent("streambert:library-sort-changed", { detail: sort }),
    );
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const SORT_OPTIONS = [
    { value: "manual", label: tr("settings.sort.custom") },
    { value: "title", label: tr("settings.sort.title") },
    { value: "rating", label: tr("settings.sort.topRated") },
    { value: "year", label: tr("settings.sort.newest") },
  ];

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">{tr("settings.libraryAndPrivacy")}</div>

      {/* Watchlist Sort */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text2)",
            marginBottom: 8,
          }}
        >
          {tr("settings.watchlistSortOrder")}
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--text3)",
            marginBottom: 12,
            lineHeight: 1.6,
          }}
        >
          {tr("settings.librarySortDesc")}
        </div>
        <SettingsSelect
          value={sort}
          onChange={(v) => setSort(v)}
          options={SORT_OPTIONS}
        />
      </div>

      {/* Watch History Toggle */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Toggle value={historyEnabled} onChange={setHistoryEnabled} />
          <div>
            <div
              style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}
            >
              {tr("settings.recordWatchHistory")}
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
              {tr("settings.historyDesc")}
            </div>
          </div>
        </div>
        {!historyEnabled && (
          <div
            style={{
              marginTop: 12,
              fontSize: 13,
              color: "var(--red)",
              background: "rgba(229,9,20,0.08)",
              border: "1px solid rgba(229,9,20,0.2)",
              borderRadius: 8,
              padding: "10px 14px",
            }}
          >
            ⚠ Watch history is disabled. Progress tracking and "Continue
            Watching" will not work.
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn-primary" onClick={handleSave}>
          {tr("settings.save")}
        </button>
        {saved && (
          <span style={{ fontSize: 13, color: "#48c774" }}>✓ {tr("settings.saved")}</span>
        )}
      </div>
    </div>
  );
}

function StartPageSection() {
  const [startPage, setStartPage] = useState(
    () => storage.get(STORAGE_KEYS.START_PAGE) || "home",
  );
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    storage.set(STORAGE_KEYS.START_PAGE, startPage);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">{tr("settings.startPage")}</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        {tr("settings.chooseWhichPageOpensWhenYouLaunchGigi")}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <SettingsSelect
          value={startPage}
          onChange={(v) => setStartPage(v)}
          options={[
            { value: "home", label: tr("settings.start.home") },
            { value: "history", label: tr("settings.start.history") },
            { value: "downloads", label: tr("settings.start.downloads") },
          ]}
        />
        <button className="btn btn-primary" onClick={handleSave}>
          {tr("settings.save")}
        </button>
        {saved && (
          <span style={{ fontSize: 13, color: "#48c774" }}>✓ {tr("settings.saved")}</span>
        )}
      </div>
    </div>
  );
}

// ── TMDB Metadata Language ────────────────────────────────────────────────────
const TMDB_LANGUAGES = [
  { value: "en-US", label: "English (en-US)" },
  { value: "de-DE", label: "Deutsch (de-DE)" },
  { value: "fr-FR", label: "Français (fr-FR)" },
  { value: "es-ES", label: "Español (es-ES)" },
  { value: "it-IT", label: "Italiano (it-IT)" },
  { value: "pt-BR", label: "Português (Brasil) (pt-BR)" },
  { value: "nl-NL", label: "Nederlands (nl-NL)" },
  { value: "pl-PL", label: "Polski (pl-PL)" },
  { value: "sv-SE", label: "Svenska (sv-SE)" },
  { value: "nb-NO", label: "Norsk (nb-NO)" },
  { value: "da-DK", label: "Dansk (da-DK)" },
  { value: "fi-FI", label: "Suomi (fi-FI)" },
  { value: "tr-TR", label: "Türkçe (tr-TR)" },
  { value: "ru-RU", label: "Русский (ru-RU)" },
  { value: "ja-JP", label: "日本語 (ja-JP)" },
  { value: "ko-KR", label: "한국어 (ko-KR)" },
  { value: "zh-CN", label: "中文 (简体) (zh-CN)" },
  { value: "ar-SA", label: "العربية (ar-SA)" },
];

function TmdbLanguageSection() {
  const [lang, setLang] = useState(
    () => storage.get(STORAGE_KEYS.TMDB_LANG) || "en-US",
  );
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    storage.set(STORAGE_KEYS.TMDB_LANG, lang);
    // Clear in-memory cache
    clearTmdbCache();
    // Notify App.jsx to re-fetch trending data immediately.
    window.dispatchEvent(new CustomEvent("streambert:tmdb-lang-changed"));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">{tr("settings.metadataLanguage")}</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        {tr("settings.metadataDesc")}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <SettingsSelect
          value={lang}
          onChange={(v) => setLang(v)}
          options={TMDB_LANGUAGES}
        />
        <button className="btn btn-primary" onClick={handleSave}>
          {tr("settings.save")}
        </button>
        {saved && (
          <span style={{ fontSize: 13, color: "#48c774" }}>
            {tr("settings.savedCacheCleared")}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Subtitle Settings ─────────────────────────────────────────────────────────
function SubtitleSettingsSection() {
  const [enabled, setEnabled] = useState(
    () =>
      storage.get(STORAGE_KEYS.SUBTITLE_ENABLED) !== 0 &&
      storage.get(STORAGE_KEYS.SUBTITLE_ENABLED) !== "0",
  );
  const [lang, setLang] = useState(
    () => storage.get(STORAGE_KEYS.SUBTITLE_LANG) || "en",
  );
  const [subdlApiKey, setSubdlApiKey] = useState("");
  const [showSubdlKey, setShowSubdlKey] = useState(false);
  const [wyzieApiKey, setWyzieApiKey] = useState("");
  const [showWyzieKey, setShowWyzieKey] = useState(false);
  const [wyzieCopied, setWyzieCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load keys from secure storage
  useEffect(() => {
    secureStorage.get(STORAGE_KEYS.SUBDL_API_KEY).then((val) => {
      if (val) setSubdlApiKey(val);
    });
    secureStorage.get(STORAGE_KEYS.WYZIE_API_KEY).then((val) => {
      if (val) setWyzieApiKey(val);
    });
  }, []);

  const hasSubdlKey = subdlApiKey.trim().length > 0;
  const hasWyzieKey = wyzieApiKey.trim().length > 0;

  const handleWyzieCopy = () => {
    navigator.clipboard.writeText(wyzieApiKey.trim()).then(() => {
      setWyzieCopied(true);
      setTimeout(() => setWyzieCopied(false), 1500);
    });
  };

  const handleSave = () => {
    storage.set(STORAGE_KEYS.SUBTITLE_ENABLED, enabled ? 1 : 0);
    storage.set(STORAGE_KEYS.SUBTITLE_LANG, lang);
    secureStorage.set(STORAGE_KEYS.SUBDL_API_KEY, subdlApiKey.trim());
    secureStorage.set(STORAGE_KEYS.WYZIE_API_KEY, wyzieApiKey.trim());
    // refresh playerSettings prop (subtitle lang)
    window.dispatchEvent(new CustomEvent("streambert:player-settings-changed"));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">{tr("settings.subtitleDownloads")}</div>

      {/* Source info */}
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 20,
          lineHeight: 1.7,
        }}
      >
        <span style={{ color: "var(--text)", fontWeight: 600 }}>
          Wyzie Subs
        </span>{" "}
        {tr("settings.subsSourceA")}{" "}
        <span
          style={{
            color: "var(--red)",
            cursor: "pointer",
            textDecoration: "underline",
          }}
          onClick={() =>
            window.electron?.openExternal("https://subdl.com/settings")
          }
        >
          {tr("settings.subdlApiKey")}
        </span>{" "}
        {tr("settings.subsSourceB")}
        {hasSubdlKey && (
          <span
            style={{
              display: "inline-block",
              marginLeft: 8,
              fontSize: 11,
              fontWeight: 700,
              padding: "1px 7px",
              borderRadius: 3,
              background: "rgba(99,149,255,0.15)",
              color: "#6395ff",
              border: "1px solid rgba(99,149,255,0.3)",
            }}
          >
            {tr("settings.subdlActive")}
          </span>
        )}
      </div>

      {/* Enable toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <Toggle value={enabled} onChange={setEnabled} />
        <span
          style={{
            fontSize: 14,
            color: enabled ? "var(--text)" : "var(--text3)",
          }}
        >
          {enabled
            ? tr("settings.autoDownloadSubs")
            : "Subtitle download disabled"}
        </span>
      </div>

      {enabled && (
        <>
          {/* Default language */}
          <div style={{ marginBottom: 16 }}>
            <div
              style={{ fontSize: 12, color: "var(--text3)", marginBottom: 6 }}
            >
              {tr("settings.defaultLanguage")}
            </div>
            <SettingsSelect
              value={lang}
              onChange={(v) => setLang(v)}
              options={SUBTITLE_LANGUAGES.map((l) => ({
                value: l.code,
                label: l.label,
              }))}
            />
          </div>

          {/* {tr("settings.wyzieApiKey")} */}
          <div style={{ marginBottom: 20 }}>
            <div
              style={{ fontSize: 12, color: "var(--text3)", marginBottom: 6 }}
            >
              Wyzie API key{" "}
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "1px 5px",
                  borderRadius: 3,
                  background: hasWyzieKey
                    ? "rgba(99,202,183,0.12)"
                    : "rgba(255,180,80,0.12)",
                  color: hasWyzieKey ? "#63cab7" : "#ffb450",
                  border: `1px solid ${hasWyzieKey ? "rgba(99,202,183,0.25)" : "rgba(255,180,80,0.25)"}`,
                }}
              >
                {hasWyzieKey ? "SET" : "REQUIRED"}
              </span>
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text3)",
                marginBottom: 8,
                lineHeight: 1.5,
              }}
            >
              {tr("settings.wyzieRequired")}{" "}
              <button
                className="btn btn-ghost"
                style={{
                  display: "inline",
                  padding: 0,
                  fontSize: 12,
                  color: "var(--red)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
                onClick={() =>
                  window.electron?.openExternal(
                    "https://github.com/necu/Gigi/blob/main/wyzie-tutorial.md",
                  )
                }
              >
                {tr("settings.howToGetKey")}
              </button>
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <input
                className="apikey-input"
                style={{ flex: 1, maxWidth: 340, marginBottom: 0 }}
                type={showWyzieKey ? "text" : "password"}
                placeholder="wyzie-..."
                value={wyzieApiKey}
                onChange={(e) => setWyzieApiKey(e.target.value)}
              />
              <button
                className="btn btn-ghost"
                style={{ padding: "6px 12px", fontSize: 12 }}
                onClick={() => setShowWyzieKey((v) => !v)}
              >
                {showWyzieKey ? "Hide" : "Show"}
              </button>
              {hasWyzieKey && (
                <button
                  className="btn btn-ghost"
                  style={{ padding: "6px 12px", fontSize: 12 }}
                  onClick={handleWyzieCopy}
                  title={tr("settings.copyKey")}
                >
                  {wyzieCopied ? "Copied!" : "Copy"}
                </button>
              )}
              {hasWyzieKey && (
                <button
                  className="btn btn-ghost"
                  style={{ padding: "6px 12px", fontSize: 12 }}
                  onClick={() =>
                    window.electron?.openExternal(
                      `https://store.wyzie.io/dashboard?key=${wyzieApiKey.trim()}`,
                    )
                  }
                  title={tr("settings.openYourWyzieDashboard")}
                >
                  Dashboard ↗
                </button>
              )}
            </div>
          </div>

          {/* {tr("settings.subdlApiKey")} */}
          <div style={{ marginBottom: 8 }}>
            <div
              style={{ fontSize: 12, color: "var(--text3)", marginBottom: 6 }}
            >
              SubDL API key{" "}
              <span
                style={{
                  color: "var(--text3)",
                  cursor: "pointer",
                  fontSize: 11,
                }}
                onClick={() =>
                  window.electron?.openExternal("https://subdl.com/settings")
                }
              >
                {tr("settings.subdlOptionalHint")}
              </span>
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "1px 5px",
                  borderRadius: 3,
                  background: "rgba(99,202,183,0.12)",
                  color: "#63cab7",
                  border: "1px solid rgba(99,202,183,0.25)",
                }}
              >
                {tr("settings.optional")}
              </span>
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text3)",
                marginBottom: 8,
                lineHeight: 1.5,
              }}
            >
              {tr("settings.leaveEmptyToUse")}{" "}
              <strong style={{ color: "var(--text)" }}>Wyzie Subs</strong>{" "}
              {tr("settings.subdlHint")}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                className="apikey-input"
                style={{ flex: 1, maxWidth: 400, marginBottom: 0 }}
                type={showSubdlKey ? "text" : "password"}
                placeholder={tr("settings.subdlApiKeyLeaveEmptyToUseWyzie")}
                value={subdlApiKey}
                onChange={(e) => setSubdlApiKey(e.target.value)}
              />
              <button
                className="btn btn-ghost"
                style={{ padding: "6px 12px", fontSize: 12 }}
                onClick={() => setShowSubdlKey((v) => !v)}
              >
                {showSubdlKey ? "Hide" : "Show"}
              </button>
              {subdlApiKey.trim() && (
                <button
                  className="btn btn-ghost"
                  style={{
                    padding: "6px 12px",
                    fontSize: 12,
                    color: "var(--text3)",
                  }}
                  onClick={() => setSubdlApiKey("")}
                  title={tr("settings.clearKeyRevertToWyzie")}
                >
                  {tr("settings.clear")}
                </button>
              )}
            </div>
          </div>
        </>
      )}

      <div
        style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}
      >
        <button className="btn btn-primary" onClick={handleSave}>
          {tr("settings.save")}
        </button>
        {saved && (
          <span style={{ fontSize: 13, color: "#4caf50" }}>✓ {tr("settings.saved")}</span>
        )}
      </div>
    </div>
  );
}

// ── Notifications Section ─────────────────────────────────────────────────────
function NotificationsSection() {
  const [notifyDownload, setNotifyDownload] = useState(
    () => storage.get(STORAGE_KEYS.NOTIFY_DOWNLOAD_COMPLETE) !== false,
  );
  const [notifyEpisode, setNotifyEpisode] = useState(() => {
    const stored = storage.get(STORAGE_KEYS.NOTIFY_NEW_EPISODE);
    return stored === null || stored === undefined ? true : !!stored;
  });
  const [saved, setSaved] = useState(false);

  const saveSettings = () => {
    storage.set(STORAGE_KEYS.NOTIFY_DOWNLOAD_COMPLETE, notifyDownload);
    storage.set(STORAGE_KEYS.NOTIFY_NEW_EPISODE, notifyEpisode);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const ToggleRow = ({ label, description, value, onChange }) => (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        padding: "16px 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <Toggle value={value} onChange={onChange} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>
          {label}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--text3)",
            marginTop: 3,
            lineHeight: 1.5,
          }}
        >
          {description}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">{tr("settings.desktopNotifications")}</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        {tr("settings.controlWhichEventsTriggerADesktopNotification")}
      </div>

      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "0 16px",
          marginBottom: 20,
        }}
      >
        <ToggleRow
          label={tr("settings.notifyWhenADownloadCompletes")}
          description={tr("settings.showsADesktopNotificationWhenAnItemFinishesDownloadi")}
          value={notifyDownload}
          onChange={setNotifyDownload}
        />
        <ToggleRow
          label={tr("settings.notifyAboutNewEpisodesOnStartup")}
          description={tr("settings.onStartupChecksEveryTvSeriesYouHaveSavedForNewlyRele")}
          value={notifyEpisode}
          onChange={setNotifyEpisode}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn-primary" onClick={saveSettings}>
          {tr("settings.save")}
        </button>
        {saved && (
          <span style={{ fontSize: 13, color: "#48c774" }}>✓ {tr("settings.saved")}</span>
        )}
      </div>
    </div>
  );
}

// ── Section Group Header ──────────────────────────────────────────────────────
function DiscordRpcSection() {
  const [enabled, setEnabledState] = useState(
    () => !!storage.get(STORAGE_KEYS.DISCORD_RPC_ENABLED),
  );
  const [showCover, setShowCover] = useState(
    () => storage.get(STORAGE_KEYS.DISCORD_RPC_SHOW_COVER) !== false,
  );
  const [showTimestamp, setShowTimestamp] = useState(
    () => storage.get(STORAGE_KEYS.DISCORD_RPC_SHOW_TIMESTAMP) !== false,
  );
  const [showButton, setShowButton] = useState(
    () => storage.get(STORAGE_KEYS.DISCORD_RPC_SHOW_BUTTON) !== false,
  );
  const [saved, setSaved] = useState(false);

  const saveSettings = () => {
    storage.set(STORAGE_KEYS.DISCORD_RPC_ENABLED, enabled);
    storage.set(STORAGE_KEYS.DISCORD_RPC_SHOW_COVER, showCover);
    storage.set(STORAGE_KEYS.DISCORD_RPC_SHOW_TIMESTAMP, showTimestamp);
    storage.set(STORAGE_KEYS.DISCORD_RPC_SHOW_BUTTON, showButton);
    window.dispatchEvent(
      new CustomEvent("streambert:discord-rpc-settings-changed"),
    );
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const ToggleRow = ({ label, description, value, onChange, disabled }) => (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        padding: "16px 0",
        borderBottom: "1px solid var(--border)",
        opacity: disabled ? 0.45 : 1,
        pointerEvents: disabled ? "none" : "auto",
      }}
    >
      <Toggle value={value} onChange={onChange} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>
          {label}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--text3)",
            marginTop: 3,
            lineHeight: 1.5,
          }}
        >
          {description}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">{tr("settings.discordRichPresence")}</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        {tr("settings.discordDesc")}
      </div>

      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "0 16px",
          marginBottom: 20,
        }}
      >
        <ToggleRow
          label={tr("settings.enableDiscordRichPresence")}
          description={tr("settings.connectsToYourLocalDiscordClientAndUpdatesYourStatus")}
          value={enabled}
          onChange={setEnabledState}
        />
        <ToggleRow
          label={tr("settings.showCoverArt")}
          description={tr("settings.usesTheMovieShowPosterAsTheLargeImageWhenOffOnlyTheG")}
          value={showCover}
          onChange={setShowCover}
          disabled={!enabled}
        />
        <ToggleRow
          label={tr("settings.showElapsedTime")}
          description={tr("settings.displaysHowLongYouVeBeenOnTheCurrentTitleSPage")}
          value={showTimestamp}
          onChange={setShowTimestamp}
          disabled={!enabled}
        />
        <ToggleRow
          label={tr("settings.showGithubButton")}
          description={tr("settings.addsAButtonLinkingToTheGigiGithubRepository")}
          value={showButton}
          onChange={setShowButton}
          disabled={!enabled}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn-primary" onClick={saveSettings}>
          {tr("settings.save")}
        </button>
        {saved && (
          <span style={{ fontSize: 13, color: "#48c774" }}>✓ {tr("settings.saved")}</span>
        )}
      </div>
    </div>
  );
}

// ── Section Group Header ─────────────────────────────────────────────────────
function SectionGroupHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 32, marginTop: 4 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: subtitle ? 6 : 0,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 16,
            letterSpacing: 2,
            color: "var(--red)",
            textTransform: "uppercase",
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
        <div
          style={{ flex: 1, height: 1, background: "rgba(229,9,20,0.18)" }}
        />
      </div>
      {subtitle && (
        <div style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.5 }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

// ── Section divider ───────────────────────────────────────────────────────────
function Divider() {
  return (
    <div style={{ height: 1, background: "var(--border)", marginBottom: 40 }} />
  );
}

// ── Search & Nav Bar ──────────────────────────────────────────────────────────
const SUPPORTS_HIGHLIGHT =
  typeof CSS !== "undefined" && typeof CSS.highlights !== "undefined";
const SECTION_NAV = [
  {
    id: "updates",
    label: "Updates & API",
    icon: "↑",
    keywords: [
      "update",
      "version",
      "tmdb",
      "api",
      "token",
      "key",
      "check",
      "startup",
      "auto",
      "app",
      "language",
      "metadata",
      "locale",
      "german",
      "french",
      "spanish",
    ],
  },
  {
    id: "content",
    label: "Age Rating",
    icon: "🔞",
    keywords: [
      "age",
      "rating",
      "parental",
      "content",
      "country",
      "restriction",
      "pg",
      "fsk",
      "adults",
    ],
  },
  {
    id: "playback",
    label: "Playback",
    icon: "▶",
    keywords: [
      "invidious",
      "trailer",
      "youtube",
      "threshold",
      "watched",
      "playback",
      "seconds",
      "mark",
      "auto-watched",
      "intro",
      "skip",
      "aniskip",
      "anime",
      "outro",
    ],
  },
  {
    id: "subtitles",
    label: "Subtitles",
    icon: "CC",
    keywords: [
      "subtitle",
      "subdl",
      "wyzie",
      "language",
      "caption",
      "srt",
      "download",
      "cc",
    ],
  },
  {
    id: "downloads",
    label: "Downloads",
    icon: "⬇",
    keywords: [
      "download",
      "folder",
      "path",
      "save",
      "video",
      "movies",
      "files",
    ],
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: "🔔",
    keywords: [
      "notification",
      "notify",
      "alert",
      "desktop",
      "episode",
      "download",
      "watchlist",
      "new episode",
      "release",
    ],
  },
  {
    id: "discordRpc",
    label: "Discord Rich Presence",
    icon: "🎮",
    keywords: [
      "discord",
      "rich presence",
      "rpc",
      "status",
      "activity",
      "watching",
      "idling",
      "presence",
    ],
  },
  {
    id: "interface",
    label: "Interface",
    icon: "✦",
    keywords: [
      "home",
      "layout",
      "start page",
      "appearance",
      "accent",
      "colour",
      "color",
      "font",
      "compact",
      "animation",
      "theme",
      "rows",
      "hero",
    ],
  },
  {
    id: "library",
    label: "Library",
    icon: "📚",
    keywords: [
      "library",
      "watchlist",
      "sort",
      "history",
      "privacy",
      "watch history",
      "continue",
    ],
  },
  {
    id: "backup",
    label: "Backup",
    icon: "💾",
    keywords: [
      "backup",
      "restore",
      "export",
      "import",
      "scheduled",
      "json",
      "backup file",
    ],
  },
  {
    id: "storage",
    label: "Storage & Data",
    icon: "🗄",
    keywords: [
      "storage",
      "cache",
      "clear",
      "reset",
      "delete",
      "data",
      "wipe",
      "progress",
      "factory",
    ],
  },
];

function SettingsTopBar({ sectionRefs, contentRef }) {
  const t = useT();
  const [searchOpen, setSearchOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const matchRanges = useRef([]);
  const currentMatchRef = useRef(0);
  const matchCountRef = useRef(0);
  const inputRef = useRef(null);
  const navRef = useRef(null);
  const searchBarRef = useRef(null);
  const debounceTimer = useRef(null);
  const rafHandle = useRef(null);

  const clearHighlights = () => {
    if (SUPPORTS_HIGHLIGHT) {
      CSS.highlights.delete("settings-search");
      CSS.highlights.delete("settings-search-active");
    }
    matchRanges.current = [];
    matchCountRef.current = 0;
    currentMatchRef.current = 0;
    setMatchCount(0);
    setCurrentMatch(0);
  };

  const scrollToRange = (range) => {
    if (!range) return;
    if (rafHandle.current) cancelAnimationFrame(rafHandle.current);
    rafHandle.current = requestAnimationFrame(() => {
      rafHandle.current = null;
      try {
        const el = range.startContainer.parentElement;
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch {}
    });
  };

  const setActiveMatch = (idx) => {
    const range = matchRanges.current[idx];
    if (!range) return;
    if (SUPPORTS_HIGHLIGHT) {
      CSS.highlights.set("settings-search-active", new Highlight(range));
    }
    scrollToRange(range);
    currentMatchRef.current = idx + 1;
    setCurrentMatch(idx + 1);
  };

  const runSearch = (searchQuery) => {
    clearHighlights();
    if (!contentRef?.current || !searchQuery.trim()) return;

    const str = searchQuery.toLowerCase();
    const ranges = [];
    const walker = document.createTreeWalker(
      contentRef.current,
      NodeFilter.SHOW_TEXT,
    );

    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.toLowerCase();
      let idx = 0;
      while ((idx = text.indexOf(str, idx)) !== -1) {
        const range = new Range();
        range.setStart(node, idx);
        range.setEnd(node, idx + searchQuery.length);
        ranges.push(range);
        idx += str.length;
      }
    }

    matchRanges.current = ranges;
    matchCountRef.current = ranges.length;
    setMatchCount(ranges.length);

    if (ranges.length > 0) {
      if (SUPPORTS_HIGHLIGHT) {
        const hl = new Highlight();
        for (const r of ranges) hl.add(r);
        CSS.highlights.set("settings-search", hl);
      }
      setActiveMatch(0);
    }
  };

  const findMatches = (searchQuery) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      runSearch(searchQuery);
    }, 80);
  };

  const goNext = () => {
    const total = matchCountRef.current;
    if (total === 0) return;
    const next = currentMatchRef.current < total ? currentMatchRef.current : 0;
    setActiveMatch(next);
  };

  const goPrev = () => {
    const total = matchCountRef.current;
    if (total === 0) return;
    const prev =
      currentMatchRef.current > 1 ? currentMatchRef.current - 2 : total - 1;
    setActiveMatch(prev);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    clearHighlights();
  };

  // Focus on open
  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 30);
    }
  }, [searchOpen]);

  // Clean up on unmount
  useEffect(
    () => () => {
      clearHighlights();
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (rafHandle.current) cancelAnimationFrame(rafHandle.current);
    },
    [],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") {
        closeSearch();
        setNavOpen(false);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "f")) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.key === "F3") {
        e.preventDefault();
        if (e.shiftKey) goPrev();
        else goNext();
        return;
      }
      if (searchOpen && e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) goPrev();
        else goNext();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [searchOpen]);

  // Close nav on outside click
  useEffect(() => {
    if (!navOpen) return;
    const handler = (e) => {
      if (navRef.current && !navRef.current.contains(e.target))
        setNavOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [navOpen]);

  // Clear highlights + close search when clicking outside the search bar
  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e) => {
      if (searchBarRef.current && !searchBarRef.current.contains(e.target)) {
        clearHighlights();
        setSearchOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [searchOpen]);

  const scrollTo = (id) => {
    const el = sectionRefs[id]?.current;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setNavOpen(false);
  };

  const handleQueryChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    findMatches(val);
  };

  const noMatch = query.trim().length > 0 && matchCount === 0;
  const hasQuery = query.trim().length > 0;

  const navBtnStyle = {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--text2)",
    display: "flex",
    alignItems: "center",
    padding: "4px 5px",
    borderRadius: 5,
    transition: "background 0.1s",
    flexShrink: 0,
  };

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        background: "var(--bg, #141414)",
        borderBottom: "1px solid var(--border)",
        padding: "0 48px",
        backdropFilter: "blur(12px)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 0",
        }}
      >
        {/* ── Search area ── */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
          {searchOpen ? (
            <div
              ref={searchBarRef}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flex: 1,
                maxWidth: 540,
                background: "var(--surface2)",
                border: `1px solid ${noMatch ? "#ff3860" : "var(--red)"}`,
                borderRadius: 8,
                padding: "5px 8px 5px 12px",
                boxShadow: `0 0 0 3px ${noMatch ? "rgba(255,56,96,0.1)" : "rgba(229,9,20,0.1)"}`,
                transition: "border-color 0.15s, box-shadow 0.15s",
              }}
            >
              {/* Search icon */}
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--text3)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0 }}
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>

              {/* Input */}
              <input
                ref={inputRef}
                value={query}
                onChange={handleQueryChange}
                placeholder={t("settings.searchPage")}
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  fontSize: 14,
                  color: noMatch ? "#ff3860" : "var(--text)",
                  fontFamily: "var(--font-body)",
                  minWidth: 0,
                }}
              />

              {/* Match counter */}
              {hasQuery && (
                <span
                  style={{
                    fontSize: 12,
                    color: noMatch ? "#ff3860" : "var(--text3)",
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                    padding: "0 8px",
                    borderLeft: "1px solid var(--border)",
                    borderRight: "1px solid var(--border)",
                    margin: "0 2px",
                    flexShrink: 0,
                  }}
                >
                  {noMatch ? "No results" : `${currentMatch} / ${matchCount}`}
                </span>
              )}

              {/* Prev button */}
              {matchCount > 0 && (
                <button
                  onClick={goPrev}
                  title={tr("settings.previousMatchShiftEnter")}
                  style={navBtnStyle}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background =
                      "rgba(255,255,255,0.08)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "none")
                  }
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="18 15 12 9 6 15" />
                  </svg>
                </button>
              )}

              {/* Next button */}
              {matchCount > 0 && (
                <button
                  onClick={goNext}
                  title={tr("settings.nextMatchEnter")}
                  style={navBtnStyle}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background =
                      "rgba(255,255,255,0.08)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "none")
                  }
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              )}

              {/* Divider + Clear */}
              {query && (
                <button
                  onClick={() => {
                    setQuery("");
                    clearHighlights();
                    inputRef.current?.focus();
                  }}
                  title={tr("settings.clearSearch")}
                  style={{ ...navBtnStyle, color: "var(--text3)" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background =
                      "rgba(255,255,255,0.08)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "none")
                  }
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}

              {/* Esc button */}
              <button
                onClick={closeSearch}
                title={tr("settings.closeEsc")}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text3)",
                  fontSize: 11,
                  padding: "3px 7px",
                  borderRadius: 4,
                  fontFamily: "var(--font-body)",
                  flexShrink: 0,
                  letterSpacing: 0.3,
                }}
              >
                {tr("settings.esc")}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "6px 14px",
                fontSize: 13,
                color: "var(--text3)",
                cursor: "pointer",
                transition: "all 0.15s",
                fontFamily: "var(--font-body)",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "var(--surface3)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "var(--surface2)")
              }
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              {tr("settings.searchSettings")}
              <span
                style={{
                  fontSize: 10,
                  color: "var(--text3)",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  padding: "1px 6px",
                  fontFamily: "monospace",
                  letterSpacing: 0.5,
                }}
              >
                ⌘K
              </span>
            </button>
          )}
        </div>

        {/* ── Jump to section dropdown ── */}
        <div ref={navRef} style={{ position: "relative", flexShrink: 0 }}>
          <button
            onClick={() => setNavOpen((o) => !o)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: navOpen ? "var(--surface3)" : "var(--surface2)",
              border: `1px solid ${navOpen ? "var(--red)" : "var(--border)"}`,
              boxShadow: navOpen ? "0 0 0 3px rgba(229,9,20,0.1)" : "none",
              borderRadius: 8,
              padding: "6px 14px",
              fontSize: 13,
              color: "var(--text)",
              cursor: "pointer",
              transition: "all 0.15s",
              fontFamily: "var(--font-body)",
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <circle cx="3" cy="6" r="1" fill="currentColor" />
              <circle cx="3" cy="12" r="1" fill="currentColor" />
              <circle cx="3" cy="18" r="1" fill="currentColor" />
            </svg>
            {t("settings.jump")}
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text3)"
              strokeWidth="2.5"
              strokeLinecap="round"
              style={{
                transform: navOpen ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s",
                flexShrink: 0,
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {navOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 0,
                zIndex: 200,
                background: "var(--surface3)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
                minWidth: 230,
                padding: 6,
              }}
            >
              {SECTION_NAV.map((s) => (
                <button
                  key={s.id}
                  onMouseDown={() => scrollTo(s.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    borderRadius: 8,
                    padding: "9px 12px",
                    fontSize: 13,
                    color: "var(--text)",
                    cursor: "pointer",
                    transition: "background 0.1s",
                    fontFamily: "var(--font-body)",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background =
                      "rgba(255,255,255,0.07)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <span
                    style={{
                      width: 22,
                      textAlign: "center",
                      fontSize: 13,
                      flexShrink: 0,
                    }}
                  >
                    {s.icon}
                  </span>
                  <span style={{ flex: 1 }}>{t(`settings.section.${s.id}`)}</span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--text3)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SettingsPage({
  apiKey,
  onChangeApiKey,
  initialSection,
}) {
  const t = useT();
  const [downloadPath, setDownloadPath] = useState(
    () => storage.get(STORAGE_KEYS.DOWNLOAD_PATH) || "",
  );
  const [watchedThreshold, setWatchedThreshold] = useState(
    () => storage.get(STORAGE_KEYS.WATCHED_THRESHOLD) ?? 20,
  );
  const [introSkipMode, setIntroSkipMode] = useState(
    () => getIntroSkipMode(),
  );
  const [playerPrefs, setPlayerPrefs] = useState(loadPlayerPreferences);
  const updatePlayerPrefs = (patch) => {
    setPlayerPrefs(savePlayerPreferences(patch));
    flash();
  };
  const [autoplayNextEnabled, setAutoplayNextEnabled] = useState(
    () => storage.get(STORAGE_KEYS.AUTOPLAY_NEXT_ENABLED) ?? true,
  );
  const [autoplayNextDuration, setAutoplayNextDuration] = useState(
    () => storage.get(STORAGE_KEYS.AUTOPLAY_NEXT_DURATION) ?? 5,
  );
  const [autoplayNextLayout, setAutoplayNextLayout] = useState(
    () => storage.get(STORAGE_KEYS.AUTOPLAY_NEXT_LAYOUT) || "right",
  );
  const [saved, setSaved] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetHovered, setResetHovered] = useState(false);
  const [showProgressConfirm, setShowProgressConfirm] = useState(false);
  const [showDeleteDlConfirm, setShowDeleteDlConfirm] = useState(false);

  // ── Section refs for navigation ────────────────────────────────────────────
  const secUpdates = useRef(null);
  const secContent = useRef(null);
  const secPlayback = useRef(null);
  const secSubtitles = useRef(null);
  const secDownloads = useRef(null);
  const secNotifications = useRef(null);
  const secDiscordRpc = useRef(null);
  const secInterface = useRef(null);
  const secLibrary = useRef(null);
  const secBackup = useRef(null);
  const secStorage = useRef(null);

  const sectionRefs = {
    updates: secUpdates,
    content: secContent,
    playback: secPlayback,
    subtitles: secSubtitles,
    downloads: secDownloads,
    notifications: secNotifications,
    discordRpc: secDiscordRpc,
    interface: secInterface,
    library: secLibrary,
    backup: secBackup,
    storage: secStorage,
  };

  // Ref for find-in-page search scope
  const contentRef = useRef(null);

  // Scroll to initial section if provided (e.g. when navigating from a modal)
  useEffect(() => {
    if (!initialSection) return;
    const el = sectionRefs[initialSection]?.current;
    if (!el) return;
    // Small delay so layout is complete before scrolling
    const t = setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => clearTimeout(t);
  }, []);

  // Age Rating
  const [ratingCountry, setRatingCountry] = useState(
    () => storage.get(STORAGE_KEYS.RATING_COUNTRY) || "US",
  );
  const [ageLimit, setAgeLimit] = useState(() => {
    const v = storage.get(STORAGE_KEYS.AGE_LIMIT);
    return v === null || v === undefined ? "" : String(v);
  });
  const [ageSaved, setAgeSaved] = useState(false);

  const saveAgeSettings = () => {
    storage.set(STORAGE_KEYS.RATING_COUNTRY, ratingCountry);
    if (ageLimit === "" || ageLimit === null) {
      storage.remove(STORAGE_KEYS.AGE_LIMIT);
    } else {
      storage.set(STORAGE_KEYS.AGE_LIMIT, Number(ageLimit));
    }
    setAgeSaved(true);
    setTimeout(() => setAgeSaved(false), 2000);
  };

  // Invidious
  const [invidiousBase, setInvidiousBase] = useState(
    () => storage.get(STORAGE_KEYS.INVIDIOUS_BASE) || DEFAULT_INVIDIOUS_BASE,
  );
  const [invidiousStatus, setInvidiousStatus] = useState(null); // null | { ok: bool, msg: string }
  const [invidiousChecking, setInvidiousChecking] = useState(false);
  const [invidiousSaved, setInvidiousSaved] = useState(false);

  const checkInvidious = async (baseUrl) => {
    const clean = (baseUrl || "").trim().replace(/\/$/, "");
    if (!clean) {
      setInvidiousStatus({ ok: false, msg: "Please enter a URL first." });
      return;
    }
    setInvidiousChecking(true);
    setInvidiousStatus(null);
    try {
      const url = `${clean}/api/v1/stats`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        setInvidiousStatus({
          ok: true,
          msg: "Instance reachable and responding.",
        });
      } else {
        setInvidiousStatus({
          ok: false,
          msg: `Server responded with status ${res.status}.`,
        });
      }
    } catch {
      setInvidiousStatus({
        ok: false,
        msg: "Could not reach instance. Check the URL or try another.",
      });
    } finally {
      setInvidiousChecking(false);
    }
  };

  const saveInvidiousBase = () => {
    const clean = (invidiousBase || "").trim().replace(/\/$/, "");
    storage.set(STORAGE_KEYS.INVIDIOUS_BASE, clean || DEFAULT_INVIDIOUS_BASE);
    setInvidiousBase(clean || DEFAULT_INVIDIOUS_BASE);
    setInvidiousSaved(true);
    setTimeout(() => setInvidiousSaved(false), 2000);
  };

  // Storage sizes - null = loading, -1 = unavailable, ≥0 = real value
  const [sizes, setSizes] = useState({ cache: null, downloads: null });

  useEffect(() => {
    if (typeof window === "undefined" || !window.electron) {
      setSizes({ cache: -1, downloads: -1 });
      return;
    }
    (async () => {
      try {
        const [cacheRes, downloadsRes] = await Promise.all([
          window.electron.getCacheSize?.() ?? null,
          window.electron.getDownloadsSize?.() ?? null,
        ]);
        setSizes({
          cache: cacheRes?.bytes ?? -1,
          downloads: downloadsRes?.bytes ?? -1,
        });
      } catch {
        setSizes({ cache: -1, downloads: -1 });
      }
    })();
  }, []);

  const pickFolder = async () => {
    if (!isElectron) return;
    const folder = await window.electron.pickFolder();
    if (folder) {
      setDownloadPath(folder);
      storage.set(STORAGE_KEYS.DOWNLOAD_PATH, folder);
      flash();
    }
  };

  const handleSavePath = () => {
    storage.set(STORAGE_KEYS.DOWNLOAD_PATH, downloadPath);
    flash();
  };

  const handleSaveThreshold = () => {
    const val = Math.max(1, Math.min(300, Number(watchedThreshold) || 20));
    setWatchedThreshold(val);
    storage.set(STORAGE_KEYS.WATCHED_THRESHOLD, val);
    flash();
  };

  const flash = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // ── Clean handlers ─────────────────────────────────────────────────────────

  const handleClearCache = async () => {
    await clearAppCaches();
    setSizes((prev) => ({ ...prev, cache: 0 }));
    return { msg: "✓ Cache cleared successfully" };
  };

  const handleClearWatchProgress = async () => {
    storage.remove(STORAGE_KEYS.WATCH_PROGRESS);
    storage.remove(STORAGE_KEYS.HISTORY);
    storage.remove(STORAGE_KEYS.WATCHED);
    if (isElectron) await window.electron.clearWatchData();
    setTimeout(() => window.location.reload(), 800);
    return { msg: "✓ Watch data cleared" };
  };

  const handleDeleteAllDownloads = async () => {
    let msg = "✓ All downloads removed";
    setSizes((prev) => ({ ...prev, downloads: 0 }));
    if (isElectron) {
      const res = await window.electron.deleteAllDownloads();
      if (res?.deleted != null) {
        msg = `✓ Removed ${res.deleted} file${res.deleted !== 1 ? "s" : ""}`;
        if (res.errors > 0) msg += ` (${res.errors} could not be deleted)`;
      }
    } else {
      storage.remove(STORAGE_KEYS.LOCAL_FILES);
    }
    return { msg };
  };

  const handleResetApp = async () => {
    setShowResetConfirm(false);
    if (isElectron) await window.electron.resetApp();
    storage.clearAll();
    // Clear non-prefixed localStorage caches
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("dlDur_")) localStorage.removeItem(key);
    }
    window.location.reload();
  };

  return (
    <>
      {showProgressConfirm && (
        <ConfirmDialog
          title={tr("settings.clearWatchProgressConfirm")}
          description={tr("settings.thisWillPermanentlyDeleteAllWatchHistoryContinueWatc")}
          confirmLabel="Yes, Clear Everything"
          onConfirm={async () => {
            setShowProgressConfirm(false);
            await handleClearWatchProgress();
            window.__progressConfirmResolve?.({ msg: "✓ Watch data cleared" });
            window.__progressConfirmResolve = null;
          }}
          onCancel={() => {
            setShowProgressConfirm(false);
            window.__progressConfirmResolve?.({ cancelled: true });
            window.__progressConfirmResolve = null;
          }}
        />
      )}
      {showDeleteDlConfirm && (
        <ConfirmDialog
          title={tr("settings.deleteAllDownloadsConfirm")}
          description={tr("settings.thisWillPermanentlyDeleteAllVideoFilesDownloadedThro")}
          confirmLabel={tr("settings.yesDeleteAll")}
          onConfirm={async () => {
            setShowDeleteDlConfirm(false);
            const result = await handleDeleteAllDownloads();
            window.__deleteDlConfirmResolve?.(result);
            window.__deleteDlConfirmResolve = null;
          }}
          onCancel={() => {
            setShowDeleteDlConfirm(false);
            window.__deleteDlConfirmResolve?.({ cancelled: true });
            window.__deleteDlConfirmResolve = null;
          }}
        />
      )}
      {showResetConfirm && (
        <ResetConfirmDialog
          onConfirm={handleResetApp}
          onCancel={() => setShowResetConfirm(false)}
        />
      )}

      {/* ── Sticky search & navigation bar ── */}
      <SettingsTopBar sectionRefs={sectionRefs} contentRef={contentRef} />

      <div
        ref={contentRef}
        className="fade-in"
        style={{ padding: "40px 48px 80px" }}
      >
        {/* Page title */}
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 48,
            letterSpacing: 1,
            marginBottom: 6,
          }}
        >
          {t("settings.title")}
        </div>
        <div style={{ color: "var(--text3)", fontSize: 14, marginBottom: 48 }}>
          {t("settings.subtitle")}
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* GROUP: GENERAL                                                     */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <div ref={secUpdates} style={{ scrollMarginTop: 80 }}>
          <SectionGroupHeader
            title={t("settings.general")}
            subtitle={t("settings.generalSub")}
          />

          {/* Language */}
          <LanguageSection />

          <Divider />

          {/* Version & Updates */}
          <VersionSection />

          <Divider />

          {/* TMDB API Token */}
          <div style={{ marginBottom: 40 }}>
            <div className="settings-section-title">{tr("settings.tmdbReadAccessToken")}</div>
            <div
              style={{
                fontSize: 13,
                color: "var(--text3)",
                marginBottom: 16,
                lineHeight: 1.6,
              }}
            >
              {tr("settings.tmdbTokenDesc")}
            </div>
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <code
                style={{
                  fontSize: 13,
                  color: "var(--text2)",
                  background: "var(--surface2)",
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                }}
              >
                {apiKey ? apiKey.slice(0, 8) + "••••••••••••••••" : "(not set)"}
              </code>
              <button className="btn btn-ghost" onClick={onChangeApiKey}>
                {tr("settings.changeApiToken")}
              </button>
            </div>
          </div>

          <Divider />

          <TmdbLanguageSection />
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* GROUP: CONTENT                                                     */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <div ref={secContent} style={{ scrollMarginTop: 80 }}>
          <SectionGroupHeader
            title={tr("settings.content")}
            subtitle={tr("settings.parentalControlsAndContentFilteringByAgeRating")}
          />

          <div style={{ marginBottom: 40 }}>
            <div className="settings-section-title">
              {tr("settings.ageRatingControls")}
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--text3)",
                marginBottom: 20,
                lineHeight: 1.6,
              }}
            >
              {tr("settings.ageLimitDescA")}{" "}
              <strong style={{ color: "var(--text)" }}>
                {tr("settings.ageLimitDescB")}
              </strong>{" "}
              {tr("settings.ageLimitSetTo")} <em>{tr("settings.noRestriction")}</em> {tr("settings.ageLimitDisableRest")}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--text2)",
                    marginBottom: 8,
                  }}
                >
                  {tr("settings.ratingCountry")}
                </div>
                <SettingsSelect
                  value={ratingCountry}
                  onChange={(v) => setRatingCountry(v)}
                  options={RATING_COUNTRIES.map((c) => ({
                    value: c.code,
                    label: tr(`ageRating.${c.code}`),
                  }))}
                />
              </div>

              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--text2)",
                    marginBottom: 8,
                  }}
                >
                  {tr("settings.maximumAllowedAgeRating")}
                </div>
                <SettingsSelect
                  value={ageLimit}
                  onChange={(v) => setAgeLimit(v)}
                  options={ageLimitOptions()}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button className="btn btn-primary" onClick={saveAgeSettings}>
                  {tr("settings.save")}
                </button>
                {ageSaved && (
                  <span style={{ fontSize: 13, color: "#48c774" }}>
                    ✓ {tr("settings.saved")}
                  </span>
                )}
              </div>
            </div>
          </div>

          <Divider />

          {/* Player Controls */}
          <div style={{ marginBottom: 40 }}>
            <div className="settings-section-title">{tr("settings.playerControls")}</div>
            <div
              style={{
                fontSize: 13,
                color: "var(--text3)",
                marginBottom: 18,
                lineHeight: 1.6,
              }}
            >
              {tr("settings.playerControlsDesc")}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>
                    {tr("settings.seekStep")}
                  </span>
                  <span style={{ fontSize: 13, color: "var(--text3)" }}>
                    {playerPrefs.seekStep}s
                  </span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={60}
                  step={5}
                  value={playerPrefs.seekStep}
                  onChange={(e) =>
                    updatePlayerPrefs({ seekStep: Number(e.target.value) })
                  }
                  style={{ width: "100%", accentColor: "var(--red)" }}
                />
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>
                    {tr("settings.holdRepeatInterval")}
                  </span>
                  <span style={{ fontSize: 13, color: "var(--text3)" }}>
                    {(playerPrefs.holdInterval / 1000).toFixed(2)}s
                  </span>
                </div>
                <input
                  type="range"
                  min={100}
                  max={600}
                  step={50}
                  value={playerPrefs.holdInterval}
                  onChange={(e) =>
                    updatePlayerPrefs({ holdInterval: Number(e.target.value) })
                  }
                  style={{ width: "100%", accentColor: "var(--red)" }}
                />
                <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>
                  {tr("settings.default10SecondsEvery02SecondsLowerIsFaster")}
                </div>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>
                    {tr("settings.estimatedIntroLength")}
                  </span>
                  <span style={{ fontSize: 13, color: "var(--text3)" }}>
                    {playerPrefs.genericIntroSeconds}s
                  </span>
                </div>
                <input
                  type="range"
                  min={20}
                  max={240}
                  step={5}
                  value={playerPrefs.genericIntroSeconds}
                  onChange={(e) =>
                    updatePlayerPrefs({
                      genericIntroSeconds: Number(e.target.value),
                    })
                  }
                  style={{ width: "100%", accentColor: "var(--red)" }}
                />
                <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>
                  {tr("settings.introEstimateDesc")}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Toggle
                  value={playerPrefs.smartIntro}
                  onChange={(val) => updatePlayerPrefs({ smartIntro: val })}
                />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>
                    {tr("settings.estimatedIntroForEverySeries")}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
                    {tr("settings.alwaysShowSkipDesc")}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* GROUP: PLAYBACK                                                    */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <div ref={secPlayback} style={{ scrollMarginTop: 80 }}>
          <SectionGroupHeader
            title={tr("settings.playback")}
            subtitle={tr("settings.trailerSourceAndAutoWatchedBehavior")}
          />

          {/* Invidious */}
          <div style={{ marginBottom: 40 }}>
            <div className="settings-section-title">{tr("settings.invidiousInstance")}</div>
            <div
              style={{
                fontSize: 13,
                color: "var(--text3)",
                marginBottom: 16,
                lineHeight: 1.6,
              }}
            >
              {tr("settings.trailersVia")}{" "}
              <span style={{ color: "var(--text)", fontWeight: 600 }}>
                Invidious
              </span>
              {tr("settings.invidiousDesc")}{" "}
              <code style={{ fontSize: 12 }}>{DEFAULT_INVIDIOUS_BASE}</code>.
              The instance must have its API enabled (
              <code style={{ fontSize: 12 }}>/api/v1/stats</code> reachable).
            </div>
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <input
                className="apikey-input"
                style={{ flex: 1, minWidth: 260, marginBottom: 0 }}
                placeholder={DEFAULT_INVIDIOUS_BASE}
                value={invidiousBase}
                onChange={(e) => {
                  setInvidiousBase(e.target.value);
                  setInvidiousStatus(null);
                }}
              />
              <button
                className="btn btn-ghost"
                disabled={invidiousChecking}
                onClick={() => checkInvidious(invidiousBase)}
                style={{ opacity: invidiousChecking ? 0.5 : 1 }}
              >
                {invidiousChecking ? "Checking…" : "Check"}
              </button>
              <button className="btn btn-primary" onClick={saveInvidiousBase}>
                {tr("settings.save")}
              </button>
            </div>

            {invidiousStatus && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 12,
                }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background: invidiousStatus.ok ? "#48c774" : "#ff3860",
                    boxShadow: invidiousStatus.ok
                      ? "0 0 6px rgba(72,199,116,0.6)"
                      : "0 0 6px rgba(255,56,96,0.6)",
                  }}
                />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: invidiousStatus.ok ? "#48c774" : "#ff3860",
                  }}
                >
                  {invidiousStatus.msg}
                </span>
              </div>
            )}

            {invidiousSaved && (
              <div style={{ marginTop: 10, fontSize: 13, color: "#48c774" }}>
                ✓ {tr("settings.saved")}
              </div>
            )}
          </div>

          <Divider />

          {/* Auto-Watched Threshold */}
          <div style={{ marginBottom: 40 }}>
            <div className="settings-section-title">{tr("settings.autoWatchedThreshold")}</div>
            <div
              style={{
                fontSize: 13,
                color: "var(--text3)",
                marginBottom: 16,
                lineHeight: 1.6,
              }}
            >
              {tr("settings.watchedThresholdA")}{" "}
              <span style={{ color: "#48c774", fontWeight: 600 }}>
                {tr("settings.watchedMark")}
              </span>{" "}
              {tr("settings.watchedThresholdB")}
            </div>
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="number"
                  min={1}
                  max={300}
                  className="apikey-input"
                  style={{ width: 90, marginBottom: 0 }}
                  value={watchedThreshold}
                  onChange={(e) => setWatchedThreshold(e.target.value)}
                />
                <span style={{ fontSize: 14, color: "var(--text2)" }}>
                  {tr("settings.seconds")}
                </span>
              </div>
              <button className="btn btn-primary" onClick={handleSaveThreshold}>
                {tr("settings.save")}
              </button>
            </div>
            {saved && (
              <div style={{ marginTop: 10, fontSize: 13, color: "#48c774" }}>
                ✓ {tr("settings.saved")}
              </div>
            )}
          </div>

          <Divider />

          {/* Autoplay Next Episode */}
          <div style={{ marginBottom: 40 }}>
            <div className="settings-section-title">{tr("settings.autoplayNextEpisode")}</div>
            <div
              style={{
                fontSize: 13,
                color: "var(--text3)",
                marginBottom: 16,
                lineHeight: 1.6,
              }}
            >
              {tr("settings.configureHowThePlayerBehavesWhenAnEpisodeFinishes")}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Enable/Disable Toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Toggle
                  value={autoplayNextEnabled}
                  onChange={(val) => {
                    setAutoplayNextEnabled(val);
                    storage.set(STORAGE_KEYS.AUTOPLAY_NEXT_ENABLED, val);
                    flash();
                  }}
                />
                <div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: "var(--text)",
                    }}
                  >
                    {tr("settings.enableAutoplayNext")}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text3)",
                      marginTop: 2,
                    }}
                  >
                    {tr("settings.autoplayDesc")}
                  </div>
                </div>
              </div>

              {autoplayNextEnabled && (
                <>
                  {/* Duration input */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      marginTop: 8,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--text2)",
                      }}
                    >
                      {tr("settings.countdownDuration")}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text3)",
                        marginBottom: 4,
                      }}
                    >
                      {tr("settings.autoplayCountdownDesc")}
                    </div>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 12 }}
                    >
                      <input
                        type="number"
                        min={0}
                        max={60}
                        className="apikey-input"
                        style={{ width: 90, marginBottom: 0 }}
                        value={autoplayNextDuration}
                        onChange={(e) =>
                          setAutoplayNextDuration(e.target.value)
                        }
                        onBlur={() => {
                          const num = Math.max(
                            0,
                            Math.min(
                              60,
                              parseInt(autoplayNextDuration, 10) || 0,
                            ),
                          );
                          setAutoplayNextDuration(num);
                          storage.set(STORAGE_KEYS.AUTOPLAY_NEXT_DURATION, num);
                          flash();
                        }}
                      />
                      <span style={{ fontSize: 14, color: "var(--text2)" }}>
                        seconds
                      </span>
                    </div>
                  </div>

                  {/* Overlay Layout selection */}
                  <div style={{ marginTop: 16 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--text2)",
                        marginBottom: 8,
                      }}
                    >
                      {tr("settings.overlayPosition")}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text3)",
                        marginBottom: 12,
                      }}
                    >
                      {tr("settings.autoplaySideDesc")}
                    </div>
                    <SettingsSelect
                      value={autoplayNextLayout}
                      onChange={(val) => {
                        setAutoplayNextLayout(val);
                        storage.set(STORAGE_KEYS.AUTOPLAY_NEXT_LAYOUT, val);
                        flash();
                      }}
                      options={[
                        { value: "left", label: tr("settings.leftSide") },
                        { value: "right", label: tr("settings.rightSide") },
                      ]}
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          <Divider />

          {/* Intro Skip */}
          <div style={{ marginBottom: 40 }}>
            <div className="settings-section-title">{tr("settings.animeIntroSkip")}</div>
            <div
              style={{
                fontSize: 13,
                color: "var(--text3)",
                marginBottom: 16,
                lineHeight: 1.6,
              }}
            >
              Uses{" "}
              <span style={{ color: "var(--text)", fontWeight: 600 }}>
                AniSkip
              </span>{" "}
              {tr("settings.aniskipDesc")}
            </div>
            <div
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "0 16px",
              }}
            >
              {[
                {
                  value: "off",
                  label: tr("settings.skipOff"),
                  desc: tr("settings.skipOffDesc"),
                },
                {
                  value: "auto",
                  label: tr("settings.skipAuto"),
                  desc: tr("settings.skipAutoDesc"),
                },
                {
                  value: "manual",
                  label: tr("settings.skipManual"),
                  desc: tr("settings.skipManualDesc"),
                },
              ].map(({ value, label, desc }, i, arr) => (
                <div
                  key={value}
                  onClick={() => {
                    setIntroSkipMode(value);
                    storage.set(STORAGE_KEYS.INTRO_SKIP_MODE, value);
                    window.dispatchEvent(
                      new CustomEvent("streambert:player-settings-changed"),
                    );
                  }}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 14,
                    padding: "16px 0",
                    borderBottom:
                      i < arr.length - 1 ? "1px solid var(--border)" : "none",
                    cursor: "pointer",
                  }}
                >
                  {/* Radio dot */}
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      border: `2px solid ${introSkipMode === value ? "var(--red)" : "var(--border)"}`,
                      background:
                        introSkipMode === value ? "var(--red)" : "transparent",
                      flexShrink: 0,
                      marginTop: 1,
                      boxShadow:
                        introSkipMode === value
                          ? "0 0 0 3px rgba(229,9,20,0.18)"
                          : "none",
                      transition: "all 0.15s",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {introSkipMode === value && (
                      <div
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "#fff",
                        }}
                      />
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: "var(--text)",
                      }}
                    >
                      {label}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text3)",
                        marginTop: 3,
                        lineHeight: 1.5,
                      }}
                    >
                      {desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* GROUP: SUBTITLES                                                   */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <div ref={secSubtitles} style={{ scrollMarginTop: 80 }}>
          <SectionGroupHeader
            title={tr("settings.subtitles")}
            subtitle={tr("settings.subtitleDownloadSourcePreferredLanguageAndApiKey")}
          />
          <SubtitleSettingsSection />
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* GROUP: DOWNLOADS                                                   */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <div ref={secDownloads} style={{ scrollMarginTop: 80 }}>
          <SectionGroupHeader
            title={tr("settings.downloads")}
            subtitle={tr("settings.whereDownloadedVideoFilesAreSavedOnDisk")}
          />

          <div style={{ marginBottom: 40 }}>
            <div className="settings-section-title">{tr("settings.downloadFolder")}</div>
            <div
              style={{
                fontSize: 13,
                color: "var(--text3)",
                marginBottom: 16,
                lineHeight: 1.6,
              }}
            >
              {tr("settings.downloadFolderDesc")}
            </div>
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <input
                className="apikey-input"
                style={{ flex: 1, minWidth: 260, marginBottom: 0 }}
                placeholder="/home/you/Movies"
                value={downloadPath}
                onChange={(e) => setDownloadPath(e.target.value)}
              />
              {isElectron && (
                <button className="btn btn-secondary" onClick={pickFolder}>
                  {tr("settings.browse")}
                </button>
              )}
              <button className="btn btn-primary" onClick={handleSavePath}>
                {tr("settings.save")}
              </button>
            </div>
            {saved && (
              <div style={{ marginTop: 10, fontSize: 13, color: "#4caf50" }}>
                ✓ {tr("settings.saved")}
              </div>
            )}
            {!downloadPath && (
              <div style={{ marginTop: 10, fontSize: 13, color: "var(--red)" }}>
                ⚠ No download folder set - videos cannot be downloaded until you
                set one.
              </div>
            )}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* GROUP: NOTIFICATIONS                                               */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <div ref={secNotifications} style={{ scrollMarginTop: 80 }}>
          <SectionGroupHeader
            title={tr("settings.notifications")}
            subtitle={tr("settings.desktopAlertsForDownloadsAndNewEpisodeReleases")}
          />
          <NotificationsSection />
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* GROUP: DISCORD RICH PRESENCE                                       */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <div ref={secDiscordRpc} style={{ scrollMarginTop: 80 }}>
          <SectionGroupHeader
            title={tr("settings.discordRichPresence")}
            subtitle={tr("settings.showWhatYouReWatchingOnYourDiscordProfile")}
          />
          <DiscordRpcSection />
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* GROUP: INTERFACE                                                   */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <div ref={secInterface} style={{ scrollMarginTop: 80 }}>
          <SectionGroupHeader
            title={t("settings.interface")}
            subtitle={t("settings.interfaceSub")}
          />
          <HomeLayoutSection />
          <Divider />
          <StartPageSection />
          <Divider />
          <AppearanceSection />
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* GROUP: LIBRARY                                                     */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <div ref={secLibrary} style={{ scrollMarginTop: 80 }}>
          <SectionGroupHeader
            title={t("settings.library")}
            subtitle={t("settings.librarySub")}
          />
          <LibraryPrivacySection />
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* GROUP: BACKUP                                                      */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <div ref={secBackup} style={{ scrollMarginTop: 80 }}>
          <SectionGroupHeader
            title={t("settings.backup")}
            subtitle={t("settings.backupSub")}
          />
          <BackupRestoreSection />
          <LibraryMaintenanceSection />
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* GROUP: STORAGE & DATA                                              */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        <div ref={secStorage} style={{ scrollMarginTop: 80 }}>
          <SectionGroupHeader
            title={t("settings.storage")}
            subtitle={tr("settings.clearCacheWatchProgressDownloadsOrResetTheEntireApp")}
          />

          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            {/* Install location */}
            <div style={{ padding: "22px 24px" }}>
              <CleanRow
                title={tr("settings.installLocation")}
                description={tr("settings.opensTheFolderWhereGigiIsInstalled")}
                buttonLabel={tr("settings.openFolder")}
                onAction={async () => {
                  const p = await window.electron?.getInstallPath?.();
                  if (p) window.electron.openPath(p);
                }}
              />
            </div>

            <div style={{ height: 1, background: "var(--border)" }} />

            {/* Cache */}
            <div style={{ padding: "22px 24px" }}>
              <CleanRow
                title={tr("settings.clearCache")}
                description={tr("settings.removesTemporaryBrowserCacheShaderCacheAndServiceWor")}
                buttonLabel={tr("settings.clearCacheBtn")}
                onAction={handleClearCache}
                sizeLabel={formatBytes(sizes.cache)}
              />
            </div>

            <div style={{ height: 1, background: "var(--border)" }} />

            {/* Watch Progress */}
            <div style={{ padding: "22px 24px" }}>
              <CleanRow
                title={tr("settings.clearWatchProgressConfirm")}
                description={tr("settings.resetsAllWatchHistoryContinueWatchingProgressAndWatc")}
                buttonLabel={tr("settings.clearProgressBtn")}
                onAction={() =>
                  new Promise((resolve) => {
                    setShowProgressConfirm(true);
                    window.__progressConfirmResolve = resolve;
                  })
                }
                danger
              />
            </div>

            <div style={{ height: 1, background: "var(--border)" }} />

            {/* Delete Downloads */}
            <div style={{ padding: "22px 24px" }}>
              <CleanRow
                title={tr("settings.deleteAllDownloadsConfirm")}
                description={tr("settings.permanentlyDeletesAllVideoFilesThatWereDownloadedThr")}
                buttonLabel={tr("settings.deleteAllBtn")}
                onAction={() =>
                  new Promise((resolve) => {
                    setShowDeleteDlConfirm(true);
                    window.__deleteDlConfirmResolve = resolve;
                  })
                }
                sizeLabel={formatBytes(sizes.downloads)}
                danger
              />
            </div>

            <div style={{ height: 1, background: "var(--border)" }} />

            {/* Full Reset */}
            <div
              style={{
                padding: "22px 24px",
                background: "rgba(229,9,20,0.03)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 24,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: "var(--text)",
                      marginBottom: 4,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    {tr("settings.resetApp")}
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: 1,
                        color: "var(--red)",
                        background: "rgba(229,9,20,0.12)",
                        border: "1px solid rgba(229,9,20,0.25)",
                        padding: "2px 7px",
                        borderRadius: 4,
                        textTransform: "uppercase",
                      }}
                    >
                      {tr("settings.irreversible")}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--text3)",
                      lineHeight: 1.6,
                    }}
                  >
                    {tr("settings.resetDesc")}
                  </div>
                </div>
                <div style={{ flexShrink: 0, paddingTop: 2 }}>
                  <button
                    className="btn"
                    onClick={() => setShowResetConfirm(true)}
                    onMouseEnter={() => setResetHovered(true)}
                    onMouseLeave={() => setResetHovered(false)}
                    style={{
                      color: resetHovered ? "#fff" : "var(--red)",
                      background: resetHovered
                        ? "rgba(229,9,20,0.85)"
                        : "rgba(229,9,20,0.08)",
                      border: resetHovered
                        ? "1px solid transparent"
                        : "1px solid rgba(229,9,20,0.3)",
                      transition: "all 0.2s",
                    }}
                  >
                    {tr("settings.resetApp")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
