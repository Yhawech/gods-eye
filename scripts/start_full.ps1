$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Test-LocalPort {
  param([int]$Port)
  try {
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    return [bool]$connection
  }
  catch {
    $match = netstat -ano | Select-String -Pattern ":$Port\s" | Select-Object -First 1
    return [bool]$match
  }
}

$pythonCommand = Get-Command python -ErrorAction Stop
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) {
  $npmCommand = Get-Command npm -ErrorAction Stop
}
$pythonPath = $pythonCommand.Source
$npmPath = $npmCommand.Source

$globePath = Join-Path $root "tmp\gods-eye-view"
if (-not (Test-Path $globePath)) {
  Write-Host "Globe companion is not set up yet. Running setup first..."
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "scripts\setup_globe.ps1")
}

if (-not (Test-Path (Join-Path $globePath "node_modules"))) {
  Write-Host "Installing globe companion packages. This can take a few minutes the first time..."
  & $npmPath --prefix $globePath install --engine-strict=false
}

$mainPort = 4173
$globePort = 4174
$mainUrl = "http://127.0.0.1:$mainPort"
$globeUrl = "http://127.0.0.1:$globePort"
$mainAlreadyRunning = Test-LocalPort $mainPort
$globeAlreadyRunning = Test-LocalPort $globePort

if ($mainAlreadyRunning) {
  Write-Host "GOD EYE main dashboard is already running on $mainUrl"
}
else {
  Write-Host "Starting GOD EYE main dashboard on $mainUrl"
}

if ($globeAlreadyRunning) {
  Write-Host "3D globe companion is already running on $globeUrl"
}
else {
  Write-Host "Starting 3D globe companion on $globeUrl"
}

if ($mainAlreadyRunning -and $globeAlreadyRunning) {
  Write-Host "Both services are already running. Open $mainUrl or $globeUrl"
  return
}

Write-Host "Use Ctrl+C in this terminal to stop services started by this command."

$started = New-Object System.Collections.Generic.List[System.Diagnostics.Process]
try {
  if (-not $mainAlreadyRunning) {
    $api = Start-Process -FilePath $pythonPath -ArgumentList @("-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "$mainPort") -WorkingDirectory $root -PassThru -NoNewWindow
    $started.Add($api)
    Start-Sleep -Seconds 2
  }

  if (-not $globeAlreadyRunning) {
    $globe = Start-Process -FilePath $npmPath -ArgumentList @("--prefix", $globePath, "run", "dev", "--", "--host", "127.0.0.1", "--port", "$globePort") -WorkingDirectory $root -PassThru -NoNewWindow
    $started.Add($globe)
  }

  while ($true) {
    foreach ($proc in $started) {
      if ($proc.HasExited) {
        return
      }
    }
    Start-Sleep -Seconds 1
  }
}
finally {
  foreach ($proc in $started) {
    if ($proc -and -not $proc.HasExited) {
      Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
  }
}