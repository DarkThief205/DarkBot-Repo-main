# DarkBot - Quick Start Guide for Wispbyte

## The Problem
Your bot uses both **Node.js** (Discord.js) and **Python** (yt-dlp music). Wispbyte doesn't support dual-language projects by default.

## The Solution
New startup scripts that automatically handle both languages! ✨

---

## Quick Setup (5 minutes)

### 1️⃣ Run Pre-Deployment Check
```powershell
.\setup-wispbyte.ps1
```
This verifies everything is ready before uploading.

### 2️⃣ Review the .env File
Make sure your bot tokens are correct:
```
DISCORD_TOKEN=your_token_here
CLIENT_ID=your_client_id_here
PORT=3000
```

### 3️⃣ Upload to Wispbyte
Upload all files including:
- ✅ `start.sh` (main startup script)
- ✅ `start.ps1` (PowerShell launcher)
- ✅ `start.bat` (batch fallback)
- ✅ All other project files

### 4️⃣ Configure Startup Command
In Wispbyte panel, set the startup command to:
```
bash start.sh
```

### 5️⃣ Start Your Bot
Click "Start" and watch the logs for:
```
[start] Node: v18.x.x
[python] Python: 3.x.x
[start] Starting DarkBot...
```

---

## How It Works

```
Wispbyte runs: bash start.sh
    ↓
Script detects Windows/Linux
    ↓
Windows → PowerShell (start.ps1)  or  Linux → Bash setup
    ↓
Install Node.js dependencies
    ↓
Create Python virtual environment
    ↓
Install Python/yt-dlp
    ↓
Load .env configuration
    ↓
Start Discord bot (node index.js)
```

---

## What Each File Does

| File | Purpose |
|------|---------|
| `start.sh` | **Main entry point** - detects OS and routes to right startup |
| `start.ps1` | **PowerShell script** - handles full setup on Windows |
| `start.bat` | **Batch backup** - works if PowerShell unavailable |
| `setup-wispbyte.ps1` | **Verification script** - run locally to check everything |
| `STARTUP_GUIDE.md` | **Full documentation** - detailed explanations |

---

## Troubleshooting

### ❌ Bot starts but can't play music

**Check 1**: Is Python available?
- Wispbyte must have Python 3.8+ installed
- Contact Wispbyte support if unsure

**Check 2**: Is yt-dlp working?
- Look for these messages in logs:
  ```
  [python] Python: 3.x.x ✓
  [python] Python dependencies installed ✓
  ```

**Check 3**: Check the logs for errors
- Look for red `[error]` messages
- Screenshot and share with Wispbyte support

### ❌ PowerShell execution policy error

**Solution**: Use `start.bat` instead
- Not the problem if you see that error - script handles it

### ❌ "Node.js not found" or "npm not found"

**Solution**: Contact Wispbyte support
- Node.js 18+ is required
- Must be in system PATH

---

## Features Included

✅ **Automatic Setup**
- Detects Node.js version
- Checks for Python 3.8+
- Creates virtual environments
- Installs all dependencies

✅ **Smart Error Handling**
- Color-coded output (Green ✓ Red ✗)
- Detailed error messages
- Graceful fallbacks

✅ **Binary Management**
- Auto-downloads yt-dlp if missing
- Checks ffmpeg availability
- Works with local or system binaries

✅ **Environment Handling**
- Loads .env configuration
- Sets Python environment variables
- Optimizes for performance

✅ **Cross-Platform**
- Works on Windows (PowerShell/Batch)
- Works on Linux (Bash)
- Auto-detects your OS

---

## Pre-Flight Checklist

Before uploading to Wispbyte:

- [ ] Run `.\setup-wispbyte.ps1` locally
- [ ] All checks show ✓ (green)
- [ ] Edit `.env` with your bot tokens
- [ ] Test locally: `npm start`
- [ ] Bot plays music locally
- [ ] Commit changes: `git commit -m "Setup for Wispbyte"`
- [ ] Upload to Wispbyte
- [ ] Check startup logs in Wispbyte panel

---

## Commands Reference

### Local Testing
```powershell
# Run startup script locally
.\start.ps1

# Or use the npm script
npm start
```

### Pre-Deployment Check
```powershell
# Full check
.\setup-wispbyte.ps1

# Quick check only
.\setup-wispbyte.ps1 -Quick

# Auto-fix issues
.\setup-wispbyte.ps1 -FixIssues
```

### Manual Python Setup
```powershell
# Create virtual environment
python -m venv venv

# Activate it
.\venv\Scripts\Activate.ps1

# Install requirements
pip install -r requirements.txt
```

---

## Still Having Issues?

1. **Check the logs carefully** - scroll through the full output
2. **Run the verification script** - `.\setup-wispbyte.ps1`
3. **Test locally first** - make sure everything works before deploying
4. **Contact Wispbyte support** with:
   - Screenshot of startup logs
   - Output from `setup-wispbyte.ps1`
   - List of installed software (Node.js version, Python version)

---

## Files You May Need to Edit

### `.env` (Configuration)
```env
# Discord Bot Token (required)
DISCORD_TOKEN=your_bot_token_here

# Discord Client ID (required)
CLIENT_ID=your_client_id_here

# Port for Express API (optional, default 3000)
PORT=3000

# Other bot settings...
```

### `requirements.txt` (Python Packages)
List of Python packages needed for music resolution:
- `yt-dlp` - YouTube/Spotify music resolver
- `aiohttp` - HTTP client
- `python-dotenv` - Environment variable loading
- `ffmpeg-python` - FFmpeg wrapper

### `package.json` (Node.js Packages)
Already configured with:
- `discord.js` - Discord bot framework
- `discord-player` - Music player
- `ffmpeg-static` - FFmpeg bundled

---

## Success Indicators

When your bot starts successfully on Wispbyte, you should see:

```
[start] Windows detected. Using PowerShell startup script...
[check] package.json found ✓
[node] Node: v20.x.x
[node] Npm: 10.x.x
[deps] Node.js dependencies installed ✓
[python] Python: 3.x.x
[python] Virtual environment activated ✓
[python] Python dependencies installed ✓
[env] Loading .env file…
[start] ========================================
[start] Starting DarkBot...
[start] ========================================

Logged in as YourBot#1234
```

Once you see `Logged in as`, your bot is running! 🎉

---

## Need More Help?

📖 **Full Documentation**: Read `STARTUP_GUIDE.md`
💬 **Wispbyte Support**: Contact them about Python/dual-language support
📝 **GitHub**: Check project README for additional info

Good luck! 🚀
