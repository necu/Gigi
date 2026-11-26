import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getIntroSkipMode,
  getSeriesIntroEnd,
  loadPlayerPreferences,
  PLAYER_PREFS_EVENT,
  savePlayerPreference,
  savePlayerPreferences,
  saveSeriesIntroEnd,
} from "../utils/playerPreferences";
import { useT } from "../utils/i18n";
import {
  BoltIcon,
  FullscreenIcon,
  PipIcon,
  RetryIcon,
  SleepIcon,
  VolumeIcon,
} from "./Icons";

const HOLD_STEP_MIN_MS = 100;
const INTRO_UNDO_MS = 5000;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatTime(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function normalizeSegment(segment, kind) {
  if (!segment) return null;
  const start = Number(segment.startTime ?? segment.start);
  const end = Number(segment.endTime ?? segment.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  return { kind, start, end };
}

function getFallbackVideoStateScript() {
  return `(() => {
    const videos = Array.from(document.querySelectorAll('video'));
    if (!videos.length) return null;
    videos.sort((a, b) => {
      const area = (v) => Math.max(1, v.clientWidth || 0) * Math.max(1, v.clientHeight || 0);
      return area(b) - area(a);
    });
    const v = videos[0];
    return {
      found: true,
      paused: !!v.paused,
      currentTime: Number.isFinite(v.currentTime) ? v.currentTime : 0,
      duration: Number.isFinite(v.duration) ? v.duration : 0,
      volume: Number.isFinite(v.volume) ? v.volume : 1,
      muted: !!v.muted,
      playbackRate: Number.isFinite(v.playbackRate) ? v.playbackRate : 1,
      readyState: v.readyState || 0,
    };
  })()`;
}

/**
 * A modern control layer over the third-party <video>. All commands go through
 * the main process so they also work when the provider nests its video in an
 * iframe. The deck deliberately owns only the bottom centre and a small skip
 * pill, leaving the provider's own menus and picture untouched.
 */
export default function PlayerDeck({
  webviewRef,
  wrapRef,
  active = false,
  pipOpen = false,
  onExit,
  title,
  subtitle,
  skipTimings = null,
  introKey = "",
  seriesKey = "",
  isSeries = false,
  onSettings,
  onSession,
  onNext = null,
  nextLabel = "",
  nextTitle = "",
  onRetry = null,
  pageFullscreen = false,
  onToggleFullscreen = null,
  onPip = null,
}) {
  const t = useT();
  const [prefs, setPrefs] = useState(loadPlayerPreferences);
  const [introMode, setIntroMode] = useState(getIntroSkipMode);
  const [video, setVideo] = useState({
    found: false,
    paused: true,
    currentTime: 0,
    duration: 0,
    volume: 1,
    muted: false,
    playbackRate: 1,
    readyState: 0,
    menuOpen: false,
  });
  const [controlsVisible, setControlsVisible] = useState(true);
  const [hoverPct, setHoverPct] = useState(0);
  const [undo, setUndo] = useState(null);
  const [undoLeft, setUndoLeft] = useState(INTRO_UNDO_MS);
  const [seekBurst, setSeekBurst] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [boostLevel, setBoostLevel] = useState(1);
  const [boostAvailable, setBoostAvailable] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [subtitleDelay, setSubtitleDelay] = useState(0);
  const [sleepEndsAt, setSleepEndsAt] = useState(0);
  const [sleepLeft, setSleepLeft] = useState(0);
  const [tracksOpen, setTracksOpen] = useState(false);
  const [waitingLong, setWaitingLong] = useState(false);
  const isFullscreen = fullscreen || pageFullscreen;
  const showRemaining = prefs.timeDisplay === "remaining";

  const holdTimerRef = useRef(null);
  const hoverFrameRef = useRef(null);
  const hoverStartRef = useRef(0);
  const hideTimerRef = useRef(null);
  const burstTimerRef = useRef(null);
  const undoUntilRef = useRef(0);
  const autoSkippedRef = useRef(new Set());
  const dismissRef = useRef(new Set());
  const pollRef = useRef(false);
  // Once the live bridge has spoken, it owns play/pause. The fallback poll is
  // only allowed to recover a video whose events never reached the host.
  const lastMediaEventRef = useRef(0);
  // The hide timer must read the current pause state, not the state captured
  // when the pointer last moved: pausing after a reveal would otherwise hide
  // the deck three seconds later while the film sits still.
  const pausedRef = useRef(video.paused);
  pausedRef.current = video.paused;
  // Only mirror the saved level once per title duration: re-applying on every
  // state tick would fight the provider's own volume handling.
  const volumeSyncedRef = useRef("");
  const boostSyncedRef = useRef("");
  const learnKey = seriesKey || introKey;
  // An episode key must win over the series key: two episodes of the same
  // series can share a duration, and the saved volume/boost still has to be
  // re-applied to the second one.
  const syncKey = `${introKey || learnKey || title || "title"}:${Math.round(video.duration || 0)}`;

  useEffect(() => {
    setWaitingLong(false);
    if (!active || pipOpen || video.found) return undefined;
    const timer = setTimeout(() => setWaitingLong(true), 12000);
    return () => clearTimeout(timer);
  }, [active, pipOpen, video.found]);

  useEffect(() => {
    setPrefs(loadPlayerPreferences());
    setIntroMode(getIntroSkipMode());
    const onPrefs = (event) => setPrefs(event.detail || loadPlayerPreferences());
    const onSettings = () => setIntroMode(getIntroSkipMode());
    window.addEventListener(PLAYER_PREFS_EVENT, onPrefs);
    window.addEventListener("streambert:player-settings-changed", onSettings);
    return () => {
      window.removeEventListener(PLAYER_PREFS_EVENT, onPrefs);
      window.removeEventListener(
        "streambert:player-settings-changed",
        onSettings,
      );
    };
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const getWebContentsId = useCallback(() => {
    try {
      const wv = webviewRef?.current;
      if (!wv || typeof wv.getWebContentsId !== "function") return null;
      return wv.getWebContentsId();
    } catch {
      return null;
    }
  }, [webviewRef]);

  const fallbackAction = useCallback(
    async (action, value) => {
      const wv = webviewRef?.current;
      if (!wv) return null;
      const number = Number(value);
      const base = getFallbackVideoStateScript();
      let js = base;
      if (action === "toggle-play") {
        js = `(() => {
          const state = ${base};
          const videos = Array.from(document.querySelectorAll('video'));
          videos.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight));
          const v = videos[0];
          if (!v) return state;
          if (v.paused) v.play().catch(() => {});
          else v.pause();
          return { ...state, paused: v.paused };
        })()`;
      } else if (action === "seek") {
        js = `(() => {
          const videos = Array.from(document.querySelectorAll('video'));
          videos.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight));
          const v = videos[0];
          if (v) v.currentTime = Math.max(0, Math.min(v.duration || 1e9, v.currentTime + ${Number.isFinite(number) ? number : 0}));
          return ${base};
        })()`;
      } else if (action === "seek-to") {
        js = `(() => {
          const videos = Array.from(document.querySelectorAll('video'));
          videos.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight));
          const v = videos[0];
          if (v) v.currentTime = Math.max(0, Math.min(v.duration || 1e9, ${Number.isFinite(number) ? number : 0}));
          return ${base};
        })()`;
      } else if (action === "toggle-mute") {
        js = `(() => {
          const videos = Array.from(document.querySelectorAll('video'));
          videos.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight));
          const v = videos[0];
          if (v) v.muted = !v.muted;
          return ${base};
        })()`;
      } else if (action === "set-rate") {
        js = `(() => {
          const videos = Array.from(document.querySelectorAll('video'));
          videos.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight));
          const v = videos[0];
          if (v) v.playbackRate = Math.max(0.25, Math.min(4, ${Number.isFinite(number) ? number : 1}));
          return ${base};
        })()`;
      }
      try {
        return await wv.executeJavaScript(js);
      } catch {
        return null;
      }
    },
    [webviewRef],
  );

  const control = useCallback(
    async (action, value = null) => {
      const wcId = getWebContentsId();
      if (wcId && window.electron?.controlVideo) {
        try {
          return await window.electron.controlVideo(wcId, action, value);
        } catch {}
      }
      return fallbackAction(action, value);
    },
    [fallbackAction, getWebContentsId],
  );

  useEffect(() => {
    if (!sleepEndsAt) {
      setSleepLeft(0);
      return undefined;
    }
    let cancelled = false;
    const tick = () => {
      const left = Math.max(0, Math.ceil((sleepEndsAt - Date.now()) / 1000));
      if (cancelled) return;
      setSleepLeft(left);
      if (left <= 0) {
        setSleepEndsAt(0);
        control("pause");
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [control, sleepEndsAt]);

  // Fallback poll. The event bridge below is the primary source; this slow
  // tick only recovers if a provider replaces its video and drops listeners.
  useEffect(() => {
    if (!active || pipOpen) return undefined;
    let cancelled = false;
    let timeout = null;

    const tick = async () => {
      if (cancelled) return;
      if (!pollRef.current) {
        pollRef.current = true;
        try {
          const next = await control("state");
          if (!cancelled && next) {
            const { paused, ...rest } = next;
            // Trust the live bridge while it is fresh. Once a provider swaps
            // its video and the events go quiet, the poll takes play/pause
            // back instead of leaving a stale label forever.
            const bridgeFresh = Date.now() - lastMediaEventRef.current < 2500;
            setVideo((current) => ({
              ...current,
              ...rest,
              ...(bridgeFresh ? {} : { paused }),
            }));
          }
        } finally {
          pollRef.current = false;
        }
      }
      if (!cancelled) timeout = setTimeout(tick, 1000);
    };

    tick();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [active, pipOpen, control]);

  // Install the outside-click guard in every player frame. Re-run periodically:
  // providers often replace iframes when quality or audio changes.
  useEffect(() => {
    if (!active) return undefined;
    const install = () => {
      const wcId = getWebContentsId();
      if (wcId && window.electron?.installPlayerGuard) {
        window.electron.installPlayerGuard(wcId).catch(() => {});
      }
    };
    const wv = webviewRef?.current;
    if (wv) wv.addEventListener("dom-ready", install);
    install();
    const timer = setInterval(install, 4000);
    return () => {
      clearInterval(timer);
      if (wv) wv.removeEventListener("dom-ready", install);
    };
  }, [active, getWebContentsId, webviewRef]);

  useEffect(() => {
    if (!video.paused) return;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setControlsVisible(true);
  }, [video.paused]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (!pausedRef.current) setControlsVisible(false);
    }, 3000);
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    const handler = () => revealControls();
    window.addEventListener("pointermove", handler);
    revealControls();
    return () => {
      window.removeEventListener("pointermove", handler);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [active, revealControls]);

  useEffect(() => {
    if (!video.menuOpen) revealControls();
  }, [video.menuOpen, revealControls]);

  const introSegment = useMemo(() => {
    if (!active || pipOpen || introMode === "off") return null;
    if (!video.found || !video.duration) return null;
    const currentTime = Number(video.currentTime) || 0;
    const candidates = [
      normalizeSegment(skipTimings?.intro, "intro"),
      normalizeSegment(skipTimings?.outro, "outro"),
    ].filter(Boolean);

    const exact = candidates.find(
      (segment) =>
        currentTime >= segment.start - 1.25 &&
        currentTime < segment.end - 0.75,
    );
    if (exact) return { ...exact, generic: false };

    if (isSeries && prefs.smartIntro && !skipTimings?.intro) {
      const learned = getSeriesIntroEnd(learnKey);
      const end = learned || prefs.genericIntroSeconds;
      const showUntil = Math.min(150, end + 20);
      if (currentTime >= 0 && currentTime < showUntil) {
        return {
          kind: "intro",
          start: 0,
          end,
          generic: true,
        };
      }
    }
    return null;
  }, [
    active,
    pipOpen,
    introMode,
    video.found,
    video.duration,
    video.currentTime,
    skipTimings?.intro,
    skipTimings?.outro,
    isSeries,
    prefs.smartIntro,
    prefs.genericIntroSeconds,
    learnKey,
  ]);

  const segmentKey = introSegment
    ? `${introKey}:${introSegment.kind}:${Math.round(introSegment.end)}`
    : "";
  const dismissed = segmentKey ? dismissRef.current.has(segmentKey) : false;

  const clearHover = useCallback(() => {
    if (hoverFrameRef.current) cancelAnimationFrame(hoverFrameRef.current);
    hoverFrameRef.current = null;
    setHoverPct(0);
  }, []);

  const clearUndo = useCallback(() => {
    setUndo(null);
    undoUntilRef.current = 0;
  }, []);

  const skipSegment = useCallback(
    async (segment, automatic = false) => {
      if (!segment) return;
      const from = Number(video.currentTime) || 0;
      const target = clamp(segment.end, 0, video.duration || segment.end);
      if (target <= from + 0.2) return;

      await control("seek-to", target);
      setVideo((current) => ({ ...current, currentTime: target }));
      dismissRef.current.add(
        `${introKey}:${segment.kind}:${Math.round(segment.end)}`,
      );
      clearHover();
      clearUndo();
      const until = Date.now() + INTRO_UNDO_MS;
      undoUntilRef.current = until;
      setUndo({
        from,
        target,
        key: `${introKey}:${segment.kind}:${Math.round(segment.end)}`,
        kind: segment.kind,
        automatic,
        segment: segment.generic ? "estimated" : "exact",
      });
      setUndoLeft(INTRO_UNDO_MS);

      if (segment.generic) {
        saveSeriesIntroEnd(learnKey, segment.end);
      }
    },
    [
      clearHover,
      clearUndo,
      control,
      introKey,
      learnKey,
      video.currentTime,
      video.duration,
    ],
  );

  // Auto mode is only allowed to act on known timings. The generic intro is a
  // useful manual escape hatch, but it is too rough to jump without consent.
  useEffect(() => {
    if (introMode !== "auto" || !introSegment || introSegment.generic) return;
    if (video.paused) return;
    if (dismissed) return;
    if (autoSkippedRef.current.has(segmentKey)) return;
    autoSkippedRef.current.add(segmentKey);
    skipSegment(introSegment, true);
  }, [
    introMode,
    introSegment,
    video.paused,
    dismissed,
    segmentKey,
    skipSegment,
  ]);

  useEffect(() => {
    if (!undo) return undefined;
    const interval = setInterval(() => {
      const left = Math.max(0, undoUntilRef.current - Date.now());
      setUndoLeft(left);
      if (left <= 0) clearUndo();
    }, 100);
    return () => clearInterval(interval);
  }, [undo, clearUndo]);

  // Keep the app-level session snapshot current without forcing App to
  // re-render. Sidebar Settings can therefore return to the exact frame.
  useEffect(() => {
    if (!active || !onSession) return;
    onSession({
      time: video.currentTime,
      duration: video.duration,
      paused: video.paused,
    });
  }, [active, onSession, video.currentTime, video.duration, video.paused]);

  useEffect(() => {
    if (!introSegment) clearHover();
    return clearHover;
    // Clear the halo when the segment changes or playback stops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentKey, active]);

  const startHover = () => {
    if (!introSegment) return;
    clearHover();
    hoverStartRef.current = performance.now();
    const tick = () => {
      const elapsed = performance.now() - hoverStartRef.current;
      const pct = Math.min(1, elapsed / prefs.introHoverMs);
      setHoverPct(pct);
      if (pct >= 1) {
        skipSegment(introSegment, true);
        return;
      }
      hoverFrameRef.current = requestAnimationFrame(tick);
    };
    hoverFrameRef.current = requestAnimationFrame(tick);
  };

  const undoSkip = async () => {
    if (!undo) return;
    await control("seek-to", undo.from);
    setVideo((current) => ({ ...current, currentTime: undo.from }));
    if (undo.key) {
      dismissRef.current.add(undo.key);
      autoSkippedRef.current.add(undo.key);
    }
    clearUndo();
    clearHover();
  };

  const togglePlay = useCallback(async () => {
    // Flip the label immediately: the provider may take a moment to answer
    // through its iframe, and the deck should never feel one step behind.
    // Mark the bridge as fresh so the fallback poll cannot undo the optimistic
    // label before the provider answers.
    lastMediaEventRef.current = Date.now();
    setVideo((current) => ({ ...current, paused: !current.paused }));
    const next = await control("toggle-play");
    if (next?.found) {
      lastMediaEventRef.current = Date.now();
      setVideo((current) => ({ ...current, ...next }));
    }
    revealControls();
  }, [control, revealControls]);

  const seekOnce = useCallback(
    async (direction, stepOverride = null) => {
      const step = stepOverride ?? prefs.seekStep;
      const delta = direction * step;
      const next = await control("seek", delta);
      if (next?.found) {
        setVideo((current) => ({ ...current, ...next }));
      } else {
        setVideo((current) => ({
          ...current,
          currentTime: clamp(
            current.currentTime + delta,
            0,
            current.duration || Number.MAX_SAFE_INTEGER,
          ),
        }));
      }
      setSeekBurst({
        direction,
        seconds: Math.abs(step),
        at: Date.now(),
      });
      if (burstTimerRef.current) clearTimeout(burstTimerRef.current);
      burstTimerRef.current = setTimeout(() => setSeekBurst(null), 650);
    },
    [control, prefs.seekStep],
  );

  const releaseHoldRef = useRef(null);
  const stopHold = useCallback(() => {
    if (holdTimerRef.current) {
      clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (releaseHoldRef.current) {
      window.removeEventListener("pointerup", releaseHoldRef.current);
      window.removeEventListener("pointercancel", releaseHoldRef.current);
      releaseHoldRef.current = null;
    }
  }, []);

  const startHold = (direction) => (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    stopHold();
    seekOnce(direction);
    holdTimerRef.current = setInterval(
      () => seekOnce(direction),
      Math.max(HOLD_STEP_MIN_MS, prefs.holdInterval),
    );
    // The pointer may be released outside the button (or outside the app).
    // Without this the hold interval keeps seeking forever.
    const release = () => stopHold();
    releaseHoldRef.current = release;
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
  };

  useEffect(() => stopHold, [stopHold]);

  useEffect(
    () => () => {
      if (burstTimerRef.current) clearTimeout(burstTimerRef.current);
    },
    [],
  );

  const seekTo = async (event) => {
    const value = Number(event.target.value);
    if (!Number.isFinite(value)) return;
    const next = await control("seek-to", value);
    if (next?.found) setVideo((current) => ({ ...current, ...next }));
    else setVideo((current) => ({ ...current, currentTime: value }));
  };

  const toggleMute = async () => {
    // Providers sometimes leave volume at 0 with muted=false. A plain mute
    // toggle would then look like it does nothing, so restore the level.
    const silentAtZero = Number(video.volume) === 0;
    // Paint and save before the provider answers: a preference change should
    // never wait for a slow iframe round-trip.
    const optimistic = {
      muted: silentAtZero ? false : !video.muted,
      volume: silentAtZero ? 1 : video.volume,
    };
    setVideo((current) => ({ ...current, ...optimistic }));
    setPrefs(savePlayerPreferences(optimistic));
    const next = silentAtZero
      ? await control("set-volume", 1)
      : await control("toggle-mute");
    if (next?.found) {
      setVideo((current) => ({ ...current, ...next }));
      const patch = { muted: !!next.muted };
      if (Number.isFinite(Number(next.volume))) {
        patch.volume = Number(next.volume);
      }
      setPrefs(savePlayerPreferences(patch));
    }
    revealControls();
  };

  const changeVolume = async (event) => {
    const value = clamp(Number(event.target.value), 0, 1);
    // Save and paint instantly. The provider call only confirms the value.
    setVideo((current) => ({
      ...current,
      volume: value,
      muted: false,
    }));
    setPrefs(savePlayerPreferences({ volume: value, muted: false }));
    volumeSyncedRef.current = syncKey;
    const next = await control("set-volume", value);
    if (next?.found) setVideo((current) => ({ ...current, ...next }));
    revealControls();
  };

  // The provider's deck used to own the only volume slider. With it hidden,
  // the deck must restore the saved level itself or every new title started
  // quieter than the user left it.
  useEffect(() => {
    if (!video.found) return;
    const key = syncKey;
    if (!key || key === "0" || volumeSyncedRef.current === key) return;
    volumeSyncedRef.current = key;
    if (prefs.muted) {
      if (!video.muted) {
        control("toggle-mute").then((next) => {
          if (next?.found) setVideo((current) => ({ ...current, ...next }));
        });
      }
      return;
    }
    if (video.muted) return;
    const target = clamp(Number(prefs.volume), 0, 1);
    if (Math.abs(target - (Number(video.volume) || 0)) < 0.02) return;
    control("set-volume", target).then((next) => {
      if (next?.found) setVideo((current) => ({ ...current, ...next }));
    });
  }, [video.found, syncKey, video.muted, video.volume, prefs.volume, prefs.muted, control]);

  const toggleTimeDisplay = () => {
    const next = showRemaining ? "total" : "remaining";
    setPrefs(savePlayerPreference("timeDisplay", next));
    revealControls();
  };

  const cycleBoost = async () => {
    const next = boostLevel >= 3 ? 1 : boostLevel + 1;
    setBoostLevel(next);
    setPrefs(savePlayerPreference("audioBoost", next));
    const result = await control("audio-boost", next);
    if (result?.supported && Number(result.level)) {
      setBoostLevel(Number(result.level));
    }
    revealControls();
  };

  // Detect the provider's volume-boost row and re-apply the saved level once
  // per title. This is the control that was lost when the provider's deck was
  // hidden, and it is what makes quiet dialogue usable.
  useEffect(() => {
    if (!active || !video.found) return;
    const key = syncKey;
    if (!key || key === "0" || boostSyncedRef.current === key) return;
    boostSyncedRef.current = key;
    // If the user already picked a boost in the deck, re-apply it. Otherwise
    // read the provider's own level instead of forcing Off and making the
    // film quieter than the provider had it.
    const desired = prefs.audioBoost > 1 ? prefs.audioBoost : null;
    control("audio-boost", desired).then((result) => {
      if (!result?.supported) {
        setBoostAvailable(false);
        return;
      }
      setBoostAvailable(true);
      const level = Number(result.level) || 1;
      setBoostLevel(level);
      if (level !== prefs.audioBoost) {
        setPrefs(savePlayerPreference("audioBoost", level));
      }
    });
  }, [active, video.found, syncKey, prefs.audioBoost, control]);

  const actualRate =
    Number(video.playbackRate) || Number(prefs.playbackRate) || 1;

  const openProviderMenu = async () => {
    await control("provider-menu");
    revealControls();
  };

  const changeSubtitleDelay = async (delta) => {
    const next = clamp(
      Math.round((subtitleDelay + delta) * 2) / 2,
      -10,
      10,
    );
    setSubtitleDelay(next);
    const result = await control("subtitle-delay", next);
    if (result && result.supported === false) {
      // The provider renders subtitles in its own DOM; keep the deck honest
      // instead of pretending a delay was applied.
      setSubtitleDelay(0);
    }
    revealControls();
  };

  const cycleSleepTimer = () => {
    const options = [0, 30, 60, 90];
    const minutesLeft = sleepEndsAt
      ? Math.ceil((sleepEndsAt - Date.now()) / 60000)
      : 0;
    const nearest = options.reduce((best, option) =>
      Math.abs(option - minutesLeft) < Math.abs(best - minutesLeft)
        ? option
        : best,
    );
    const next = options[(options.indexOf(nearest) + 1) % options.length];
    setSleepEndsAt(next ? Date.now() + next * 60000 : 0);
    revealControls();
  };

  const cycleRate = async () => {
    const rates = [0.75, 1, 1.25, 1.5, 1.75, 2];
    const current = rates.reduce((best, rate) =>
      Math.abs(rate - actualRate) < Math.abs(best - actualRate) ? rate : best,
    );
    const next = rates[(rates.indexOf(current) + 1) % rates.length];
    // Save and paint instantly; the provider call only confirms it.
    setVideo((currentState) => ({ ...currentState, playbackRate: next }));
    setPrefs(savePlayerPreference("playbackRate", next));
    const result = await control("set-rate", next);
    if (result?.found) {
      setVideo((currentState) => ({ ...currentState, ...result }));
    }
    revealControls();
  };

  const stepRate = useCallback(
    async (direction) => {
      const current = Number(actualRate) || 1;
      const next = clamp(
        Math.round((current + direction * 0.25) * 100) / 100,
        0.25,
        4,
      );
      if (next === current) return;
      setVideo((state) => ({ ...state, playbackRate: next }));
      setPrefs(savePlayerPreference("playbackRate", next));
      const result = await control("set-rate", next);
      if (result?.found) {
        setVideo((state) => ({ ...state, ...result }));
      }
      revealControls();
    },
    [actualRate, control, revealControls],
  );

  const toggleFullscreen = useCallback(async () => {
    if (typeof onToggleFullscreen === "function") {
      onToggleFullscreen();
      return;
    }
    const target = wrapRef?.current;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (target?.requestFullscreen) {
        await target.requestFullscreen();
      }
    } catch {}
  }, [onToggleFullscreen, wrapRef]);

  // Host-side shortcuts. They only run while the deck is mounted and never
  // steal keys from inputs, buttons or editable fields. The guest page keeps
  // its own shortcuts; this covers focus that sits outside the iframe.
  useEffect(() => {
    if (!active || pipOpen) return undefined;
    const handler = (event) => {
      const tag = (event.target?.tagName || "").toUpperCase();
      const editing =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        event.target?.isContentEditable;
      if (editing) return;
      if (event.defaultPrevented) return;
      if (
        tag === "BUTTON" ||
        tag === "A" ||
        event.target?.closest?.("button, a, [role='button']")
      ) {
        return;
      }

      if (event.key === "Escape" && helpOpen) {
        event.preventDefault();
        setHelpOpen(false);
        return;
      }
      if (event.key === "?" || (event.shiftKey && event.code === "Slash")) {
        event.preventDefault();
        setHelpOpen((open) => !open);
        revealControls();
        return;
      }
      if (helpOpen) return;

      if (event.code === "Space" || event.code === "KeyK") {
        if (event.repeat) return;
        event.preventDefault();
        togglePlay();
        return;
      }
      if (event.code === "ArrowLeft") {
        event.preventDefault();
        seekOnce(-1);
        return;
      }
      if (event.code === "ArrowRight") {
        event.preventDefault();
        seekOnce(1);
        return;
      }
      if (event.code === "KeyJ") {
        event.preventDefault();
        seekOnce(-1, 10);
        return;
      }
      if (event.code === "KeyL") {
        event.preventDefault();
        seekOnce(1, 10);
        return;
      }
      if (event.code === "KeyM") {
        event.preventDefault();
        toggleMute();
        return;
      }
      if (event.code === "KeyF") {
        event.preventDefault();
        toggleFullscreen();
        return;
      }
      if (event.shiftKey && event.code === "Comma") {
        event.preventDefault();
        stepRate(-1);
        return;
      }
      if (event.shiftKey && event.code === "Period") {
        event.preventDefault();
        stepRate(1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    active,
    helpOpen,
    pipOpen,
    revealControls,
    seekOnce,
    stepRate,
    toggleFullscreen,
    toggleMute,
    togglePlay,
  ]);

  // Live media bridge. The injected guard reports play/pause/seek/volume events
  // from every frame, so the label follows a click on the provider's own player
  // (or a keyboard shortcut) immediately instead of waiting for a poll.
  useEffect(() => {
    if (!active || pipOpen) return undefined;
    const wcId = getWebContentsId();
    const onState = (payload) => {
      if (!payload?.state) return;
      if (payload.wcId && wcId && Number(payload.wcId) !== Number(wcId)) return;
      lastMediaEventRef.current = Date.now();
      setVideo((current) => ({ ...current, ...payload.state }));
    };
    const onCommand = (payload) => {
      if (payload?.wcId && wcId && Number(payload.wcId) !== Number(wcId)) return;
      if (payload?.command === "toggle-fullscreen") toggleFullscreen();
      else if (payload?.command === "exit-fullscreen") {
        if (isFullscreen) toggleFullscreen();
      } else if (payload?.command === "pointer-move") revealControls();
    };
    const offState = window.electron?.onPlayerMediaState?.(onState);
    const offCommand = window.electron?.onPlayerCommand?.(onCommand);
    return () => {
      offState?.();
      offCommand?.();
    };
  }, [
    active,
    pipOpen,
    getWebContentsId,
    toggleFullscreen,
    revealControls,
    isFullscreen,
  ]);

  const openSettings = () => {
    onSession?.({
      time: video.currentTime,
      duration: video.duration,
      paused: video.paused,
    });
    onSettings?.();
  };

  const progress = video.duration
    ? clamp((video.currentTime / video.duration) * 100, 0, 100)
    : 0;
  const visible =
    active &&
    !pipOpen &&
    !video.menuOpen &&
    (controlsVisible || !!introSegment || !!undo || !!seekBurst || helpOpen || tracksOpen);

  if (!active || pipOpen) return null;
  if (!visible) {
    if (video.menuOpen) return null;
    return (
      <div className="player-deck-handle-wrap">
        <button
          type="button"
          className="player-deck__handle"
          onMouseEnter={() => setControlsVisible(true)}
          onClick={() => setControlsVisible(true)}
          title={t("player.showControls")}
          aria-label={t("player.showControls")}
        >
          ⌃
        </button>
      </div>
    );
  }

  return (
    <div
      className={`player-deck${visible ? " is-visible" : ""}${isFullscreen ? " is-fullscreen" : ""}`}
      onMouseEnter={() => {
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        setControlsVisible(true);
      }}
      onMouseLeave={revealControls}
      onDoubleClick={(event) => {
        if (event.target.closest("button, input, a, select, textarea")) return;
        toggleFullscreen();
      }}
    >
      <div className="player-deck__dock">
      <div className="player-deck__topline">
        <button
          type="button"
          className="player-deck__back"
          onClick={onExit}
          title={t("player.back")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
          <span>{t("player.back")}</span>
        </button>
        {(title || subtitle) && (
          <div className="player-deck__identity">
            {subtitle && <span>{subtitle}</span>}
            {title && <b>{title}</b>}
          </div>
        )}
        {onSettings && (
          <button
            type="button"
            className="player-deck__settings"
            onClick={openSettings}
            title={t("player.settings")}
            aria-label={t("player.settings")}
          >
            ⚙
          </button>
        )}
      </div>

      <div className="player-deck__bottom">
        <div className="player-deck__timeline-row">
          <span className="player-deck__time">{formatTime(video.currentTime)}</span>
          <div className="player-deck__timeline">
            <div
              className="player-deck__timeline-fill"
              style={{ width: `${progress}%` }}
            />
            <input
              type="range"
              min={0}
              max={video.duration || 0}
              step={0.25}
              value={Math.min(video.currentTime, video.duration || 0)}
              onChange={seekTo}
              aria-label={t("player.progress")}
              style={{ "--player-progress": `${progress}%` }}
            />
          </div>
          <button
            type="button"
            className="player-deck__time player-deck__time--total"
            onClick={toggleTimeDisplay}
            title={
              showRemaining
                ? t("player.showTotalTime")
                : t("player.showRemainingTime")
            }
          >
            {showRemaining
              ? `−${formatTime(Math.max(0, (video.duration || 0) - (video.currentTime || 0)))}`
              : formatTime(video.duration)}
          </button>
        </div>

        <div className="player-deck__controls">
          <div className="player-deck__controls-side">
            <button
              type="button"
              className="player-deck__icon-btn"
              onClick={toggleMute}
              title={video.muted ? t("player.unmute") : t("player.mute")}
              aria-label={video.muted ? t("player.unmute") : t("player.mute")}
            >
              <VolumeIcon muted={video.muted || video.volume === 0} />
            </button>
            <input
              type="range"
              className="player-deck__volume"
              min={0}
              max={1}
              step={0.02}
              value={video.muted ? 0 : video.volume || 0}
              onChange={changeVolume}
              aria-label={t("player.volume")}
              title={`${t("player.volume")} ${Math.round((video.muted ? 0 : video.volume || 0) * 100)}%`}
              style={{ "--vol": `${Math.round((video.muted ? 0 : video.volume || 0) * 100)}%` }}
            />
            <button
              type="button"
              className="player-deck__rate"
              onClick={cycleRate}
              title={t("player.speed")}
            >
              {actualRate.toFixed(2).replace(/\.?0+$/, "")}×
            </button>
          </div>

          <div className="player-deck__transport">
            <button
              type="button"
              className="player-deck__skip"
              onPointerDown={startHold(-1)}
              onPointerUp={stopHold}
              onPointerLeave={stopHold}
              onPointerCancel={stopHold}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  seekOnce(-1);
                }
              }}
              title={t("player.seekBack", { s: prefs.seekStep })}
              aria-label={t("player.seekBack", { s: prefs.seekStep })}
            >
              <span className="player-deck__skip-arrow">↞</span>
              <span>{prefs.seekStep}</span>
            </button>

            <button
              type="button"
              className="player-deck__play"
              onClick={togglePlay}
              title={video.paused ? t("player.play") : t("player.pause")}
              aria-label={video.paused ? t("player.play") : t("player.pause")}
            >
              {video.paused ? (
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M8 5.2v13.6L19.5 12 8 5.2Z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="6.4" y="5" width="4.2" height="14" rx="1" />
                  <rect x="13.4" y="5" width="4.2" height="14" rx="1" />
                </svg>
              )}
            </button>

            <button
              type="button"
              className="player-deck__skip"
              onPointerDown={startHold(1)}
              onPointerUp={stopHold}
              onPointerLeave={stopHold}
              onPointerCancel={stopHold}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  seekOnce(1);
                }
              }}
              title={t("player.seekForward", { s: prefs.seekStep })}
              aria-label={t("player.seekForward", { s: prefs.seekStep })}
            >
              <span>{prefs.seekStep}</span>
              <span className="player-deck__skip-arrow">↠</span>
            </button>
          </div>

          <div className="player-deck__controls-side player-deck__controls-side--right">
            <span className="player-deck__state" aria-live="polite">
              {waitingLong && !video.found
                ? t("player.stalled")
                : video.found || video.readyState > 0
                  ? !video.paused && video.readyState < 3
                    ? t("player.buffering")
                    : video.paused
                      ? t("player.paused")
                      : t("player.playing")
                : t("player.connecting")}
            </span>
            {waitingLong && onRetry && (
              <button
                type="button"
                className="player-deck__icon-btn player-deck__retry"
                onClick={onRetry}
                title={t("player.retry")}
                aria-label={t("player.retry")}
              >
                <RetryIcon />
              </button>
            )}
            {onNext && (
              <button
                type="button"
                className="player-deck__next"
                onClick={() => onNext()}
                title={
                  nextTitle ||
                  (nextLabel
                    ? `${t("player.nextEpisode")}: ${nextLabel}`
                    : t("player.nextEpisode"))
                }
                aria-label={nextTitle || t("player.nextEpisode")}
              >
                {t("player.nextShort")} <span>→</span>
              </button>
            )}
            {boostAvailable && (
              <button
                type="button"
                className={`player-deck__icon-btn player-deck__boost${boostLevel > 1 ? " is-active" : ""}`}
                onClick={cycleBoost}
                title={`${t("player.boost")} · ${boostLevel > 1 ? `${boostLevel}×` : "1×"}`}
                aria-label={`${t("player.boost")} ${boostLevel}×`}
              >
                <BoltIcon />
                {boostLevel > 1 ? `${boostLevel}×` : ""}
              </button>
            )}
            <button
              type="button"
              className={`player-deck__icon-btn player-deck__tracks${tracksOpen ? " is-active" : ""}`}
              onClick={() => setTracksOpen((open) => !open)}
              title={t("player.tracks")}
              aria-label={t("player.tracks")}
              aria-expanded={tracksOpen}
            >
              CC
            </button>
            <button
              type="button"
              className="player-deck__icon-btn"
              onClick={cycleSleepTimer}
              title={
                sleepLeft > 0
                  ? t("player.sleepRemaining", { time: formatTime(sleepLeft) })
                  : t("player.sleepTimer")
              }
              aria-label={
                sleepLeft > 0
                  ? t("player.sleepRemaining", { time: formatTime(sleepLeft) })
                  : t("player.sleepTimer")
              }
            >
              {sleepLeft > 0 ? formatTime(sleepLeft) : <SleepIcon />}
            </button>
            <button
              type="button"
              className="player-deck__icon-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? t("player.exitFullscreen") : t("player.fullscreen")}
              aria-label={isFullscreen ? t("player.exitFullscreen") : t("player.fullscreen")}
            >
              <FullscreenIcon exit={isFullscreen} />
            </button>
            {onPip && (
              <button
                type="button"
                className="player-deck__icon-btn"
                onClick={onPip}
                title={t("player.pip")}
                aria-label={t("player.pip")}
              >
                <PipIcon />
              </button>
            )}
          </div>
        </div>
      </div>
      </div>

      {seekBurst && (
        <div className="player-deck__burst" key={seekBurst.at}>
          {seekBurst.direction < 0 ? "−" : "+"}
          {seekBurst.seconds}s
        </div>
      )}

      {introSegment &&
        (introMode === "manual" || introSegment.generic) &&
        !dismissed && (
        <button
          type="button"
          className={`player-skip${hoverPct > 0 ? " is-hovering" : ""}`}
          style={{ "--skip-deg": `${hoverPct * 360}deg` }}
          onMouseEnter={startHover}
          onMouseLeave={clearHover}
          onClick={() => skipSegment(introSegment, false)}
          title={`${introSegment.kind === "outro" ? t("player.skipOutro") : t("player.skipIntro")}${
            introSegment.generic ? t("player.skipEstimated") : ""
          }`}
        >
          <span className="player-skip__ring" aria-hidden="true">
            <span className="player-skip__ring-inner">↦</span>
          </span>
          <span className="player-skip__copy">
            <b>
              {introSegment.kind === "outro"
                ? t("player.skipOutro")
                : t("player.skipIntro")}
              {introSegment.generic ? t("player.skipEstimated") : ""}
            </b>
            <small>
              {hoverPct > 0
                ? t("player.releaseToCancel", {
                    s: Math.ceil(
                      (1 - hoverPct) * (prefs.introHoverMs / 1000),
                    ),
                  })
                : t("player.holdToSkip", {
                    s: (prefs.introHoverMs / 1000).toFixed(1),
                  })}
            </small>
          </span>
        </button>
      )}

      {undo && (
        <button type="button" className="player-undo" onClick={undoSkip}>
          <span className="player-undo__icon">↶</span>
          <span>
            {t("player.undoStart")}
            <small>
              {(undoLeft / 1000).toFixed(1)}s ·{" "}
              {undo.automatic ? t("player.autoSkip") : t("player.manualSkip")}
            </small>
          </span>
        </button>
      )}

      {tracksOpen && (
        <div className="player-deck__tracks-menu" role="menu">
          <button
            type="button"
            className="player-deck__tracks-item"
            role="menuitem"
            onClick={() => {
              setTracksOpen(false);
              openProviderMenu();
            }}
          >
            <span>{t("player.providerTracks")}</span>
            <small>{t("player.providerTracksHint")}</small>
          </button>
          <div className="player-deck__tracks-row">
            <span>{t("player.subtitleDelay")}</span>
            <div className="player-deck__tracks-stepper">
              <button type="button" onClick={() => changeSubtitleDelay(-0.5)} aria-label="−0.5 s">
                −
              </button>
              <b>{subtitleDelay > 0 ? "+" : ""}{subtitleDelay.toFixed(1)} s</b>
              <button type="button" onClick={() => changeSubtitleDelay(0.5)} aria-label="+0.5 s">
                +
              </button>
            </div>
          </div>
          <button
            type="button"
            className="player-deck__tracks-reset"
            onClick={() => changeSubtitleDelay(-subtitleDelay)}
          >
            {t("player.subtitleDelayReset")}
          </button>
        </div>
      )}

      {helpOpen && (
        <div className="player-deck__help" role="dialog" aria-label={t("player.shortcuts")}>
          <div className="player-deck__help-head">
            <b>{t("player.shortcuts")}</b>
            <button type="button" onClick={() => setHelpOpen(false)} aria-label={t("common.close")}>
              ×
            </button>
          </div>
          <dl>
            <div><dt>Space / K</dt><dd>{t("player.shortcutPlayPause")}</dd></div>
            <div><dt>← / →</dt><dd>{t("player.shortcutSeek")}</dd></div>
            <div><dt>J / L</dt><dd>{t("player.shortcutSeekLong")}</dd></div>
            <div><dt>M</dt><dd>{t("player.shortcutMute")}</dd></div>
            <div><dt>F</dt><dd>{t("player.shortcutFullscreen")}</dd></div>
            <div><dt>Shift + , / .</dt><dd>{t("player.shortcutSpeed")}</dd></div>
            <div><dt>?</dt><dd>{t("player.shortcutHelp")}</dd></div>
          </dl>
        </div>
      )}
    </div>
  );
}
