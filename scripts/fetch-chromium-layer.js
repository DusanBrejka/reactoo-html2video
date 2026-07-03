'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ARTIFACTS_DIR = path.join(ROOT, 'artifacts');
const LAYERS_DIR = ARTIFACTS_DIR;
const CHROMIUM_VERSION = '121.0.0';
const LAYER_ZIP = path.join(LAYERS_DIR, 'chromium-v' + CHROMIUM_VERSION + '-layer.zip');
const LAYER_URL = 'https://github.com/Sparticuz/chromium/releases/download/v' + CHROMIUM_VERSION +
  '/chromium-v' + CHROMIUM_VERSION + '-layer.zip';

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error('HTTP ' + res.statusCode + ' fetching ' + url));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
}

async function main() {
  if (fs.existsSync(LAYER_ZIP)) {
    console.log('Chromium layer already present: ' + LAYER_ZIP);
    return;
  }

  fs.mkdirSync(LAYERS_DIR, { recursive: true });
  console.log('Downloading Sparticuz Chromium layer v' + CHROMIUM_VERSION + '...');
  await download(LAYER_URL, LAYER_ZIP);
  console.log('Done: ' + LAYER_ZIP);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
