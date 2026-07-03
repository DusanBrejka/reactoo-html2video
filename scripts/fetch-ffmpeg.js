'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const https = require('https');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ARTIFACTS_DIR = path.join(ROOT, 'artifacts');
const BIN_DIR = path.join(ARTIFACTS_DIR, 'bin');
const FFMPEG_URL = 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz';
const ARCHIVE = path.join(BIN_DIR, 'ffmpeg-release-amd64-static.tar.xz');

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

function extractLinuxFfmpeg() {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const extractDir = path.join(BIN_DIR, '_extract');
  if (fs.existsSync(extractDir)) {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
  fs.mkdirSync(extractDir, { recursive: true });

  childProcess.execFileSync('tar', ['-xJf', ARCHIVE, '-C', extractDir], { stdio: 'inherit' });

  const entries = fs.readdirSync(extractDir).filter((name) => name.indexOf('ffmpeg-') === 0);
  if (!entries.length) {
    throw new Error('ffmpeg static archive layout unexpected');
  }

  const staticRoot = path.join(extractDir, entries[0]);
  fs.copyFileSync(path.join(staticRoot, 'ffmpeg'), path.join(BIN_DIR, 'ffmpeg'));
  fs.chmodSync(path.join(BIN_DIR, 'ffmpeg'), 0o755);
  if (fs.existsSync(path.join(staticRoot, 'ffprobe'))) {
    fs.copyFileSync(path.join(staticRoot, 'ffprobe'), path.join(BIN_DIR, 'ffprobe'));
    fs.chmodSync(path.join(BIN_DIR, 'ffprobe'), 0o755);
  }

  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.unlinkSync(ARCHIVE);
}

async function main() {
  const ffmpegBin = path.join(BIN_DIR, 'ffmpeg');
  if (fs.existsSync(ffmpegBin)) {
    console.log('ffmpeg already present: ' + ffmpegBin);
    return;
  }

  console.log('Downloading Linux ffmpeg static build...');
  fs.mkdirSync(BIN_DIR, { recursive: true });
  await download(FFMPEG_URL, ARCHIVE);
  console.log('Extracting ffmpeg...');
  extractLinuxFfmpeg();
  console.log('Done: ' + ffmpegBin);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
