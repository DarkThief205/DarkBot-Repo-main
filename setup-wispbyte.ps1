bash start.sh#!/usr/bin/env pwsh
<#
.SYNOPSIS
    DarkBot Wispbyte Pre-Deployment Verification Script
    
.DESCRIPTION
    Verifies all dependencies and configurations before uploading to Wispbyte.
    Run this locally to ensure your bot is ready for hosting.
#>

param(
    [switch]$Quick = $false,
    [switch]$FixIssues = $false
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  DarkBot Wispbyte Pre-Deployment Check" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$checks = @{
    "✓ Passed" = @()
    "✗ Failed" = @()
    "⚠ Warning" = @()
}

# ==============================================================================
# 1. PROJECT STRUCTURE
# ==============================================================================

Write-Host "[1] Project Structure" -ForegroundColor Yellow
Write-Host "─────────────────────" -ForegroundColor Gray

$requiredFiles = @(
    "package.json",
    "index.js",
    ".env"
)

foreach ($file in $requiredFiles) {
    if (Test-Path $file) {
        Write-Host "  ✓ $file" -ForegroundColor Green
        $checks["✓ Passed"] += $file
    } else {
        Write-Host "  ✗ $file (MISSING)" -ForegroundColor Red
        $checks["✗ Failed"] += $file
    }
}

# ==============================================================================
# 2. NODE.JS CHECK
# ==============================================================================

Write-Host "`n[2] Node.js Environment" -ForegroundColor Yellow
Write-Host "───────────────────────" -ForegroundColor Gray

try {
    $nodeVersion = node --version
    $npmVersion = npm --version
    $nodeNumeric = [version]($nodeVersion -replace 'v', '')
    
    if ($nodeNumeric -ge [version]"18.0") {
        Write-Host "  ✓ Node.js $nodeVersion (OK)" -ForegroundColor Green
        $checks["✓ Passed"] += "Node.js $nodeVersion"
    } else {
        Write-Host "  ✗ Node.js $nodeVersion (NEED 18+)" -ForegroundColor Red
        $checks["✗ Failed"] += "Node.js version"
    }
    
    Write-Host "  ✓ npm $npmVersion" -ForegroundColor Green
    $checks["✓ Passed"] += "npm $npmVersion"
} catch {
    Write-Host "  ✗ Node.js not found in PATH" -ForegroundColor Red
    Write-Host "     Install from: https://nodejs.org/" -ForegroundColor Yellow
    $checks["✗ Failed"] += "Node.js installation"
}

# ==============================================================================
# 3. PYTHON CHECK
# ==============================================================================

Write-Host "`n[3] Python Environment" -ForegroundColor Yellow
Write-Host "──────────────────────" -ForegroundColor Gray

$pythonCmd = $null
$pythonVersion = $null

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

if ($pythonCmd) {
    $pyNumeric = [version]$pythonVersion
    if ($pyNumeric -ge [version]"3.8") {
        Write-Host "  ✓ Python $pythonVersion (cmd: $pythonCmd) (OK)" -ForegroundColor Green
        $checks["✓ Passed"] += "Python $pythonVersion"
    } else {
        Write-Host "  ✗ Python $pythonVersion (NEED 3.8+)" -ForegroundColor Red
        $checks["✗ Failed"] += "Python version"
    }
} else {
    Write-Host "  ⚠ Python not found in PATH" -ForegroundColor Yellow
    Write-Host "     Music features may not work on Wispbyte without Python" -ForegroundColor Yellow
    Write-Host "     Install from: https://www.python.org/" -ForegroundColor Yellow
    Write-Host "     Or use: scoop install python" -ForegroundColor Gray
    $checks["⚠ Warning"] += "Python installation"
}

# ==============================================================================
# 4. DEPENDENCIES CHECK
# ==============================================================================

Write-Host "`n[4] Node.js Dependencies" -ForegroundColor Yellow
Write-Host "────────────────────────" -ForegroundColor Gray

if (Test-Path "package-lock.json") {
    Write-Host "  ✓ package-lock.json exists" -ForegroundColor Green
    $checks["✓ Passed"] += "package-lock.json"
} else {
    Write-Host "  ⚠ package-lock.json missing" -ForegroundColor Yellow
    Write-Host "    Run: npm install (to generate lockfile)" -ForegroundColor Gray
    $checks["⚠ Warning"] += "package-lock.json"
}

if (Test-Path "node_modules") {
    $moduleCount = (Get-ChildItem node_modules -Directory).Count
    Write-Host "  ✓ node_modules exists ($moduleCount packages)" -ForegroundColor Green
    $checks["✓ Passed"] += "node_modules"
    
    # Check for critical packages
    $critical = @("discord.js", "discord-player", "dotenv")
    foreach ($pkg in $critical) {
        if (Test-Path "node_modules/$pkg") {
            Write-Host "    ✓ $pkg" -ForegroundColor DarkGreen
        } else {
            Write-Host "    ✗ $pkg (MISSING)" -ForegroundColor Red
            $checks["✗ Failed"] += "$pkg package"
        }
    }
} else {
    Write-Host "  ⚠ node_modules not found" -ForegroundColor Yellow
    Write-Host "    Run: npm install" -ForegroundColor Gray
    $checks["⚠ Warning"] += "node_modules"
}

