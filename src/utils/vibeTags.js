// ── Vibe tags ────────────────────────────────────────────────────────────────
// A second, feeling-oriented layer on top of the factual tags (genre, director,
// decade, language). The goal is to let the library answer questions such as
// "what can I watch tonight that is tense but not depressing?" without asking
// the user to write a single tag.
//
// The rules below are deliberate: they combine TMDB genres, keywords and
// overview vocabulary, with runtime and format signals. Every title receives
// at least two context tags, while the picker limits how many tags one title
// can collect so the cloud stays useful instead of turning into soup.

export const VIBE_GROUPS = [
  {
    id: "momento",
    label: "Momento",
    hint: "¿Cuándo y cómo lo vas a ver?",
    accent: "#e5b567",
    max: 2,
    tags: [
      "Noche",
      "Día",
      "Atardecer",
      "Madrugada",
      "Después de comer",
      "Fin de semana",
      "Sesión corta",
      "Maratón",
    ],
  },
  {
    id: "emocion",
    label: "Emoción",
    hint: "¿Qué quieres sentir?",
    accent: "#e06c75",
    max: 2,
    tags: [
      "Alegre",
      "Triste",
      "Profunda",
      "Ligera",
      "Nostálgica",
      "Oscura",
      "Tensa",
      "Recomfortante",
      "Romántica",
      "Adrenalina",
      "Inspiradora",
      "Melancólica",
    ],
  },
  {
    id: "compania",
    label: "Compañía",
    hint: "¿Con quién la vas a compartir?",
    accent: "#61afef",
    max: 1,
    tags: ["Solo", "En pareja", "Con amigos", "En familia", "Con niños"],
  },
  {
    id: "ritmo",
    label: "Ritmo",
    hint: "¿Cómo quieres que fluya?",
    accent: "#98c379",
    max: 1,
    tags: ["Pausada", "Intensa", "Frenética", "Episódica", "Absorbente"],
  },
  {
    id: "tema",
    label: "Tema",
    hint: "¿Qué historia te apetece?",
    accent: "#c678dd",
    max: 2,
    tags: [
      "Viaje",
      "Venganza",
      "Amistad",
      "Amor",
      "Familia",
      "Crimen",
      "Misterio",
      "Ciencia ficción",
      "Fantasía",
      "Supervivencia",
      "Distopía",
      "Coming of age",
      "Biografía",
      "Música",
      "Deportes",
      "Guerra",
      "Época",
      "Noir",
      "Terror psicológico",
      "Comedia negra",
      "Superhéroes",
      "Espacio",
      "Animales",
      "Cocina",
      "Navidad",
      "Halloween",
      "Verano",
    ],
  },
];

const groupByTag = new Map();
for (const group of VIBE_GROUPS) {
  for (const tag of group.tags) groupByTag.set(tag, group);
}

const rule = (group, tag, options = {}) => ({
  group,
  tag,
  keywords: [],
  terms: [],
  genres: [],
  genresAll: null,
  ...options,
  threshold: options.threshold ?? 2,
});

