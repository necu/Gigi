import { useEffect, useMemo, useState } from "react";
import { PlaylistIcon } from "../components/Icons";
import { imgUrl, tmdbFetch } from "../utils/api";
import {
  PERSON_FILTERS,
  creditLabel,
  creditMeta,
  creditYear,
  departmentKey,
  isKnownFor,
  normalizePersonCredits,
} from "../utils/people";
import { usePlaylists } from "../utils/usePlaylists";
import { useT } from "../utils/i18n";

function PersonCreditCard({
  credit,
  onSelect,
  knownFor = false,
  saved = false,
  onToggleSave,
}) {
  const t = useT();
  const title = creditLabel(credit) || t("person.untitled");
  const roles = credit.roles?.filter(Boolean) || [];
  const roleLabel = roles.slice(0, 3).join(" · ") || t("person.crew");
  const typeLabel =
    credit.media_type === "tv" ? t("person.series") : t("person.movie");

  return (
    <div className={`person-credit${knownFor ? " person-credit--known" : ""}`}>
      <button
        type="button"
        className="person-credit__open"
        onClick={() => onSelect?.(credit)}
        title={`${title}${roleLabel ? ` — ${roleLabel}` : ""}`}
      >
        <div className="person-credit__poster">
          {credit.poster_path ? (
            <img
              src={imgUrl(credit.poster_path, "w342")}
              alt=""
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span className="person-credit__placeholder">🎞</span>
          )}
          {knownFor && (
            <span className="person-credit__known">{t("person.knownTag")}</span>
          )}
        </div>
        <div className="person-credit__title">{title}</div>
        <div className="person-credit__meta">
          {creditMeta(credit, typeLabel)}
        </div>
        <div className="person-credit__role" title={roleLabel}>
          {roleLabel}
        </div>
      </button>
      {onToggleSave && (
        <button
          type="button"
          className={`person-credit__save${saved ? " is-saved" : ""}`}
          onClick={() => onToggleSave(credit)}
          title={
            saved ? t("person.removeFromLibrary") : t("person.addToLibrary")
          }
          aria-label={
            saved
              ? t("person.removeTitle", { title })
              : t("person.addTitle", { title })
          }
        >
          {saved ? "✓" : "+"}
        </button>
      )}
    </div>
  );
}

