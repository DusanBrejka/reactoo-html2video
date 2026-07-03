'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const AWS_CANDIDATES = process.platform === 'win32'
  ? [
      process.env.AWS_CLI_PATH,
      'C:\\SOFTWARE\\AWSCLIV2\\aws.exe',
      'C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe',
      path.join(process.env.ProgramFiles || '', 'Amazon', 'AWSCLIV2', 'aws.exe'),
      path.join(process.env['ProgramFiles(x86)'] || '', 'Amazon', 'AWSCLIV2', 'aws.exe'),
      'aws'
    ].filter(Boolean)
  : ['aws'];

let cachedAwsPath;

function resolveAwsPath() {
  if (cachedAwsPath) {
    return cachedAwsPath;
  }
  for (let i = 0; i < AWS_CANDIDATES.length; i++) {
    const candidate = AWS_CANDIDATES[i];
    if (candidate === 'aws') {
      cachedAwsPath = candidate;
      return cachedAwsPath;
    }
    if (fs.existsSync(candidate)) {
      cachedAwsPath = candidate;
      return cachedAwsPath;
    }
  }
  cachedAwsPath = 'aws';
  return cachedAwsPath;
}

function aws(args, options) {
  const opts = options || {};
  const awsPath = resolveAwsPath();
  const execArgs = args.concat(['--output', 'json']);
  if (opts.region) {
    execArgs.push('--region', opts.region);
  }
  const out = childProcess.execFileSync(awsPath, execArgs, {
    encoding: 'utf8',
    maxBuffer: opts.maxBuffer || 20 * 1024 * 1024
  });
  if (opts.raw) {
    return out;
  }
  return out ? JSON.parse(out) : {};
}

function awsRaw(args, options) {
  return aws(args, Object.assign({}, options || {}, { raw: true }));
}

function getAccountId(region) {
  return aws(['sts', 'get-caller-identity'], { region }).Account;
}

function renderBucket(stage, accountId) {
  return 'reactoo-html2video-' + stage + '-' + accountId;
}

function renderFunctionName(stage) {
  return 'reactoo-html2video-' + stage + '-render';
}

module.exports = {
  resolveAwsPath,
  aws,
  awsRaw,
  getAccountId,
  renderBucket,
  renderFunctionName
};
