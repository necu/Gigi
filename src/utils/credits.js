// ── Cast & crew helpers ──────────────────────────────────────────────────────
// TMDB returns different shapes for movies (credits) and series
// (aggregate_credits): roles/jobs are arrays on TV and plain strings on movies.
// These helpers normalize both so the inline panel and the modal share one view.

export const normalizeCastPerson = (person) => {
  if (Array.isArray(person?.roles)) {
    return {
      ...person,
      characterList: person.roles.map((role) => role?.character).filter(Boolean),
    };
  }

  return {
    ...person,
    characterList: person?.character ? [person.character] : [],
  };
};

export const normalizeCrewPerson = (person) => {
  if (Array.isArray(person?.jobs)) {
    return {
      ...person,
      jobList: person.jobs.map((entry) => entry?.job).filter(Boolean),
    };
  }

  return {
    ...person,
    jobList: person?.job ? [person.job] : [],
  };
};

// Keep the first entry per person id (crew can list one person many times).
export const dedupeById = (people) => {
  const seen = new Set();
  return (people || []).filter((person) => {
    if (!person?.id || seen.has(person.id)) return false;
    seen.add(person.id);
    return true;
  });
};

export const getByJobs = (crew, jobs) =>
  dedupeById(
    (crew || [])
      .map(normalizeCrewPerson)
      .filter((person) => person.jobList.some((job) => jobs.includes(job))),
  );

export const getDirectors = (crew) => getByJobs(crew, ["Director"]);

export const getWriters = (crew) =>
  getByJobs(crew, [
    "Screenplay",
    "Writer",
    "Story",
    "Teleplay",
    "Novel",
    "Characters",
  ]);

export const getCinematographers = (crew) =>
  getByJobs(crew, ["Director of Photography", "Cinematography"]);

export const getComposers = (crew) =>
  getByJobs(crew, ["Original Music Composer", "Music", "Composer"]);

export const getProducers = (crew) =>
  getByJobs(crew, [
    "Producer",
    "Executive Producer",
    "Co-Producer",
    "Line Producer",
  ]);

export const getTopCast = (cast, limit = 14) =>
  dedupeById((cast || []).map(normalizeCastPerson)).slice(0, limit);
