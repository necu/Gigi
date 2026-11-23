// ── Saga engine ───────────────────────────────────────────────────────────────
// Finds every sensible way a title can be part of a larger saga and returns
// ready-to-save playlists:
//
//   1. official  – the TMDB collection (always the strongest signal)
//   2. universe  – cross-over franchises that TMDB keeps in separate
//                  collections (Alien & Predator, Conjuring, Middle-earth…)
//   3. deep      – on demand: collections that keep coming back through shared
//                  cast, crew, themes and studios. This is what catches a saga
//                  that is not a numbered sequel.
//
// A saga is only returned when it contains at least two titles. The caller
// decides whether to save one, several, or just open it as a playlist.

import { tmdbFetch } from "./api";

// ── Small helpers ────────────────────────────────────────────────────────────

const uniq = (values) => [...new Set((values || []).filter(Boolean))];

const yearOf = (item) =>
  Number((item?.release_date || item?.first_air_date || "").slice(0, 4)) || 0;

function normalizePart(part, type = "movie") {
  return {
    id: part.id,
    media_type: type,
    title: part.title || part.name || "",
    name: part.name || part.title || "",
    poster_path: part.poster_path || null,
    backdrop_path: part.backdrop_path || null,
    release_date: part.release_date || part.first_air_date || "",
    first_air_date: part.first_air_date || part.release_date || "",
    vote_average: part.vote_average ?? 0,
    vote_count: part.vote_count ?? 0,
    popularity: part.popularity ?? 0,
    overview: part.overview || "",
    genre_ids: part.genre_ids || (part.genres || []).map((g) => g.id),
    original_language: part.original_language || null,
    belongs_to_collection: part.belongs_to_collection || null,
  };
}

function mergeParts(lists, type = "movie") {
  const map = new Map();
  for (const list of lists) {
    for (const raw of list || []) {
      if (!raw?.id) continue;
      const key = `${type}_${raw.id}`;
      if (!map.has(key)) map.set(key, normalizePart(raw, type));
    }
  }
  return [...map.values()].sort(
    (a, b) => yearOf(a) - yearOf(b) || a.title.localeCompare(b.title),
  );
}

async function fetchPartsByIds(ids, apiKey, type = "movie") {
  const uniqueIds = uniq(ids);
  if (uniqueIds.length === 0) return [];
  const results = await Promise.allSettled(
    uniqueIds.map((id) => tmdbFetch(`/${type}/${id}`, apiKey)),
  );
  return results
    .filter((result) => result.status === "fulfilled" && result.value?.id)
    .map((result) => normalizePart(result.value, type));
}

// Some official collections are incomplete on TMDB. These completions add the
// missing films that belong to the same franchise (for example, the Alien
// collection only has the first four films; Prometheus/Covenant are a separate
// collection and Romulus is standalone).
const COLLECTION_COMPLETIONS = [
  {
    // Keep AVP before Alien: "Alien vs. Predator Collection" contains the word
    // Alien, but it must not be treated as the main Alien saga.
    id: "avp",
    match: /avp|alien vs\.? predator/i,
    name: "AVP Collection",
    collectionIds: [115762],
    extraIds: [],
    note: "The Alien vs. Predator crossover films.",
  },
  {
    id: "alien",
    match: /alien|prometheus/i,
    name: "Alien Collection",
    collectionIds: [8091, 135416],
    extraIds: [945961], // Alien: Romulus
    note: "Complete Alien saga: the original collection, the Prometheus prequels and Romulus.",
  },
  {
    id: "predator",
    match: /predator|yautja/i,
    name: "Predator Collection",
    collectionIds: [399],
    extraIds: [1376434], // Predator: Killer of Killers
    note: "Complete Predator collection, including the animated Killer of Killers.",
  },
];

function completionFor(seed) {
  const collection = seed?.belongs_to_collection;
  if (!collection) return null;
  const collectionName = collection.name || "";
  return (
    COLLECTION_COMPLETIONS.find(
      (completion) =>
        completion.collectionIds.includes(collection.id) ||
        completion.match.test(collectionName),
    ) || null
  );
}

// ── Known cross-over universes ───────────────────────────────────────────────
// TMDB stores these as separate collections, so a normal "belongs to
// collection" lookup never sees the whole saga. The rules are intentionally
// conservative: they only fire when the title itself belongs to the universe.

