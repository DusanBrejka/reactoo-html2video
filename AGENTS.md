# reactoo-html2video — project context

## What this is

HTML overlay templates (CSS animations + `window.GRAPHIC` config) → frame-by-frame capture via Puppeteer → ffmpeg encode.

**Outputs:** `webm` (VP9+alpha, default), `prores` (.mov 4444+alpha), `apng`, `mp4` (H.264; alpha often lost — falls back to black).

**Runtimes:** local (Windows Chrome + ffmpeg) or AWS Lambda (zip function + Sparticuz Chromium layer + Linux ffmpeg layer).

Originated as SWPL goal lower-third; renderer is **template-agnostic** — no sports-specific constants in core code.

---

## Repo layout

| File / dir | Role |
|------------|------|
| `handler.js` | Lambda entry: S3 HTML in, optional `graphic`, video out to S3 |
| `render-transparent-webm.js` | CLI + shared pipeline: patch HTML, capture frames, encode |
| `overlay-render-runtime.js` | Injected into templates: `prepareFrame`, `seekOverlay`, `getOverlayRenderDuration` |
| `graphic-schema.json` / `invoke-schema.json` | Payload docs |
| `source/` | Bundled templates (`SWPL_landscape_1.html`) |
| `examples/` | Sample invoke JSON |
| `scripts/` | `fetch-ffmpeg`, `fetch-chromium-layer`, `build-ffmpeg-layer`, `check-exit-phase`, `benchmark-memory` |
| `artifacts/` | Downloaded binaries (gitignored); populated by `npm run predeploy` |

---

## Pipeline (high level)

1. Patch HTML: inject runtime, disable auto-play (`__RENDER_WAIT_FOR_GO__`), optional `graphic` deep-merge.
2. Puppeteer loads template, waits for fonts + armed state, scales `.overlay` to output dimensions.
3. For each frame: `prepareFrame(t)` → screenshot PNG with `omitBackground: true`.
4. ffmpeg encodes PNG sequence to chosen format.
5. Lambda uploads to S3 with correct `Content-Type`.

**Duration:** `getOverlayRenderDuration(GRAPHIC)` — typically `hold` + exit animations + small tail (~6.05s @ defaults, 25fps → 152 frames).

---

## Template contract

- Root: `.overlay` or `[data-overlay-root]`
- Exit phase: `.is-exiting` class when `time >= animation.hold`
- Exit CSS anims: names like `*-out` / `*-exit`
- `window.GRAPHIC` with `animation.hold` (seconds)
- Optional: template's own `seekGraphic` — only used if `window.__RENDER_USE_TEMPLATE_SEEK__` is set

---

## Lambda / AWS

- **Service:** `reactoo-html2video`
- **Function:** `reactoo-html2video-<stage>-render`
- **Bucket:** `reactoo-html2video-<stage>-<accountId>`
- **Memory:** 10240 MB (sweet spot ~3008 MB for cost; 10GB ~75s/render 1080p)
- **Layers:** `artifacts/chromium-v121.0.0-layer.zip`, `artifacts/ffmpeg-layer/`

**Legacy stack (pre-move):** `html-overlay-render-dev3` — separate CloudFormation stack; bucket `reactoo-html-overlay-render-dev3-458780930208` still exists until removed.

```powershell
npm install
npm run predeploy    # downloads artifacts/
npm run deploy -- --stage dev3 --region eu-central-1
npx serverless invoke -f render --stage dev3 --region eu-central-1 --data file://examples/invoke-s3-swpl-defaults.json
```

**Package rule:** `artifacts/**` must stay out of the function zip (70MB upload limit). Already excluded in `serverless.yml`.

---

## Local dev

```powershell
$env:FFMPEG_PATH = "C:\SOFTWARE\FFMPEG\ffmpeg.exe"
npm run render -- --html source/SWPL_landscape_1.html --format webm --width 1920 --height 1080 --fps 25 --output demo.webm
npm run check-exit     # opacity curve during competition-tag exit
```

---

## Invoke payload (minimal S3)

```json
{
  "htmlS3Bucket": "reactoo-html2video-dev3-ACCOUNTID",
  "htmlS3Key": "templates/SWPL_landscape_1.html",
  "outputS3Key": "renders/demo.webm",
  "format": "webm",
  "width": 1920,
  "height": 1080,
  "templateWidth": 1920,
  "templateHeight": 1080,
  "fps": 25
}
```

`format` optional if inferred from `outputS3Key` extension. `graphic` = partial `GRAPHIC` override (see `graphic-schema.json`).

---

## Important bugs fixed (don't regress)

### 1. Missing end frames / wrong duration

Use `getOverlayRenderDuration()`; don't hardcode frame counts.

### 2. Competition tag stuck visible on Lambda exit

**Cause:** Sparticuz Chromium leaves stale enter anims (`tag-in`) in `getAnimations()` with empty names; seeking them snapped to opacity 1 during exit.

**Fix (in `overlay-render-runtime.js`):** On exit phase, `cancel()` enter-named anims on exit-controlled elements; seek only primary exit anims (`tag-out`) via `seekExitAnimation`. **Do not** force `opacity: 0` — that made exit abrupt.

**Verify:** `node scripts/check-exit-phase.js` — tag should fade 1.0 → 0 over ~0.45s after `hold`.

### 3. Lambda package too large

Exclude `artifacts/`, `output/`, `node_modules/serverless/**` from function zip.

---

## Format notes

| Format | Alpha | Typical size (1080p ~6s) |
|--------|-------|----------------------------|
| webm | Yes | ~1.8 MB |
| prores | Yes | ~25 MB |
| apng | Yes | ~2–4 MB (encoder-dependent) |
| mp4 | No* | ~0.13 MB |

\*libx264 auto-selects `yuv420p`; transparency composites on black.

---

## Cardinal don'ts

1. Don't bundle `artifacts/` into Lambda zip.
2. Don't hardcode template-specific timing in `render-transparent-webm.js`.
3. Don't snap-hide elements on exit — seek exit animations.
4. Run `npm run predeploy` on fresh clone before first deploy.

---

## Cursor / AI usage

When editing this repo, read this file + `README.md` + `invoke-schema.json`. For animation bugs, read `overlay-render-runtime.js` (`seekOverlay`, `cancelStaleEnterAnimations`) first, then run `check-exit-phase.js` locally before Lambda deploy.
