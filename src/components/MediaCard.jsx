import { useState, useEffect, useRef, useCallback, memo } from "react";
import { imgUrl, isAnimeContent } from "../utils/api";
import { useT } from "../utils/i18n";
import {
  PlayIcon,
  FilmIcon,
  TVIcon,
  WatchedIcon,
  RatingShieldIcon,
  RatingLockIcon,
  BookmarkIcon,
  BookmarkFillIcon,
  HeartIcon,
  HeartFillIcon,
} from "./Icons";

const MediaCard = memo(function MediaCard({
  item,
  onClick,
  progress,
  watched,
  onMarkWatched,
  onMarkUnwatched,
  ageRating,
  restricted,
  isSaved = false,
  onToggleSave,
  isFavorite = false,
  onToggleFavorite,
  onEdit,
  selectable = false,
  selected = false,
  onToggleSelect,
}) {
  const t = useT();
  const title = item.title || item.name;
  const year = (item.release_date || item.first_air_date || "").slice(0, 4);
  const isTV = item.media_type === "tv";
  const isAnime = isAnimeContent(item);

  // Unreleased detection
  const rawDate = item.release_date || item.first_air_date;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isUnreleased = rawDate ? new Date(rawDate) > today : false;

  // Build watched key for TV cards from Continue Watching we get season/episode
  const watchedKey = isTV
    ? item.season != null && item.episode != null
      ? `tv_${item.id}_s${item.season}e${item.episode}`
      : `tv_${item.id}`
    : `movie_${item.id}`;

  const isWatched = !!watched?.[watchedKey];

  // Context menu state
  const [menu, setMenu] = useState(null); // { x, y }
  const menuRef = useRef(null);

  // For TV series cards without a specific episode, watched marking is disabled
  const canMarkWatched = !isTV || (item.season != null && item.episode != null);
  const hasMenu =
    canMarkWatched || !!onToggleSave || !!onToggleFavorite || !!onEdit;

  const openMenu = useCallback(
    (e) => {
      if (!hasMenu) return;
      e.preventDefault();
      e.stopPropagation();
      setMenu({ x: e.clientX, y: e.clientY });
    },
    [hasMenu],
  );

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [menu]);

  const handleMarkWatched = (e) => {
    e.stopPropagation();
    onMarkWatched?.(watchedKey);
    setMenu(null);
  };
  const handleMarkUnwatched = (e) => {
    e.stopPropagation();
    onMarkUnwatched?.(watchedKey);
    setMenu(null);
  };
  const handleToggleSave = (e) => {
    e.stopPropagation();
    onToggleSave?.(item);
    setMenu(null);
  };
  const handleToggleFavorite = (e) => {
    e.stopPropagation();
    onToggleFavorite?.(item);
    setMenu(null);
  };
  const handleEdit = (e) => {
    e.stopPropagation();
    onEdit?.(item);
    setMenu(null);
  };
  const handleSelect = (e) => {
    e.stopPropagation();
    onToggleSelect?.(item);
  };

  return (
    <>
      <div
        className={`card${isWatched ? " ep-watched" : ""}${isUnreleased ? " card--unreleased" : ""}${selected ? " card--selected" : ""}`}
        onClick={onClick}
        onContextMenu={isUnreleased ? undefined : openMenu}
      >
        <div
          className={`card-poster${selectable ? " card-poster--selectable" : ""}`}
        >
          {item.poster_path ? (
            <img
              src={imgUrl(item.poster_path, "w342")}
              alt={title}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="no-poster">
              {isTV ? <TVIcon /> : <FilmIcon />}
              <span style={{ fontSize: 10, color: "var(--text3)" }}>
                {t("mediaCard.noImage")}
              </span>
            </div>
          )}
          {ageRating && (
            <div
              className={`card-age-badge${restricted ? " card-age-badge--restricted" : ""}`}
            >
              {restricted ? (
                <RatingLockIcon size={9} />
              ) : (
                <RatingShieldIcon size={9} />
              )}
              {ageRating}
            </div>
          )}

          {selectable && (
            <button
              className={`card-select${selected ? " selected" : ""}`}
              onClick={handleSelect}
              aria-label={
                selected ? t("mediaCard.deselect") : t("mediaCard.select")
              }
              title={
                selected ? t("mediaCard.deselect") : t("mediaCard.select")
              }
            >
              {selected ? "✓" : ""}
            </button>
          )}

          {onToggleSave && (
            <button
              className={`card-save${isSaved ? " is-saved" : ""}`}
              onClick={handleToggleSave}
              aria-label={
                isSaved
                  ? t("mediaCard.removeWatchlist")
                  : t("mediaCard.addWatchlist")
              }
              title={
                isSaved
                  ? t("mediaCard.removeWatchlist")
                  : t("mediaCard.addWatchlist")
              }
            >
              {isSaved ? <BookmarkFillIcon /> : <BookmarkIcon />}
            </button>
          )}

          {onToggleFavorite && isSaved && (
            <button
              className={`card-favorite${isFavorite ? " is-favorite" : ""}`}
              onClick={handleToggleFavorite}
              aria-label={
                isFavorite
                  ? t("mediaCard.removeFavorite")
                  : t("mediaCard.addFavorite")
              }
              title={
                isFavorite
                  ? t("mediaCard.removeFavorite")
                  : t("mediaCard.addFavorite")
              }
            >
              {isFavorite ? <HeartFillIcon /> : <HeartIcon />}
            </button>
          )}

          <div className="card-overlay">
            {isUnreleased ? (
              <div className="card-unreleased-overlay">
                <span className="card-unreleased-label">
                  🔒 {t("mediaCard.unreleased")}
                </span>
              </div>
            ) : (
              <div className="card-play">
                <PlayIcon />
              </div>
            )}
          </div>
          {!isUnreleased && progress > 0 && !isWatched && (
            <div className="card-progress">
              <div
                className="card-progress-fill"
                style={{ width: `${Math.min(progress, 100)}%` }}
              />
            </div>
          )}
          {!isUnreleased && isWatched && (
            <div className="card-watched-badge">
              <WatchedIcon size={26} />
            </div>
          )}
        </div>
        <div className="card-info">
          <div className="card-title" title={title}>
            {title}
          </div>
          <div className="card-year">
            {isTV && item.season != null && item.episode != null
              ? `S${item.season}E${item.episode}${item.episodeName ? ` · ${item.episodeName}` : ""}`
              : `${year} · ${isTV ? t("mediaCard.series") : t("mediaCard.movie")}`}
          </div>
        </div>
        <span
          className={`card-badge${isUnreleased ? " card-badge--unreleased" : ""}${isAnime && !isUnreleased ? " card-badge--anime" : ""}`}
        >
          {isUnreleased ? "SOON" : isAnime ? "ANIME" : isTV ? "TV" : "HD"}
        </span>
      </div>

      {menu && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ top: menu.y, left: menu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {canMarkWatched &&
            (isWatched ? (
              <button
                className="context-menu-item"
                onClick={handleMarkUnwatched}
              >
                ↩ {t("mediaCard.markUnwatched")}
              </button>
            ) : (
              <button className="context-menu-item" onClick={handleMarkWatched}>
                ✓ {t("mediaCard.markWatched")}
              </button>
            ))}
          {onToggleSave && (
            <button className="context-menu-item" onClick={handleToggleSave}>
              {isSaved
                ? `✕ ${t("mediaCard.removeWatchlist")}`
                : `+ ${t("mediaCard.addWatchlist")}`}
            </button>
          )}
          {onToggleFavorite && isSaved && (
            <button className="context-menu-item" onClick={handleToggleFavorite}>
              {isFavorite
                ? `♥ ${t("mediaCard.removeFavorite")}`
                : `♡ ${t("mediaCard.addFavorite")}`}
            </button>
          )}
          {onEdit && (
            <button className="context-menu-item" onClick={handleEdit}>
              ✎ {t("mediaCard.edit")}
            </button>
          )}
        </div>
      )}
    </>
  );
});
export default MediaCard;
