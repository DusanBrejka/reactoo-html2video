'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer-core');

const ROOT = __dirname;
const SOURCE_DIR = path.join(ROOT, 'source');
const FRAMES_DIR = path.join(ROOT, 'frames');
const OUTPUT_DIR = path.join(ROOT, 'output');

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const DEFAULT_FPS = 25;
const DEFAULT_FORMAT = 'webm';

const OUTPUT_FORMATS = {
  webm: {
    ext: 'webm',
    contentType: 'video/webm',
    defaultOutput: 'overlay-transparent.webm'
  },
  prores: {
    ext: 'mov',
    contentType: 'video/quicktime',
    defaultOutput: 'overlay-transparent.mov'
  },
  apng: {
    ext: 'apng',
    contentType: 'image/apng',
    defaultOutput: 'overlay-transparent.apng'
  },
  mp4: {
    ext: 'mp4',
    contentType: 'video/mp4',
    defaultOutput: 'overlay-transparent.mp4'
  }
};

const DEFAULT_OUTPUT = OUTPUT_FORMATS.webm.defaultOutput;
const MIN_DIMENSION = 320;
const MAX_DIMENSION = 4096;

function resolveDimensions(opts) {
  opts = opts || {};
  const video = opts.video || {};
  const width = Number(opts.width != null ? opts.width : video.width != null ? video.width : DEFAULT_WIDTH);
  const height = Number(opts.height != null ? opts.height : video.height != null ? video.height : DEFAULT_HEIGHT);
  const templateWidth = Number(
    opts.templateWidth != null ? opts.templateWidth :
      video.templateWidth != null ? video.templateWidth : DEFAULT_WIDTH
  );
  const templateHeight = Number(
    opts.templateHeight != null ? opts.templateHeight :
      video.templateHeight != null ? video.templateHeight : DEFAULT_HEIGHT
  );

  [width, height, templateWidth, templateHeight].forEach((n, i) => {
    const label = ['width', 'height', 'templateWidth', 'templateHeight'][i];
    if (!Number.isFinite(n) || n < MIN_DIMENSION || n > MAX_DIMENSION) {
      throw new Error(label + ' must be between ' + MIN_DIMENSION + ' and ' + MAX_DIMENSION);
    }
  });

  return {
    width: Math.round(width),
    height: Math.round(height),
    templateWidth: Math.round(templateWidth),
    templateHeight: Math.round(templateHeight)
  };
}

function normalizeFormat(value) {
  if (value == null || value === '') {
    return DEFAULT_FORMAT;
  }
  const key = String(value).toLowerCase().replace(/^\./, '');
  if (!OUTPUT_FORMATS[key]) {
    throw new Error(
      'Unsupported format: ' + value + '. Use one of: ' + Object.keys(OUTPUT_FORMATS).join(', ')
    );
  }
  return key;
}

function inferFormatFromFilename(fileName) {
  if (!fileName) return null;
  const ext = path.extname(fileName).toLowerCase().replace(/^\./, '');
  if (ext === 'mov') return 'prores';
  if (ext === 'png' && fileName.toLowerCase().indexOf('.apng') !== -1) return 'apng';
  if (OUTPUT_FORMATS[ext]) return ext;
  return null;
}

function resolveFormat(opts) {
  opts = opts || {};
  const video = opts.video || {};
  const explicit = opts.format != null ? opts.format :
    opts.outputFormat != null ? opts.outputFormat :
      video.format != null ? video.format : null;
  if (explicit != null) {
    return normalizeFormat(explicit);
  }
  const fromOutput = inferFormatFromFilename(opts.output) ||
    inferFormatFromFilename(opts.outputPath) ||
    inferFormatFromFilename(opts.outputFileName);
  return fromOutput || DEFAULT_FORMAT;
}

function defaultOutputForFormat(format) {
  return OUTPUT_FORMATS[normalizeFormat(format)].defaultOutput;
}

function contentTypeForFormat(format) {
  return OUTPUT_FORMATS[normalizeFormat(format)].contentType;
}

