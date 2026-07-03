'use strict';

const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const {
  renderOverlay,
  resolveFormat,
  contentTypeForFormat,
  defaultOutputForFormat,
  ROOT,
  DEFAULT_FPS,
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT
} = require('./render-transparent-webm');

const s3 = new AWS.S3();

function resolveBundledHtml(html) {
  if (!html) {
    throw new Error('html is required (bundled path relative to package root, e.g. source/examples/goal-lower-third-landscape.html)');
  }
  const resolved = path.isAbsolute(html) ? html : path.join(ROOT, html);
  if (!fs.existsSync(resolved)) {
    throw new Error('Bundled HTML not found: ' + resolved);
  }
  return resolved;
}

function resolveBuckets(event) {
  const htmlBucket = event.htmlS3Bucket || event.inputS3Bucket || null;
  const outputBucket = event.outputS3Bucket || event.s3Bucket || process.env.RENDER_BUCKET || null;
  return { htmlBucket: htmlBucket, outputBucket: outputBucket };
}

function resolveRenderOptions(event) {
  const video = event.video || {};
  return {
    fps: event.fps != null ? Number(event.fps) : video.fps != null ? Number(video.fps) : undefined,
    width: event.width != null ? Number(event.width) : video.width != null ? Number(video.width) : undefined,
    height: event.height != null ? Number(event.height) : video.height != null ? Number(video.height) : undefined,
    templateWidth: event.templateWidth != null ? Number(event.templateWidth) :
      video.templateWidth != null ? Number(video.templateWidth) : undefined,
    templateHeight: event.templateHeight != null ? Number(event.templateHeight) :
      video.templateHeight != null ? Number(video.templateHeight) : undefined,
    format: event.format != null ? event.format :
      event.outputFormat != null ? event.outputFormat :
        video.format != null ? video.format : undefined,
    video: video
  };
}

async function downloadFromS3(bucket, key, workDir, fileName) {
  const localPath = path.join(workDir, fileName || path.basename(key));
  const object = await s3.getObject({ Bucket: bucket, Key: key }).promise();
  fs.writeFileSync(localPath, object.Body);
  return localPath;
}

async function uploadRenderToS3(bucket, key, filePath, contentType) {
  await s3.putObject({
    Bucket: bucket,
    Key: key,
    Body: fs.readFileSync(filePath),
    ContentType: contentType
  }).promise();
}

function normalizeGraphic(graphic) {
  if (graphic == null) {
    return undefined;
  }
  if (typeof graphic === 'string') {
    return JSON.parse(graphic);
  }
  if (typeof graphic !== 'object' || Array.isArray(graphic)) {
    throw new Error('graphic must be a JSON object (partial GRAPHIC override)');
  }
  return graphic;
}

exports.render = async (event) => {
  event = event || {};
  const workDir = '/tmp/overlay-render-' + Date.now();
  fs.mkdirSync(workDir, { recursive: true });

  const buckets = resolveBuckets(event);
  const renderOpts = resolveRenderOptions(event);
  const graphic = normalizeGraphic(event.graphic);

  let htmlPath;
  if (event.htmlS3Key) {
    if (!buckets.htmlBucket) {
      throw new Error('htmlS3Key requires htmlS3Bucket or inputS3Bucket');
    }
    htmlPath = await downloadFromS3(buckets.htmlBucket, event.htmlS3Key, workDir, 'template.html');
  } else if (event.html) {
    htmlPath = resolveBundledHtml(event.html);
  } else {
    throw new Error('Provide htmlS3Key (+ htmlS3Bucket) or html (bundled template path)');
  }

  const format = resolveFormat({
    format: renderOpts.format,
    outputFormat: event.outputFormat,
    outputFileName: event.outputFileName,
    output: event.outputFileName,
    outputPath: event.outputS3Key,
    video: renderOpts.video
  });
  const outputFileName = event.outputFileName || defaultOutputForFormat(format);
  const outputPath = path.join(workDir, outputFileName);

  console.log(
    'Rendering', htmlPath,
    buckets.htmlBucket ? 'from s3://' + buckets.htmlBucket + '/' + event.htmlS3Key : '',
    graphic ? 'with graphic override' : '',
    'format', format,
    '->', outputPath
  );

  const result = await renderOverlay({
    htmlPath: htmlPath,
    graphic: graphic,
    fps: renderOpts.fps,
    format: format,
    width: renderOpts.width,
    height: renderOpts.height,
    templateWidth: renderOpts.templateWidth,
    templateHeight: renderOpts.templateHeight,
    video: renderOpts.video,
    outputPath: outputPath,
    outputFileName: outputFileName,
    workDir: workDir,
    keepFrames: false
  });

  const response = {
    bytes: result.bytes,
    format: result.format,
    fps: renderOpts.fps != null ? renderOpts.fps : DEFAULT_FPS,
    width: result.width,
    height: result.height
  };

  if (graphic) {
    response.graphicApplied = true;
  }

  const outputKey = event.outputS3Key;
  if (outputKey) {
    if (!buckets.outputBucket) {
      throw new Error('outputS3Key requires outputS3Bucket (or RENDER_BUCKET env default)');
    }
    await uploadRenderToS3(buckets.outputBucket, outputKey, result.outputPath, result.contentType);
    response.outputS3Bucket = buckets.outputBucket;
    response.outputS3Key = outputKey;
    response.outputS3Uri = 's3://' + buckets.outputBucket + '/' + outputKey;
  } else if (buckets.outputBucket) {
    const autoKey = 'renders/' + Date.now() + '-' + outputFileName;
    await uploadRenderToS3(buckets.outputBucket, autoKey, result.outputPath, result.contentType);
    response.outputS3Bucket = buckets.outputBucket;
    response.outputS3Key = autoKey;
    response.outputS3Uri = 's3://' + buckets.outputBucket + '/' + autoKey;
  } else {
    response.localOutputPath = result.outputPath;
  }

  if (buckets.htmlBucket && event.htmlS3Key) {
    response.inputS3Bucket = buckets.htmlBucket;
    response.inputS3Key = event.htmlS3Key;
    response.inputS3Uri = 's3://' + buckets.htmlBucket + '/' + event.htmlS3Key;
  }

  return response;
};
