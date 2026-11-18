param(
  [string]$RepoUrl = "https://github.com/bilawalsidhu/gods-eye-view.git",
  [string]$InstallPath = "tmp\gods-eye-view"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root $InstallPath
$envFile = Join-Path $target ".env"

if (-not (Test-Path $target)) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
  git clone $RepoUrl $target
}

if (-not (Test-Path $envFile)) {
  @"
# GOD'S EYE View companion settings
# Paste your restricted Google Maps Platform key below.
GOOGLE_MAPS_API_KEY=PASTE_YOUR_RESTRICTED_GOOGLE_MAPS_KEY_HERE

# Local companion server. Main GOD EYE stays on 4173.
PORT=4174
HOST=127.0.0.1

# Keep free/keyless providers on for local use.
OPENSKY_AUTH_MODE=anon
VITE_AIS_LIVE_API_URL=/api/ais-live
VITE_AIS_LIVE_MAX_ROWS=12000
VITE_AIS_LIVE_LABEL_MAX_ROWS=900

# Optional free/live source keys. Leave blank until you create the free accounts.
FIRMS_MAP_KEY=
AISSTREAM_API_KEY=
CCTV_MAX_SOURCES=900
CCTV_AUSTIN_MAX_SOURCES=120
CCTV_PREFER_AUSTIN=0

# Keyless public OSINT feed controls.
GLOBE_OSINT_ENABLED=true
GLOBE_OSINT_REFRESH_MS=300000
GLOBE_OSINT_MAX_ITEMS=80

# Soft local guards. Real spend protection must be configured in Google Cloud.
GEV_RATELIMIT_GOOGLE_PER_MIN=30

OPENAI_API_KEY=
"@ | Set-Content -Path $envFile -Encoding UTF8
}

$patchScript = Join-Path $root "scripts\patch_globe_layout.mjs"
if (Test-Path $patchScript) {
  node $patchScript $InstallPath
}
Write-Host "Globe companion is ready at $target"
Write-Host "Next:"
Write-Host "1. Put your Google Maps key in $envFile"
Write-Host "2. Run: npm run install:globe"
Write-Host "3. Run: npm run start:globe"



