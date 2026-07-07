'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  getAccountId,
  renderBucket,
  resolveAwsPath
} = require('./aws-cli');

const ROOT = path.join(__dirname, '..');
const SOURCE_DIR = path.join(ROOT, 'source');
const DEFAULT_STAGE = 'dev3';
const DEFAULT_REGION = 'eu-central-1';
const DEFAULT_TEMPLATE = path.join(SOURCE_DIR, 'SWPL_landscape_1.html');
const DEFAULT_KEY = 'templates/SWPL_landscape_1.html';

function parseArgs(argv) {
  const opts = {
    stage: DEFAULT_STAGE,
    region: DEFAULT_REGION,
    all: true,
    file: DEFAULT_TEMPLATE,
    key: DEFAULT_KEY
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--stage' && argv[i + 1]) {
      opts.stage = argv[++i];
    } else if (arg === '--region' && argv[i + 1]) {
      opts.region = argv[++i];
    } else if (arg === '--all') {
      opts.all = true;
    } else if (arg === '--file' && argv[i + 1]) {
      opts.all = false;
      opts.file = path.isAbsolute(argv[++i]) ? argv[i] : path.join(ROOT, argv[i]);
    } else if (arg === '--key' && argv[i + 1]) {
      opts.key = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log([
        'Usage: node scripts/upload-template.js [--stage dev3] [--region eu-central-1]',
        '',
        '  Default: sync all *.html under source/ to s3://.../templates/ (public via bucket policy)',
        '  --file source/foo.html --key templates/foo.html   upload one file'
      ].join('\n'));
      process.exit(0);
    } else {
      throw new Error('Unknown argument: ' + arg);
    }
  }
  return opts;
}

function templatePublicUrl(region, bucket, key) {
  return 'https://' + bucket + '.s3.' + region + '.amazonaws.com/' + key;
}

function uploadAll(sourceDir, bucket, region) {
  if (!fs.existsSync(sourceDir)) {
    throw new Error('Source directory not found: ' + sourceDir);
  }

  const destination = 's3://' + bucket + '/templates/';
  console.log('Syncing HTML templates', sourceDir, '->', destination);

  childProcess.execFileSync(resolveAwsPath(), [
    's3', 'sync',
    sourceDir,
    destination,
    '--delete',
    '--exclude', '*',
    '--include', '*.html',
    '--content-type', 'text/html; charset=utf-8',
    '--region', region
  ], { stdio: 'inherit' });

  const urls = [];
  function walk(dir, prefix) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = prefix ? prefix + '/' + name : name;
      if (fs.statSync(full).isDirectory()) {
        walk(full, rel);
      } else if (name.endsWith('.html')) {
        urls.push(templatePublicUrl(region, bucket, 'templates/' + rel.replace(/\\/g, '/')));
      }
    }
  }
  walk(sourceDir, '');
  return urls;
}

function uploadOne(file, key, bucket, region) {
  if (!fs.existsSync(file)) {
    throw new Error('Template not found: ' + file);
  }
  const destination = 's3://' + bucket + '/' + key;
  console.log('Uploading', file, '->', destination);

  childProcess.execFileSync(resolveAwsPath(), [
    's3', 'cp',
    file,
    destination,
    '--content-type', 'text/html; charset=utf-8',
    '--region', region
  ], { stdio: 'inherit' });

  return [templatePublicUrl(region, bucket, key)];
}

function main() {
  const opts = parseArgs(process.argv);
  const bucket = renderBucket(opts.stage, getAccountId(opts.region));

  console.log('AWS CLI:', resolveAwsPath());
  console.log('Bucket:', bucket);
  console.log('Public prefix: templates/*');

  const urls = opts.all
    ? uploadAll(SOURCE_DIR, bucket, opts.region)
    : uploadOne(opts.file, opts.key, bucket, opts.region);

  console.log('Done. Public URLs:');
  for (let i = 0; i < urls.length; i++) {
    console.log(' ', urls[i]);
  }
}

try {
  main();
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
