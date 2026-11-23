import { useEffect, useMemo } from "react";
import { imgUrl } from "../utils/api";

const normalizeCastPerson = (person) => {
  if (Array.isArray(person.roles)) {
    return {
      ...person,
      characterList: person.roles.map((r) => r.character).filter(Boolean),
    };
  }

  return {
    ...person,
    characterList: person.character ? [person.character] : [],
  };
};

const normalizeCrewPerson = (person) => {
  if (Array.isArray(person.jobs)) {
    return {
      ...person,
      jobList: person.jobs.map((j) => j.job),
    };
  }

  return {
    ...person,
    jobList: person.job ? [person.job] : [],
  };
};

// Keep the first entry per person id (crew can list one person many times).
const dedupeById = (people) => {
  const seen = new Set();
  return people.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
};

const getDirectors = (crew) =>
  dedupeById(
    crew
      .map(normalizeCrewPerson)
      .filter((person) => person.jobList.includes("Director")),
  );

const getByJobs = (crew, jobs) =>
  dedupeById(
    crew
      .map(normalizeCrewPerson)
      .filter((person) => person.jobList.some((job) => jobs.includes(job))),
  );

const getWriters = (crew) =>
  getByJobs(crew, [
    "Screenplay",
    "Writer",
    "Story",
    "Teleplay",
    "Novel",
    "Characters",
  ]);

function PersonCard({ person, onOpenPerson }) {
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
      title={`Open ${person.name}'s page`}
      aria-label={`Open ${person.name}'s page`}
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
  }, [crew, directors, writers, cinematographers, composers, producers]);

  return (
    <div className="cast-overlay" onClick={onClose}>
      <div
        className="cast-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Cast & Crew — ${title}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cast-modal-header">
          <span className="cast-modal-title">🎭 Cast &amp; Crew — {title}</span>
          <button
            className="cast-close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="cast-modal-body">
          <Section
            title="Creators"
            people={normalizedCreators}
            limit={4}
            onOpenPerson={onOpenPerson}
          />
          <Section
            title="Directors"
            people={directors}
            limit={4}
            onOpenPerson={onOpenPerson}
          />
          <Section
            title="Writers"
            people={writers}
            limit={6}
            onOpenPerson={onOpenPerson}
          />
          <Section
            title="Cinematography"
            people={cinematographers}
            limit={4}
            onOpenPerson={onOpenPerson}
          />
          <Section
            title="Music"
            people={composers}
            limit={4}
            onOpenPerson={onOpenPerson}
          />
          <Section
            title="Producers"
            people={producers}
            limit={6}
            onOpenPerson={onOpenPerson}
          />
          {normalizedCast.length > 0 ? (
            <Section
              title="Cast"
              people={normalizedCast}
              limit={20}
              onOpenPerson={onOpenPerson}
            />
          ) : (
            <div className="cast-empty">No cast information available.</div>
          )}
          <Section
            title="More crew"
            people={otherCrew}
            limit={30}
            onOpenPerson={onOpenPerson}
          />
        </div>
      </div>
    </div>
  );
}