// These rules intentionally read like a tiny film critic: "dark" is not the
// same as "sad", and "after lunch" is a different promise from "late night".
export const VIBE_RULES = [
  // ── Moment ────────────────────────────────────────────────────────────────
  rule("momento", "Noche", {
    genres: [27, 53, 80, 9648],
    keywords: [
      "night",
      "midnight",
      "noir",
      "neo-noir",
      "vampire",
      "haunted",
      "serial killer",
      "dark",
      "neon",
    ],
    terms: ["at night", "late night", "night city", "city lights"],
  }),
  rule("momento", "Día", {
    genres: [35, 10751, 16, 99, 12],
    keywords: [
      "feel-good",
      "sunny",
      "holiday",
      "summer",
      "daylight",
      "wholesome",
      "playful",
    ],
    terms: ["a sunny", "small town", "road trip", "holiday"],
  }),
  rule("momento", "Atardecer", {
    genres: [10749, 18, 37],
    keywords: ["sunset", "twilight", "longing", "nostalgia", "romance"],
    terms: ["fall in love", "second chance", "summer romance", "golden hour"],
    threshold: 3.2,
  }),
  rule("momento", "Madrugada", {
    genres: [27, 878, 9648],
    keywords: [
      "insomnia",
      "dream",
      "surreal",
      "psychological",
      "slow burn",
      "space",
      "isolated",
    ],
    terms: ["cannot sleep", "3am", "in the middle of the night", "insomnia"],
  }),
  rule("momento", "Después de comer", {
    genres: [35, 10751, 16, 99],
    maxRuntime: 125,
    keywords: [
      "cozy",
      "comfort",
      "food",
      "cooking",
      "friendship",
      "gentle",
      "healing",
    ],
    terms: ["comfort watch", "easy watch", "cooking", "family dinner"],
  }),
  rule("momento", "Fin de semana", {
    genres: [12, 28, 14, 878],
    minRuntime: 115,
    keywords: ["epic", "journey", "adventure", "quest", "spectacle"],
    terms: ["epic", "adventure", "journey", "world"],
  }),
  rule("momento", "Sesión corta", {
    maxRuntime: 105,
    threshold: 1.8,
  }),
  rule("momento", "Maratón", {
    series: true,
    threshold: 1.8,
  }),

  // ── Emotion ──────────────────────────────────────────────────────────────
  rule("emocion", "Alegre", {
    genres: [35, 10751, 16, 10402],
    keywords: [
      "feel-good",
      "funny",
      "joy",
      "happy",
      "upbeat",
      "celebration",
      "friendship",
      "musical",
    ],
    terms: ["feel good", "laugh", "celebration", "friends", "fun"],
  }),
  rule("emocion", "Triste", {
    genres: [18, 10749, 10752],
    keywords: [
      "grief",
      "loss",
      "tragedy",
      "death",
      "melancholy",
      "heartbreak",
      "mourning",
    ],
    terms: ["grief", "loss", "death", "tears", "heartbreak", "tragedy"],
  }),
  rule("emocion", "Profunda", {
    genres: [18, 99, 36, 9648],
    minRuntime: 150,
    keywords: [
      "philosophy",
      "existential",
      "meaning",
      "identity",
      "moral",
      "social",
      "psychological",
      "memory",
    ],
    terms: ["what it means", "human nature", "existential", "identity", "moral"],
  }),
  rule("emocion", "Ligera", {
    genres: [35, 10751, 16, 12],
    maxRuntime: 112,
    keywords: ["light", "cozy", "fun", "easy", "charming", "sweet"],
    terms: ["easy", "light-hearted", "charming", "sweet", "fun"],
  }),
  rule("emocion", "Nostálgica", {
    genres: [18, 35, 10749],
    keywords: [
      "nostalgia",
      "memory",
      "childhood",
      "retro",
      "coming of age",
      "vhs",
      "old friends",
    ],
    terms: ["childhood", "memory", "remember", "back then", "years later"],
    threshold: 3.2,
  }),
  rule("emocion", "Oscura", {
    genres: [27, 53, 80],
    keywords: [
      "dark",
      "violence",
      "murder",
      "serial killer",
      "haunted",
      "demon",
      "revenge",
      "corruption",
    ],
    terms: ["dark", "murder", "killer", "blood", "nightmare", "evil"],
  }),
  rule("emocion", "Tensa", {
    genres: [53, 9648, 80, 27],
    keywords: [
      "tension",
      "suspense",
      "tense",
      "chase",
      "heist",
      "kidnapping",
      "conspiracy",
      "thriller",
    ],
    terms: ["tension", "suspense", "chase", "race against", "conspiracy"],
  }),
  rule("emocion", "Recomfortante", {
    genres: [35, 10751, 16, 10749],
    keywords: [
      "cozy",
      "comfort",
      "healing",
      "friendship",
      "community",
      "wholesome",
      "feel-good",
    ],
    terms: ["cozy", "comfort", "healing", "home", "friendship", "warm"],
  }),
  rule("emocion", "Romántica", {
    genres: [10749],
    keywords: ["love", "romance", "relationship", "wedding", "soulmate"],
    terms: ["fall in love", "romance", "love", "relationship", "wedding"],
  }),
  rule("emocion", "Adrenalina", {
    genres: [28, 12, 53],
    keywords: [
      "action",
      "chase",
      "explosion",
      "heist",
      "fight",
      "race",
      "adrenaline",
    ],
    terms: ["chase", "explosion", "fight", "race", "mission", "heist"],
  }),
  rule("emocion", "Inspiradora", {
    genres: [18, 36, 99, 10402],
    keywords: [
      "inspirational",
      "triumph",
      "dream",
      "true story",
      "survival",
      "hope",
      "underdog",
    ],
    terms: ["triumph", "inspire", "dream", "true story", "against the odds"],
    threshold: 3.2,
  }),
  rule("emocion", "Melancólica", {
    genres: [18, 10749],
    keywords: [
      "melancholy",
      "loneliness",
      "longing",
      "grief",
      "memory",
      "quiet",
    ],
    terms: ["lonely", "memories", "longing", "quiet", "misses", "absence"],
    threshold: 3.2,
  }),

  // ── Company ───────────────────────────────────────────────────────────────
  rule("compania", "Solo", {
    genres: [],
    keywords: ["solitude", "isolated", "psychological", "intimate", "quiet"],
    terms: ["alone", "solitude", "introspective", "isolated"],
    threshold: 2.4,
  }),
  rule("compania", "En pareja", {
    genres: [],
    keywords: ["romance", "relationship", "date", "wedding", "love"],
    terms: ["romance", "heart", "love", "couple", "relationship"],
    threshold: 2.4,
  }),
  rule("compania", "Con amigos", {
    genres: [],
    keywords: ["friends", "group", "party", "fun", "road trip"],
    terms: ["friends", "group", "party", "together", "crew"],
    threshold: 2.4,
  }),
  rule("compania", "En familia", {
    genres: [10751, 16],
    keywords: ["kids", "wholesome", "children", "parents", "siblings", "household"],
    terms: ["parents", "children", "siblings", "household"],
  }),
  rule("compania", "Con niños", {
    genres: [16, 10751, 10762],
    keywords: ["kids", "children", "animation", "young"],
    terms: ["children", "kids", "young"],
  }),

  // ── Rhythm ────────────────────────────────────────────────────────────────
  rule("ritmo", "Pausada", {
    genres: [18, 99, 36],
    minRuntime: 125,
    keywords: ["slow", "contemplative", "meditative", "quiet", "atmospheric"],
    terms: ["slow", "quiet", "contemplative", "patient"],
  }),
  rule("ritmo", "Intensa", {
    genres: [53, 80, 27, 28],
    keywords: ["intense", "suspense", "relentless", "chase", "gritty"],
    terms: ["intense", "relentless", "suspense", "pressure"],
  }),
  rule("ritmo", "Frenética", {
    genres: [28, 53],
    maxRuntime: 120,
    keywords: ["fast-paced", "explosive", "chase", "adrenaline", "frantic"],
    terms: ["fast", "frantic", "explosive", "race"],
  }),
  rule("ritmo", "Episódica", {
    series: true,
    keywords: ["episodic", "case of the week", "anthology", "serial"],
    threshold: 2.2,
  }),
  rule("ritmo", "Absorbente", {
    genres: [53, 9648, 878, 18],
    minRating: 7,
    keywords: ["gripping", "mind-bending", "twist", "immersive", "hypnotic"],
    terms: ["twist", "gripping", "absorbing", "mind", "mystery"],
  }),

  // ── Theme ─────────────────────────────────────────────────────────────────
  rule("tema", "Viaje", {
    genres: [12, 878, 14],
    keywords: ["journey", "road trip", "quest", "travel", "adventure"],
    terms: ["journey", "travel", "road", "quest", "adventure"],
  }),
  rule("tema", "Venganza", {
    genres: [],
    keywords: ["revenge", "vengeance", "retribution", "payback"],
    terms: ["revenge", "vengeance", "retribution", "payback"],
    threshold: 2.4,
  }),
  rule("tema", "Amistad", {
    genres: [],
    keywords: ["friendship", "friends", "companionship", "bond"],
    terms: ["friendship", "friends", "bond", "companions"],
    threshold: 2.4,
  }),
  rule("tema", "Amor", {
    genres: [10749],
    keywords: ["love", "romance", "relationship", "soulmate"],
    terms: ["love", "romance", "relationship", "heart"],
  }),
  rule("tema", "Familia", {
    genres: [],
    keywords: ["family", "father", "mother", "daughter", "son", "generations"],
    terms: ["family", "father", "mother", "daughter", "son", "siblings"],
    threshold: 2.4,
  }),
  rule("tema", "Crimen", {
    genres: [80, 53],
    keywords: [
      "crime",
      "mafia",
      "heist",
      "detective",
      "murder",
      "serial killer",
      "cartel",
    ],
    terms: ["crime", "mafia", "heist", "murder", "detective", "cartel"],
  }),
  rule("tema", "Misterio", {
    genres: [9648, 53],
    keywords: [
      "mystery",
      "detective",
      "whodunit",
      "investigation",
      "secret",
      "puzzle",
    ],
    terms: ["mystery", "secret", "investigation", "detective", "puzzle"],
  }),
  rule("tema", "Ciencia ficción", {
    genres: [878, 10765],
    keywords: [
      "space",
      "future",
      "robot",
      "alien",
      "artificial intelligence",
      "time travel",
      "sci-fi",
    ],
    terms: ["future", "space", "robot", "alien", "technology", "planet"],
  }),
  rule("tema", "Fantasía", {
    genres: [14, 10765],
    keywords: ["magic", "fantasy", "mythical", "dragon", "kingdom", "wizard"],
    terms: ["magic", "kingdom", "dragon", "myth", "wizard", "spell"],
  }),
  rule("tema", "Supervivencia", {
    genres: [],
    keywords: ["survival", "wilderness", "disaster", "isolation", "stranded"],
    terms: ["survive", "survival", "stranded", "wilderness", "alone"],
    threshold: 2.4,
  }),
  rule("tema", "Distopía", {
    genres: [],
    keywords: [
      "dystopia",
      "apocalypse",
      "post-apocalyptic",
      "totalitarian",
      "collapse",
    ],
    terms: ["dystopia", "apocalypse", "collapse", "future society"],
    threshold: 2.4,
  }),
  rule("tema", "Coming of age", {
    genres: [],
    keywords: [
      "coming of age",
      "teenager",
      "adolescence",
      "high school",
      "first love",
    ],
    terms: ["grow up", "teenager", "adolescence", "high school", "first love"],
    threshold: 2.4,
  }),
  rule("tema", "Biografía", {
    genres: [],
    keywords: ["biography", "biopic", "true story", "based on a true story"],
    terms: ["true story", "biography", "based on", "real life"],
    threshold: 2.4,
  }),
  rule("tema", "Música", {
    genres: [10402],
    keywords: ["music", "musician", "singer", "band", "concert", "songwriter"],
    terms: ["music", "band", "singer", "concert", "song"],
  }),
  rule("tema", "Deportes", {
    genres: [],
    keywords: ["sport", "football", "boxing", "basketball", "athlete", "olympic"],
    terms: ["sport", "football", "boxing", "basketball", "athlete", "team"],
    threshold: 2.4,
  }),
  rule("tema", "Guerra", {
    genres: [10752],
    keywords: ["war", "soldier", "battle", "military", "combat"],
    terms: ["war", "soldier", "battle", "military", "combat"],
  }),
  rule("tema", "Época", {
    genres: [],
    keywords: [
      "period",
      "victorian",
      "19th century",
      "1920s",
      "medieval",
      "historical",
    ],
    terms: ["19th century", "victorian", "medieval", "1920s", "period"],
    threshold: 2.4,
  }),
  rule("tema", "Noir", {
    genres: [],
    keywords: ["noir", "neo-noir", "femme fatale", "detective", "shadow"],
    terms: ["noir", "detective", "shadow", "femme fatale", "rain"],
    threshold: 2.4,
  }),
  rule("tema", "Terror psicológico", {
    genres: [],
    keywords: ["psychological", "haunting", "possession", "insanity", "trauma"],
    terms: ["psychological", "haunted", "insanity", "trauma", "mind"],
    threshold: 2.4,
  }),
  rule("tema", "Comedia negra", {
    genres: [35, 80],
    keywords: ["dark comedy", "black comedy", "satire", "absurd"],
    terms: ["dark comedy", "satire", "absurd", "irony"],
    threshold: 4,
  }),
  rule("tema", "Superhéroes", {
    genres: [],
    keywords: ["superhero", "comic book", "marvel", "dc", "superpower"],
    terms: ["superhero", "comic", "superpower", "hero"],
    threshold: 2.4,
  }),
  rule("tema", "Espacio", {
    genres: [],
    keywords: ["space", "galaxy", "planet", "spaceship", "astronaut", "alien"],
    terms: ["space", "galaxy", "planet", "spaceship", "astronaut"],
    threshold: 2.4,
  }),
  rule("tema", "Animales", {
    genres: [],
    keywords: ["animal", "dog", "cat", "horse", "wildlife", "creature"],
    terms: ["animal", "dog", "cat", "horse", "wildlife"],
    threshold: 2.4,
  }),
  rule("tema", "Cocina", {
    genres: [],
    keywords: ["cooking", "food", "chef", "restaurant", "kitchen", "recipe"],
    terms: ["cooking", "food", "chef", "restaurant", "kitchen"],
    threshold: 3.2,
  }),
  rule("tema", "Navidad", {
    genres: [],
    keywords: ["christmas", "xmas", "santa", "holiday", "snow"],
    terms: ["christmas", "santa", "holiday season", "xmas"],
    threshold: 2.4,
  }),
  rule("tema", "Halloween", {
    genres: [],
    keywords: ["halloween", "witch", "witches", "pumpkin", "costume"],
    terms: ["halloween", "witch", "pumpkin", "costume"],
    threshold: 2.4,
  }),
  rule("tema", "Verano", {
    genres: [],
    keywords: ["summer", "beach", "holiday", "vacation", "sun"],
    terms: ["summer", "beach", "vacation", "holiday"],
    threshold: 2.4,
  }),
];

