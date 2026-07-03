# reactoo-html2video

Render HTML overlay templates to video with alpha (WebM, ProRes, APNG) or H.264 MP4. Runs locally (Chrome + ffmpeg) or on AWS Lambda (Puppeteer + Sparticuz Chromium + ffmpeg layers).

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
npm run render -- --html source/SWPL_landspace_1.html --format prores --output demo.mov
npm run render -- --html source/SWPL_landspace_1.html --format apng --output demo.apng
npm run render -- --html source/SWPL_landspace_1.html --format mp4 --output demo.mp4
```

## Local render

```powershell
$env:FFMPEG_PATH = "C:\path\to\ffmpeg.exe"   # optional if ffmpeg is on PATH
.\render.ps1 --html source/SWPL_landspace_1.html --width 1920 --height 1080 --fps 25 --output output/demo.webm
```

Or:

```powershell
npm run render -- --html source/SWPL_landspace_1.html --width 1920 --height 1080 --fps 25 --output output/demo.webm
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
aws s3 cp source/SWPL_landspace_1.html s3://YOUR_BUCKET/templates/SWPL_landspace_1.html
npx serverless invoke -f render --stage dev3 --region eu-central-1 --data file://examples/invoke-s3-swpl-defaults.json
```

See `invoke-example.json` and `invoke-schema.json` for payload fields. Partial `graphic` overrides are documented in `graphic-schema.json`.

## Template contract

Templates should expose a root overlay element (`.overlay` or `[data-overlay-root]`), optional `.is-exiting` exit phase, and a `window.GRAPHIC` config with `animation.hold` (seconds). The injected runtime seeks CSS animations frame-by-frame; templates may also ship `seekGraphic` / `prepareFrame` (opt-in via `window.__RENDER_USE_TEMPLATE_SEEK__`).

## Benchmarks

```powershell
node scripts/benchmark-memory.js
```

Uses `examples/invoke-benchmark.json` against the deployed function.
