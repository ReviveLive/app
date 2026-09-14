# dev-start-railway.ps1 — first-time setup (if needed) + start the local dev
# stack pointed at a Railway database instead of a local Postgres. The API is
# read-only against `readings`/`vehicles` here, so pointing it at a real
# database carries no write risk beyond whatever you do through ingest/.
#
# Run from the repo root: .\dev-start-railway.ps1

$root = $PSScriptRoot
$ErrorActionPreference = "Stop"

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function OK($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    WARNING: $msg" -ForegroundColor Yellow }

# ---------------------------------------------------------------------------
# 1. .env.railway — holds RAILWAY_DATABASE_URL. Kept separate from .env
# deliberately: docker-compose auto-loads ".env" and interpolates every value
# in it, so a raw Postgres URL there would need `$` escaping even though
# compose never touches this variable. ".env.*" is gitignored but NOT
# auto-loaded by compose, so this stays out of both git and interpolation.
# ---------------------------------------------------------------------------
Step "Checking .env.railway..."
$envRailwayPath = "$root\.env.railway"
if (-not (Test-Path $envRailwayPath)) {
    @"
# Local reference only - never committed (.env.* is gitignored).
# The Railway database's connection string - Railway dashboard -> the
# Postgres/timescaledb service -> Connect -> the public connection string
# (DATABASE_PUBLIC_URL). No `$ escaping needed here - never read by
# docker-compose.
RAILWAY_DATABASE_URL=
"@ | Set-Content $envRailwayPath
    Warn ".env.railway did not exist - created it, but it's empty."
    Write-Host "Open .env.railway, set RAILWAY_DATABASE_URL, then re-run this script." -ForegroundColor Yellow
    exit 1
}

$railwayUrl = $null
foreach ($line in Get-Content $envRailwayPath) {
    if ($line -match '^RAILWAY_DATABASE_URL=(.+)$') { $railwayUrl = $matches[1].Trim() }
}
if (-not $railwayUrl) {
    Write-Error ".env.railway exists but RAILWAY_DATABASE_URL is blank. Set it and re-run."
    exit 1
}
OK "Found RAILWAY_DATABASE_URL."

# ---------------------------------------------------------------------------
# 2. Python virtual environment + dependencies (created here if missing -
# unlike demo/'s equivalent script, this one doesn't assume a separate
# first-time-setup script already ran).
# ---------------------------------------------------------------------------
Step "Checking Python virtual environment..."

$pythonExe = $null
$candidate = (Get-Command python -ErrorAction SilentlyContinue)
if ($candidate -and $candidate.Source -notlike "*WindowsApps*") {
    $pythonExe = $candidate.Source
}
if (-not $pythonExe) {
    foreach ($hive in @("HKCU:\SOFTWARE\Python\PythonCore", "HKLM:\SOFTWARE\Python\PythonCore")) {
        $versions = Get-ChildItem $hive -ErrorAction SilentlyContinue
        foreach ($v in $versions) {
            $exe = (Get-ItemProperty "$($v.PSPath)\InstallPath" -ErrorAction SilentlyContinue).ExecutablePath
            if ($exe -and (Test-Path $exe)) { $pythonExe = $exe; break }
        }
        if ($pythonExe) { break }
    }
}
if (-not $pythonExe) {
    Write-Error "Python not found. Install from https://python.org (tick 'Add Python to PATH')."
    exit 1
}

$venvPython = "$root\backend\.venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Host "    Creating virtual environment..."
    & $pythonExe -m venv "$root\backend\.venv"
    OK "Virtual environment created."
} else {
    OK "Virtual environment exists."
}

Write-Host "    Installing/updating Python dependencies..."
& $venvPython -m pip install --quiet --upgrade pip
& $venvPython -m pip install --quiet -r "$root\backend\requirements.txt"
OK "Python dependencies installed."

# ---------------------------------------------------------------------------
# 3. Node dependencies
# ---------------------------------------------------------------------------
Step "Checking Node dependencies..."
if (-not (Test-Path "$root\frontend\node_modules")) {
    Write-Host "    Running npm install (first time — may take a minute)..."
    Set-Location "$root\frontend"
    npm install
    Set-Location $root
    OK "Node dependencies installed."
} else {
    OK "node_modules exists — skipping npm install."
}

# ---------------------------------------------------------------------------
# 4. Launch API (pointed at Railway) + frontend dev server - as tabs in one
# Windows Terminal window when available (wt.exe), else as two separate
# PowerShell windows.
# ---------------------------------------------------------------------------
function Start-DevTab($title, $command) {
    $wt = Get-Command wt.exe -ErrorAction SilentlyContinue
    if ($wt) {
        $encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($command))
        wt.exe -w 0 new-tab --title $title powershell -NoExit -EncodedCommand $encoded
    } else {
        Start-Process powershell -ArgumentList "-NoExit", "-Command", $command
    }
}

# CUSTOMER_ID/VISIBLE_VEHICLES intentionally left unset here - api.py fails
# CLOSED with neither set (see CLAUDE.md non-negotiable #4), so this starts
# as a "no vehicles visible" view until you set one yourself, e.g.:
#   $env:VISIBLE_VEHICLES = "Warrior-75-Demo,Warrior-No.75"
# or, to preview exactly what one customer's deployment shows:
#   $env:CUSTOMER_ID = "veolia"
Step "Launching API server against the Railway database..."
$apiCmd = "Set-Location '$root\backend'; `$env:DATABASE_URL = '$railwayUrl'; Write-Host 'API server starting (Railway DB)...' -ForegroundColor Cyan; & '$venvPython' -m uvicorn revive.api:app --reload"
Start-DevTab "API (Railway)" $apiCmd

Step "Launching frontend dev server..."
$frontendCmd = "Set-Location '$root\frontend'; Write-Host 'Frontend dev server starting...' -ForegroundColor Cyan; npm run dev"
Start-DevTab "Frontend" $frontendCmd

Step "Opening the app in your browser..."
Start-Sleep -Seconds 5
Start-Process "http://localhost:5173"
OK "Opened http://localhost:5173 - if the vehicle dropdown is empty, set `$env:VISIBLE_VEHICLES or `$env:CUSTOMER_ID (see the note above step 4) and re-run."

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host " Dev stack started (Railway DB, read-only)" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  Frontend : http://localhost:5173"
Write-Host "  API      : http://localhost:8000 (-> Railway database)"