function parseArgs(argv) {
  const opts = {
    fps: DEFAULT_FPS,
    format: null,
    output: null,
    html: null,
    graphic: null,
    graphicFile: null,
    width: null,
    height: null,
    templateWidth: null,
    templateHeight: null,
    keepFrames: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--fps' && argv[i + 1]) {
      opts.fps = Number(argv[++i]);
    } else if ((arg === '--format' || arg === '--output-format') && argv[i + 1]) {
      opts.format = argv[++i];
    } else if (arg === '--output' && argv[i + 1]) {
      opts.output = argv[++i];
    } else if (arg === '--html' && argv[i + 1]) {
      opts.html = argv[++i];
    } else if (arg === '--graphic' && argv[i + 1]) {
      opts.graphicFile = argv[++i];
    } else if (arg === '--width' && argv[i + 1]) {
      opts.width = Number(argv[++i]);
    } else if (arg === '--height' && argv[i + 1]) {
      opts.height = Number(argv[++i]);
    } else if (arg === '--template-width' && argv[i + 1]) {
      opts.templateWidth = Number(argv[++i]);
    } else if (arg === '--template-height' && argv[i + 1]) {
      opts.templateHeight = Number(argv[++i]);
    } else if (arg === '--keep-frames') {
      opts.keepFrames = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error('Unknown argument: ' + arg);
      printHelp();
      process.exit(1);
    }
  }

  if (!Number.isFinite(opts.fps) || opts.fps < 1 || opts.fps > 120) {
    throw new Error('--fps must be between 1 and 120');
  }

  return opts;
}

function printHelp() {
  console.log([
    'Usage: node render-transparent-webm.js [options]',
    '',
    'Options:',
    '  --format <fmt>  Output format: webm, prores, apng, mp4 (default: webm)',
    '  --fps <n>       Frame rate (default: 25)',
    '  --output <file> Output filename in output/ (default depends on --format)',
    '  --html <file>   Source HTML template (required unless htmlPath passed programmatically)',
    '  --graphic <file> JSON file with partial GRAPHIC override (merged into template defaults)',
    '  --width <n>     Output video width (default: ' + DEFAULT_WIDTH + ')',
    '  --height <n>    Output video height (default: ' + DEFAULT_HEIGHT + ')',
    '  --template-width <n>  Template design width to scale from (default: ' + DEFAULT_WIDTH + ')',
    '  --template-height <n> Template design height to scale from (default: ' + DEFAULT_HEIGHT + ')',
    '  --keep-frames   Keep PNG frames after encoding',
    '  -h, --help      Show this help'
  ].join('\n'));
}

function loadOverlayRuntime() {
  return fs.readFileSync(path.join(__dirname, 'overlay-render-runtime.js'), 'utf8');
}

function injectOverlayRuntime(html) {
  if (html.includes('window.getOverlayRenderDuration')) {
    return html;
  }
  const tag = '<script>\n' + loadOverlayRuntime() + '\n</script>\n';
  if (html.includes('</body>')) {
    return html.replace('</body>', tag + '</body>');
  }
  return html + tag;
}