const VIBE_NAME_SET = new Set(VIBE_RULES.map((entry) => entry.tag));

function uniq(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function genreIdsOf(source) {
  if (Array.isArray(source?.genres)) {
    return source.genres
      .map((genre) => (typeof genre === "number" ? genre : genre?.id))
      .filter((id) => id != null);
  }
  return Array.isArray(source?.genre_ids) ? source.genre_ids : [];
}

function keywordTextOf(source) {
  const raw = source?.keywords;
  const items = raw?.keywords || raw?.results || raw || [];
  if (!Array.isArray(items)) return "";
  return items
    .map((item) => (typeof item === "string" ? item : item?.name))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function runtimeOf(source) {
  const raw = source?.runtime ?? source?.episode_run_time?.[0];
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function yearOf(source) {
  const raw =
    source?.release_date || source?.first_air_date || source?.year || "";
  const match = String(raw).match(/(\d{4})/);
  return match ? Number(match[1]) : null;
}

function buildSignals(source) {
  const keywordText = keywordTextOf(source);
  const text = [
    source?.overview,
    source?.tagline,
    source?.title,
    source?.name,
    keywordText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return {
    genreIds: genreIdsOf(source),
    keywordText,
    text,
    runtime: runtimeOf(source),
    year: yearOf(source),
    voteAverage: Number(source?.vote_average) || 0,
    isTV:
      source?.media_type === "tv" ||
      source?.first_air_date != null ||
      source?.number_of_seasons != null,
    seasons: Number(source?.number_of_seasons) || 0,
    episodes: Number(source?.number_of_episodes) || 0,
  };
}

function scoreRule(entry, signals) {
  let score = 0;

  if (entry.keywords?.length) {
    for (const keyword of entry.keywords) {
      if (signals.keywordText.includes(keyword)) score += 2.4;
    }
  }

  if (entry.genres?.length) {
    const matches = entry.genres.filter((id) =>
      signals.genreIds.includes(id),
    ).length;
    if (entry.genresAll && matches < entry.genres.length) {
      score += 0;
    } else {
      score += matches * 2.2;
    }
  }

  if (entry.terms?.length) {
    for (const term of entry.terms) {
      if (signals.text.includes(term)) score += 0.9;
    }
  }

  if (entry.minRuntime != null && signals.runtime != null) {
    if (signals.runtime >= entry.minRuntime) score += 1.8;
    else score -= 0.8;
  }
  if (entry.maxRuntime != null && signals.runtime != null) {
    if (signals.runtime <= entry.maxRuntime) score += 1.8;
    else score -= 0.8;
  }
  if (entry.minRating != null && signals.voteAverage >= entry.minRating) {
    score += 1.1;
  }
  if (entry.minYear != null && signals.year != null) {
    if (signals.year >= entry.minYear) score += 1.1;
  }
  if (entry.maxYear != null && signals.year != null) {
    if (signals.year <= entry.maxYear) score += 1.1;
  }
  if (entry.series) {
    if (signals.isTV) score += 2.1;
    else score -= 0.6;
  }
  if (entry.movie) {
    if (!signals.isTV) score += 1.4;
  }

  return score;
}

function fallbackTags(signals) {
  const genres = signals.genreIds;
  const isLight =
    genres.includes(35) ||
    genres.includes(10751) ||
    genres.includes(16) ||
    genres.includes(99);
  const isDark =
    genres.includes(27) ||
    genres.includes(53) ||
    genres.includes(80) ||
    genres.includes(9648);
  const isDrama = genres.includes(18) || genres.includes(10749);

  const tags = [];
  if (signals.isTV) tags.push("Maratón");
  if (signals.runtime != null && signals.runtime <= 105) {
    tags.push("Sesión corta");
  }
  if (signals.isTV || isLight) tags.push("Día");
  if (isDark) tags.push("Noche", "Tensa");
  else if (isDrama) tags.push("Profunda");
  else tags.push("Ligera");
  if (isLight) tags.push("Alegre");
  if (isDrama && !isLight) tags.push("Melancólica");

  return uniq(tags);
}

/**
 * Derives the feeling/context tags for one library title.
 * It is deterministic and safe to call with partial metadata.
 */
export function deriveVibeTags(source = {}) {
  const signals = buildSignals(source);
  const scored = VIBE_RULES.map((entry) => ({
    entry,
    score: scoreRule(entry, signals),
  }));

  const picked = [];
  for (const group of VIBE_GROUPS) {
    const candidates = scored
      .filter(({ entry }) => entry.group === group.id)
      .filter(({ entry, score }) => score >= entry.threshold)
      .sort((a, b) => b.score - a.score || a.entry.tag.localeCompare(b.entry.tag));

    for (const candidate of candidates.slice(0, group.max)) {
      picked.push(candidate.entry.tag);
    }
  }

  const unique = uniq(picked);
  if (unique.length >= 2) return unique.slice(0, 10);

  return uniq([...unique, ...fallbackTags(signals)]).slice(0, 10);
}

/** True when an entry has at least two of the new context tags. */
export function hasVibeContext(entry) {
  const tags = entry?.tags || [];
  return tags.filter((tag) => VIBE_NAME_SET.has(tag)).length >= 2;
}

export function vibeTagCount(entry) {
  return (entry?.tags || []).filter((tag) => VIBE_NAME_SET.has(tag)).length;
}

export function vibeGroupFor(tag) {
  return groupByTag.get(tag) || null;
}

export function isVibeTag(tag) {
  return VIBE_NAME_SET.has(tag);
}

export const VIBE_TAG_NAMES = VIBE_NAME_SET;

/**
 * Counts the tags available after the current selection, excluding the
 * dimension being counted so the options inside that dimension remain visible.
 */
export function buildVibeFacets(entries, active = {}) {
  const all = (entries || []).filter(Boolean);
  const activeTags = Object.values(active || {}).filter(Boolean);

  const matching = all.filter((entry) =>
    activeTags.every((tag) => (entry.tags || []).includes(tag)),
  );

  const groups = VIBE_GROUPS.map((group) => {
    const otherTags = Object.entries(active || {})
      .filter(([groupId, tag]) => groupId !== group.id && tag)
      .map(([, tag]) => tag);

    const tags = group.tags
      .map((tag) => {
        const selected = active?.[group.id] === tag;
        const count = all.filter(
          (entry) =>
            (entry.tags || []).includes(tag) &&
            otherTags.every((other) => (entry.tags || []).includes(other)),
        ).length;
        return { tag, count, selected };
      })
      .filter((item) => item.count > 0 || item.selected)
      .sort(
        (a, b) =>
          Number(b.selected) - Number(a.selected) ||
          b.count - a.count ||
          a.tag.localeCompare(b.tag),
      );

    return { ...group, tags };
  });

  return { groups, total: matching.length, activeTags };
}

function normalizeSelected(raw) {
  const next = {};
  if (!raw || typeof raw !== "object") return next;
  for (const group of VIBE_GROUPS) {
    const value = raw[group.id];
    if (typeof value === "string" && group.tags.includes(value)) {
      next[group.id] = value;
    }
  }
  return next;
}

export function loadVibeFilters(storage) {
  const raw = storage?.get("libraryVibeFilters");
  return normalizeSelected(raw);
}

export function saveVibeFilters(storage, filters) {
  storage?.set("libraryVibeFilters", normalizeSelected(filters));
}

export function normalizeVibeFilters(raw) {
  return normalizeSelected(raw);
}

export default {
  VIBE_GROUPS,
  VIBE_RULES,
  deriveVibeTags,
  hasVibeContext,
  vibeTagCount,
  vibeGroupFor,
  isVibeTag,
  buildVibeFacets,
  loadVibeFilters,
  saveVibeFilters,
  normalizeVibeFilters,
};

