# Render an HTML overlay template to transparent WebM (VP9 + alpha).
# Requires: Node.js 16+, Google Chrome or Edge, ffmpeg on PATH, network for Google Fonts.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Error 'ffmpeg not found on PATH. Install ffmpeg and try again.'
}

if (-not (Test-Path node_modules)) {
    Write-Host 'Installing dependencies...'
    npm install
}

node render-transparent-webm.js @args
