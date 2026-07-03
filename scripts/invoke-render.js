'use strict';

const fs = require('fs');
const path = require('path');
const {
  awsRaw,
  getAccountId,
  renderBucket,
  renderFunctionName,
  resolveAwsPath
} = require('./aws-cli');

const ROOT = path.join(__dirname, '..');
const DEFAULT_STAGE = 'dev3';
const DEFAULT_REGION = 'eu-central-1';
const DEFAULT_PAYLOAD = path.join(ROOT, 'examples', 'invoke-s3-swpl-defaults.json');
const PLACEHOLDER_BUCKETS = new Set([
  'YOUR_RENDER_BUCKET',
  'YOUR_BUCKET',
  'my-templates-bucket',
  'my-renders-bucket'
]);

function parseArgs(argv) {
  const opts = {
    stage: DEFAULT_STAGE,
    region: DEFAULT_REGION,
    payload: DEFAULT_PAYLOAD,
    output: path.join(ROOT, '.invoke-response.json')
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--stage' && argv[i + 1]) {
      opts.stage = argv[++i];
    } else if (arg === '--region' && argv[i + 1]) {
      opts.region = argv[++i];
    } else if ((arg === '--payload' || arg === '-p') && argv[i + 1]) {
      opts.payload = path.isAbsolute(argv[++i]) ? argv[i] : path.join(ROOT, argv[i]);
    } else if (arg === '--output' && argv[i + 1]) {
      opts.output = path.isAbsolute(argv[++i]) ? argv[i] : path.join(ROOT, argv[i]);
    } else if (arg === '--help' || arg === '-h') {
      console.log([
        'Usage: node scripts/invoke-render.js [--stage dev3] [--region eu-central-1]',
        '       [--payload examples/invoke-s3-swpl-defaults.json] [--output .invoke-response.json]',
        '',
        'Invokes the deployed render Lambda with a JSON payload file.',
        'Fills htmlS3Bucket / outputS3Bucket when omitted or set to a placeholder.'
      ].join('\n'));
      process.exit(0);
    } else {
      throw new Error('Unknown argument: ' + arg);
    }
  }
  return opts;
}

function needsBucket(value) {
  return value == null || value === '' || PLACEHOLDER_BUCKETS.has(String(value));
}

function preparePayload(payloadPath, stage, region) {
  if (!fs.existsSync(payloadPath)) {
    throw new Error('Payload not found: ' + payloadPath);
  }
  const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  const accountId = getAccountId(region);
  const bucket = renderBucket(stage, accountId);

  if (payload.htmlS3Key && needsBucket(payload.htmlS3Bucket)) {
    payload.htmlS3Bucket = bucket;
  }
  if (payload.outputS3Key && needsBucket(payload.outputS3Bucket)) {
    payload.outputS3Bucket = bucket;
  }

  const tempPath = path.join(ROOT, '.invoke-payload.json');
  fs.writeFileSync(tempPath, JSON.stringify(payload));
  return { payload, tempPath, functionName: renderFunctionName(stage) };
}

function main() {
  const opts = parseArgs(process.argv);
  const prepared = preparePayload(opts.payload, opts.stage, opts.region);
  const payloadUri = 'fileb://' + prepared.tempPath.replace(/\\/g, '/');

  console.log('AWS CLI:', resolveAwsPath());
  console.log('Function:', prepared.functionName);
  console.log('Region:', opts.region);
  if (prepared.payload.htmlS3Key) {
    console.log(
      'Input:',
      's3://' + prepared.payload.htmlS3Bucket + '/' + prepared.payload.htmlS3Key
    );
  }
  if (prepared.payload.outputS3Key) {
    console.log(
      'Output:',
      's3://' + (prepared.payload.outputS3Bucket || prepared.payload.htmlS3Bucket) +
        '/' + prepared.payload.outputS3Key
    );
  }

  awsRaw([
    'lambda', 'invoke',
    '--function-name', prepared.functionName,
    '--payload', payloadUri,
    '--cli-read-timeout', '310',
    opts.output
  ], { region: opts.region });

  const responseText = fs.readFileSync(opts.output, 'utf8');
  let response;
  try {
    response = JSON.parse(responseText);
  } catch (err) {
    console.log(responseText);
    throw new Error('Invoke returned non-JSON response');
  }

  if (response.errorType || response.errorMessage) {
    console.error(JSON.stringify(response, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(response, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