function injectGraphicOverrideSupport(html) {
  if (html.includes('function mergeGraphicConfig')) {
    return html;
  }

  const helpers = [
    '  function deepMergeGraphic(base, patch) {',
    '    if (!patch || typeof patch !== \'object\') return base;',
    '    var out = Object.assign({}, base);',
    '    Object.keys(patch).forEach(function (key) {',
    '      var val = patch[key];',
    '      if (val && typeof val === \'object\' && !Array.isArray(val) &&',
    '          typeof out[key] === \'object\' && out[key] && !Array.isArray(out[key])) {',
    '        out[key] = deepMergeGraphic(out[key], val);',
    '      } else {',
    '        out[key] = val;',
    '      }',
    '    });',
    '    return out;',
    '  }',
    '  function mergeGraphicConfig(config) {',
    '    if (!window.__GRAPHIC_OVERRIDE__) return config;',
    '    return deepMergeGraphic(config, window.__GRAPHIC_OVERRIDE__);',
    '  }',
    '  function applyGraphicOverride(override) {',
    '    window.__GRAPHIC_OVERRIDE__ = override || {};',
    '    var base = typeof GRAPHIC !== \'undefined\' ? GRAPHIC : (window.GRAPHIC || {});',
    '    var merged = mergeGraphicConfig(base);',
    '    window.GRAPHIC = merged;',
    '    applyGraphic(merged);',
    '    applyAnimationTiming(document.querySelector(\'.overlay\'), merged.animation || {});',
    '  }',
    '  window.applyGraphicOverride = applyGraphicOverride;',
    ''
  ].join('\n');

  if (html.includes("'use strict';")) {
    html = html.replace("'use strict';", "'use strict';\n" + helpers);
  } else {
    html = html.replace('<script>', '<script>\n' + helpers);
  }

  const initPatterns = [
    [
      'window.GRAPHIC = GRAPHIC;\n  initGraphic(GRAPHIC);',
      'var __renderGraphic = mergeGraphicConfig(GRAPHIC);\n  window.GRAPHIC = __renderGraphic;\n  initGraphic(__renderGraphic);'
    ],
    [
      '  window.GRAPHIC = GRAPHIC;\n  initGraphic(GRAPHIC);',
      '  var __renderGraphic = mergeGraphicConfig(GRAPHIC);\n  window.GRAPHIC = __renderGraphic;\n  initGraphic(__renderGraphic);'
    ],
    [
      '  initGraphic(GRAPHIC);',
      '  var __renderGraphic = mergeGraphicConfig(GRAPHIC);\n  window.GRAPHIC = __renderGraphic;\n  initGraphic(__renderGraphic);'
    ]
  ];

  for (let i = 0; i < initPatterns.length; i++) {
    const pair = initPatterns[i];
    if (html.includes(pair[0])) {
      html = html.replace(pair[0], pair[1]);
      break;
    }
  }

  return html;
}

function patchHtmlForRender(html) {
  const graphicHook = 'window.GRAPHIC = GRAPHIC;';
  if (!html.includes(graphicHook)) {
    html = html.replace(
      '  initGraphic(GRAPHIC);',
      '  ' + graphicHook + '\n  initGraphic(GRAPHIC);'
    );
  }

  if (!html.includes('__RENDER_WAIT_FOR_GO__')) {
    html = html.replace(
      `  function startAnimation(config) {
    const overlay = document.querySelector('.overlay');
    applyAnimationTiming(overlay, config.animation);
    if (overlay) overlay.classList.add('is-ready');
    scheduleExit(config);
  }`,
      `  function startAnimation(config) {
    if (window.__RENDER_WAIT_FOR_GO__) {
      window.__RENDER_ARMED__ = true;
      return;
    }
    const overlay = document.querySelector('.overlay');
    applyAnimationTiming(overlay, config.animation);
    if (overlay) overlay.classList.add('is-ready');
    scheduleExit(config);
  }`
    );
  }

  html = injectGraphicOverrideSupport(html);
  html = injectOverlayRuntime(html);
  return html;
}

function prepareHtmlForRender(sourcePath, workDir) {
  const html = patchHtmlForRender(fs.readFileSync(sourcePath, 'utf8'));
  fs.mkdirSync(workDir, { recursive: true });
  const dest = path.join(workDir, 'template.render.html');
  fs.writeFileSync(dest, html, 'utf8');
  return dest;
}

