import { imgUrl } from "../utils/api";
import { BookmarkIcon, BookmarkFillIcon } from "./Icons";

/** Compact recommendation card with a match score and one explained reason. */
export default function SmartCard({
  item,
  saved = false,
  onOpen,
  onSave,
  className = "",
}) {
  const title = item.title || item.name || "Untitled";
  const year = (item.release_date || item.first_air_date || "").slice(0, 4);
  const reasons = item._why?.reasons || [];
  const firstReason = reasons[0]?.label || "";
  const match = item._why?.match;

  return (
    <div
      className={`smart-mini${className ? ` ${className}` : ""}`}
      onClick={() => onOpen?.(item)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen?.(item);
        }
      }}
      title={reasons.map((reason) => reason.label).join(" · ") || title}
    >
      <div className="smart-mini__poster">
        {item.poster_path ? (
          <img
            src={imgUrl(item.poster_path, "w342")}
            alt={title}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="smart-mini__placeholder">🎞</span>
        )}
        {match != null && (
          <span className="smart-mini__match">{match}%</span>
        )}
        {onSave && (
          <button
            className={`smart-mini__save${saved ? " is-saved" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              onSave(item);
            }}
            title={saved ? "Remove from library" : "Add to library"}
            aria-label={saved ? "Remove from library" : "Add to library"}
          >
            {saved ? <BookmarkFillIcon /> : <BookmarkIcon />}
          </button>
        )}
      </div>
      <div className="smart-mini__title" title={title}>
        {title}
      </div>
      <div className="smart-mini__year">
        {year || "—"} · {item.media_type === "tv" ? "Series" : "Movie"}
      </div>
      {firstReason && (
        <div className="smart-mini__reason" title={firstReason}>
          {firstReason}
        </div>
      )}
    </div>
  );
}
