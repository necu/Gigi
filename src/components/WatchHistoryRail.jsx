import { imgUrl } from "../utils/api";
import { WatchedIcon } from "./Icons";
import { useT } from "../utils/i18n";

function relativeTime(t, ts) {
  const value = Number(ts) || 0;
  if (!value) return "";
  const diff = Math.max(0, Date.now() - value);
  if (diff < 60_000) return t("history.now");
  if (diff < 3_600_000)
    return t("history.minutes", { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000)
    return t("history.hours", { n: Math.floor(diff / 3_600_000) });
  if (diff < 7 * 86_400_000)
    return t("history.days", { n: Math.floor(diff / 86_400_000) });
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/**
 * Permanent watch-history rail. Rendered once by the app shell so it survives
 * every page change, and sticky so it never leaves the screen while scrolling.
 * Clicking an entry reopens its title and resumes the exact position.
 */
export default function WatchHistoryRail({
  history = [],
  watched,
  onSelect,
  onRemoveHistory,
}) {
  const t = useT();

  return (
    <section className="history-rail history-rail--global" aria-label={t("history.eyebrow")}>
      <div className="history-rail__head">
        <div className="history-rail__heading">
          <div className="history-rail__eyebrow">{t("history.eyebrow")}</div>
          <h2 className="history-rail__title">{t("history.title")}</h2>
        </div>
        <span className="history-rail__count">{history.length}</span>
      </div>
      {history.length > 0 ? (
        <div className="history-rail__list">
          {history.slice(0, 10).map((item) => {
            const pk =
              item.media_type === "movie"
                ? `movie_${item.id}`
                : `tv_${item.id}_s${item.season}e${item.episode}`;
            const isWatched = !!watched?.[pk];
            return (
              <div className="history-pill" key={`${pk}_${item.watchedAt}`}>
                <button
                  type="button"
                  className="history-pill__main"
                  onClick={() => onSelect(item)}
                  title={`${item.title}${
                    item.season != null ? ` · S${item.season}E${item.episode}` : ""
                  }`}
                >
                  <span className="history-pill__poster">
                    {item.poster_path ? (
                      <img
                        src={imgUrl(item.poster_path, "w92")}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span>{item.title?.slice(0, 1) || "?"}</span>
                    )}
                  </span>
                  <span className="history-pill__copy">
                    <b>
                      {item.title}
                      {isWatched && <WatchedIcon size={12} />}
                    </b>
                    <small>
                      {item.media_type === "tv" &&
                      item.season != null &&
                      item.episode != null
                        ? `S${item.season}E${item.episode}${
                            item.episodeName ? ` · ${item.episodeName}` : ""
                          }`
                        : t("history.movie")}
                      {" · "}
                      {relativeTime(t, item.watchedAt)}
                    </small>
                  </span>
                </button>
                {onRemoveHistory && (
                  <button
                    type="button"
                    className="history-pill__remove"
                    onClick={() => onRemoveHistory(item)}
                    title={t("history.remove")}
                    aria-label={`${t("history.remove")}: ${item.title}`}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="history-rail__empty">{t("history.empty")}</div>
      )}
    </section>
  );
}