function loadGraphicFromFile(filePath) {
  if (!filePath) return undefined;
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function resolveHtmlPath(htmlArg) {
  if (!htmlArg) {
    throw new Error('--html is required (path to overlay template HTML)');
  }
  const resolved = path.isAbsolute(htmlArg) ? htmlArg : path.join(ROOT, htmlArg);
  if (!fs.existsSync(resolved)) {
    throw new Error('HTML not found: ' + resolved);
  }
  return resolved;
}

function rimraf(dir) {
  if (!fs.existsSync(dir)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    const entries = fs.readdirSync(dir);
    entries.forEach((name) => {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    });
    fs.rmdirSync(dir);
  }
}

function findFfmpegExecutable() {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  const bundled = path.join(ROOT, 'bin', 'ffmpeg');
  if (fs.existsSync(bundled)) {
    return bundled;
  }
  const artifactsBundled = path.join(ROOT, 'artifacts', 'bin', 'ffmpeg');
  if (fs.existsSync(artifactsBundled)) {
    return artifactsBundled;
  }
  return 'ffmpeg';
}

async function getPuppeteerLaunchOptions() {
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = require('@sparticuz/chromium-min');
    chromium.setGraphicsMode = false;
    const chromiumBin = process.env.CHROMIUM_PATH || '/opt/nodejs/node_modules/@sparticuz/chromium/bin';
    return {
      args: chromium.args.concat([
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--font-render-hinting=none'
      ]),
      executablePath: await chromium.executablePath(chromiumBin),
      headless: chromium.headless
    };
  }

  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return {
      executablePath: process.env.CHROME_PATH,
      headless: 'new',
      args: [
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--font-render-hinting=none'
      ]
    };
  }

  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);

  for (let i = 0; i < candidates.length; i++) {
    if (fs.existsSync(candidates[i])) {
      return {
        executablePath: candidates[i],
        headless: 'new',
        args: [
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--font-render-hinting=none'
        ]
      };
    }
  }

  throw new Error(
    'Chrome or Edge not found. Install Google Chrome or set CHROME_PATH to chrome.exe.'
  );
}

function ensureFfmpeg() {
  const ffmpeg = findFfmpegExecutable();
  try {
    childProcess.execFileSync(ffmpeg, ['-version'], { stdio: 'ignore' });
  } catch (err) {
    throw new Error('ffmpeg not found on PATH. Install ffmpeg and try again.');
  }
}

function encodeFrames(format, fps, framesDir, outputPath, totalFrames) {
  const ffmpeg = findFfmpegExecutable();
  const inputPattern = path.join(framesDir, 'frame_%05d.png');
  const baseArgs = [
    '-y',
    '-framerate', String(fps),
    '-i', inputPattern,
    '-frames:v', String(totalFrames)
  ];
  let args;

  switch (normalizeFormat(format)) {
    case 'prores':
      args = baseArgs.concat([
        '-c:v', 'prores_ks',
        '-profile:v', '4444',
        '-pix_fmt', 'yuva444p10le',
        outputPath
      ]);
      break;
    case 'apng':
      args = baseArgs.concat([
        '-plays', '1',
        '-c:v', 'apng',
        '-f', 'apng',
        outputPath
      ]);
      break;
    case 'mp4':
      args = baseArgs.concat([
        '-c:v', 'libx264',
        '-pix_fmt', 'yuva420p',
        '-preset', 'medium',
        '-crf', '18',
        '-movflags', '+faststart',
        outputPath
      ]);
      break;
    case 'webm':
    default:
      args = baseArgs.concat([
        '-c:v', 'libvpx-vp9',
        '-pix_fmt', 'yuva420p',
        '-b:v', '4M',
        '-auto-alt-ref', '0',
        '-g', '1',
        '-keyint_min', '1',
        outputPath
      ]);
      break;
  }

  console.log('Encoding ' + normalizeFormat(format) + ': ' + ffmpeg + ' ' + args.join(' '));
  try {
    childProcess.execFileSync(ffmpeg, args, {
      stdio: process.env.AWS_LAMBDA_FUNCTION_NAME ? 'pipe' : 'inherit'
    });
  } catch (err) {
    if (normalizeFormat(format) === 'mp4') {
      console.warn('MP4 alpha encode failed; retrying H.264 yuv420p composited on black.');
      const fallbackArgs = baseArgs.concat([
        '-vf', 'format=rgba,geq=r=\'r(X,Y)*alpha(X,Y)/255\':g=\'g(X,Y)*alpha(X,Y)/255\':b=\'b(X,Y)*alpha(X,Y)/255\',format=yuv420p',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'medium',
        '-crf', '18',
        '-movflags', '+faststart',
        outputPath
      ]);
      childProcess.execFileSync(ffmpeg, fallbackArgs, {
        stdio: process.env.AWS_LAMBDA_FUNCTION_NAME ? 'pipe' : 'inherit'
      });
    } else {
      throw err;
    }
  }
}

