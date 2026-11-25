// Injected into every player frame. Streaming sites often pause the video when
// an outside click closes their quality/audio menu. From the user's point of
// view that click was only "close the menu", not "pause the film". The guard
// remembers that a menu was open, lets the site close it normally, and restores
// playback only if the click itself caused a pause.
//
// It also owns the live media bridge: every play/pause/seek/volume event is
// reported to the host through a prefixed console message, which the main
// process forwards to the deck. That makes the play/pause label instant no
// matter how playback was toggled (deck, provider UI, keyboard, mouse).
//
// Important: a normal click on the video must never be interpreted as a menu
// click. Doing that made the deck look like it paused and immediately played
// again by itself.
module.exports = `
(function() {
  if (window.__gigiMenuGuardInstalled) return;
  window.__gigiMenuGuardInstalled = true;

  // The app draws its own deck above the video. Every provider also ships a
  // control bar with play/volume/settings buttons, which would sit underneath
  // ours and duplicate every control. Hide it in the guest: common player
  // skins first, then a geometry pass for custom bars with no stable class.
  var CHROME_CSS = [
    'video::-webkit-media-controls,',
    'video::-webkit-media-controls-enclosure,',
    'video::-webkit-media-controls-panel,',
    'video::-webkit-media-controls-overlay-play-button { display: none !important; }',
    'html:not([data-gigi-show-chrome]) :is(.controls-row, .vjs-control-bar, .jw-controls, .plyr__controls, .ytp-chrome-bottom,',
    '[class*="control-bar"], [class*="controls-bar"], [class*="player-controls"],',
    '[class*="playerControls"], [data-gigi-provider-chrome]) { display: none !important; }',
    // The provider paints its own giant play/pause glyph over the picture.
    // The deck already owns that control, so leaving it visible showed two
    // icons at once. The button stays clickable (opacity keeps hit-testing)
    // and the guard's smart click still works as a fallback.
    '#centerToggle, .center-toggle, [class*="center-toggle"] { opacity: 0 !important; background: transparent !important; }',
    '#centerToggle svg, .center-toggle svg, [class*="center-toggle"] svg { display: none !important; }'
  ].join(String.fromCharCode(10));

  function installChromeCss() {
    if (document.getElementById('__gigi_chrome_css')) return;
    var style = document.createElement('style');
    style.id = '__gigi_chrome_css';
    style.textContent = CHROME_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function hideProviderChrome() {
    installChromeCss();
    var v = getVideo();
    if (!v) return;
    if (v.controls) v.controls = false;
    var vr = v.getBoundingClientRect();
    if (!vr.width || !vr.height) return;

    var nodes = document.querySelectorAll('div, section, footer, nav');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el === v || el.contains(v)) continue;
      if (el.getAttribute('data-gigi-provider-chrome')) continue;
      var r = el.getBoundingClientRect();
      if (r.width < vr.width * 0.5 || r.height < 28 || r.height > 140) continue;
      if (r.top < vr.top + vr.height * 0.6) continue;
      if (r.bottom < vr.top || r.top > vr.bottom) continue;
      var s = window.getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      if (Number(s.opacity || 1) < 0.01) continue;
      var controls = el.querySelectorAll('button, [role="button"], input[type="range"]').length;
      if (controls < 2) continue;
      el.setAttribute('data-gigi-provider-chrome', '1');
    }
  }

  var MENU_SELECTOR = [
    '[role="menu"]',
    '[role="listbox"]',
    '[class*="dropdown"]',
    '[class*="Dropdown"]',
    '[class*="quality"]',
    '[class*="Quality"]',
    '[class*="audio"]',
    '[class*="Audio"]',
    '[class*="subtitle"]',
    '[class*="Subtitle"]',
    '[class*="caption"]',
    '[class*="settings"]',
    '[aria-expanded="true"]'
  ].join(',');

  var guardUntil = 0;
  var wasPlaying = false;
  var pendingMenu = null;
  var menuFlagTimer = null;
  var lastReport = 0;
  var lastPointer = 0;
  var clickTimers = [];

  function markMenuOpen() {
    window.__gigiMenuOpen = true;
    clearTimeout(menuFlagTimer);
    menuFlagTimer = setTimeout(function() {
      window.__gigiMenuOpen = false;
    }, 2500);
  }

  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    var r = el.getBoundingClientRect();
    var style = window.getComputedStyle(el);
    return r.width > 4 && r.height > 4 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      Number(style.opacity || 1) > 0.01;
  }

  function getVideo() {
    var videos = Array.prototype.slice.call(document.querySelectorAll('video'));
    if (!videos.length) return null;
    videos.sort(function(a, b) {
      var area = function(v) {
        return Math.max(1, v.clientWidth || 0) * Math.max(1, v.clientHeight || 0);
      };
      return area(b) - area(a);
    });
    return videos[0];
  }

  function snapshot(v) {
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
  }

  function report(v) {
    if (!v) return;
    try {
      var state = snapshot(v);
      window.__gigiVideoState = state;
      window.__gigiVideoRevision = (window.__gigiVideoRevision || 0) + 1;
      lastReport = Date.now();
      console.log('__GIGI_MEDIA__' + JSON.stringify(state));
    } catch (e) {}
  }

  function thinReport(v) {
    // timeupdate fires ~4x/s; one report per 600ms is enough for the timeline.
    if (Date.now() - lastReport < 600) return;
    report(v);
  }

  function bindMedia(v) {
    if (!v || v.__gigiMediaBound) return;
    v.__gigiMediaBound = true;
    ['play', 'pause', 'seeked', 'volumechange', 'ratechange',
      'loadedmetadata', 'durationchange', 'ended', 'playing', 'waiting'
    ].forEach(function(name) {
      v.addEventListener(name, function() { report(v); }, true);
    });
    v.addEventListener('timeupdate', function() { thinReport(v); }, true);
    report(v);
  }

  function bindCurrent() {
    var v = getVideo();
    if (v) bindMedia(v);
    hideProviderChrome();
  }

  bindCurrent();
  setInterval(bindCurrent, 1000);

  // ── Smart mouse behaviour ────────────────────────────────────────────────
  // A provider may or may not toggle playback on a picture click. Wait a short
  // moment: if the provider already changed pause state, do nothing; if it did
  // not, toggle it ourselves. This gives one reliable single-click play/pause
  // without double toggles.
  function isControlTarget(target) {
    if (!target || !target.closest) return false;
    // A provider's full-player tap surface is the picture, not a control.
    // With its own deck hidden, the smart click below must keep toggling.
    if (target.closest('.center-toggle, [class*="center-toggle"], [class*="centerToggle"]')) return false;
    return !!target.closest(
      'button, [role="button"], input, select, textarea, a, ' +
      '[role="menuitem"], [role="slider"], ' +
      // Specific bar classes, never a bare [class*="control"]: the provider's
      // player root carries "controls-visib" and that ancestor made every
      // picture click look like a control click.
      '[class*="control-bar"], [class*="controls-bar"], ' +
      '[class*="controls-row"], [class*="player-controls"], ' +
      '[class*="playerControls"], [class*="volume"], ' +
      '[class*="settings"], [class*="menu"], [class*="Menu"]'
    );
  }

  function onPicture(event) {
    var v = getVideo();
    if (!v) return false;
    if (isControlTarget(event.target)) return false;
    var r = v.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    if (event.clientX < r.left || event.clientX > r.right ||
        event.clientY < r.top || event.clientY > r.bottom) return false;
    // Leave the provider's own bottom control strip alone.
    if (event.clientY > r.bottom - Math.min(92, r.height * 0.24)) return false;
    return true;
  }

  document.addEventListener('click', function(event) {
    if (event.button !== 0) return;
    if (event.detail > 1) {
      // Second click of a double click: cancel the pending single-click
      // fallback before it can toggle playback, and keep the provider from
      // toggling it a second time. The dblclick handler restores the state
      // the first click changed, so a double click is only a fullscreen
      // gesture instead of pause + play + fullscreen.
      clickTimers.forEach(function(timer) { clearTimeout(timer); });
      clickTimers = [];
      if (onPicture(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (!onPicture(event)) return;
    var v = getVideo();
    if (!v) return;
    window.__gigiPausedBeforeClick = !!v.paused;
    var before = !!v.paused;
    // Delay the fallback long enough for a double click to cancel it and
    // become a clean fullscreen gesture.
    var timer = setTimeout(function() {
      clickTimers = clickTimers.filter(function(entry) { return entry !== timer; });
      if (!v.isConnected) return;
      // Provider handled the click -> state already changed.
      if (!!v.paused !== before) return;
      if (before) v.play().catch(function() {});
      else v.pause();
      report(v);
    }, 300);
    clickTimers.push(timer);
  }, true);

  document.addEventListener('dblclick', function(event) {
    if (!onPicture(event)) return;
    event.preventDefault();
    event.stopPropagation();
    clickTimers.forEach(function(timer) { clearTimeout(timer); });
    clickTimers = [];
    var v = getVideo();
    var before = window.__gigiPausedBeforeClick;
    if (v && typeof before === 'boolean') {
      // The first click of the pair may have paused/resumed the film before
      // this handler ran. Put playback back where the user left it.
      setTimeout(function() {
        if (!v.isConnected) return;
        if (before && !v.paused) v.pause();
        else if (!before && v.paused) v.play().catch(function() {});
        report(v);
      }, 80);
    }
    try { console.log('__GIGI_TOGGLE_FULLSCREEN__'); } catch (e) {}
  }, true);

  // The host cannot see pointer events that land on the webview surface. Report
  // them (throttled) so the deck reappears when the mouse moves over the video.
  document.addEventListener('mousemove', function() {
    var now = Date.now();
    if (now - lastPointer < 260) return;
    lastPointer = now;
    try { console.log('__GIGI_POINTER__'); } catch (e) {}
  }, true);

  // Keyboard shortcuts work even when the host deck does not have focus.
  document.addEventListener('keydown', function(event) {
    var active = document.activeElement;
    var tag = (active && active.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT|BUTTON|A/.test(tag)) return;
    if (active && active.isContentEditable) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    var v = getVideo();
    if (!v) return;
    if (event.key === 'Escape' || event.code === 'Escape') {
      // The host overlay is not the guest's native fullscreen, so the app
      // window never sees this key while the player iframe has focus.
      try { console.log('__GIGI_EXIT_FULLSCREEN__'); } catch (e) {}
      return;
    }
    if (event.code === 'Space' || event.key === ' ') {
      event.preventDefault();
      // Some providers also handle Space. Wait a moment and only toggle when
      // the site left the state untouched, otherwise both toggles cancel out.
      var wasPaused = v.paused;
      setTimeout(function() {
        if (!v.isConnected) return;
        if (v.paused !== wasPaused) return;
        if (wasPaused) v.play().catch(function() {});
        else v.pause();
        report(v);
      }, 140);
    } else if (event.key === 'ArrowLeft') {
      v.currentTime = Math.max(0, v.currentTime - 10);
      report(v);
    } else if (event.key === 'ArrowRight') {
      v.currentTime = Math.min(v.duration || 0, v.currentTime + 10);
      report(v);
    }
  }, true);

  function findMenu() {
    var nodes = document.querySelectorAll(MENU_SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el === getVideo()) continue;
      if (!visible(el)) continue;
      var rect = el.getBoundingClientRect();
      if (rect.width > window.innerWidth * 0.7) continue;
      if (rect.height < 36) continue;
      if (el.querySelectorAll('button, [role="menuitem"], li').length < 2) continue;
      return el;
    }
    return null;
  }

  function menuStillOpen(el) {
    if (!el || !el.isConnected) return false;
    return visible(el);
  }

  function resumeIfNeeded() {
    if (!wasPlaying || Date.now() > guardUntil) return;
    // The provider closes its menu in the same click, so wait until its
    // handler ran. If the menu is still there, this click did not close it
    // and playback must stay exactly as the user left it.
    if (menuStillOpen(pendingMenu)) return;
    var v = getVideo();
    wasPlaying = false;
    pendingMenu = null;
    guardUntil = 0;
    if (!v) return;
    if (v.paused) v.play().catch(function() {});
  }

  function scheduleResume() {
    setTimeout(resumeIfNeeded, 160);
    setTimeout(resumeIfNeeded, 420);
  }

  document.addEventListener('pointerdown', function(event) {
    var control = event.target && event.target.closest
      ? event.target.closest('button, [role="button"], [role="menuitem"], [aria-label], [title]')
      : null;
    var label = control
      ? [control.getAttribute('aria-label'), control.getAttribute('title'), control.className, control.textContent]
          .filter(Boolean).join(' ').toLowerCase()
      : '';
    var menuControl = !!label && /quality|calidad|audio|subtitle|subtitles|caption|cc|setting|ajustes|track|idioma|language/.test(label);
    var menu = findMenu();
    pendingMenu = menu;

    if (menuControl) markMenuOpen();

    // Only a genuinely open menu can be closed by this click. A plain click
    // on the picture must never arm a resume: that is what made the video
    // pause and play again by itself when a provider kept a hidden settings
    // panel in the DOM.
    if (!menu) {
      wasPlaying = false;
      guardUntil = 0;
      return;
    }

    var v = getVideo();
    if (v && !v.paused) {
      wasPlaying = true;
      guardUntil = Date.now() + 1800;
    }
  }, true);

  document.addEventListener('click', function(event) {
    if (event.button !== 0) return;
    if (!wasPlaying || Date.now() > guardUntil) return;
    scheduleResume();
  }, true);

  window.__gigiMenuGuardCleanup = function() {
    wasPlaying = false;
    guardUntil = 0;
    window.__gigiMenuOpen = false;
  };
})();
`;
