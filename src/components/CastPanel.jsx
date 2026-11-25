import { useMemo } from "react";
import { imgUrl } from "../utils/api";
import { useT } from "../utils/i18n";
import { CastIcon } from "./Icons";
import {
  dedupeById,
  getByJobs,
  getComposers,
  getDirectors,
  getProducers,
  getTopCast,
  getWriters,
} from "../utils/credits";

function PersonChip({ person, role, onOpenPerson }) {
  const t = useT();
  const label = t("detail.openPerson", { name: person.name });
  const content = (
    <>
      <span className="detail-person__avatar">
        {person.profile_path ? (
          <img
            src={imgUrl(person.profile_path, "w185")}
            alt=""
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="detail-person__fallback">
            {person.name?.[0] || "?"}
          </span>
        )}
      </span>
      <span className="detail-person__name">{person.name}</span>
      {role ? <span className="detail-person__role">{role}</span> : null}
    </>
  );

  if (!onOpenPerson) {
    return <div className="detail-person">{content}</div>;
  }

  return (
    <button
      type="button"
      className="detail-person"
      onClick={() => onOpenPerson(person)}
      title={label}
      aria-label={label}
    >
      {content}
    </button>
  );
}

function SkeletonRow() {
  return (
    <div className="detail-people__row" aria-hidden="true">
      <div className="detail-people__label">
        <span className="detail-people__skeleton-line" />
      </div>
      <div className="detail-people__list">
        {Array.from({ length: 8 }).map((_, index) => (
          <div className="detail-person detail-person--skeleton" key={index}>
            <span className="detail-person__avatar" />
            <span className="detail-person__skeleton-line" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CastPanel({
  cast = [],
  crew = [],
  creators = [],
  loading = false,
  onOpenPerson,
  onShowAll,
}) {
  const t = useT();

  const groups = useMemo(() => {
    const directing = new Map();
    for (const person of creators || []) {
      if (!person?.id) continue;
      directing.set(person.id, {
        ...person,
        role: t("detail.peopleCreating"),
      });
    }
    for (const person of getDirectors(crew)) {
      if (!directing.has(person.id)) {
        directing.set(person.id, {
          ...person,
          role: t("detail.peopleDirecting"),
        });
      }
    }

    const castPeople = getTopCast(cast, 14).map((person) => ({
      ...person,
      role: person.characterList?.[0] || t("detail.peopleCast"),
    }));

    const crewMap = new Map();
    const addCrew = (people, role) => {
      for (const person of people) {
        if (!person?.id) continue;
        const existing = crewMap.get(person.id);
        if (existing) {
          if (!existing.roles.includes(role)) existing.roles.push(role);
        } else {
          crewMap.set(person.id, { ...person, roles: [role] });
        }
      }
    };
    addCrew(getWriters(crew), t("detail.peopleWriting"));
    addCrew(getComposers(crew), t("detail.peopleMusic"));
    addCrew(
      getByJobs(crew, ["Director of Photography", "Cinematography"]),
      t("detail.peopleCinematography"),
    );
    addCrew(getProducers(crew), t("detail.peopleProducing"));

    return [
      {
        key: "directing",
        label: t("detail.peopleDirecting"),
        people: [...directing.values()],
      },
      {
        key: "cast",
        label: t("detail.peopleCast"),
        people: dedupeById(castPeople),
      },
      {
        key: "crew",
        label: t("detail.peopleCrew"),
        people: [...crewMap.values()].map((person) => ({
          ...person,
          role: person.roles.join(" · "),
        })),
      },
    ].filter((group) => group.people.length > 0);
  }, [cast, crew, creators, t]);

  if (!loading && groups.length === 0) {
    return (
      <section className="detail-people" aria-label={t("detail.peopleTitle")}>
        <div className="detail-people__head">
          <div>
            <div className="detail-people__title">
              {t("detail.peopleTitle")}
            </div>
            <div className="detail-people__sub">{t("detail.peopleSub")}</div>
          </div>
        </div>
        <div className="detail-people__empty">{t("detail.peopleEmpty")}</div>
      </section>
    );
  }

  return (
    <section className="detail-people" aria-label={t("detail.peopleTitle")}>
      <div className="detail-people__head">
        <div>
          <div className="detail-people__title">{t("detail.peopleTitle")}</div>
          <div className="detail-people__sub">{t("detail.peopleSub")}</div>
        </div>
        {onShowAll && !loading && (
          <button
            type="button"
            className="btn btn-secondary detail-people__all"
            onClick={onShowAll}
          >
            <CastIcon /> {t("detail.peopleAll")}
          </button>
        )}
      </div>

      <div className="detail-people__rows">
        {loading ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : (
          groups.map((group) => (
            <div className="detail-people__row" key={group.key}>
              <div className="detail-people__label">{group.label}</div>
              <div className="detail-people__list">
                {group.people.map((person) => (
                  <PersonChip
                    key={`${group.key}_${person.id}`}
                    person={person}
                    role={person.role}
                    onOpenPerson={onOpenPerson}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
