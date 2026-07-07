'use strict';

(function (global) {
  var DEFAULT_IMAGE_URL = 'https://assetcdn.reactoo.com/reactooBackup/2d59fac5-b78a-4267-83aa-3ec0ae091108';
  var DEFAULT_CONFIG = {
    imageUrl: DEFAULT_IMAGE_URL,
    imageFit: 'cover',
    inType: 'barndoor',
    inDirection: 'v-open',
    inSpeed: 1,
    inEasing: 'ease-in-out',
    inEasingSharpness: 55,
    inEnabled: true,
    outType: 'barndoor',
    outDirection: 'v-close',
    outSpeed: 1,
    outEasing: 'ease-in-out',
    outEasingSharpness: 55,
    outEnabled: true,
    holdTime: 3,
    preDelay: 0,
    framerate: 25,
    resolution: '1920x1080'
  };

  function sanitizeType(value, fallback) {
    var types = ['cut', 'fade', 'wipe', 'slide', 'barndoor'];
    var type = String(value || '').trim().toLowerCase();
    return types.indexOf(type) >= 0 ? type : (fallback || 'barndoor');
  }

  function sanitizeEasing(value, fallback) {
    var vals = ['linear', 'ease-in', 'ease-out', 'ease-in-out'];
    var easing = String(value || '').trim();
    if (easing === 'ease') easing = 'ease-in-out';
    return vals.indexOf(easing) >= 0 ? easing : (fallback || 'ease-in-out');
  }

  function sanitizeSharpness(value, fallback) {
    var n = Number(value);
    var base = Number.isFinite(n) ? n : (fallback != null ? fallback : 55);
    return Math.max(0, Math.min(100, Math.round(base)));
  }

  function defaultDirection(type, phase) {
    var inMap = { barndoor: 'v-open', wipe: 'left', slide: 'left' };
    var outMap = { barndoor: 'v-close', wipe: 'left', slide: 'left' };
    var map = phase === 'out' ? outMap : inMap;
    return map[sanitizeType(type)] || (phase === 'out' ? 'v-close' : 'v-open');
  }

  function sanitizeDirection(type, direction, phase) {
    var key = sanitizeType(type);
    var raw = String(direction || '').trim();
    var barndoor = ['h-open', 'h-close', 'v-open', 'v-close'];
    var wipe = ['left', 'right', 'top', 'bottom'];
    if (key === 'barndoor') {
      return barndoor.indexOf(raw) >= 0 ? raw : defaultDirection(key, phase);
    }
    if (key === 'wipe' || key === 'slide') {
      return wipe.indexOf(raw) >= 0 ? raw : defaultDirection(key, phase);
    }
    return raw || defaultDirection(key, phase);
  }

  function parseResolution(resolution) {
    var match = String(resolution || '1920x1080').match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (!match) return { width: 1920, height: 1080 };
    return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
  }

  function normalizeConfig(config) {
    var data = Object.assign({}, DEFAULT_CONFIG, config || {});
    if (!data.imageUrl) data.imageUrl = DEFAULT_IMAGE_URL;
    data.imageFit = data.imageFit === 'contain' ? 'contain' : 'cover';
    data.inType = sanitizeType(data.inType, DEFAULT_CONFIG.inType);
    data.outType = sanitizeType(data.outType, DEFAULT_CONFIG.outType);
    data.inDirection = sanitizeDirection(data.inType, data.inDirection, 'in');
    data.outDirection = sanitizeDirection(data.outType, data.outDirection, 'out');
    data.inEasing = sanitizeEasing(data.inEasing, DEFAULT_CONFIG.inEasing);
    data.outEasing = sanitizeEasing(data.outEasing, DEFAULT_CONFIG.outEasing);
    data.inEasingSharpness = sanitizeSharpness(data.inEasingSharpness, DEFAULT_CONFIG.inEasingSharpness);
    data.outEasingSharpness = sanitizeSharpness(data.outEasingSharpness, DEFAULT_CONFIG.outEasingSharpness);
    data.inEnabled = data.inEnabled !== false;
    data.outEnabled = data.outEnabled !== false;
    data.holdTime = Math.max(0, Number(data.holdTime) || 0);
    data.preDelay = Math.max(0, Number(data.preDelay) || 0);
    return data;
  }

  function easingBezier(easing, sharpness) {
    var key = sanitizeEasing(easing, 'ease-in-out');
    if (key === 'linear') return [0, 0, 1, 1];
    var t = sanitizeSharpness(sharpness, 55) / 100;
    var soft = {
      'ease-in': [0.15, 0.15, 1, 1],
      'ease-out': [0, 0, 0.85, 0.85],
      'ease-in-out': [0.15, 0.15, 0.85, 0.85]
    };
    var hard = {
      'ease-in': [0.7, 0, 1, 1],
      'ease-out': [0, 0, 0.3, 1],
      'ease-in-out': [0.75, 0, 0.25, 1]
    };
    var s = soft[key] || soft['ease-in-out'];
    var h = hard[key] || hard['ease-in-out'];
    return [
      s[0] + ((h[0] - s[0]) * t),
      s[1] + ((h[1] - s[1]) * t),
      s[2] + ((h[2] - s[2]) * t),
      s[3] + ((h[3] - s[3]) * t)
    ];
  }

  function bezierComponent(p0, p1, p2, p3, t) {
    var u = 1 - t;
    return (u * u * u * p0) + (3 * u * u * t * p1) + (3 * u * t * t * p2) + (t * t * t * p3);
  }

  function easeSample(easing, x, sharpness) {
    var clamped = Math.max(0, Math.min(1, Number(x) || 0));
    if (sanitizeEasing(easing, 'ease-in-out') === 'linear') return clamped;
    var bezier = easingBezier(easing, sharpness);
    var lo = 0;
    var hi = 1;
    var i;
    for (i = 0; i < 20; i++) {
      var mid = (lo + hi) / 2;
      var bx = bezierComponent(0, bezier[0], bezier[2], 1, mid);
      if (bx < clamped) lo = mid;
      else hi = mid;
    }
    var t = (lo + hi) / 2;
    return bezierComponent(0, bezier[1], bezier[3], 1, t);
  }

  function buildTimeline(config) {
    var data = normalizeConfig(config);
    var inType = sanitizeType(data.inType, 'barndoor');
    var outType = sanitizeType(data.outType, 'barndoor');
    var inDur = data.inEnabled ? (inType === 'cut' ? 0 : Math.max(0.1, Number(data.inSpeed) || 1)) : 0;
    var hold = Math.max(0, Number(data.holdTime) || 0);
    var outDur = data.outEnabled && outType !== 'cut' ? Math.max(0.1, Number(data.outSpeed) || 1) : 0;
    if (!data.outEnabled) outDur = 0;
    if (outType === 'cut' && data.outEnabled) outDur = 0;
    var total = data.preDelay + inDur + hold + outDur;
    return {
      data: data,
      preDelay: data.preDelay,
      inDur: inDur,
      hold: hold,
      outDur: outDur,
      total: total > 0 ? total : 0.001
    };
  }

  function layoutBarndoorPanels(axis, panelA, panelB, imgA, imgB) {
    if (axis === 'h') {
      panelA.style.left = '0'; panelA.style.top = '0'; panelA.style.width = '50%'; panelA.style.height = '100%';
      panelA.style.right = 'auto'; panelA.style.bottom = 'auto';
      panelB.style.left = 'auto'; panelB.style.right = '0'; panelB.style.top = '0'; panelB.style.width = '50%';
      panelB.style.height = '100%'; panelB.style.bottom = 'auto';
      imgA.style.left = '0'; imgA.style.top = '0'; imgA.style.width = '200%'; imgA.style.height = '100%';
      imgB.style.left = '-100%'; imgB.style.top = '0'; imgB.style.width = '200%'; imgB.style.height = '100%';
      return { offA: 'translateX(-100%)', offB: 'translateX(100%)' };
    }
    panelA.style.left = '0'; panelA.style.top = '0'; panelA.style.width = '100%'; panelA.style.height = '50%';
    panelA.style.right = 'auto'; panelA.style.bottom = 'auto';
    panelB.style.left = '0'; panelB.style.top = 'auto'; panelB.style.bottom = '0'; panelB.style.width = '100%';
    panelB.style.height = '50%'; panelB.style.right = 'auto';
    imgA.style.left = '0'; imgA.style.top = '0'; imgA.style.width = '100%'; imgA.style.height = '200%';
    imgB.style.left = '0'; imgB.style.top = '-100%'; imgB.style.width = '100%'; imgB.style.height = '200%';
    return { offA: 'translateY(-100%)', offB: 'translateY(100%)' };
  }

  function barndoorEndpoints(direction, animPhase, panelA, panelB) {
    direction = direction || 'v-open';
    animPhase = animPhase || 'in';
    var axis = direction.indexOf('h') === 0 ? 'h' : 'v';
    var closing = direction.indexOf('-close') > 0;
    var splitMode = (animPhase === 'out' && !closing) || (animPhase === 'in' && closing);
    if (!splitMode) {
      var strip = axis === 'h' ? 'inset(0 50% 0 50%)' : 'inset(50% 0 50% 0)';
      var fromClip = animPhase === 'in' ? strip : 'inset(0)';
      var toClip = animPhase === 'in' ? 'inset(0)' : strip;
      return {
        imageFrom: { opacity: '1', transform: 'none', clipPath: fromClip },
        imageTo: { opacity: '1', transform: 'none', clipPath: toClip },
        panelFrom: null,
        panelTo: null
      };
    }
    var imgA = panelA.querySelector('.stinger-panel-img');
    var imgB = panelB.querySelector('.stinger-panel-img');
    var t = layoutBarndoorPanels(axis, panelA, panelB, imgA, imgB);
    var on = 'translate(0,0)';
    return {
      imageFrom: { opacity: '0', transform: 'none', clipPath: 'none' },
      imageTo: { opacity: '0', transform: 'none', clipPath: 'none' },
      panelFrom: { a: animPhase === 'in' ? t.offA : on, b: animPhase === 'in' ? t.offB : on },
      panelTo: { a: animPhase === 'in' ? on : t.offA, b: animPhase === 'in' ? on : t.offB }
    };
  }

  function wipeClip(direction, animPhase, which) {
    var map = {
      left: { in: { from: 'inset(0 100% 0 0)', to: 'inset(0)' }, out: { from: 'inset(0)', to: 'inset(0 100% 0 0)' } },
      right: { in: { from: 'inset(0 0 0 100%)', to: 'inset(0)' }, out: { from: 'inset(0)', to: 'inset(0 0 0 100%)' } },
      top: { in: { from: 'inset(100% 0 0 0)', to: 'inset(0)' }, out: { from: 'inset(0)', to: 'inset(100% 0 0 0)' } },
      bottom: { in: { from: 'inset(0 0 100% 0)', to: 'inset(0)' }, out: { from: 'inset(0)', to: 'inset(0 0 100% 0)' } }
    };
    var entry = map[direction] || map.left;
    var pair = entry[animPhase === 'out' ? 'out' : 'in'];
    return which === 'from' ? pair.from : pair.to;
  }

  function slideTransform(direction, animPhase, which) {
    var map = {
      left: { in: { from: 'translateX(-100%)', to: 'translateX(0)' }, out: { from: 'translateX(0)', to: 'translateX(-100%)' } },
      right: { in: { from: 'translateX(100%)', to: 'translateX(0)' }, out: { from: 'translateX(0)', to: 'translateX(100%)' } },
      top: { in: { from: 'translateY(-100%)', to: 'translateY(0)' }, out: { from: 'translateY(0)', to: 'translateY(-100%)' } },
      bottom: { in: { from: 'translateY(100%)', to: 'translateY(0)' }, out: { from: 'translateY(0)', to: 'translateY(100%)' } }
    };
    var entry = map[direction] || map.left;
    var pair = entry[animPhase === 'out' ? 'out' : 'in'];
    return which === 'from' ? pair.from : pair.to;
  }

  function fadeOpacity(animPhase, which) {
    var reveal = animPhase !== 'out';
    if (reveal) return which === 'from' ? '0' : '1';
    return which === 'from' ? '1' : '0';
  }

  function endpointsFor(type, direction, animPhase, panelA, panelB) {
    type = sanitizeType(type, 'barndoor');
    direction = direction || 'v-open';
    animPhase = animPhase || 'in';
    if (type === 'barndoor') {
      return barndoorEndpoints(direction, animPhase, panelA, panelB);
    }
    if (type === 'wipe') {
      return {
        imageFrom: { opacity: '1', transform: 'none', clipPath: wipeClip(direction, animPhase, 'from') },
        imageTo: { opacity: '1', transform: 'none', clipPath: wipeClip(direction, animPhase, 'to') },
        panelFrom: null,
        panelTo: null
      };
    }
    if (type === 'slide') {
      return {
        imageFrom: { opacity: '1', transform: slideTransform(direction, animPhase, 'from'), clipPath: 'none' },
        imageTo: { opacity: '1', transform: slideTransform(direction, animPhase, 'to'), clipPath: 'none' },
        panelFrom: null,
        panelTo: null
      };
    }
    return {
      imageFrom: { opacity: fadeOpacity(animPhase, 'from'), transform: 'none', clipPath: 'none' },
      imageTo: { opacity: fadeOpacity(animPhase, 'to'), transform: 'none', clipPath: 'none' },
      panelFrom: null,
      panelTo: null
    };
  }

  function parseInset(clip) {
    var m = String(clip || 'inset(0)').match(/inset\(([^)]+)\)/i);
    if (!m) return [0, 0, 0, 0];
    return m[1].split(/\s+/).map(function (part) {
      part = part.trim();
      if (part.slice(-1) === '%') return parseFloat(part) || 0;
      return 0;
    }).concat([0, 0, 0, 0]).slice(0, 4);
  }

  function formatInset(values) {
    return 'inset(' + values.map(function (v) { return v.toFixed(3) + '%'; }).join(' ') + ')';
  }

  function parseTranslate(transform) {
    var str = String(transform || 'none');
    if (str === 'none') return { x: 0, y: 0 };
    var m = str.match(/translate\(([-\d.]+)%,\s*([-\d.]+)%\)/);
    if (m) return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
    m = str.match(/translateX\(([-\d.]+)%\)/);
    if (m) return { x: parseFloat(m[1]), y: 0 };
    m = str.match(/translateY\(([-\d.]+)%\)/);
    if (m) return { x: 0, y: parseFloat(m[1]) };
    return { x: 0, y: 0 };
  }

  function formatTranslate(x, y) {
    if (Math.abs(y) < 0.001) return 'translateX(' + x.toFixed(3) + '%)';
    if (Math.abs(x) < 0.001) return 'translateY(' + y.toFixed(3) + '%)';
    return 'translate(' + x.toFixed(3) + '%, ' + y.toFixed(3) + '%)';
  }

  function lerp(a, b, t) {
    return a + ((b - a) * t);
  }

  function lerpImageState(from, to, progress) {
    var p = Math.max(0, Math.min(1, progress));
    var fromInset = parseInset(from.clipPath);
    var toInset = parseInset(to.clipPath);
    var inset = fromInset.map(function (v, i) { return lerp(v, toInset[i] || 0, p); });
    var fromT = parseTranslate(from.transform);
    var toT = parseTranslate(to.transform);
    return {
      opacity: String(lerp(parseFloat(from.opacity) || 0, parseFloat(to.opacity) || 0, p)),
      transform: formatTranslate(lerp(fromT.x, toT.x, p), lerp(fromT.y, toT.y, p)),
      clipPath: formatInset(inset)
    };
  }

  function lerpPanelState(from, to, progress) {
    if (!from || !to) return null;
    var p = Math.max(0, Math.min(1, progress));
    var fromA = parseTranslate(from.a);
    var fromB = parseTranslate(from.b);
    var toA = parseTranslate(to.a);
    var toB = parseTranslate(to.b);
    return {
      a: formatTranslate(lerp(fromA.x, toA.x, p), lerp(fromA.y, toA.y, p)),
      b: formatTranslate(lerp(fromB.x, toB.x, p), lerp(fromB.y, toB.y, p))
    };
  }

  function applyImageState(image, state) {
    image.style.transition = 'none';
    image.style.opacity = state.opacity != null ? state.opacity : '1';
    image.style.transform = state.transform || 'none';
    image.style.clipPath = state.clipPath || 'none';
  }

  function applyPanelState(panelA, panelB, state) {
    if (!state) {
      panelA.style.display = 'none';
      panelB.style.display = 'none';
      return;
    }
    panelA.style.display = 'block';
    panelB.style.display = 'block';
    panelA.style.transition = 'none';
    panelB.style.transition = 'none';
    panelA.style.transform = state.a;
    panelB.style.transform = state.b;
  }

  function getStingerConfig(config) {
    if (!config) return normalizeConfig(null);
    if (config.stinger) return normalizeConfig(config.stinger);
    return normalizeConfig(config);
  }

  function seekGraphic(timeSec, config, dom) {
    dom = dom || {};
    var image = dom.image || document.querySelector('.stinger-image');
    var panelA = dom.panelA || document.querySelector('.stinger-panel-a');
    var panelB = dom.panelB || document.querySelector('.stinger-panel-b');
    if (!image || !panelA || !panelB) return;

    var data = getStingerConfig(config);
    var model = buildTimeline(data);
    var t = Math.max(0, Number(timeSec) || 0);
    var preEnd = model.preDelay;
    var inEnd = preEnd + model.inDur;
    var holdEnd = inEnd + model.hold;
    var outEnd = holdEnd + model.outDur;

    var phase;
    var progress;
    if (t < preEnd) {
      phase = 'pre';
      progress = 0;
    } else if (t < inEnd) {
      phase = 'in';
      if (!data.inEnabled || model.inDur <= 0) progress = 1;
      else progress = easeSample(data.inEasing, (t - preEnd) / model.inDur, data.inEasingSharpness);
    } else if (t < holdEnd) {
      phase = 'hold';
      progress = 1;
    } else if (t < outEnd) {
      phase = 'out';
      if (!data.outEnabled || model.outDur <= 0) progress = 1;
      else progress = easeSample(data.outEasing, (t - holdEnd) / model.outDur, data.outEasingSharpness);
    } else {
      phase = 'done';
      progress = 1;
    }

    if (phase === 'pre') {
      var preEp = endpointsFor(data.inType, data.inDirection, 'in', panelA, panelB);
      applyImageState(image, preEp.imageFrom);
      applyPanelState(panelA, panelB, preEp.panelFrom);
      return;
    }

    if (phase === 'in') {
      var inEp = endpointsFor(data.inType, data.inDirection, 'in', panelA, panelB);
      applyImageState(image, lerpImageState(inEp.imageFrom, inEp.imageTo, progress));
      var inPanels = lerpPanelState(inEp.panelFrom, inEp.panelTo, progress);
      applyPanelState(panelA, panelB, inPanels);
      return;
    }

    if (phase === 'hold') {
      var holdEp = endpointsFor(data.inType, data.inDirection, 'in', panelA, panelB);
      applyImageState(image, holdEp.imageTo);
      applyPanelState(panelA, panelB, holdEp.panelTo);
      return;
    }

    if (phase === 'out' || phase === 'done') {
      if (!data.outEnabled || model.outDur <= 0) {
        var skipOutEp = endpointsFor(data.inType, data.inDirection, 'in', panelA, panelB);
        applyImageState(image, skipOutEp.imageTo);
        applyPanelState(panelA, panelB, skipOutEp.panelTo);
        return;
      }
      var outEp = endpointsFor(data.outType, data.outDirection, 'out', panelA, panelB);
      if (phase === 'done') {
        applyImageState(image, outEp.imageTo);
        applyPanelState(panelA, panelB, outEp.panelTo);
        return;
      }
      applyImageState(image, lerpImageState(outEp.imageFrom, outEp.imageTo, progress));
      var outPanels = lerpPanelState(outEp.panelFrom, outEp.panelTo, progress);
      applyPanelState(panelA, panelB, outPanels);
    }
  }

  function getRenderDuration(config) {
    return buildTimeline(getStingerConfig(config)).total;
  }

  global.StingerSeek = {
    normalizeConfig: normalizeConfig,
    buildTimeline: buildTimeline,
    seekGraphic: seekGraphic,
    getRenderDuration: getRenderDuration,
    parseResolution: parseResolution,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    DEFAULT_IMAGE_URL: DEFAULT_IMAGE_URL
  };
})(typeof window !== 'undefined' ? window : global);
