// ── People / filmography helpers ─────────────────────────────────────────────
// TMDB returns a person's acting and crew work as two separate lists. The UI
// wants one filmography with role filters, so credits are merged by title and
// tagged with the departments in which the person worked on that title.

export const PERSON_FILTERS = [
  { id: "all", label: "All credits" },
  { id: "acting", label: "Acting" },
  { id: "directing", label: "Directing" },
  { id: "writing", label: "Writing" },
  { id: "camera", label: "Cinematography" },
  { id: "music", label: "Music" },
  { id: "production", label: "Production" },
  { id: "crew", label: "Crew" },
];

const JOB_GROUPS = {
  directing: ["Director"],
  writing: [
    "Writer",
    "Screenplay",
    "Story",
    "Teleplay",
    "Novel",
    "Characters",
    "Author",
    "Creator",
    "Screenstory",
  ],
  camera: [
    "Director of Photography",
    "Cinematography",
    "Camera Operator",
    "Steadicam Operator",
    "Second Unit Director of Photography",
  ],
  music: [
    "Original Music Composer",
    "Music",
    "Composer",
    "Songs",
    "Music Supervisor",
    "Sound",
  ],
  production: [
    "Producer",
    "Executive Producer",
    "Co-Producer",
    "Line Producer",
    "Casting",
    "Production Design",
    "Art Direction",
    "Set Decoration",
    "Costume Design",
  ],
};

const DEPARTMENT_LABELS = {
  Acting: "Acting",
  Directing: "Directing",
  Writing: "Writing",
  Camera: "Cinematography",
  Sound: "Music & sound",
  Music: "Music",
  Production: "Production",
  Art: "Art department",
  Editing: "Editing",
  "Costume & Make-Up": "Costume & make-up",
  "Visual Effects": "Visual effects",
  Lighting: "Lighting",
  Crew: "Crew",
};

export function departmentLabel(department) {
  return DEPARTMENT_LABELS[department] || department || "Film industry";
}

function groupForJob(job) {
  for (const [group, jobs] of Object.entries(JOB_GROUPS)) {
    if (jobs.includes(job)) return group;
  }
  return "crew";
}

function creditTitle(credit) {
  return credit?.title || credit?.name || credit?.original_title || credit?.original_name || "";
}

function rolesForCredit(credit) {
  if (Array.isArray(credit?.roles)) {
    return credit.roles.map((role) => role?.character).filter(Boolean);
  }
  return credit?.character ? [credit.character] : [];
}

function jobsForCredit(credit) {
  if (Array.isArray(credit?.jobs)) {
    return credit.jobs.map((entry) => entry?.job).filter(Boolean);
  }
  return credit?.job ? [credit.job] : [];
}

const creditKey = (credit, mediaType) =>
  `${mediaType}_${credit?.id ?? credit?.credit_id ?? "unknown"}`;

/**
 * Merges `combined_credits.cast` and `.crew` into one filmography.
 * Every entry gets `categories` (used by the filter chips) and `roles` (the
 * character names or crew jobs shown under the title).
 */
export function normalizePersonCredits(person) {
  const credits = person?.combined_credits || {};
  const map = new Map();

  const add = (credit, category, role) => {
    if (!credit?.id) return;
    const mediaType = credit.media_type === "tv" ? "tv" : "movie";
    const key = creditKey(credit, mediaType);
    let entry = map.get(key);

    if (!entry) {
      entry = {
        id: credit.id,
        media_type: mediaType,
        title: creditTitle(credit),
        name: creditTitle(credit),
        poster_path: credit.poster_path || null,
        backdrop_path: credit.backdrop_path || null,
        release_date: credit.release_date || credit.first_air_date || "",
        first_air_date: credit.first_air_date || credit.release_date || "",
        vote_average: credit.vote_average ?? null,
        vote_count: credit.vote_count ?? 0,
        popularity: credit.popularity ?? 0,
        episode_count: credit.episode_count ?? null,
        categories: new Set(),
        roles: [],
      };
      map.set(key, entry);
    }

    entry.categories.add(category);
    if (role && !entry.roles.includes(role)) entry.roles.push(role);
    if (!entry.poster_path && credit.poster_path) {
      entry.poster_path = credit.poster_path;
    }
    if (!entry.backdrop_path && credit.backdrop_path) {
      entry.backdrop_path = credit.backdrop_path;
    }
    entry.popularity = Math.max(entry.popularity || 0, credit.popularity || 0);
    entry.vote_count = Math.max(entry.vote_count || 0, credit.vote_count || 0);
    entry.episode_count = Math.max(entry.episode_count || 0, credit.episode_count || 0) || null;
  };

  for (const credit of credits.cast || []) {
    add(credit, "acting", rolesForCredit(credit).join(", "));
  }

  for (const credit of credits.crew || []) {
    const jobs = jobsForCredit(credit);
    for (const job of jobs) {
      add(credit, groupForJob(job), job);
    }
  }

  return [...map.values()]
    .map((entry) => ({
      ...entry,
      categories: [...entry.categories],
      roles: entry.roles,
    }))
    .sort(
      (a, b) =>
        creditYear(b) - creditYear(a) ||
        (b.popularity || 0) - (a.popularity || 0) ||
        a.title.localeCompare(b.title),
    );
}

export function creditYear(credit) {
  return Number(
    (credit?.release_date || credit?.first_air_date || "").slice(0, 4),
  ) || 0;
}

export function isKnownFor(credit) {
  return Boolean(credit?.poster_path && (credit.vote_count > 0 || credit.popularity > 0));
}

export function creditMeta(credit) {
  const year = creditYear(credit);
  const type = credit?.media_type === "tv" ? "Series" : "Movie";
  return [year || null, type].filter(Boolean).join(" · ");
}

export function creditLabel(credit) {
  return credit?.media_type === "tv" ? credit?.name || credit?.title : credit?.title || credit?.name;
}
