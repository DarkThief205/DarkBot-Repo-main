#!/usr/bin/env pwsh
# DarkBot Multi-Language Startup Script for Wispbyte
# Handles both Node.js and Python environments

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

Write-Host "[start] PowerShell Version: $($PSVersionTable.PSVersion)" -ForegroundColor Cyan
Write-Host "[start] Working Directory: $(Get-Location)" -ForegroundColor Cyan

# ==============================================================================
# 1. VALIDATE PREREQUISITES
# ==============================================================================

if (-not (Test-Path "package.json")) {
    Write-Host "[error] package.json not found in current directory" -ForegroundColor Red
    exit 1
}

Write-Host "[check] package.json found ✓" -ForegroundColor Green

# ==============================================================================
# 2. NODE.JS SETUP
# ==============================================================================

Write-Host "`n[node] Checking Node.js installation..." -ForegroundColor Yellow

try {
    $nodeVersion = node --version
    $npmVersion = npm --version
    Write-Host "[node] Node: $nodeVersion" -ForegroundColor Green
    Write-Host "[node] Npm:  $npmVersion" -ForegroundColor Green
} catch {
    Write-Host "[error] Node.js or npm not found. Please install Node.js 18+" -ForegroundColor Red
    exit 1
}

# Clean node_modules if no lockfile exists
if ((Test-Path "node_modules") -and -not (Test-Path "package-lock.json")) {
    Write-Host "[deps] Cleaning node_modules (no lockfile)..." -ForegroundColor Yellow
    Remove-Item -Path "node_modules" -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "[deps] Installing Node.js dependencies..." -ForegroundColor Yellow
try {
    if (Test-Path "package-lock.json") {
        npm ci --omit=dev --legacy-peer-deps
    } else {
        npm install --omit=dev --no-audit --no-fund --legacy-peer-deps
    }
    Write-Host "[deps] Node.js dependencies installed ✓" -ForegroundColor Green
} catch {
    Write-Host "[deps] npm install failed, retrying with different flags..." -ForegroundColor Yellow
    npm install --omit=dev --force --legacy-peer-deps
}

Write-Host "[deps] Rebuilding native modules..." -ForegroundColor Yellow
npm rebuild --build-from-source 2>$null
Write-Host "[deps] Native modules rebuilt ✓" -ForegroundColor Green

# ==============================================================================
# 3. PYTHON SETUP
# ==============================================================================

Write-Host "`n[python] Checking Python installation..." -ForegroundColor Yellow

$pythonCmd = $null
$pythonVersion = $null

# Try to find Python
foreach ($cmd in @("python", "python3", "py")) {
    try {
        $version = & $cmd --version 2>&1
        if ($version -match "Python (\d+\.\d+)") {
            $pythonCmd = $cmd
            $pythonVersion = $matches[1]
            break
        }
    } catch {
        continue
    }
}

if (-not $pythonCmd) {
    Write-Host "[python] WARNING: Python not found in PATH" -ForegroundColor Yellow
    Write-Host "[python] Attempting to install Python via scoop/choco..." -ForegroundColor Yellow
    
    # Try scoop first
    if (Get-Command scoop -ErrorAction SilentlyContinue) {
        scoop install python
        $pythonCmd = "python"
    }
    # Try chocolatey
    elseif (Get-Command choco -ErrorAction SilentlyContinue) {
        choco install python -y
        $pythonCmd = "python"
    } else {
        Write-Host "[python] ERROR: Cannot find Python. Please install Python 3.8+ manually." -ForegroundColor Red
        exit 1
    }
}

Write-Host "[python] Python: $pythonVersion (cmd: $pythonCmd)" -ForegroundColor Green

# Create virtual environment if it doesn't exist
if (-not (Test-Path "venv")) {
    Write-Host "[python] Creating virtual environment..." -ForegroundColor Yellow
    & $pythonCmd -m venv venv
    Write-Host "[python] Virtual environment created ✓" -ForegroundColor Green
}

# Activate virtual environment (PowerShell)
$activateScript = ".\venv\Scripts\Activate.ps1"
if (Test-Path $activateScript) {
    Write-Host "[python] Activating virtual environment..." -ForegroundColor Yellow
    & $activateScript
    Write-Host "[python] Virtual environment activated ✓" -ForegroundColor Green
} else {
    Write-Host "[python] ERROR: Cannot find virtual environment activation script" -ForegroundColor Red
    exit 1
}

# Install Python requirements
if (Test-Path "requirements.txt") {
    Write-Host "[python] Installing Python dependencies..." -ForegroundColor Yellow
    try {
        & $pythonCmd -m pip install --upgrade pip setuptools wheel -q
        & $pythonCmd -m pip install -r requirements.txt -q
        Write-Host "[python] Python dependencies installed ✓" -ForegroundColor Green
    } catch {
        Write-Host "[python] WARNING: Some Python packages may not have installed" -ForegroundColor Yellow
    }
} else {
    Write-Host "[python] WARNING: requirements.txt not found" -ForegroundColor Yellow
}

# ==============================================================================
# 4. ENVIRONMENT SETUP
# ==============================================================================

Write-Host "`n[env] Setting up environment variables..." -ForegroundColor Yellow

# Load .env file if it exists
if (Test-Path ".env") {
    Write-Host "[env] Loading .env file..." -ForegroundColor Cyan
    $envContent = Get-Content ".env"
    foreach ($line in $envContent) {
        if ($line -match "^([^#=]+)=(.+)$") {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            [System.Environment]::SetEnvironmentVariable($key, $value, "Process")
            Write-Host "[env] Set $key" -ForegroundColor DarkGray
        }
    }
} else {
    Write-Host "[env] WARNING: .env file not found" -ForegroundColor Yellow
}

# Set Python-specific env vars
$env:PYTHONUNBUFFERED = "1"
$env:PYTHONDONTWRITEBYTECODE = "1"
Write-Host "[env] Python unbuffered output enabled" -ForegroundColor Green

# ==============================================================================
# 5. VERIFY BINARY DEPENDENCIES
# ==============================================================================

Write-Host "`n[bins] Checking binary dependencies..." -ForegroundColor Yellow

# Create bin directory
if (-not (Test-Path "bin")) {
    New-Item -ItemType Directory -Path "bin" -Force | Out-Null
}

# Check for ffmpeg
if (-not (Test-Path "bin/ffmpeg") -and -not (Test-Path "bin/ffmpeg.exe")) {
    Write-Host "[bins] ffmpeg not found in bin/, checking system PATH..." -ForegroundColor Yellow
    if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
        Write-Host "[bins] ffmpeg found in system PATH ✓" -ForegroundColor Green
    } else {
        Write-Host "[bins] WARNING: ffmpeg not found. Music may not work without it." -ForegroundColor Yellow
    }
} else {
    Write-Host "[bins] ffmpeg found in ./bin/ ✓" -ForegroundColor Green
}

