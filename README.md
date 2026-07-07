# reactoo-html2video

Render HTML overlay templates to video with alpha (WebM, ProRes, APNG) or H.264 MP4. Runs locally (Chrome + ffmpeg) or on AWS Lambda (Puppeteer + Sparticuz Chromium + ffmpeg layers).

AI / onboarding context: see [`AGENTS.md`](AGENTS.md).

## Layout

```
handler.js                  Lambda entry
render-transparent-webm.js  Capture + encode (local CLI + Lambda)
overlay-render-runtime.js   Injected seek/bake runtime (template-agnostic)
graphic-schema.json         GRAPHIC override schema
invoke-schema.json          Lambda invoke payload schema
source/                     Bundled HTML templates
scripts/                    Layer fetch, benchmarks, diagnostics
examples/                   Sample invoke payloads
artifacts/                  Downloaded ffmpeg + Lambda layers (gitignored)
```

## Prerequisites

- Node.js 16+
- **Local render:** Google Chrome or Edge, ffmpeg on PATH (or set `FFMPEG_PATH`)
- **Deploy:** AWS CLI, credentials for target account

## Install

```powershell
npm install
```

## Output formats

| Format | Extension | Alpha | Notes |
|--------|-----------|-------|-------|
| `webm` | `.webm` | Yes | VP9 + alpha (default, best for web) |
| `prores` | `.mov` | Yes | ProRes 4444 — NLE / broadcast |
| `apng` | `.apng` | Yes | Animated PNG (large at 1080p) |
| `mp4` | `.mp4` | Partial | H.264 `yuva420p` when supported; otherwise flattened on black |

Set via `--format`, Lambda `format` / `outputFormat`, or infer from output filename extension.

```powershell
npm run render -- --html source/SWPL_landscape_1.html --format prores --output demo.mov
npm run render -- --html source/SWPL_landscape_1.html --format apng --output demo.apng
npm run render -- --html source/SWPL_landscape_1.html --format mp4 --output demo.mp4
```

## Local render

```powershell
$env:FFMPEG_PATH = "C:\path\to\ffmpeg.exe"   # optional if ffmpeg is on PATH
.\render.ps1 --html source/SWPL_landscape_1.html --width 1920 --height 1080 --fps 25 --output output/demo.webm
```

Or:

```powershell
npm run render -- --html source/SWPL_landscape_1.html --width 1920 --height 1080 --fps 25 --output output/demo.webm
```

Verify exit animation timing:

```powershell
npm run check-exit
```

## Deploy (Lambda)

Downloads Linux ffmpeg + Sparticuz Chromium layer into `artifacts/`, then deploys:

```powershell
npm run deploy -- --stage dev3 --region eu-central-1
```

Function name: `reactoo-html2video-<stage>-render`. S3 bucket: `reactoo-html2video-<stage>-<accountId>`.

Upload a template, then invoke (replace bucket name):

```powershell
aws s3 cp source/SWPL_landscape_1.html s3://YOUR_BUCKET/templates/SWPL_landscape_1.html
npx serverless invoke -f render --stage dev3 --region eu-central-1 --data file://examples/invoke-s3-swpl-defaults.json
```

See `invoke-example.json` and `invoke-schema.json` for payload fields. Partial `graphic` overrides are documented in `graphic-schema.json`.

## Invoke from another Lambda

The render function is a normal Lambda (`handler.render`). Other functions call it with the AWS SDK — no API Gateway.

**Function name:** `reactoo-html2video-<stage>-render`  
**Region:** same as deploy (default `eu-central-1`)  
**Timeout:** 300s — use **sync** invoke only if the caller’s timeout is ≥ 300s; otherwise use **async** (`Event`) and poll S3 or use a callback pattern.

### Payload

Upload the HTML template to S3 first, then pass keys (and optional `graphic` / `format`). If `outputS3Bucket` is omitted, the render function writes to its own `RENDER_BUCKET` (the stack bucket).

```json
{
  "htmlS3Bucket": "reactoo-html2video-dev3-123456789012",
  "htmlS3Key": "templates/goal-lower-third.html",
  "outputS3Key": "renders/job-abc.webm",
  "format": "webm",
  "width": 1920,
  "height": 1080,
  "templateWidth": 1920,
  "templateHeight": 1080,
  "fps": 25,
  "graphic": {
    "text": { "playerSurname": "SMITH" },
    "animation": { "hold": 5 }
  }
}
```

