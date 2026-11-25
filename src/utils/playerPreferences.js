import { storage, STORAGE_KEYS } from "./storage";

export const PLAYER_PREFS_KEY = "playerPreferences";
export const PLAYER_PREFS_EVENT = "streambert:player-preferences-changed";

export const DEFAULT_PLAYER_PREFERENCES = {
  seekStep: 10,
  holdInterval: 200,
  playbackRate: 1,
  volume: 1,
  muted: false,
  smartIntro: true,
  introHoverMs: 5000,
  genericIntroSeconds: 85,
  timeDisplay: "total",
  audioBoost: 1,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizePlayerPreferences(raw = {}) {
  return {
    seekStep: clamp(Math.round(number(raw.seekStep, 10)), 5, 60),
    holdInterval: clamp(
      Math.round(number(raw.holdInterval, 200)),
      100,
      600,
    ),
    playbackRate: clamp(number(raw.playbackRate, 1), 0.5, 2),
    volume: clamp(number(raw.volume, 1), 0, 1),
    muted: !!raw.muted,
    smartIntro: raw.smartIntro !== false,
    timeDisplay: raw.timeDisplay === "remaining" ? "remaining" : "total",
    audioBoost: [1, 2, 3].includes(Number(raw.audioBoost))
      ? Number(raw.audioBoost)
      : 1,
    introHoverMs: clamp(Math.round(number(raw.introHoverMs, 5000)), 1500, 10000),
    genericIntroSeconds: clamp(
      Math.round(number(raw.genericIntroSeconds, 85)),
      20,
      240,
    ),
  };
}

export function loadPlayerPreferences() {
  return normalizePlayerPreferences(
    storage.get(PLAYER_PREFS_KEY) || DEFAULT_PLAYER_PREFERENCES,
  );
}

export function savePlayerPreferences(patch) {
  const next = normalizePlayerPreferences({
    ...loadPlayerPreferences(),
    ...(patch || {}),
  });
  storage.set(PLAYER_PREFS_KEY, next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(PLAYER_PREFS_EVENT, { detail: next }),
    );
  }
  return next;
}

export function savePlayerPreference(key, value) {
  return savePlayerPreferences({ [key]: value });
}

/** The existing intro mode setting drives AniSkip and the generic intro. */
export function getIntroSkipMode() {
  const mode = storage.get(STORAGE_KEYS.INTRO_SKIP_MODE);
  return ["off", "auto", "manual"].includes(mode) ? mode : "manual";
}

/** Learned intro end for a series, in seconds. */
export function getSeriesIntroEnd(seriesKey) {
  if (!seriesKey) return null;
  const value = Number(storage.get(`seriesIntroEnd_${seriesKey}`));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function saveSeriesIntroEnd(seriesKey, seconds) {
  if (!seriesKey || !Number.isFinite(Number(seconds))) return;
  storage.set(`seriesIntroEnd_${seriesKey}`, Math.round(Number(seconds)));
}

export const PLAYER_PREFS = DEFAULT_PLAYER_PREFERENCES;

export default {
  DEFAULT_PLAYER_PREFERENCES,
  loadPlayerPreferences,
  savePlayerPreferences,
  savePlayerPreference,
  normalizePlayerPreferences,
  getIntroSkipMode,
  getSeriesIntroEnd,
  saveSeriesIntroEnd,
  PLAYER_PREFS_EVENT,
  PLAYER_PREFS_KEY,
};