const UNIVERSES = [
  {
    id: "star-wars",
    name: "Star Wars Saga",
    match: /star wars|rogue one|solo:? a star wars story|skywalker/i,
    collectionIds: [10],
    extraIds: [330459, 348350], // Rogue One and Solo
    searches: ["Star Wars Collection"],
    note: "The nine Skywalker episodes plus Rogue One and Solo.",
  },
  {
    id: "alien-predator",
    name: "Alien & Predator",
    match: /\balien(s)?\b|\bpredator(s)?\b|yautja|xenomorph|\bweyland\b|\bavp\b|prometheus/i,
    // Explicit IDs avoid depending on TMDB search ranking and, more
    // importantly, include every film: TMDB splits the franchise into Alien,
    // Prometheus, Predator and AVP collections, and Romulus / Killer of Killers
    // are not inside those collections.
    collectionIds: [8091, 135416, 399, 115762],
    extraIds: [945961, 1376434],
    searches: [
      "Alien Collection",
      "Prometheus Collection",
      "Predator Collection",
      "Alien vs. Predator Collection",
      "AVP Collection",
    ],
    note: "Crossover universe: Xenomorphs and Yautja share the same timeline.",
  },
  {
    id: "conjuring",
    name: "The Conjuring Universe",
    match: /conjuring|annabelle|\bnun\b|la llorona|valak|\bwarren/i,
    searches: [
      "The Conjuring Collection",
      "Annabelle Collection",
      "The Nun Collection",
      "The Curse of La Llorona Collection",
    ],
    note: "Shared demonology universe across several collections.",
  },
  {
    id: "middle-earth",
    name: "Middle-earth",
    match: /lord of the rings|hobbit|middle-earth|frodo|sauron|mordor/i,
    searches: ["The Lord of the Rings Collection", "The Hobbit Collection"],
    note: "Tolkien's Middle-earth saga (Rings + Hobbit).",
  },
  {
    id: "wizarding-world",
    name: "Wizarding World",
    match: /harry potter|fantastic beasts|wizarding|hogwarts|newt scamander/i,
    searches: [
      "Harry Potter Collection",
      "Fantastic Beasts Collection",
    ],
    note: "The Wizarding World spans both film series.",
  },
  {
    id: "x-men",
    name: "X-Men Universe",
    match: /\bx-?men\b|wolverine|deadpool|\bmutant(s)?\b/i,
    searches: [
      "X-Men Collection",
      "Deadpool Collection",
      "Wolverine Collection",
    ],
    note: "Mutant universe with several separate collections.",
  },
  {
    id: "spider-verse",
    name: "Spider-Man Multiverse",
    match: /\bspider-?man\b|\bvenom\b|miles morales|spider-verse/i,
    searches: [
      "Spider-Man Collection",
      "The Amazing Spider-Man Collection",
      "Venom Collection",
      "Spider-Man: Spider-Verse Collection",
    ],
    note: "Every Spider-Man / Venom film series in one playlist.",
  },
  {
    id: "monsterverse",
    name: "MonsterVerse",
    match: /\bgodzilla\b|\bkong\b|monsterverse|mothra|ghidorah/i,
    searches: [
      "MonsterVerse Collection",
      "Godzilla Collection",
      "King Kong Collection",
    ],
    note: "Kaiju universe shared by Godzilla and King Kong.",
  },
  {
    id: "planet-apes",
    name: "Planet of the Apes",
    match: /planet of the apes|rise of the planet|dawn of the planet|war for the planet|kingdom of the planet/i,
    collectionIds: [1709, 173710],
    searches: [
      "Planet of the Apes (Original) Collection",
      "Planet of the Apes (Reboot) Collection",
    ],
    note: "The original Apes films and the modern reboot series.",
  },
  {
    id: "rocky-creed",
    name: "Rocky & Creed",
    match: /\brocky\b|\bcreed\b|adonis creed|balboa/i,
    collectionIds: [1575, 553717],
    searches: ["Rocky Collection", "Creed Collection"],
    note: "Rocky Balboa's story continues in the Creed films.",
  },
  {
    id: "ghostbusters",
    name: "Ghostbusters",
    match: /ghostbusters|stay puft|ecto-?1/i,
    collectionIds: [2980],
    extraIds: [43074], // Ghostbusters (2016), outside the main collection
    searches: [
      "Ghostbusters Collection",
      "Ghostbusters: Answer the Call Collection",
    ],
    note: "The original Ghostbusters films and the 2016 reboot.",
  },
  {
    id: "star-trek",
    name: "Star Trek",
    match: /star trek|enterprise|kirk|picard|spock/i,
    collectionIds: [151, 115570, 115575],
    searches: [
      "Star Trek: The Original Series Collection",
      "Star Trek: The Next Generation Collection",
      "Star Trek: Alternate Reality Collection",
    ],
    note: "The original series, The Next Generation and the Kelvin timeline films.",
  },
];

