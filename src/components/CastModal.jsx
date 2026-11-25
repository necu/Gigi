import { useEffect, useMemo } from "react";
import { imgUrl } from "../utils/api";
import { useT } from "../utils/i18n";
import {
  dedupeById,
  getByJobs,
  getDirectors,
  getWriters,
  normalizeCastPerson,
  normalizeCrewPerson,
} from "../utils/credits";

function PersonCard({ person, onOpenPerson }) {
  const t = useT();
  const subtitle =
    person.characterList?.join(", ") || person.jobList?.join(", ") || "";
  const content = (
    <>
      {person.profile_path ? (
        <img
          src={imgUrl(person.profile_path, "w185")}
          alt={person.name}
          className="cast-person-photo"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="cast-person-photo cast-person-photo--fallback">
          {person.name?.[0] ?? "?"}
        </div>
      )}
      <div className="cast-person-name">{person.name}</div>
      <div className="cast-person-character">{subtitle}</div>
    </>
  );

  if (!onOpenPerson) {
    return <div className="cast-person">{content}</div>;
  }

  return (
    <button
      type="button"
      className="cast-person cast-person--link"
      onClick={() => onOpenPerson(person)}
      title={t("cast.openPerson", { name: person.name })}
      aria-label={t("cast.openPerson", { name: person.name })}
    >
      {content}
    </button>
  );
}

function Section({ title, people, limit, onOpenPerson }) {
  if (!people.length) return null;
  return (
    <div className="cast-section">
      <div className="cast-section-title">{title}</div>
      <div className="cast-grid">
        {people.slice(0, limit).map((person) => (
          <PersonCard
            key={person.id}
            person={person}
            onOpenPerson={onOpenPerson}
          />
        ))}
      </div>
    </div>
  );
}

export default function CastModal({
  onClose,
  cast = [],
  crew = [],
  creators = [],
  title,
  onOpenPerson,
}) {
  const t = useT();
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Lock body scroll while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const directors = useMemo(() => getDirectors(crew), [crew]);
  const writers = useMemo(() => getWriters(crew), [crew]);
  const cinematographers = useMemo(
    () => getByJobs(crew, ["Director of Photography", "Cinematography"]),
    [crew],
  );
  const composers = useMemo(
    () => getByJobs(crew, ["Original Music Composer", "Music", "Composer"]),
    [crew],
  );
  const producers = useMemo(
    () =>
      getByJobs(crew, [
        "Producer",
        "Executive Producer",
        "Co-Producer",
        "Line Producer",
      ]),
    [crew],
  );
  const normalizedCast = useMemo(
    () => dedupeById(cast.map(normalizeCastPerson)),
    [cast],
  );
  const normalizedCreators = useMemo(
    () =>
      dedupeById(
        creators.map((person) => ({ ...person, jobList: ["Creator"] })),
      ),
    [creators],
  );
  const otherCrew = useMemo(() => {
    const featured = new Set(
      [
        ...normalizedCreators,
        ...directors,
        ...writers,
        ...cinematographers,
        ...composers,
        ...producers,
      ].map((person) => person.id),
    );
    return dedupeById(crew.map(normalizeCrewPerson)).filter(
      (person) => !featured.has(person.id),
    );
  }, [
    crew,
    normalizedCreators,
    directors,
    writers,
    cinematographers,
    composers,
    producers,
  ]);

  return (
    <div className="cast-overlay" onClick={onClose}>
      <div
        className="cast-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("cast.title", { title })}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cast-modal-header">
          <span className="cast-modal-title">
            🎭 {t("cast.title", { title })}
          </span>
          <button
            className="cast-close-btn"
            onClick={onClose}
            aria-label={t("cast.close")}
          >
            ✕
          </button>
        </div>

        <div className="cast-modal-body">
          <Section
            title={t("cast.creators")}
            people={normalizedCreators}
            limit={4}
            onOpenPerson={onOpenPerson}
          />
          <Section
            title={t("cast.directors")}
            people={directors}
            limit={4}
            onOpenPerson={onOpenPerson}
          />
          <Section
            title={t("cast.writers")}
            people={writers}
            limit={10}
            onOpenPerson={onOpenPerson}
          />
          <Section
            title={t("cast.cinematography")}
            people={cinematographers}
            limit={4}
            onOpenPerson={onOpenPerson}
          />
          <Section
            title={t("cast.music")}
            people={composers}
            limit={4}
            onOpenPerson={onOpenPerson}
          />
          <Section
            title={t("cast.producers")}
            people={producers}
            limit={10}
            onOpenPerson={onOpenPerson}
          />
          {normalizedCast.length > 0 ? (
            <Section
              title={t("cast.cast")}
              people={normalizedCast}
              limit={30}
              onOpenPerson={onOpenPerson}
            />
          ) : (
            <div className="cast-empty">{t("cast.empty")}</div>
          )}
          <Section
            title={t("cast.moreCrew")}
            people={otherCrew}
            limit={80}
            onOpenPerson={onOpenPerson}
          />
        </div>
      </div>
    </div>
  );
}
