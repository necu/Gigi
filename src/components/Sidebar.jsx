import { memo } from "react";
import { useSeasonalEvent } from "./seasonalEvents.jsx";
import { useT } from "../utils/i18n";
import {
  GigiLogo,
  HomeIcon,
  SearchIcon,
  HistoryIcon,
  PlaylistIcon,
  SettingsIcon,
  DownloadsQueueIcon,
  QuitIcon,
  BackIcon,
  HelpIcon,
} from "./Icons";

const NAV_ITEMS = [
  { page: "home", labelKey: "nav.home", icon: HomeIcon },
  { page: "playlists", labelKey: "nav.playlists", icon: PlaylistIcon },
  { page: "history", labelKey: "nav.library", icon: HistoryIcon },
  { page: "downloads", labelKey: "nav.downloads", icon: DownloadsQueueIcon },
];

function Sidebar({
  page,
  onNavigate,
  onSearch,
  activeDownloads,
  canGoBack,
  onBack,
  onShowShortcuts,
}) {
  const seasonalEvent = useSeasonalEvent();
  const t = useT();

  return (
    <div className="sidebar">
      <div
        className="sidebar-logo"
        onClick={() => onNavigate("home")}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onNavigate("home");
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Gigi home"
        title="Gigi"
        style={{ position: "relative" }}
      >
        <GigiLogo />
        {seasonalEvent && seasonalEvent.render()}
      </div>

      {canGoBack && (
        <SideBtn onClick={onBack} icon={<BackIcon />} label={t("nav.back")} />
      )}

      <SideBtn onClick={onSearch} icon={<SearchIcon />} label={t("nav.search")} />

      {NAV_ITEMS.map(({ page: target, labelKey, icon: Icon }) => (
        <SideBtn
          key={target}
          active={page === target}
          onClick={() => onNavigate(target)}
          icon={<Icon />}
          label={t(labelKey)}
          badge={
            target === "downloads" && activeDownloads > 0
              ? activeDownloads
              : null
          }
        />
      ))}

      <div className="sidebar-bottom">
        <SideBtn
          onClick={onShowShortcuts}
          icon={<HelpIcon />}
          label={t("nav.help")}
        />
        <SideBtn
          active={page === "settings"}
          onClick={() => onNavigate("settings")}
          icon={<SettingsIcon />}
          label={t("nav.settings")}
        />
        <button
          className="sidebar-btn"
          onClick={() => window.electron?.quitApp?.()}
          title={t("nav.quit")}
          style={{ color: "#e53e3e", marginTop: 4 }}
        >
          <QuitIcon />
          <span className="tooltip">{t("nav.quit")}</span>
        </button>
      </div>
    </div>
  );
}

function SideBtn({ active, onClick, icon, label, badge }) {
  return (
    <button
      type="button"
      className={`sidebar-btn ${active ? "active" : ""}`}
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      style={{ position: "relative" }}
    >
      {icon}
      <span className="tooltip">{label}</span>
      {badge && (
        <span
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            background: "var(--red)",
            color: "white",
            fontSize: 10,
            fontWeight: 700,
            lineHeight: "16px",
            textAlign: "center",
            padding: "0 4px",
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

export default memo(Sidebar);