# Check for yt-dlp
if (-not (Test-Path "bin/yt-dlp") -and -not (Test-Path "bin/yt-dlp.exe")) {
    Write-Host "[bins] yt-dlp not found in bin/, attempting download..." -ForegroundColor Yellow
    
    $ytdlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    try {
        $ProgressPreference = "SilentlyContinue"
        Invoke-WebRequest -Uri $ytdlpUrl -OutFile "bin/yt-dlp.exe" -ErrorAction Stop
        Write-Host "[bins] yt-dlp.exe downloaded successfully ✓" -ForegroundColor Green
    } catch {
        Write-Host "[bins] ERROR: Failed to download yt-dlp" -ForegroundColor Red
        Write-Host "[bins] Download manually: $ytdlpUrl" -ForegroundColor Yellow
    }
} else {
    Write-Host "[bins] yt-dlp found in ./bin/ ✓" -ForegroundColor Green
}

# ==============================================================================
# 6. FIND AND RUN START COMMAND
# ==============================================================================

Write-Host "`n[start] Determining startup command..." -ForegroundColor Yellow

$startCmd = $null

# Check if npm has a start script
try {
    $npmScripts = npm run 2>&1 | Select-String "start"
    if ($npmScripts) {
        $startCmd = "npm run start"
    }
} catch {}

# Fallback to direct node execution
if (-not $startCmd) {
    $entryFiles = @("dist/index.js", "build/index.js", "index.js", "bot.js")
    foreach ($file in $entryFiles) {
        if (Test-Path $file) {
            $startCmd = "node $file"
            break
        }
    }
}

if (-not $startCmd) {
    Write-Host "[error] No start script or entry file found" -ForegroundColor Red
    Write-Host "[error] Checked: $($entryFiles -join ', ')" -ForegroundColor Red
    exit 1
}

Write-Host "[start] Launch command: $startCmd" -ForegroundColor Green
Write-Host "[start] ========================================" -ForegroundColor Cyan
Write-Host "[start] Starting DarkBot..." -ForegroundColor Cyan
Write-Host "[start] ========================================" -ForegroundColor Cyan
Write-Host ""

# Run the bot
Invoke-Expression $startCmd