### Sync invoke (wait for result)

Returns parsed JSON, e.g. `{ "bytes", "format", "width", "height", "outputS3Bucket", "outputS3Key", "outputS3Uri" }`.

```javascript
'use strict';

const AWS = require('aws-sdk');

const lambda = new AWS.Lambda({
  region: process.env.AWS_REGION || 'eu-central-1',
  httpOptions: { timeout: 310000 }
});

async function renderOverlayVideo(job) {
  const stage = process.env.STAGE || 'dev3';
  const accountId = process.env.AWS_ACCOUNT_ID;
  const functionName = `reactoo-html2video-${stage}-render`;
  // Or: `arn:aws:lambda:eu-central-1:${accountId}:function:${functionName}`

  const response = await lambda.invoke({
    FunctionName: functionName,
    InvocationType: 'RequestResponse',
    Payload: JSON.stringify({
      htmlS3Bucket: job.templateBucket,
      htmlS3Key: job.templateKey,
      outputS3Key: job.outputKey,
      format: job.format || 'webm',
      width: job.width,
      height: job.height,
      templateWidth: job.templateWidth,
      templateHeight: job.templateHeight,
      fps: job.fps || 25,
      graphic: job.graphic
    })
  }).promise();

  if (response.FunctionError) {
    const err = JSON.parse(response.Payload || '{}');
    throw new Error(err.errorMessage || response.FunctionError);
  }

  return JSON.parse(response.Payload);
}
```

### Async invoke (fire-and-forget)

Use when the caller must not block for ~1–2 minutes. The render Lambda still runs; check `outputS3Key` when complete (S3 event, Step Functions, or a follow-up job).

```javascript
await lambda.invoke({
  FunctionName: `reactoo-html2video-${process.env.STAGE || 'dev3'}-render`,
  InvocationType: 'Event',
  Payload: JSON.stringify({ htmlS3Bucket, htmlS3Key, outputS3Key, format: 'webm', width: 1920, height: 1080, fps: 25 })
}).promise();
```

### IAM on the **caller** function

Grant invoke on the render function. Grant S3 only if the caller uploads HTML or reads the output (the render function already has S3 read/write for its own work).

```yaml
# serverless.yml snippet — caller function
iam:
  role:
    statements:
      - Effect: Allow
        Action: lambda:InvokeFunction
        Resource: arn:aws:lambda:${aws:region}:${aws:accountId}:function:reactoo-html2video-${self:provider.stage}-render
      - Effect: Allow
        Action:
          - s3:PutObject
          - s3:GetObject
        Resource: arn:aws:s3:::reactoo-html2video-${self:provider.stage}-${aws:accountId}/*
```

### Calling from reactoo-api

`reactoo/common.js` `callLambda(name, payload, type)` builds names as `reactoo-<stage>-<name>`. This service uses a **different** Serverless service name, so pass the full ARN (or the full function name string) as `name`:

```javascript
const common = require('reactoo/common');

const arn = `arn:aws:lambda:eu-central-1:${process.env.AWS_ACCOUNT_ID}:function:reactoo-html2video-${common.getStage()}-render`;

const result = await common.callLambda(arn, {
  htmlS3Bucket: bucket,
  htmlS3Key: templateKey,
  outputS3Key: outputKey,
  format: 'webm',
  width: 1920,
  height: 1080,
  fps: 25,
  graphic: graphicOverride
}, 'RequestResponse');
```

Add `lambda:InvokeFunction` on that ARN to the caller’s `serverless.yml` and ensure `aws-sdk` is packaged if the caller Lambda uses it.

## Template contract

Templates should expose a root overlay element (`.overlay` or `[data-overlay-root]`), optional `.is-exiting` exit phase, and a `window.GRAPHIC` config with `animation.hold` (seconds). The injected runtime seeks CSS animations frame-by-frame; templates may also ship `seekGraphic` / `prepareFrame` (opt-in via `window.__RENDER_USE_TEMPLATE_SEEK__`).

## Benchmarks

```powershell
node scripts/benchmark-memory.js
```

Uses `examples/invoke-benchmark.json` against the deployed function.
