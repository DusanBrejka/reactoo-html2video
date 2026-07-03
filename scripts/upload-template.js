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
const DEFAULT_STAGE = 'dev3';
const DEFAULT_REGION = 'eu-central-1';
const DEFAULT_TEMPLATE = path.join(ROOT, 'source', 'SWPL_landspace_1.html');
const DEFAULT_KEY = 'templates/SWPL_landspace_1.html';

function parseArgs(argv) {
  const opts = {
    stage: DEFAULT_STAGE,
    region: DEFAULT_REGION,
    file: DEFAULT_TEMPLATE,
    key: DEFAULT_KEY
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--stage' && argv[i + 1]) {
      opts.stage = argv[++i];
    } else if (arg === '--region' && argv[i + 1]) {
      opts.region = argv[++i];
    } else if (arg === '--file' && argv[i + 1]) {
      opts.file = path.isAbsolute(argv[++i]) ? argv[i] : path.join(ROOT, argv[i]);
    } else if (arg === '--key' && argv[i + 1]) {
      opts.key = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log([
        'Usage: node scripts/upload-template.js [--stage dev3] [--region eu-central-1]',
        '       [--file source/SWPL_landspace_1.html] [--key templates/SWPL_landspace_1.html]'
      ].join('\n'));
      process.exit(0);
    } else {
      throw new Error('Unknown argument: ' + arg);
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv);
  if (!fs.existsSync(opts.file)) {
    throw new Error('Template not found: ' + opts.file);
  }

  const bucket = renderBucket(opts.stage, getAccountId(opts.region));
  const destination = 's3://' + bucket + '/' + opts.key;

  console.log('AWS CLI:', resolveAwsPath());
  console.log('Uploading', opts.file, '->', destination);

  childProcess.execFileSync(resolveAwsPath(), [
    's3', 'cp',
    opts.file,
    destination,
    '--region', opts.region
  ], { stdio: 'inherit' });

  console.log('Done.');
}

try {
  main();
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
