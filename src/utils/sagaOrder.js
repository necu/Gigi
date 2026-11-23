// ── Saga viewing orders ──────────────────────────────────────────────────────
// Release order is always available. A few large franchises also get curated
// "story" and fan orders (Star Wars' Machete order, the Fast & Furious
// timeline, etc.). Any collection can additionally be rearranged by hand; that
// custom order is stored locally per saga and survives restarts.

import { storage } from "./storage";

const RELEASE = {
  id: "release",
  label: "Release order",
  description: "Oldest release first. The default, safe order.",
};

const CUSTOM = {
  id: "custom",
  label: "My fan order",
  description: "Drag the cards into the order you want to watch them.",
};

const PRESETS = [
  {
    id: "star-wars",
    match: /star wars|skywalker/i,
    orders: {
      story: {
        label: "Chronological story order",
        description:
          "Episodes I–III, Solo, Rogue One, then the original and sequel trilogies.",
        ids: [
          1893, // The Phantom Menace
          1894, // Attack of the Clones
          1895, // Revenge of the Sith
          348350, // Solo
          330459, // Rogue One
          11, // A New Hope
          1891, // The Empire Strikes Back
          1892, // Return of the Jedi
          140607, // The Force Awakens
          181808, // The Last Jedi
          181812, // The Rise of Skywalker
        ],
      },
      machete: {
        label: "Machete order (fan)",
        description:
          "IV, V, II, III, VI: the original trilogy, the prequel reveal, then Jedi. The sequels are appended at the end.",
        ids: [11, 1891, 1894, 1895, 1892, 140607, 181808, 181812],
      },
    },
  },
  {
    id: "middle-earth",
    match: /middle.?earth|lord of the rings|hobbit|tolkien/i,
    orders: {
      story: {
        label: "Chronological story order",
        description:
          "The Hobbit trilogy first, then The Lord of the Rings trilogy.",
        ids: [49051, 57158, 122917, 120, 121, 122],
      },
    },
  },
  {
    id: "alien",
    match: /\balien(s)?\b|predator|yautja|\bavp\b/i,
    orders: {
      story: {
        label: "Chronological story order",
        description:
          "Prometheus and Covenant, then Alien, Romulus, Aliens and the later sequels.",
        ids: [70981, 126889, 348, 945961, 679, 8077, 8078],
      },
    },
  },
  {
    id: "fast-furious",
    match: /fast (and )?furious|fast saga|furious/i,
    orders: {
      story: {
        label: "Fan timeline order",
        description:
          "The usual marathon order: Tokyo Drift sits between Fast 6 and Furious 7.",
        ids: [9799, 584, 13804, 51497, 82992, 9615, 168259, 337339, 385128, 385687],
      },
    },
  },
  {
    id: "wizarding-world",
    match: /harry potter|fantastic beasts|wizarding world/i,
    orders: {
      story: {
        label: "Chronological story order",
        description:
          "The Fantastic Beasts prequels first, then the Harry Potter films.",
        ids: [
          259316, 338952, 338953, 671, 672, 673, 674, 675, 767, 12444, 12445,
        ],
      },
    },
  },
];

const normalize = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function findPreset(collection) {
  const haystack = normalize(collection);
  return (
    PRESETS.find((preset) => preset.match.test(haystack)) || null
  );
}

const preferenceKey = (collection) => `sagaOrder:${collection}`;
const customKey = (collection) => `sagaOrderCustom:${collection}`;

export function getSagaOrderOptions(collection) {
  const preset = findPreset(collection);
  const options = [RELEASE];
  if (preset) {
    for (const [id, order] of Object.entries(preset.orders)) {
      options.push({ id, ...order });
    }
  }
  options.push(CUSTOM);
  return options;
}

export function getSagaOrderPreference(collection) {
  const options = getSagaOrderOptions(collection);
  const saved = storage.get(preferenceKey(collection));
  return options.some((option) => option.id === saved) ? saved : "release";
}

export function saveSagaOrderPreference(collection, orderId) {
  if (!collection) return;
  storage.set(preferenceKey(collection), orderId);
}

export function getSagaCustomOrder(collection) {
  const saved = storage.get(customKey(collection));
  return Array.isArray(saved) ? saved.filter(Boolean) : [];
}

export function saveSagaCustomOrder(collection, order) {
  if (!collection) return;
  storage.set(customKey(collection), Array.isArray(order) ? order : []);
}

export function getSagaOrderOption(collection, orderId) {
  return (
    getSagaOrderOptions(collection).find((option) => option.id === orderId) ||
    RELEASE
  );
}

export const sagaEntryKey = (entry) =>
  `${entry?.media_type === "tv" ? "tv" : "movie"}_${entry?.id}`;

function yearOf(entry) {
  return (
    Number(
      String(
        entry?.release_date || entry?.first_air_date || entry?.year || "",
      ).slice(0, 4),
    ) || 0
  );
}

function sortByYear(entries) {
  return [...entries].sort(
    (a, b) =>
      yearOf(a) - yearOf(b) ||
      (a.title || a.name || "").localeCompare(b.title || b.name || ""),
  );
}

function sortBySequence(entries, sequence, useEntryKeys = false) {
  const order = new Map(
    sequence.map((value, index) => [String(value), index]),
  );
  return [...entries].sort((a, b) => {
    const aKey = useEntryKeys ? sagaEntryKey(a) : String(a.id);
    const bKey = useEntryKeys ? sagaEntryKey(b) : String(b.id);
    const aIndex = order.has(aKey) ? order.get(aKey) : Infinity;
    const bIndex = order.has(bKey) ? order.get(bKey) : Infinity;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return (
      yearOf(a) - yearOf(b) ||
      (a.title || a.name || "").localeCompare(b.title || b.name || "")
    );
  });
}

/**
 * Applies a saga order to a list of watchlist entries.
 * `customOrder` is optional: pass the live state so a drag updates immediately.
 */
export function sortSagaEntries(
  entries,
  orderId = "release",
  collection = "",
  customOrder = null,
) {
  if (!Array.isArray(entries) || entries.length < 2) return entries || [];
  const preset = findPreset(collection);
  const presetOrder = preset?.orders?.[orderId];

  if (presetOrder) return sortBySequence(entries, presetOrder.ids);
  if (orderId === "custom") {
    const order =
      Array.isArray(customOrder) && customOrder.length
        ? customOrder
        : getSagaCustomOrder(collection);
    if (order.length > 0) return sortBySequence(entries, order, true);
  }
  return sortByYear(entries);
}

export function moveSagaEntry(order, key, delta) {
  const next = [...(order || [])];
  const index = next.indexOf(key);
  if (index < 0) return next;
  const target = Math.max(0, Math.min(next.length - 1, index + delta));
  if (target === index) return next;
  next.splice(index, 1);
  next.splice(target, 0, key);
  return next;
}
