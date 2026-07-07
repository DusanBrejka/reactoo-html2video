'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { prepareHtmlForRender, ROOT } = require('../render-transparent-webm');

const HTML = path.join(ROOT, 'source', 'SWPL_landscape_1.html');
const WORK = path.join(ROOT, 'output', 'check-exit');
const TIMES = [0, 2.5, 4.9, 5.0, 5.1, 5.2, 5.25, 5.35, 5.45, 5.5, 5.8, 6.0];

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);
  for (let i = 0; i < candidates.length; i++) {
    if (fs.existsSync(candidates[i])) return candidates[i];
  }
  throw new Error('Chrome/Edge not found');
}

async function main() {
  fs.mkdirSync(WORK, { recursive: true });
  const htmlPath = prepareHtmlForRender(HTML, WORK);
  const browser = await puppeteer.launch({
    executablePath: await findChrome(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      window.__RENDER_WAIT_FOR_GO__ = true;
    });
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'networkidle0', timeout: 120000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => window.__RENDER_ARMED__ === true, { timeout: 60000 });

    const duration = await page.evaluate(() => window.getOverlayRenderDuration(window.GRAPHIC));
    console.log('Duration sec:', duration);

    const rows = [];
    for (let i = 0; i < TIMES.length; i++) {
      const t = TIMES[i];
      const state = await page.evaluate((timeSec) => {
        window.prepareFrame(timeSec, window.GRAPHIC);
        var tag = document.querySelector('.competition-tag');
        var bar = document.querySelector('.lower-third');
        var overlay = document.querySelector('.overlay');
        function snap(el) {
          if (!el) return null;
          var cs = getComputedStyle(el);
          return {
            opacity: cs.opacity,
            visibility: cs.visibility,
            transform: cs.transform,
            animation: cs.animationName
          };
        }
        return {
          isReady: overlay && overlay.classList.contains('is-ready'),
          isExiting: overlay && overlay.classList.contains('is-exiting'),
          tag: snap(tag),
          bar: snap(bar)
        };
      }, t);
      rows.push({ t: t, state: state });
      console.log(
        't=' + t.toFixed(2) + 's',
        'exiting=' + state.isExiting,
        'tagOpacity=' + (state.tag && state.tag.opacity),
        'tagAnim=' + (state.tag && state.tag.animation),
        'barOpacity=' + (state.bar && state.bar.opacity)
      );
    }

    const tagVisibleAtEnd = rows[rows.length - 1].state.tag &&
      parseFloat(rows[rows.length - 1].state.tag.opacity) > 0.05;
    console.log('');
    console.log(tagVisibleAtEnd ? 'FAIL: competition tag still visible at end' : 'PASS: competition tag hidden at end');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
