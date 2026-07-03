'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ARTIFACTS_DIR = path.join(ROOT, 'artifacts');
const FFMPEG_BIN = path.join(ARTIFACTS_DIR, 'bin', 'ffmpeg');
const LAYER_DIR = path.join(ARTIFACTS_DIR, 'ffmpeg-layer');
const LAYER_BIN = path.join(LAYER_DIR, 'bin', 'ffmpeg');

function main() {
  if (!fs.existsSync(FFMPEG_BIN)) {
    throw new Error('Run scripts/fetch-ffmpeg.js first');
  }

  fs.mkdirSync(path.dirname(LAYER_BIN), { recursive: true });
  fs.copyFileSync(FFMPEG_BIN, LAYER_BIN);
  console.log('FFmpeg layer ready: ' + LAYER_BIN);
}

main();