# Python requirements
Write-Host "`n[5] Python Requirements" -ForegroundColor Yellow
Write-Host "──────────────────────" -ForegroundColor Gray

if (Test-Path "requirements.txt") {
    Write-Host "  ✓ requirements.txt exists" -ForegroundColor Green
    $checks["✓ Passed"] += "requirements.txt"
    
    $packages = @("yt-dlp", "aiohttp", "python-dotenv")
    $content = Get-Content "requirements.txt"
    foreach ($pkg in $packages) {
        if ($content -match $pkg) {
            Write-Host "    ✓ $pkg" -ForegroundColor DarkGreen
        } else {
            Write-Host "    ⚠ $pkg not found" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "  ⚠ requirements.txt missing" -ForegroundColor Yellow
    $checks["⚠ Warning"] += "requirements.txt"
}

if ($pythonCmd -and (Test-Path "venv")) {
    Write-Host "  ✓ Python venv exists" -ForegroundColor Green
    $checks["✓ Passed"] += "Python venv"
} else {
    Write-Host "  ⚠ Python venv not created" -ForegroundColor Yellow
    Write-Host "    Scripts will create it on first run" -ForegroundColor Gray
    $checks["⚠ Warning"] += "Python venv"
}

# ==============================================================================
# 6. ENVIRONMENT CONFIGURATION
# ==============================================================================

Write-Host "`n[6] Environment Configuration" -ForegroundColor Yellow
Write-Host "─────────────────────────────" -ForegroundColor Gray

if (Test-Path ".env") {
    Write-Host "  ✓ .env file exists" -ForegroundColor Green
    $checks["✓ Passed"] += ".env file"
    
    $envContent = Get-Content ".env"
    $hasToken = $envContent -match "DISCORD_TOKEN"
    $hasClientId = $envContent -match "CLIENT_ID"
    $hasPort = $envContent -match "PORT"
    
    if ($hasToken) {
        Write-Host "    ✓ DISCORD_TOKEN configured" -ForegroundColor DarkGreen
    } else {
        Write-Host "    ✗ DISCORD_TOKEN missing" -ForegroundColor Red
        $checks["✗ Failed"] += "DISCORD_TOKEN"
    }
    
    if ($hasClientId) {
        Write-Host "    ✓ CLIENT_ID configured" -ForegroundColor DarkGreen
    } else {
        Write-Host "    ✗ CLIENT_ID missing" -ForegroundColor Red
        $checks["✗ Failed"] += "CLIENT_ID"
    }
    
    if ($hasPort) {
        Write-Host "    ✓ PORT configured" -ForegroundColor DarkGreen
    } else {
        Write-Host "    ⚠ PORT not set (default: 3000)" -ForegroundColor Yellow
        $checks["⚠ Warning"] += "PORT configuration"
    }
} else {
    Write-Host "  ✗ .env file missing (REQUIRED)" -ForegroundColor Red
    Write-Host "    Create .env with your bot tokens" -ForegroundColor Yellow
    $checks["✗ Failed"] += ".env file"
}

# ==============================================================================
# 7. STARTUP SCRIPTS
# ==============================================================================

Write-Host "`n[7] Startup Scripts" -ForegroundColor Yellow
Write-Host "──────────────────" -ForegroundColor Gray

$scripts = @(
    "start.sh",
    "start.ps1",
    "start.bat"
)

foreach ($script in $scripts) {
    if (Test-Path $script) {
        Write-Host "  ✓ $script" -ForegroundColor Green
        $checks["✓ Passed"] += $script
    } else {
        Write-Host "  ✗ $script (missing)" -ForegroundColor Red
        $checks["✗ Failed"] += $script
    }
}

# ==============================================================================
# 8. BINARY DEPENDENCIES
# ==============================================================================

Write-Host "`n[8] Binary Dependencies" -ForegroundColor Yellow
Write-Host "──────────────────────" -ForegroundColor Gray

if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
    $ffmpegVer = ffmpeg -version 2>&1 | Select-Object -First 1
    Write-Host "  ✓ ffmpeg (in PATH)" -ForegroundColor Green
    $checks["✓ Passed"] += "ffmpeg"
} elseif (Test-Path "bin/ffmpeg.exe" -or Test-Path "bin/ffmpeg") {
    Write-Host "  ✓ ffmpeg (in ./bin/)" -ForegroundColor Green
    $checks["✓ Passed"] += "ffmpeg"
} else {
    Write-Host "  ⚠ ffmpeg not found" -ForegroundColor Yellow
    Write-Host "    Music playback may fail without ffmpeg" -ForegroundColor Gray
    $checks["⚠ Warning"] += "ffmpeg"
}

if (Get-Command yt-dlp -ErrorAction SilentlyContinue) {
    $ytdlpVer = yt-dlp --version 2>&1 | Select-Object -First 1
    Write-Host "  ✓ yt-dlp (in PATH): $ytdlpVer" -ForegroundColor Green
    $checks["✓ Passed"] += "yt-dlp"
} elseif (Test-Path "bin/yt-dlp.exe" -or Test-Path "bin/yt-dlp") {
    Write-Host "  ✓ yt-dlp (in ./bin/)" -ForegroundColor Green
    $checks["✓ Passed"] += "yt-dlp"
} else {
    Write-Host "  ⚠ yt-dlp not found" -ForegroundColor Yellow
    Write-Host "    Will download on first run" -ForegroundColor Gray
    $checks["⚠ Warning"] += "yt-dlp"
}

# ==============================================================================
# 9. GIT STATUS
# ==============================================================================

if (Get-Command git -ErrorAction SilentlyContinue) {
    Write-Host "`n[9] Git Status" -ForegroundColor Yellow
    Write-Host "──────────────" -ForegroundColor Gray
    
    try {
        $status = git status --porcelain 2>&1
        if ($status) {
            $lines = ($status | Measure-Object -Line).Lines
            Write-Host "  ⚠ $lines uncommitted changes" -ForegroundColor Yellow
            $checks["⚠ Warning"] += "Uncommitted changes"
        } else {
            Write-Host "  ✓ Git working directory clean" -ForegroundColor Green
            $checks["✓ Passed"] += "Git status"
        }
    } catch {
        Write-Host "  ⚠ Git error (not a repo?)" -ForegroundColor Yellow
    }
}

# ==============================================================================
# 10. SUMMARY
# ==============================================================================

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

Write-Host "`n✓ Passed: $($checks['✓ Passed'].Count)" -ForegroundColor Green
foreach ($item in $checks["✓ Passed"] | Select-Object -First 5) {
    Write-Host "  • $item" -ForegroundColor DarkGreen
}
if ($checks["✓ Passed"].Count -gt 5) {
    Write-Host "  ... and $($checks['✓ Passed'].Count - 5) more" -ForegroundColor DarkGreen
}

if ($checks["✗ Failed"].Count -gt 0) {
    Write-Host "`n✗ Failed: $($checks['✗ Failed'].Count)" -ForegroundColor Red
    foreach ($item in $checks["✗ Failed"]) {
        Write-Host "  • $item" -ForegroundColor Red
    }
}

if ($checks["⚠ Warning"].Count -gt 0) {
    Write-Host "`n⚠ Warnings: $($checks['⚠ Warning'].Count)" -ForegroundColor Yellow
    foreach ($item in $checks["⚠ Warning"]) {
        Write-Host "  • $item" -ForegroundColor Yellow
    }
}

# ==============================================================================
# DEPLOYMENT READINESS
# ==============================================================================

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Deployment Readiness" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$failCount = $checks["✗ Failed"].Count
$warnCount = $checks["⚠ Warning"].Count

if ($failCount -eq 0) {
    Write-Host "`n✓ Your bot is READY for Wispbyte deployment!`n" -ForegroundColor Green
    
    if ($warnCount -gt 0) {
        Write-Host "⚠ Note: You have $warnCount warning(s)" -ForegroundColor Yellow
        Write-Host "  These may cause issues but aren't critical.`n" -ForegroundColor Yellow
    }
    
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Commit changes: git add . && git commit -m 'Add startup scripts'" -ForegroundColor Gray
    Write-Host "  2. Upload to Wispbyte (via git or file manager)" -ForegroundColor Gray
    Write-Host "  3. Set startup command to: bash start.sh" -ForegroundColor Gray
    Write-Host "  4. Monitor logs for '[start] Starting DarkBot...'" -ForegroundColor Gray
    
    exit 0
} else {
    Write-Host "`n✗ Your bot has $failCount critical issue(s) that must be fixed!`n" -ForegroundColor Red
    Write-Host "Please resolve the failures above before deployment." -ForegroundColor Red
    
    if ($FixIssues) {
        Write-Host "`n[auto-fix] Attempting to fix issues..." -ForegroundColor Yellow
        
        if (-not (Test-Path ".env")) {
            Write-Host "[auto-fix] Creating .env template..." -ForegroundColor Cyan
            @"
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here
PORT=3000
"@ | Out-File -FilePath ".env" -Encoding UTF8
            Write-Host "[auto-fix] Created .env (EDIT THIS FILE!)" -ForegroundColor Green
        }
        
        if (-not (Test-Path "node_modules")) {
            Write-Host "[auto-fix] Installing Node.js dependencies..." -ForegroundColor Cyan
            npm install
        }
        
        if ($pythonCmd -and -not (Test-Path "venv")) {
            Write-Host "[auto-fix] Creating Python virtual environment..." -ForegroundColor Cyan
            & $pythonCmd -m venv venv
            & ".\venv\Scripts\Activate.ps1"
            & $pythonCmd -m pip install -r requirements.txt
        }
    }
    
    exit 1
}
