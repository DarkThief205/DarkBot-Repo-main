#!/bin/bash
# DarkBot Multi-Language Startup Script
# Works on both Linux and Windows environments (Wispbyte compatible)

set -euo pipefail

# Detect OS
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" || "$OSTYPE" == "cygwin" ]]; then
    # Windows environment
    echo "[start] Windows detected. Using PowerShell startup script..."
    
    if command -v pwsh &> /dev/null; then
        # PowerShell Core available
        exec pwsh -NoProfile -ExecutionPolicy Bypass -File "./start.ps1"
    elif command -v powershell &> /dev/null; then
        # Windows PowerShell available
        exec powershell -NoProfile -ExecutionPolicy Bypass -File "./start.ps1"
    else
        # Fallback to batch file
        echo "[start] PowerShell not available. Using batch startup script..."
        exec cmd /c "start.bat"
    fi
else
    # Linux/Unix environment
    echo "[start] Linux detected. Setting up Node.js and Python environment..."
    
    cd "$(dirname "$0")" || exit 1
    
    # Validate prerequisites
    [ -f package.json ] || { echo "[error] package.json not found"; exit 1; }
    
    # Check Node.js
    echo "[node] Node: $(node -v)"
    echo "[node] Npm:  $(npm -v)"
    
    # Clean drift if no lockfile
    [ -d node_modules ] && [ ! -f package-lock.json ] && { echo "[deps] cleaning node_modules"; rm -rf node_modules; }
    
    # Install Node.js dependencies
    echo "[deps] installing Node.js dependencies…"
    if [ -f package-lock.json ]; then
        npm ci --omit=dev --legacy-peer-deps || npm ci --omit=dev
    else
        npm install --omit=dev --no-audit --no-fund --legacy-peer-deps || npm install --omit=dev --no-audit --no-fund
    fi
    
    echo "[deps] rebuilding native modules…"
    npm rebuild || true
    
    # Check Python
    PYTHON_CMD="python"
    if ! command -v python &> /dev/null; then
        if command -v python3 &> /dev/null; then
            PYTHON_CMD="python3"
        else
            echo "[python] WARNING: Python not found"
        fi
    fi
    
    echo "[python] Python: $($PYTHON_CMD --version 2>&1 || echo 'not found')"
    
    # Try to create virtual environment, fallback to system pip if it fails
        USING_VENV=false
        if [ -d venv ] && [ -f venv/bin/activate ]; then
            echo "[python] Activating existing virtual environment…"
            source venv/bin/activate
            USING_VENV=true
        else
            # Remove corrupted venv if it exists
            [ -d venv ] && rm -rf venv
        
            echo "[python] Creating virtual environment…"
            if $PYTHON_CMD -m venv venv 2>/dev/null && [ -f venv/bin/activate ]; then
                echo "[python] Virtual environment created ✓"
                source venv/bin/activate
                USING_VENV=true
            else
                echo "[python] venv creation failed, using system Python instead…"
                USING_VENV=false
            fi
        fi
    
    # Install Python requirements
    if [ -f requirements.txt ]; then
        echo "[python] installing Python dependencies…"
        $PYTHON_CMD -m pip install --upgrade pip -q 2>/dev/null || true
        $PYTHON_CMD -m pip install -r requirements.txt -q 2>/dev/null || echo "[python] WARNING: Some packages may not have installed"
        echo "[python] Python dependencies installed ✓"
    fi
    
    # Load .env file
    if [ -f .env ]; then
        echo "[env] Loading .env file…"
        export $(cat .env | grep -v '^#' | xargs)
    fi
    
    # Set Python environment variables
    export PYTHONUNBUFFERED=1
    export PYTHONDONTWRITEBYTECODE=1
    
    # Create bin directory
    mkdir -p bin
    
    # Download yt-dlp if missing
    if [ ! -f bin/yt-dlp ]; then
        echo "[bins] Downloading yt-dlp…"
        curl -L -o bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux || \
        wget -O bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux || \
        echo "[bins] WARNING: Failed to download yt-dlp"
        
        [ -f bin/yt-dlp ] && chmod +x bin/yt-dlp
    fi
    
    # Determine start command
    CMD=""
    if npm run -s 2>/dev/null | grep -qE "^[[:space:]]*start$"; then
        CMD="npm run start"
    elif [ -f dist/index.js ]; then
        CMD="node dist/index.js"
    elif [ -f build/index.js ]; then
        CMD="node build/index.js"
    elif [ -f index.js ]; then
        CMD="node index.js"
    elif [ -f bot.js ]; then
        CMD="node bot.js"
    else
        echo "[error] No start script or entry file found"
        exit 1
    fi
    
    echo "[start] ========================================"
    echo "[start] Starting DarkBot…"
    echo "[start] Command: $CMD"
    echo "[start] ========================================"
    echo ""
    
    exec $CMD
fi