// ── Official collection ──────────────────────────────────────────────────────

async function findOfficialSaga(seed, apiKey, type) {
  const collectionId = seed?.belongs_to_collection?.id;
  if (!collectionId) return null;

  const completion = completionFor(seed);
  const collectionIds = uniq([
    collectionId,
    ...(completion?.collectionIds || []),
  ]);
  const collections = await Promise.allSettled(
    collectionIds.map((id) => tmdbFetch(`/collection/${id}`, apiKey)),
  );

  const names = [];
  const lists = [];
  for (const result of collections) {
    if (result.status !== "fulfilled" || !result.value?.parts?.length) continue;
    names.push(result.value.name);
    lists.push(result.value.parts);
  }
  if (lists.length === 0 && !completion?.extraIds?.length) return null;

  const extras = completion
    ? await fetchPartsByIds(completion.extraIds, apiKey, type)
    : [];
  const parts = mergeParts([...lists, extras], type);
  if (parts.length < 2) return null;

  const name =
    completion?.name ||
    names[0] ||
    seed.belongs_to_collection?.name ||
    "Collection";
  const enriched = collectionIds.length > 1 || extras.length > 0;

  return {
    id: `official:${completion?.id || collectionId}`,
    name,
    kind: "official",
    confidence: 1,
    note: completion?.note || "Official franchise as catalogued by TMDB.",
    reasons: [
      {
        type: "collection",
        label: enriched
          ? "Official TMDB collection, completed with related films"
          : "Official TMDB collection",
      },
      { type: "collection", label: `${parts.length} parts in release order` },
    ],
    collectionNames: uniq(names),
    parts,
  };
}

// ── Cross-over universes ─────────────────────────────────────────────────────

async function searchCollectionId(query, apiKey) {
  try {
    const data = await tmdbFetch(
      `/search/collection?query=${encodeURIComponent(query)}`,
      apiKey,
    );
    const results = data?.results || [];
    const hit =
      results.find((entry) => /collection/i.test(entry.name || "")) ||
      results[0];
    return hit?.id || null;
  } catch {
    return null;
  }
}

async function findUniverseSagas(seed, apiKey, type) {
  const haystack = [
    seed?.title,
    seed?.name,
    seed?.original_title,
    seed?.belongs_to_collection?.name,
  ]
    .filter(Boolean)
    .join(" ");
  const rule = UNIVERSES.find((entry) => entry.match.test(haystack));
  if (!rule) return [];

  const collectionIds = uniq(rule.collectionIds || []);
  if (collectionIds.length === 0) {
    const found = await Promise.all(
      rule.searches.slice(0, 6).map((query) => searchCollectionId(query, apiKey)),
    );
    for (const id of found) {
      if (id && !collectionIds.includes(id)) collectionIds.push(id);
    }
  }
  if (collectionIds.length === 0 && !rule.extraIds?.length) return [];

  const collections = await Promise.all(
    collectionIds.map(async (id) => {
      try {
        return await tmdbFetch(`/collection/${id}`, apiKey);
      } catch {
        return null;
      }
    }),
  );

  const names = [];
  const lists = [];
  for (const collection of collections) {
    if (!collection?.parts?.length) continue;
    names.push(collection.name);
    lists.push(collection.parts);
  }
  const extras = await fetchPartsByIds(rule.extraIds || [], apiKey, type);
  const parts = mergeParts([...lists, extras], type);
  if (parts.length < 2) return [];

  return [
    {
      id: `universe:${rule.id}`,
      name: rule.name,
      kind: "universe",
      confidence: 0.92,
      note: rule.note,
      reasons: [
        { type: "universe", label: "Shared universe" },
        ...uniq(names)
          .slice(0, 3)
          .map((name) => ({ type: "collection", label: name })),
      ],
      collectionNames: uniq(names),
      parts,
    },
  ];
}

