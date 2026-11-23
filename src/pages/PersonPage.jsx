import { useEffect, useMemo, useState } from "react";
import { imgUrl, tmdbFetch } from "../utils/api";
import {
  PERSON_FILTERS,
  creditLabel,
  creditMeta,
  creditYear,
  departmentLabel,
  isKnownFor,
  normalizePersonCredits,
} from "../utils/people";

function PersonCreditCard({ credit, onSelect, knownFor = false }) {
  const title = creditLabel(credit) || "Untitled";
  const roles = credit.roles?.filter(Boolean) || [];
  const roleLabel = roles.slice(0, 3).join(" · ") || "Crew";

  return (
    <button
      type="button"
      className={`person-credit${knownFor ? " person-credit--known" : ""}`}
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
        {knownFor && <span className="person-credit__known">Known for</span>}
      </div>
      <div className="person-credit__title">{title}</div>
      <div className="person-credit__meta">{creditMeta(credit)}</div>
      <div className="person-credit__role" title={roleLabel}>
        {roleLabel}
      </div>
    </button>
  );
}

export default function PersonPage({ person, apiKey, onBack, onSelect }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [showFullBio, setShowFullBio] = useState(false);

  const personId = person?.id;

  useEffect(() => {
    let mounted = true;
    setDetails(null);
    setError(null);
    setFilter("all");
    setShowFullBio(false);
    if (!personId || !apiKey) {
      setLoading(false);
      if (!apiKey) setError("Add a TMDB API key to load this filmography.");
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
        if (mounted) setError("Could not load this person from TMDB.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [personId, apiKey]);

  const profile = details || person || {};
  const credits = useMemo(() => normalizePersonCredits(details), [details]);
  const filters = useMemo(
    () =>
      PERSON_FILTERS.map((item) => ({
        ...item,
        count:
          item.id === "all"
            ? credits.length
            : credits.filter((credit) => credit.categories.includes(item.id))
                .length,
      })).filter((item) => item.id === "all" || item.count > 0),
    [credits],
  );
  const visibleCredits = useMemo(
    () =>
      filter === "all"
        ? credits
        : credits.filter((credit) => credit.categories.includes(filter)),
    [credits, filter],
  );
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
  const name = profile.name || person?.name || "Person";
  const department = departmentLabel(
    profile.known_for_department || person?.known_for_department,
  );
  const meta = [
    department,
    profile.birthday
      ? `Born ${profile.birthday}${profile.deathday ? ` · died ${profile.deathday}` : ""}`
      : null,
    profile.place_of_birth || null,
  ].filter(Boolean);

  return (
    <div className="fade-in person-page">
      <button type="button" className="btn btn-ghost person-back" onClick={onBack}>
        ← Back
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
          <div className="library-kicker">People</div>
          <h1 className="person-name">{name}</h1>
          <div className="person-meta">{meta.join(" · ")}</div>

          <div className="person-stats">
            <span>
              <b>{credits.length}</b> credits
            </span>
            {years.length > 0 && (
              <span>
                <b>{years[0]}</b>–<b>{years[years.length - 1]}</b>
              </span>
            )}
            {profile.popularity != null && (
              <span>
                <b>{Math.round(profile.popularity)}</b> popularity
              </span>
            )}
          </div>

          {loading ? (
            <div className="person-bio person-bio--loading">Loading biography…</div>
          ) : error ? (
            <div className="person-error">{error}</div>
          ) : (
            <div className="person-bio-wrap">
              <p
                className={`person-bio${showFullBio ? " person-bio--full" : ""}`}
              >
                {profile.biography || "No biography available for this person yet."}
              </p>
              {profile.biography?.length > 420 && (
                <button
                  type="button"
                  className="btn btn-ghost person-bio-toggle"
                  onClick={() => setShowFullBio((value) => !value)}
                >
                  {showFullBio ? "Show less" : "Read more"}
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
              <div className="section-title">Known for</div>
              <div className="person-section__sub">
                The work people usually recognise {name} from.
              </div>
            </div>
          </div>
          <div className="person-credit-grid person-credit-grid--known">
            {knownFor.map((credit) => (
              <PersonCreditCard
                key={`${credit.media_type}_${credit.id}`}
                credit={credit}
                onSelect={onSelect}
                knownFor
              />
            ))}
          </div>
        </section>
      )}

      <section className="person-section">
        <div className="person-section__head">
          <div>
            <div className="section-title">Filmography</div>
            <div className="person-section__sub">
              {visibleCredits.length} credit
              {visibleCredits.length === 1 ? "" : "s"}
              {filter !== "all"
                ? ` · ${filters.find((item) => item.id === filter)?.label || filter}`
                : ""}
            </div>
          </div>
        </div>

        {filters.length > 2 && (
          <div className="person-filters" role="tablist" aria-label="Credit type">
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
              />
            ))}
          </div>
        ) : (
          <div className="person-empty">No credits in this category.</div>
        )}
      </section>
    </div>
  );
}
