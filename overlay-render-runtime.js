'use strict';

/**
 * Generic HTML overlay frame-seek runtime (injected into any template).
 *
 * Template contract (all optional):
 * - window.GRAPHIC or any config passed to prepareFrame(timeSec, config)
 * - Root element: .overlay, [data-render-overlay], or body > *:first-child
 * - Exit phase: .is-exiting on root (standard)
 * - Exit keyframes: animation names ending in -out or -exit (convention)
 * - config.renderDuration / window.RENDER_DURATION — fixed duration
 * - config.animation.hold, config.animation.tail / tailPad
 */

(function () {
  function findOverlayRoot() {
    return document.querySelector('.overlay,[data-render-overlay]') ||
      (document.body && document.body.firstElementChild);
  }

  function parseCssTime(str) {
    str = (str || '').trim();
    if (!str) return 0;
    if (str.slice(-2) === 'ms') return parseFloat(str) || 0;
    return (parseFloat(str) || 0) * 1000;
  }

  function timingEndMs(timing) {
    if (!timing) return 0;
    var delay = timing.delay != null ? timing.delay : 0;
    var duration = timing.duration != null ? timing.duration : 0;
    if (duration > 0 && duration < 20) duration *= 1000;
    if (delay > 0 && delay < 20) delay *= 1000;
    return delay + duration;
  }

  function timingToSeconds(timing) {
    return timingEndMs(timing) / 1000;
  }

  function animationDurationSec(anim) {
    if (!anim || !anim.effect || !anim.effect.getTiming) return 0;
    return timingToSeconds(anim.effect.getTiming());
  }

  function splitCssList(str) {
    return (str || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function looksLikeExitAnimationName(name) {
    return /-out$|-exit$/i.test(name || '');
  }

  function looksLikeEnterAnimationName(name) {
    return /-in$|-enter$/i.test(name || '');
  }

  function elementHasExitAnimation(el) {
    if (!el) return false;
    var names = splitCssList(getComputedStyle(el).animationName);
    for (var i = 0; i < names.length; i++) {
      if (looksLikeExitAnimationName(names[i])) return true;
    }
    return false;
  }

  function elementExitDurationMs(el) {
    if (!el) return 0;
    var cs = getComputedStyle(el);
    var names = splitCssList(cs.animationName);
    var durations = splitCssList(cs.animationDuration);
    for (var i = 0; i < names.length; i++) {
      if (looksLikeExitAnimationName(names[i])) {
        return parseCssTime(durations[i] || durations[0]);
      }
    }
    return 0;
  }

  function applyAnimationTimingIfAvailable(overlay, config) {
    var anim = config && config.animation;
    if (typeof window.applyAnimationTiming === 'function') {
      window.applyAnimationTiming(overlay, anim || {});
    } else if (typeof applyAnimationTiming === 'function') {
      applyAnimationTiming(overlay, anim || {});
    }
  }

  function discoverExitAnimationNames(overlay, config) {
    if (window.__RENDER_EXIT_ANIM_NAMES__ && window.__RENDER_EXIT_ANIM_NAMES__.length) {
      return window.__RENDER_EXIT_ANIM_NAMES__;
    }
    if (!overlay) return [];

    applyAnimationTimingIfAvailable(overlay, config || window.GRAPHIC || {});

    overlay.classList.add('is-ready');
    overlay.classList.remove('is-exiting');
    void overlay.offsetHeight;

    overlay.classList.add('is-exiting');
    void overlay.offsetHeight;

    var names = [];
    var nodes = [overlay].concat(Array.prototype.slice.call(overlay.querySelectorAll('*')));
    for (var i = 0; i < nodes.length; i++) {
      splitCssList(getComputedStyle(nodes[i]).animationName).forEach(function (name) {
        if (looksLikeExitAnimationName(name) && names.indexOf(name) === -1) {
          names.push(name);
        }
      });
    }

    if (!names.length) {
      document.getAnimations({ subtree: true }).forEach(function (a) {
        var name = a.animationName || '';
        if (looksLikeExitAnimationName(name) && names.indexOf(name) === -1) {
          names.push(name);
        }
      });
    }

    overlay.classList.remove('is-exiting');
    if (names.length) {
      window.__RENDER_EXIT_ANIM_NAMES__ = names;
    }
    return names;
  }

  function readHoldSec(config) {
    var anim = config && config.animation;
    if (anim && anim.hold != null) return Number(anim.hold);
    if (config && config.hold != null) return Number(config.hold);
    return null;
  }

  function readTailSec(config) {
    var anim = config && config.animation;
    if (anim && anim.tailPad != null) return Number(anim.tailPad);
    if (anim && anim.tail != null) return Number(anim.tail);
    if (config && config.tailPad != null) return Number(config.tailPad);
    return 0.5;
  }

  function getOverlayRenderDuration(config) {
    config = config || window.GRAPHIC || {};
    if (typeof config.renderDuration === 'number') return config.renderDuration;
    if (typeof window.RENDER_DURATION === 'number') return window.RENDER_DURATION;

    var overlay = findOverlayRoot();
    if (!overlay) return 5;

    var tail = readTailSec(config);
    var hold = readHoldSec(config);
    var exitNames = discoverExitAnimationNames(overlay, config);

    applyAnimationTimingIfAvailable(overlay, config);
    overlay.classList.add('is-ready');
    overlay.classList.remove('is-exiting');
    void overlay.offsetHeight;

    var enterEnd = 0;
    document.getAnimations({ subtree: true }).forEach(function (a) {
      if (exitNames.indexOf(a.animationName) !== -1) return;
      enterEnd = Math.max(enterEnd, animationDurationSec(a));
    });

    overlay.classList.add('is-exiting');
    void overlay.offsetHeight;

    var exitEnd = 0;
    var nodes = [overlay].concat(Array.prototype.slice.call(overlay.querySelectorAll('*')));
    for (var i = 0; i < nodes.length; i++) {
      exitEnd = Math.max(exitEnd, elementExitDurationMs(nodes[i]) / 1000);
    }
    if (!exitEnd) {
      document.getAnimations({ subtree: true }).forEach(function (a) {
        if (exitNames.indexOf(a.animationName) === -1) return;
        var timing = a.effect && a.effect.getTiming ? a.effect.getTiming() : null;
        if (!timing) return;
        exitEnd = Math.max(exitEnd, timingEndMs({ delay: 0, duration: timing.duration }) / 1000);
      });
    }

    overlay.classList.remove('is-exiting', 'is-ready');

    var mainEnd = hold != null ? Math.max(hold, enterEnd) : Math.max(enterEnd, hold || 0);
    return mainEnd + exitEnd + tail;
  }

  function resetAnimationState() {
    var overlay = findOverlayRoot();
    if (overlay) {
      overlay.classList.remove('is-ready', 'is-exiting');
    }
    document.querySelectorAll('[data-render-bake]').forEach(function (el) {
      el.style.removeProperty('opacity');
      el.style.removeProperty('visibility');
      el.style.removeProperty('transform');
      el.style.removeProperty('filter');
      el.style.removeProperty('box-shadow');
      el.style.removeProperty('-webkit-backdrop-filter');
      el.style.removeProperty('backdrop-filter');
      el.style.removeProperty('animation');
      el.removeAttribute('data-render-bake');
    });
  }

  function animationsForElement(el, allAnims) {
    if (el && typeof el.getAnimations === 'function') {
      return el.getAnimations();
    }
    return allAnims.filter(function (a) {
      return a.effect && a.effect.target === el;
    });
  }

  function cancelStaleEnterAnimations(overlay, allAnims) {
    allAnims.forEach(function (a) {
      var target = a.effect && a.effect.target;
      if (!target || !overlay.contains(target) || !elementHasExitAnimation(target)) return;
      var name = a.animationName || '';
      if (looksLikeEnterAnimationName(name)) {
        try { a.cancel(); } catch (e) { /* ignore */ }
      }
    });
  }

  function seekExitAnimation(a, target, timeMs, holdMs) {
    var exitDurMs = elementExitDurationMs(target);
    if (!exitDurMs && a.effect && a.effect.getTiming) {
      exitDurMs = timingEndMs({ delay: 0, duration: a.effect.getTiming().duration });
    }
    if (!exitDurMs) return;
    var elapsed = timeMs - holdMs;
    a.currentTime = Math.min(Math.max(elapsed, 0), exitDurMs);
  }

  function isPrimaryExitAnimation(a, allAnims) {
    var name = a.animationName || '';
    if (looksLikeExitAnimationName(name)) return true;
    var target = a.effect && a.effect.target;
    if (!target || !elementHasExitAnimation(target)) return false;
    if (looksLikeEnterAnimationName(name)) return false;
    var onEl = animationsForElement(target, allAnims);
    if (onEl.length !== 1) return false;
    return onEl[0] === a;
  }

  function bakeAnimatedStyles() {
    var root = findOverlayRoot();
    var nodes = root ? [root].concat(Array.prototype.slice.call(root.querySelectorAll('*'))) : [];
    var snapshot = [];

    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var cs = getComputedStyle(el);
      snapshot.push({
        el: el,
        opacity: cs.opacity,
        visibility: cs.visibility,
        transform: cs.transform,
        filter: cs.filter,
        boxShadow: cs.boxShadow,
        backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
        hadAnim: cs.animationName && cs.animationName !== 'none'
      });
    }

    for (var j = 0; j < snapshot.length; j++) {
      var s = snapshot[j];
      var baked = false;
      s.el.style.opacity = s.opacity;
      baked = true;
      if (parseFloat(s.opacity) === 0 || s.visibility === 'hidden') {
        s.el.style.visibility = 'hidden';
        baked = true;
      }
      if (s.transform && s.transform !== 'none') {
        s.el.style.transform = s.transform;
        baked = true;
      }
      if (s.filter && s.filter !== 'none') {
        s.el.style.filter = s.filter;
        baked = true;
      }
      if (s.boxShadow && s.boxShadow !== 'none') {
        s.el.style.boxShadow = s.boxShadow;
        baked = true;
      }
      if (s.backdropFilter && s.backdropFilter !== 'none') {
        s.el.style.backdropFilter = s.backdropFilter;
        s.el.style.webkitBackdropFilter = s.backdropFilter;
        baked = true;
      }
      if (s.hadAnim) {
        s.el.style.animation = 'none';
        baked = true;
      }
      if (baked) {
        s.el.setAttribute('data-render-bake', '1');
      }
    }
  }

  function seekOverlay(timeSec, config) {
    config = config || window.GRAPHIC || {};
    var overlay = findOverlayRoot();
    if (!overlay) return;

    applyAnimationTimingIfAvailable(overlay, config);

    var hold = readHoldSec(config);
    if (hold == null) hold = 0;
    discoverExitAnimationNames(overlay, config);
    var inExitPhase = timeSec >= hold;

    if (inExitPhase) {
      overlay.classList.add('is-ready');
      overlay.classList.add('is-exiting');
    } else if (timeSec > 0) {
      overlay.classList.add('is-ready');
      overlay.classList.remove('is-exiting');
    } else {
      overlay.classList.remove('is-exiting', 'is-ready');
    }

    void overlay.offsetHeight;

    var timeMs = timeSec * 1000;
    var holdMs = hold * 1000;
    var anims = document.getAnimations({ subtree: true });

    if (inExitPhase) {
      cancelStaleEnterAnimations(overlay, anims);
      void overlay.offsetHeight;
      anims = document.getAnimations({ subtree: true });
    }

    for (var i = 0; i < anims.length; i++) {
      var a = anims[i];
      var target = a.effect && a.effect.target;
      var name = a.animationName || '';

      a.pause();

      if (inExitPhase && isPrimaryExitAnimation(a, anims)) {
        seekExitAnimation(a, target, timeMs, holdMs);
        continue;
      }

      if (inExitPhase && target && elementHasExitAnimation(target)) {
        continue;
      }

      if (timeSec < hold) {
        a.currentTime = timeMs;
      } else {
        var enterTiming = a.effect && a.effect.getTiming ? a.effect.getTiming() : null;
        if (enterTiming) {
          a.currentTime = timingEndMs(enterTiming);
        }
      }
    }
  }

  function prepareFrame(timeSec, config) {
    if (typeof window.seekGraphic === 'function' && window.__RENDER_USE_TEMPLATE_SEEK__) {
      resetAnimationState();
      window.seekGraphic(timeSec, config || window.GRAPHIC || {});
      bakeAnimatedStyles();
      return;
    }
    resetAnimationState();
    seekOverlay(timeSec, config);
    bakeAnimatedStyles();
  }

  window.getOverlayRenderDuration = getOverlayRenderDuration;
  window.getGraphicRenderDuration = getOverlayRenderDuration;
  window.resetAnimationState = resetAnimationState;
  window.bakeAnimatedStyles = bakeAnimatedStyles;
  window.seekOverlay = seekOverlay;
  window.prepareFrame = prepareFrame;
})();
