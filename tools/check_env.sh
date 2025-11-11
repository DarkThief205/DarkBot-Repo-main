#!/usr/bin/env bash
set -euo pipefail

echo "== Environment quick check =="
printf "Node:  "; node --version 2>/dev/null || echo "(not found)"
printf "Npm:   "; npm --version 2>/dev/null || echo "(not found)"

echo "\n== Binaries =="
if command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg: found in PATH -> $(command -v ffmpeg)"
  ffmpeg -version | head -n 1
else
  echo "ffmpeg: NOT in PATH"
fi

if [ -f ./bin/ffmpeg ]; then
  echo "bin/ffmpeg: exists -> ./bin/ffmpeg"
  ./bin/ffmpeg -version 2>/dev/null | head -n 1 || true
else
  echo "bin/ffmpeg: not present"
fi

if [ -f ./bin/yt-dlp ]; then
  echo "bin/yt-dlp: exists -> ./bin/yt-dlp"
  ./bin/yt-dlp --version || true
else
  echo "bin/yt-dlp: not present"
fi

if command -v yt-dlp >/dev/null 2>&1; then
  echo "yt-dlp: found in PATH -> $(command -v yt-dlp)"
  yt-dlp --version || true
else
  echo "yt-dlp: not in PATH"
fi

echo "\n== Python =="
if command -v python >/dev/null 2>&1; then
  python --version
  python -m pip --version || true
else
  echo "python: not found"
fi

if command -v python3 >/dev/null 2>&1; then
  python3 --version
  python3 -m pip --version || true
else
  echo "python3: not found"
fi

# test a lightweight yt-dlp JSON probe via the binary (does not download)
SAMPLE_URL="ytsearch1:rick astley - never gonna give you up"
if [ -f ./bin/yt-dlp ]; then
  echo "\n== yt-dlp JSON probe (bin/yt-dlp) =="
  ./bin/yt-dlp -J --no-playlist "${SAMPLE_URL}" | jq '.webpage_url, .title, .duration' 2>/dev/null || echo "(yt-dlp probe failed or jq not installed)"
elif command -v yt-dlp >/dev/null 2>&1; then
  echo "\n== yt-dlp JSON probe (system yt-dlp) =="
  yt-dlp -J --no-playlist "${SAMPLE_URL}" | jq '.webpage_url, .title, .duration' 2>/dev/null || echo "(yt-dlp probe failed or jq not installed)"
else
  echo "\n== yt-dlp probe skipped (no yt-dlp) =="
fi

echo "\n== Files/Permissions =="
ls -la . | sed -n '1,120p'
ls -la ./bin || true

echo "\n== End of check =="