// ── Deep scan ────────────────────────────────────────────────────────────────
// Looks for other collections that share real evidence with the seed. At least
// two independent signals are required so a shared director alone (which would
// just be a filmography) never becomes a "saga".

function signalsOf(details) {
  const crew = details?.credits?.crew || [];
  const cast = details?.credits?.cast || [];
  const keywords = details?.keywords?.keywords || [];
  return {
    director: crew.find((person) => person.job === "Director") || null,
    dop:
      crew.find((person) => person.job === "Director of Photography") || null,
    composer:
      crew.find((person) => person.job === "Original Music Composer") || null,
    editor: crew.find((person) => person.job === "Editor") || null,
    cast: cast.slice(0, 12),
    keywords: keywords.slice(0, 12),
    companies: (details?.production_companies || []).slice(0, 4),
  };
}

function compareSignals(seed, other) {
  const reasons = [];
  let score = 0;

  if (seed.director && other.director?.id === seed.director.id) {
    score += 1;
    reasons.push({ type: "director", label: `Same director: ${seed.director.name}` });
  }
  if (seed.dop && other.dop?.id === seed.dop.id) {
    score += 0.5;
    reasons.push({ type: "cinematography", label: `Same cinematographer: ${seed.dop.name}` });
  }
  if (seed.composer && other.composer?.id === seed.composer.id) {
    score += 0.75;
    reasons.push({ type: "composer", label: `Same music: ${seed.composer.name}` });
  }
  if (seed.editor && other.editor?.id === seed.editor.id) {
    score += 0.5;
    reasons.push({ type: "editor", label: `Same editor: ${seed.editor.name}` });
  }

  const otherCastIds = new Set((other.cast || []).map((person) => person.id));
  const sharedCast = (seed.cast || []).filter((person) =>
    otherCastIds.has(person.id),
  );
  if (sharedCast.length > 0) {
    score += Math.min(sharedCast.length, 3);
    reasons.push({
      type: "cast",
      label: `Shared cast: ${sharedCast
        .slice(0, 3)
        .map((person) => person.name)
        .join(", ")}`,
    });
  }

  const otherKeywords = new Set((other.keywords || []).map((keyword) => keyword.id));
  const sharedKeywords = (seed.keywords || []).filter((keyword) =>
    otherKeywords.has(keyword.id),
  );
  if (sharedKeywords.length > 0) {
    score += Math.min(sharedKeywords.length, 2);
    reasons.push({
      type: "keywords",
      label: `Themes: ${sharedKeywords
        .slice(0, 3)
        .map((keyword) => keyword.name)
        .join(", ")}`,
    });
  }

  const otherCompanies = new Set(
    (other.companies || []).map((company) => company.id),
  );
  const sharedCompany = (seed.companies || []).find((company) =>
    otherCompanies.has(company.id),
  );
  if (sharedCompany) {
    score += 0.75;
    reasons.push({ type: "company", label: `Studio: ${sharedCompany.name}` });
  }

  return { score, reasons };
}