async function seekAndCapture(page, timeSec, framePath, dims) {
  await page.evaluate(async (t) => {
    window.prepareFrame(t, window.GRAPHIC);
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }, timeSec);

  await page.screenshot({
    path: framePath,
    omitBackground: true,
    clip: { x: 0, y: 0, width: dims.width, height: dims.height }
  });
}

async function applyOutputDimensions(page, dims) {
  const scale = dims.width / dims.templateWidth;
  await page.evaluate((w, h, tw, th, scaleFactor) => {
    document.documentElement.style.margin = '0';
    document.documentElement.style.padding = '0';
    document.documentElement.style.width = w + 'px';
    document.documentElement.style.height = h + 'px';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.width = w + 'px';
    document.body.style.height = h + 'px';
    document.body.style.overflow = 'hidden';
    document.body.style.background = 'transparent';
    var overlay = document.querySelector('.overlay,[data-render-overlay]') ||
      (document.body && document.body.firstElementChild);
    if (overlay) {
      overlay.style.width = tw + 'px';
      overlay.style.height = th + 'px';
      overlay.style.transform = 'scale(' + scaleFactor + ')';
      overlay.style.transformOrigin = 'top left';
    }
  }, dims.width, dims.height, dims.templateWidth, dims.templateHeight, scale);
}

async function captureFrames(opts, sourceHtmlPath, framesDir, dims) {
  const launchOptions = await getPuppeteerLaunchOptions();
  console.log('Using browser: ' + launchOptions.executablePath);

  const browser = await puppeteer.launch(launchOptions);

  try {
    const page = await browser.newPage();
    const workDir = path.dirname(framesDir);
    const htmlPath = prepareHtmlForRender(sourceHtmlPath, workDir);

    if (opts.graphic) {
      await page.evaluateOnNewDocument((graphicOverride) => {
        window.__GRAPHIC_OVERRIDE__ = graphicOverride;
      }, opts.graphic);
    }

    await page.evaluateOnNewDocument(() => {
      window.__RENDER_WAIT_FOR_GO__ = true;
    });

    await page.setViewport({
      width: dims.width,
      height: dims.height,
      deviceScaleFactor: 1
    });

    const url = pathToFileURL(htmlPath).href;
    console.log('Loading ' + url);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => window.__RENDER_ARMED__ === true, { timeout: 60000 });
    await applyOutputDimensions(page, dims);

    const durationSec = await page.evaluate(() => {
      if (typeof window.getOverlayRenderDuration === 'function') {
        return window.getOverlayRenderDuration(window.GRAPHIC);
      }
      if (typeof window.getGraphicRenderDuration === 'function') {
        return window.getGraphicRenderDuration(window.GRAPHIC && window.GRAPHIC.animation);
      }
      return 10;
    });

    const totalFrames = Math.max(1, Math.ceil(durationSec * opts.fps));
    console.log(
      'Capturing ' + totalFrames + ' frames at ' + opts.fps + ' fps (~' + durationSec.toFixed(2) + 's), ' +
      dims.width + 'x' + dims.height + ' (template ' + dims.templateWidth + 'x' + dims.templateHeight + ')'
    );

    rimraf(framesDir);
    fs.mkdirSync(framesDir, { recursive: true });

    for (let frame = 0; frame < totalFrames; frame++) {
      const timeSec = frame / opts.fps;
      const framePath = path.join(framesDir, 'frame_' + String(frame).padStart(5, '0') + '.png');
      await seekAndCapture(page, timeSec, framePath, dims);

      if ((frame + 1) % opts.fps === 0 || frame === totalFrames - 1) {
        console.log('  frame ' + (frame + 1) + '/' + totalFrames);
      }
    }

    return totalFrames;
  } finally {
    await browser.close();
  }
}

