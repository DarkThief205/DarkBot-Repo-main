# DarkBot - Multi-Language Startup Scripts

This directory now includes enhanced startup scripts that handle both **Node.js** (Discord.js bot) and **Python** (yt-dlp music resolution) environments. These scripts are designed to work with **Wispbyte** and other hosting platforms that don't natively support dual-language projects.

## Files Overview

### 1. **start.sh** (Main Entry Point)
- **Universal bash script** that works on both Linux and Windows
- Detects your operating system automatically
- Routes to appropriate startup method:
  - **Windows**: Calls `start.ps1` (PowerShell) or `start.bat` (batch fallback)
  - **Linux**: Handles Node.js + Python setup directly in bash

### 2. **start.ps1** (PowerShell Script - Windows)
- **Recommended for Windows hosting** (Wispbyte, etc.)
- Comprehensive setup with detailed logging
- Features:
  - Automatic Node.js detection and dependency installation
  - Python virtual environment creation and activation
  - Automatic Python package installation from `requirements.txt`
  - Binary dependency checks (ffmpeg, yt-dlp)
  - Environment variable loading from `.env`
  - Graceful error handling with color-coded output

### 3. **start.bat** (Batch Script - Windows Fallback)
- **Fallback for systems without PowerShell**
- Basic setup without as many features
- Good for minimal Windows environments

## Environment Requirements

### Node.js (Required)
- **Version**: 18+
- **Purpose**: Discord.js bot framework
- **Dependencies**: Installed via `npm install`

### Python (Required for Music)
- **Version**: 3.8+
- **Purpose**: yt-dlp (YouTube/Spotify music resolution)
- **Dependencies**: Installed via `pip install -r requirements.txt`

### Required Files
```
.env                  # Discord token and bot configuration
requirements.txt      # Python dependencies (yt-dlp, aiohttp, etc.)
package.json         # Node.js dependencies
package-lock.json    # (Recommended for consistency)
```

## How to Use on Wispbyte

### Step 1: Upload Files
Upload your entire project to Wispbyte including the new startup scripts:
- `start.sh` (main entry point)
- `start.ps1` (PowerShell script)
- `start.bat` (batch fallback)
- All other project files

### Step 2: Configure Wispbyte
In Wispbyte hosting panel:

**Option A: If you can run custom startup command**
```
bash start.sh
```

**Option B: If Wispbyte auto-detects from package.json**
- The `package.json` already has `"start": "node index.js"` script
- But you MUST ensure Python is also available

### Step 3: Ensure Dependencies
Make sure your `.env` file contains:
```
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_client_id
PORT=3000
```

### Step 4: Monitor Logs
Watch the startup logs for these success indicators:
```
[start] Node: v18.x.x (or higher)
[node] Npm:  9.x.x (or higher)
[python] Python: 3.x.x
[python] Virtual environment activated ✓
[python] Python dependencies installed ✓
[start] Starting DarkBot...
```

## Troubleshooting

### Issue: "Bot plays music locally but fails on Wispbyte"

**Likely Cause**: Python or yt-dlp not available on hosting platform

**Solutions**:
1. **Check Wispbyte Support**:
   - Contact Wispbyte to confirm Python is installed
   - Ask about custom binary support (ffmpeg, yt-dlp)

2. **Install Python Manually** (if Wispbyte allows):
   - PowerShell script attempts automatic Python installation
   - May need to use `scoop` or `choco` (Windows)
   - For Linux: `apt install python3 python3-venv`

3. **Download Binaries** (if direct install fails):
   - Script auto-downloads `yt-dlp.exe` for Windows
   - For Linux: Script auto-downloads `yt-dlp_linux`
   - Ensure `ffmpeg` is available in system PATH or in `./bin/`

4. **Alternative Approach** - Use Discord-Player Only:
   - Modify `music.js` to use Discord-Player's built-in extractors
   - Remove dependency on Python/yt-dlp for standalone extraction
   - Requires code changes (not covered here)

### Issue: "PowerShell execution policy error"

**Solution**: The script includes `-ExecutionPolicy Bypass` flag
- If still blocked, Wispbyte may need to be configured differently
- Fallback to `start.bat` instead

### Issue: "npm: command not found" or "python: command not found"

**Solution**: These tools aren't in system PATH
- Contact Wispbyte support - they must have Node.js installed
- Ask about Python availability or alternative music sources

### Issue: "Virtual environment activation fails"

**Solution**:
- Check if `venv` directory exists
- Try deleting `venv` and letting script recreate it
- Verify Python is functional: `python --version`

## Script Features

### Automatic Downloads
- **yt-dlp**: Downloaded from GitHub releases if missing
- **ffmpeg**: Checked in system PATH and `./bin/`

### Smart Dependency Management
- Detects and uses `package-lock.json` if available
- Falls back to fresh `npm install` if needed
- Retries with different flags on failure
- Rebuilds native modules for your platform

### Environment Variable Handling
- Loads `.env` file automatically
- Sets Python environment variables for optimal performance
  - `PYTHONUNBUFFERED=1` (realtime output)
  - `PYTHONDONTWRITEBYTECODE=1` (no .pyc files)

### Comprehensive Logging
- Color-coded output (Green ✓ for success, Red ✗ for errors)
- Timestamps and progress indicators
- Helps diagnose issues quickly

## File Structure
```
DarkBot-Repo-main/
├── start.sh           # Main entry point (bash)
├── start.ps1          # PowerShell startup script
├── start.bat          # Batch fallback script
├── index.js           # Main bot file
├── package.json       # Node.js dependencies
├── requirements.txt   # Python dependencies
├── .env               # Configuration (keep secret!)
├── commands/          # Discord commands
├── src/
│   ├── player.djs.js  # Discord-player setup
│   └── pybridge.js    # Python bridge (yt-dlp)
├── py/
│   └── resolve.py     # Python music resolver
├── bin/               # Bundled binaries
│   ├── ffmpeg         # Audio codec
│   └── yt-dlp         # Music resolver
└── ...
```

## Support

If you encounter issues:

1. **Check Logs**: Read startup script output carefully
2. **Test Locally**: Verify everything works on your machine first
3. **Verify .env**: Ensure `DISCORD_TOKEN` and `CLIENT_ID` are set
4. **Contact Wispbyte**: Ask about:
   - Node.js version available
   - Python 3 availability
   - Custom binary support (ffmpeg, yt-dlp)
   - PowerShell availability (recommended)

## Notes

- ✅ **Tested with**: Node 18+, Python 3.8-3.12, Windows 10/11
- ✅ **Compatible with**: Linux (bash), macOS (bash), Windows (PowerShell/batch)
- ⚠️ **Wispbyte Specific**: May need to request Python or dual-language support
- 🔧 **Customizable**: Edit scripts to add/remove features as needed

---

**Last Updated**: November 2025