async function deepScan(seed, apiKey, excludedKeys, onProgress) {
  if (!seed?.id) return [];
  let full = seed;
  if (!seed.credits) {
    try {
      full = await tmdbFetch(
        `/movie/${seed.id}?append_to_response=credits,keywords`,
        apiKey,
      );
    } catch {
      return [];
    }
  }
  const seedSignals = signalsOf(full);
  const queries = [];
  if (seedSignals.director) {
    queries.push(
      `/discover/movie?with_crew=${seedSignals.director.id}&sort_by=popularity.desc&vote_count.gte=25`,
    );
  }
  if (seedSignals.dop) {
    queries.push(
      `/discover/movie?with_crew=${seedSignals.dop.id}&sort_by=popularity.desc&vote_count.gte=25`,
    );
  }
  if (seedSignals.composer) {
    queries.push(
      `/discover/movie?with_crew=${seedSignals.composer.id}&sort_by=popularity.desc&vote_count.gte=25`,
    );
  }
  if (seedSignals.cast[0]) {
    queries.push(
      `/discover/movie?with_cast=${seedSignals.cast[0].id}&sort_by=popularity.desc&vote_count.gte=25`,
    );
  }
  if (seedSignals.keywords.length > 0) {
    const ids = seedSignals.keywords
      .slice(0, 3)
      .map((keyword) => keyword.id)
      .join("|");
    queries.push(
      `/discover/movie?with_keywords=${ids}&sort_by=popularity.desc&vote_count.gte=25`,
    );
  }

  onProgress?.({ stage: "deep", total: queries.length });
  const results = await Promise.allSettled(
    queries.map((path) => tmdbFetch(path, apiKey)),
  );

  const candidates = new Map();
  results.forEach((result) => {
    if (result.status !== "fulfilled") return;
    for (const item of result.value?.results || []) {
      const key = `movie_${item.id}`;
      if (!item?.id || excludedKeys.has(key) || candidates.has(key)) continue;
      if (item.adult) continue;
      candidates.set(key, item);
    }
  });

  const list = [...candidates.values()]
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    .slice(0, 10);

  onProgress?.({ stage: "validate", total: list.length });
  const enriched = await Promise.allSettled(
    list.map((item) =>
      tmdbFetch(
        `/movie/${item.id}?append_to_response=credits,keywords`,
        apiKey,
      ),
    ),
  );

  const groups = new Map();
  for (const result of enriched) {
    if (result.status !== "fulfilled") continue;
    const details = result.value;
    if (!details?.id || excludedKeys.has(`movie_${details.id}`)) continue;
    const collection = details.belongs_to_collection;
    if (!collection?.id) continue;
    const comparison = compareSignals(seedSignals, signalsOf(details));
    if (comparison.score < 3) continue;
    const key = `collection:${collection.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.score += comparison.score;
      existing.reasons.push(...comparison.reasons);
    } else {
      groups.set(key, {
        collection,
        score: comparison.score,
        reasons: [...comparison.reasons],
      });
    }
  }

  const top = [...groups.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const sagas = [];
  for (const group of top) {
    try {
      const data = await tmdbFetch(
        `/collection/${group.collection.id}`,
        apiKey,
      );
      const parts = mergeParts([data.parts || []]);
      if (parts.length < 2) continue;
      const confidence = Math.min(
        0.78,
        0.52 + Math.min(group.score, 8) * 0.03,
      );
      sagas.push({
        id: `deep:${group.collection.id}`,
        name: data.name || group.collection.name,
        kind: "deep",
        confidence,
        note: "Not a numbered sequel, but the evidence keeps pointing to the same universe.",
        reasons: uniq(
          group.reasons.map((reason) => reason.label),
        )
          .slice(0, 4)
          .map((label) => ({ type: "signal", label })),
        collectionNames: [data.name || group.collection.name],
        parts,
      });
    } catch {
      // Ignore a collection that disappeared mid-scan.
    }
  }
  return sagas;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function discoverSagas({
  type = "movie",
  id,
  apiKey,
  details,
  deep = false,
  onProgress,
}) {
  if (!apiKey || !id) return { sagas: [], seed: null };

  const kind = type === "tv" ? "tv" : "movie";
  let seed = details;
  if (!seed || seed.id !== id) {
    try {
      seed = await tmdbFetch(
        `/${kind}/${id}?append_to_response=credits,keywords`,
        apiKey,
      );
    } catch {
      return { sagas: [], seed: null };
    }
  }

  onProgress?.({ stage: "official" });
  const sagas = [];
  const official = await findOfficialSaga(seed, apiKey, kind);
  if (official) sagas.push(official);

  if (kind === "movie") {
    onProgress?.({ stage: "universe" });
    sagas.push(...(await findUniverseSagas(seed, apiKey, kind)));

    if (deep) {
      const excluded = new Set([`${kind}_${id}`]);
      for (const saga of sagas) {
        for (const part of saga.parts) {
          excluded.add(`${part.media_type}_${part.id}`);
        }
      }
      sagas.push(...(await deepScan(seed, apiKey, excluded, onProgress)));
    }
  }

  // Strongest first, then by name; avoid two identical playlists.
  const seen = new Set();
  const unique = sagas
    .filter((saga) => {
      const signature = `${saga.name}`.toLowerCase();
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    })
    .sort(
      (a, b) =>
        b.confidence - a.confidence || a.name.localeCompare(b.name),
    );

  return {
    sagas: unique,
    seed: {
      id: seed.id,
      title: seed.title || seed.name || "",
      year: yearOf(seed) || null,
      collection: seed.belongs_to_collection?.name || null,
    },
  };
}

export function sagaCollectionNames(saga) {
  return uniq([saga?.name, ...(saga?.collectionNames || [])]);
}

export const UNIVERSES_LIST = UNIVERSES;