async function renderOverlay(opts) {
  opts = opts || {};
  const fps = opts.fps != null ? opts.fps : DEFAULT_FPS;
  const format = resolveFormat(opts);
  const dims = resolveDimensions(opts);
  const htmlPath = opts.htmlPath || resolveHtmlPath(opts.html);
  const workDir = opts.workDir || (process.env.AWS_LAMBDA_FUNCTION_NAME ? '/tmp/overlay-render' : ROOT);
  const framesDir = opts.framesDir || path.join(workDir, 'frames');
  const outputDir = opts.outputDir || (process.env.AWS_LAMBDA_FUNCTION_NAME ? workDir : OUTPUT_DIR);
  const outputFileName = opts.output || opts.outputFileName || defaultOutputForFormat(format);
  const outputPath = opts.outputPath || path.join(outputDir, outputFileName);

  ensureFfmpeg();
  fs.mkdirSync(outputDir, { recursive: true });

  const totalFrames = await captureFrames({ fps: fps, graphic: opts.graphic }, htmlPath, framesDir, dims);
  encodeFrames(format, fps, framesDir, outputPath, totalFrames);

  if (!opts.keepFrames) {
    rimraf(framesDir);
    const patched = path.join(workDir, 'template.render.html');
    if (fs.existsSync(patched)) {
      fs.unlinkSync(patched);
    }
  }

  const stats = fs.statSync(outputPath);
  return {
    outputPath: outputPath,
    bytes: stats.size,
    width: dims.width,
    height: dims.height,
    format: format,
    contentType: contentTypeForFormat(format)
  };
}

async function renderTransparentWebm(opts) {
  return renderOverlay(Object.assign({}, opts, { format: opts && opts.format ? opts.format : 'webm' }));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.html) {
    printHelp();
    process.exit(1);
  }

  const graphic = opts.graphicFile ? loadGraphicFromFile(opts.graphicFile) : undefined;
  const htmlPath = resolveHtmlPath(opts.html);
  const format = resolveFormat(opts);
  const outputFileName = opts.output || defaultOutputForFormat(format);
  console.log('Using HTML: ' + path.relative(ROOT, htmlPath));
  if (graphic) {
    console.log('GRAPHIC override: ' + opts.graphicFile);
  }
  console.log('Output format: ' + format);

  const outputPath = path.join(OUTPUT_DIR, outputFileName);
  const result = await renderOverlay({
    htmlPath: htmlPath,
    graphic: graphic,
    fps: opts.fps,
    format: format,
    width: opts.width,
    height: opts.height,
    templateWidth: opts.templateWidth,
    templateHeight: opts.templateHeight,
    output: outputFileName,
    outputPath: outputPath,
    keepFrames: opts.keepFrames
  });

  console.log('Done: ' + path.relative(ROOT, result.outputPath) + ' (' + (result.bytes / 1024 / 1024).toFixed(2) + ' MB)');
}

module.exports = {
  renderOverlay: renderOverlay,
  renderTransparentWebm: renderTransparentWebm,
  resolveFormat: resolveFormat,
  contentTypeForFormat: contentTypeForFormat,
  defaultOutputForFormat: defaultOutputForFormat,
  OUTPUT_FORMATS: OUTPUT_FORMATS,
  patchHtmlForRender: patchHtmlForRender,
  prepareHtmlForRender: prepareHtmlForRender,
  resolveDimensions: resolveDimensions,
  ROOT: ROOT,
  SOURCE_DIR: SOURCE_DIR,
  DEFAULT_FPS: DEFAULT_FPS,
  DEFAULT_WIDTH: DEFAULT_WIDTH,
  DEFAULT_HEIGHT: DEFAULT_HEIGHT,
  DEFAULT_FORMAT: DEFAULT_FORMAT
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