export default function PersonPage({
  person,
  apiKey,
  onBack,
  onSelect,
  isSaved,
  onToggleSave,
  onOpenSavedPlaylist,
  isFavoritePerson,
  onToggleFavoritePerson,
}) {
  const t = useT();
  const { playlists, save } = usePlaylists();
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [showFullBio, setShowFullBio] = useState(false);
  const [savingPlaylist, setSavingPlaylist] = useState(false);
  const [playlistNotice, setPlaylistNotice] = useState(null);
  const [playlistError, setPlaylistError] = useState(null);

  const personId = person?.id;

  useEffect(() => {
    let mounted = true;
    setDetails(null);
    setError(null);
    setFilter("all");
    setShowFullBio(false);
    setPlaylistNotice(null);
    setPlaylistError(null);
    if (!personId || !apiKey) {
      setLoading(false);
      if (!apiKey) setError(t("person.apiKeyError"));
      return () => {
        mounted = false;
      };
    }

    setLoading(true);
    tmdbFetch(
      `/person/${personId}?append_to_response=combined_credits,external_ids`,
      apiKey,
    )
      .then((data) => {
        if (mounted) setDetails(data || null);
      })
      .catch(() => {
        if (mounted) setError(t("person.loadError"));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
    // The error strings follow the current language; refetching on language
    // changes is unnecessary, so `t` stays out of the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId, apiKey]);

  useEffect(() => {
    setPlaylistNotice(null);
    setPlaylistError(null);
  }, [filter]);

  const profile = details || person || {};
  const credits = useMemo(() => normalizePersonCredits(details), [details]);
  const filters = useMemo(
    () =>
      PERSON_FILTERS.map((item) => ({
        ...item,
        label: t(`person.filter.${item.id}`),
        count:
          item.id === "all"
            ? credits.length
            : credits.filter((credit) => credit.categories.includes(item.id))
                .length,
      })).filter((item) => item.id === "all" || item.count > 0),
    [credits, t],
  );
  // A filmography reads best as a career timeline: oldest release first, and
  // undated projects at the end. Sort at render time so imported or legacy
  // playlists cannot show decades out of order.
  const visibleCredits = useMemo(() => {
    const filtered =
      filter === "all"
        ? credits
        : credits.filter((credit) => credit.categories.includes(filter));
    return [...filtered].sort((a, b) => {
      const dateA = a.release_date || a.first_air_date || "";
      const dateB = b.release_date || b.first_air_date || "";
      if (!dateA && !dateB) return a.title.localeCompare(b.title);
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateA.localeCompare(dateB) || a.title.localeCompare(b.title);
    });
  }, [credits, filter]);
  const activeFilterLabel =
    filter === "all"
      ? ""
      : filters.find((item) => item.id === filter)?.label || filter;
  const creditCount = (count) =>
    count === 1 ? t("person.creditOne") : t("person.credits", { n: count });
  // The visible list is already in release order; the playlist stores it as-is.
  const playlistCredits = visibleCredits;
  const knownFor = useMemo(
    () =>
      credits
        .filter(isKnownFor)
        .sort(
          (a, b) =>
            (b.popularity || 0) - (a.popularity || 0) ||
            (b.vote_count || 0) - (a.vote_count || 0),
        )
        .slice(0, 8),
    [credits],
  );
  const years = useMemo(
    () => credits.map(creditYear).filter(Boolean).sort((a, b) => a - b),
    [credits],
  );
  const name = profile.name || person?.name || t("person.person");
  const rawDepartment =
    profile.known_for_department || person?.known_for_department || "";
  const department = departmentKey(rawDepartment)
    ? t(`person.dept.${departmentKey(rawDepartment)}`)
    : rawDepartment || t("person.dept.fallback");
  const meta = [
    department,
    profile.birthday
      ? `${t("person.born", { date: profile.birthday })}${
          profile.deathday
            ? ` · ${t("person.died", { date: profile.deathday })}`
            : ""
        }`
      : null,
    profile.place_of_birth || null,
  ].filter(Boolean);

  const saveFilmography = async () => {
    if (!playlistCredits.length || savingPlaylist) return;
    setSavingPlaylist(true);
    setPlaylistError(null);
    setPlaylistNotice(null);
    try {
      const personKey = profile.id || personId;
      const existing = playlists.find(
        (playlist) =>
          playlist.kind === "person" &&
          playlist.meta?.personId === personKey &&
          (playlist.meta?.filterId || "all") === filter,
      );
      const years = playlistCredits.map(creditYear).filter(Boolean);
      const playlistName = `${name} — ${
        activeFilterLabel || t("person.filmography")
      }`;
      const saved = await save({
        id: existing?.id,
        name: playlistName,
        kind: "person",
        meta: {
          personId: personKey,
          personName: name,
          profilePath: profile.profile_path || null,
          department,
          filterId: filter,
          filterLabel: activeFilterLabel,
          yearStart: years[0] || null,
          yearEnd: years[years.length - 1] || null,
        },
        moment: "any",
        genre: "",
        subgenre: "",
        terms: [],
        tags: [
          rawDepartment ? department : null,
          t("person.releaseOrder"),
        ].filter(Boolean),
        items: playlistCredits,
      });
      setPlaylistNotice({
        id: saved?.id || existing?.id || null,
        name: saved?.name || playlistName,
        count: playlistCredits.length,
        updated: Boolean(existing),
      });
    } catch {
      setPlaylistError(t("person.saveError"));
    } finally {
      setSavingPlaylist(false);
    }
  };

  return (
    <div className="fade-in person-page">
      <button type="button" className="btn btn-ghost person-back" onClick={onBack}>
        ← {t("person.back")}
      </button>

      <div className="person-hero">
        <div className="person-portrait">
          {profile.profile_path ? (
            <img
              src={imgUrl(profile.profile_path, "w500")}
              alt={name}
              decoding="async"
            />
          ) : (
            <div className="person-portrait__fallback">{name[0] || "?"}</div>
          )}
        </div>

        <div className="person-intro">
          <div className="library-kicker">{t("person.people")}</div>
          <h1 className="person-name">{name}</h1>
          <div className="person-meta">{meta.join(" · ")}</div>

          {onToggleFavoritePerson && (
            <button
              type="button"
              className={`btn person-favorite${
                isFavoritePerson?.(profile.id || personId) ? " is-favorite" : ""
              }`}
              onClick={() => onToggleFavoritePerson(profile)}
            >
              {isFavoritePerson?.(profile.id || personId) ? "♥" : "♡"}{" "}
              {isFavoritePerson?.(profile.id || personId)
                ? t("person.unfollow")
                : t("person.follow")}
            </button>
          )}

          <div className="person-stats">
            <span>
              <b>{credits.length}</b>{" "}
              {credits.length === 1
                ? t("person.creditWord")
                : t("person.creditWords")}
            </span>
            {years.length > 0 && (
              <span>
                <b>{years[0]}</b>–<b>{years[years.length - 1]}</b>
              </span>
            )}
            {profile.popularity != null && (
              <span>
                <b>{Math.round(profile.popularity)}</b>{" "}
                {t("person.popularity")}
              </span>
            )}
          </div>

          {loading ? (
            <div className="person-bio person-bio--loading">
              {t("person.loadingBio")}
            </div>
          ) : error ? (
            <div className="person-error">{error}</div>
          ) : (
            <div className="person-bio-wrap">
              <p
                className={`person-bio${showFullBio ? " person-bio--full" : ""}`}
              >
                {profile.biography || t("person.noBio")}
              </p>
              {profile.biography?.length > 420 && (
                <button
                  type="button"
                  className="btn btn-ghost person-bio-toggle"
                  onClick={() => setShowFullBio((value) => !value)}
                >
                  {showFullBio ? t("person.showLess") : t("person.readMore")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {knownFor.length > 0 && (
        <section className="person-section">
          <div className="person-section__head">
            <div>
              <div className="section-title">{t("person.knownFor")}</div>
              <div className="person-section__sub">
                {t("person.knownForSub", { name })}
              </div>
            </div>
          </div>
          <div className="person-credit-grid person-credit-grid--known">
            {knownFor.map((credit) => (
              <PersonCreditCard
                key={`${credit.media_type}_${credit.id}`}
                credit={credit}
                onSelect={onSelect}
                saved={!!isSaved?.(credit)}
                onToggleSave={onToggleSave}
                knownFor
              />
            ))}
          </div>
        </section>
      )}

      <section className="person-section">
        <div className="person-section__head">
          <div>
            <div className="section-title">{t("person.filmography")}</div>
            <div className="person-section__sub">
              {creditCount(visibleCredits.length)}
              {filter !== "all" ? ` · ${activeFilterLabel}` : ""}
            </div>
          </div>
          <div className="person-filmography-actions">
            <button
              type="button"
              className="btn btn-primary person-save-playlist"
              onClick={saveFilmography}
              disabled={savingPlaylist || playlistCredits.length === 0}
              title={
                filter === "all"
                  ? t("person.saveTitleAll")
                  : t("person.saveTitleFilter", { label: activeFilterLabel })
              }
            >
              <PlaylistIcon />
              {savingPlaylist
                ? t("person.saving")
                : filter === "all"
                  ? t("person.saveFilmography")
                  : t("person.saveFilter", { label: activeFilterLabel })}
            </button>
          </div>
        </div>

        {playlistNotice && (
          <div className="person-playlist-notice" role="status">
            <span>
              {t(
                playlistNotice.count === 1
                  ? "person.playlistSavedOne"
                  : "person.playlistSaved",
                {
                  action: playlistNotice.updated
                    ? t("person.updated")
                    : t("person.saved"),
                  name: playlistNotice.name,
                  n: playlistNotice.count,
                },
              )}
            </span>
            {onOpenSavedPlaylist && playlistNotice.id && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => onOpenSavedPlaylist(playlistNotice.id)}
              >
                {t("person.openPlaylist")}
              </button>
            )}
          </div>
        )}
        {playlistError && <div className="person-error">{playlistError}</div>}

        {filters.length > 2 && (
          <div
            className="person-filters"
            role="tablist"
            aria-label={t("person.filterAria")}
          >
            {filters.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                className={`filter-chip${filter === item.id ? " active" : ""}`}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
                <span className="filter-count">{item.count}</span>
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="person-credit-grid">
            {Array.from({ length: 10 }).map((_, index) => (
              <div className="person-credit person-credit--skeleton" key={index}>
                <div className="person-credit__poster" />
                <div className="person-skeleton-line" />
                <div className="person-skeleton-line person-skeleton-line--short" />
              </div>
            ))}
          </div>
        ) : visibleCredits.length > 0 ? (
          <div className="person-credit-grid">
            {visibleCredits.map((credit) => (
              <PersonCreditCard
                key={`${credit.media_type}_${credit.id}`}
                credit={credit}
                onSelect={onSelect}
                saved={!!isSaved?.(credit)}
                onToggleSave={onToggleSave}
              />
            ))}
          </div>
        ) : (
          <div className="person-empty">{t("person.empty")}</div>
        )}
      </section>
    </div>
  );
}
