'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { aws, awsRaw, renderFunctionName, resolveAwsPath } = require('./aws-cli');

const ROOT = path.join(__dirname, '..');
const REGION = 'eu-central-1';
const STAGE = 'dev3';
const FUNCTION = renderFunctionName(STAGE);
const LOG_GROUP = '/aws/lambda/' + FUNCTION;
const MEMORY_SIZES = [1024, 2048, 3008, 4096, 6144, 8192, 10240];
const GB_SECOND_USD = 0.0000166667;
const REQUEST_USD = 0.20 / 1000000;
const PAYLOAD_TEMPLATE = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'invoke-benchmark.json'), 'utf8'));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseReport(message) {
  const duration = /Duration:\s+([\d.]+)\s+ms/.exec(message);
  const billed = /Billed Duration:\s+(\d+)\s+ms/.exec(message);
  const maxMem = /Max Memory Used:\s+(\d+)\s+MB/.exec(message);
  return {
    durationMs: duration ? Number(duration[1]) : null,
    billedMs: billed ? Number(billed[1]) : null,
    maxMemoryUsedMb: maxMem ? Number(maxMem[1]) : null
  };
}

function fetchLatestReport(afterMs) {
  for (let attempt = 0; attempt < 15; attempt++) {
    const events = aws([
      'logs', 'filter-log-events',
      '--log-group-name', LOG_GROUP,
      '--start-time', String(afterMs),
      '--filter-pattern', 'REPORT',
      '--limit', '5'
    ], { region: REGION });
    const messages = (events.events || []).map((e) => e.message).filter(Boolean);
    if (messages.length) {
      return parseReport(messages[messages.length - 1]);
    }
    childProcess.execFileSync('powershell', ['-Command', 'Start-Sleep -Seconds 2'], { stdio: 'ignore' });
  }
  return null;
}

function costUsd(memoryMb, billedMs) {
  const gbSeconds = (memoryMb / 1024) * (billedMs / 1000);
  return gbSeconds * GB_SECOND_USD + REQUEST_USD;
}

async function benchmarkMemory(memoryMb) {
  console.log('Memory ' + memoryMb + ' MB...');
  aws([
    'lambda', 'update-function-configuration',
    '--function-name', FUNCTION,
    '--memory-size', String(memoryMb)
  ], { region: REGION });
  await sleep(3000);

  const payload = Object.assign({}, PAYLOAD_TEMPLATE, {
    outputS3Key: 'renders/benchmark-' + memoryMb + 'mb.webm'
  });
  const payloadPath = path.join(ROOT, '.benchmark-payload.json');
  fs.writeFileSync(payloadPath, JSON.stringify(payload));

  const afterMs = Date.now() - 5000;
  const wallStart = Date.now();
  const outFile = path.join(ROOT, '.benchmark-response.json');
  awsRaw([
    'lambda', 'invoke',
    '--function-name', FUNCTION,
    '--payload', 'fileb://' + payloadPath.replace(/\\/g, '/'),
    '--cli-read-timeout', '300',
    outFile
  ], { region: REGION });
  const wallMs = Date.now() - wallStart;
  const responseBody = fs.readFileSync(outFile, 'utf8');
  if (responseBody.indexOf('errorType') !== -1) {
    throw new Error('Invoke failed at ' + memoryMb + ' MB: ' + responseBody);
  }

  const report = fetchLatestReport(afterMs);
  if (!report || report.billedMs == null) {
    throw new Error('No REPORT log for ' + memoryMb + ' MB');
  }

  const cost = costUsd(memoryMb, report.billedMs);
  const durationSec = report.durationMs / 1000;
  const efficiency = durationSec / cost;

  return {
    memoryMb: memoryMb,
    durationSec: Math.round(durationSec * 10) / 10,
    billedSec: Math.round((report.billedMs / 1000) * 10) / 10,
    wallSec: Math.round((wallMs / 1000) * 10) / 10,
    maxMemoryUsedMb: report.maxMemoryUsedMb,
    gbSeconds: Math.round((memoryMb / 1024) * (report.billedMs / 1000) * 1000) / 1000,
    costUsd: Math.round(cost * 100000) / 100000,
    secPerUsd: Math.round((durationSec / cost) * 10) / 10,
    usdPerSec: Math.round((cost / durationSec) * 100000) / 100000
  };
}

async function main() {
  const results = [];
  for (let i = 0; i < MEMORY_SIZES.length; i++) {
    results.push(await benchmarkMemory(MEMORY_SIZES[i]));
    console.log(
      '  ' + results[results.length - 1].durationSec + 's, $' +
      results[results.length - 1].costUsd.toFixed(5)
    );
  }

  const baseline = results[0];
  const enriched = results.map((row) => {
  const speedup = Math.round((baseline.durationSec / row.durationSec) * 100) / 100;
    const costVsBaseline = Math.round((row.costUsd / baseline.costUsd) * 100) / 100;
    const score = Math.round((speedup / costVsBaseline) * 100) / 100;
    return Object.assign({}, row, { speedupVs1024: speedup, costVs1024: costVsBaseline, valueScore: score });
  });

  const outPath = path.join(ROOT, 'benchmark-memory-results.json');
  fs.writeFileSync(outPath, JSON.stringify({
    region: REGION,
    function: FUNCTION,
    pricing: { gbSecondUsd: GB_SECOND_USD, requestUsd: REQUEST_USD },
    results: enriched
  }, null, 2));

  console.log('\nWrote ' + outPath);
  console.log(JSON.stringify(enriched, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
