@echo off
REM DarkBot Multi-Language Startup Script (Batch Wrapper)
REM For systems where PowerShell may not be available

setlocal enabledelayedexpansion

echo.
echo [start] Windows Batch Startup Script
echo [start] Working Directory: %CD%
echo.

REM Check if package.json exists
if not exist package.json (
    echo [error] package.json not found
    exit /b 1
)

echo [node] Checking Node.js installation...
node --version >nul 2>&1
if errorlevel 1 (
    echo [error] Node.js not found. Please install Node.js 18+
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
for /f "tokens=*" %%i in ('npm --version') do set NPM_VER=%%i
echo [node] Node: %NODE_VER%
echo [node] Npm:  %NPM_VER%

REM Clean node_modules if no lockfile
if exist node_modules (
    if not exist package-lock.json (
        echo [deps] Cleaning node_modules (no lockfile)...
        rmdir /s /q node_modules
    )
)

echo [deps] Installing Node.js dependencies...
if exist package-lock.json (
    call npm ci --omit=dev --legacy-peer-deps
) else (
    call npm install --omit=dev --no-audit --no-fund --legacy-peer-deps
)

if errorlevel 1 (
    echo [deps] npm install failed
    exit /b 1
)

echo [deps] Native modules rebuilt
npm rebuild 2>nul

REM Check Python
echo.
echo [python] Checking Python installation...
python --version >nul 2>&1
if errorlevel 1 (
    python3 --version >nul 2>&1
    if errorlevel 1 (
        echo [python] ERROR: Python not found
        exit /b 1
    )
    set PYTHON_CMD=python3
) else (
    set PYTHON_CMD=python
)

for /f "tokens=*" %%i in ('%PYTHON_CMD% --version') do set PYTHON_VER=%%i
echo [python] %PYTHON_VER%

REM Create virtual environment
if not exist venv (
    echo [python] Creating virtual environment...
    %PYTHON_CMD% -m venv venv
)

echo [python] Activating virtual environment...
call venv\Scripts\activate.bat

REM Install Python requirements
if exist requirements.txt (
    echo [python] Installing Python dependencies...
    %PYTHON_CMD% -m pip install --upgrade pip setuptools wheel -q
    %PYTHON_CMD% -m pip install -r requirements.txt -q
)

REM Load environment variables from .env
if exist .env (
    echo [env] Loading .env file...
    for /f "delims==" %%a in (type .env ^| findstr /v "^#") do (
        set "%%a"
    )
)

set PYTHONUNBUFFERED=1
set PYTHONDONTWRITEBYTECODE=1

REM Create bin directory
if not exist bin mkdir bin

echo.
echo [start] ========================================
echo [start] Starting DarkBot...
echo [start] ========================================
echo.

REM Run the bot
node index.js
