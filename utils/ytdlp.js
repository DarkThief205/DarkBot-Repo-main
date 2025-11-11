// utils/ytdlp.js (CommonJS)
const { spawn } = require("node:child_process");
const { statSync, chmodSync } = require("node:fs");
const path = require("node:path");
const ffmpegPath = require("ffmpeg-static");

const YTDLP = process.env.YTDLP_PATH || path.resolve(__dirname, "..", "bin", "yt-dlp");
const FFMPEG = process.env.FFMPEG_PATH || ffmpegPath || path.resolve(__dirname, "..", "bin", "ffmpeg");

function ensureExec(p) {
  try {
    const st = statSync(p);
    if ((st.mode & 0o111) === 0) chmodSync(p, 0o755);
  } catch {}
}

// Return a Readable stream (48kHz s16le PCM) suitable for Discord
function streamAudio(url) {
  ensureExec(YTDLP);
  ensureExec(FFMPEG);

  const ytdlp = spawn(
    YTDLP,
    ["-f", "bestaudio/best", "-o", "-", "--no-playlist", "--quiet", "--no-warnings", url],
    { stdio: ["ignore", "pipe", "inherit"] }
  );

  const ffmpeg = spawn(
    FFMPEG,
    ["-i", "pipe:0", "-ac", "2", "-ar", "48000", "-f", "s16le", "pipe:1"],
    { stdio: ["pipe", "pipe", "inherit"] }
  );

  ytdlp.stdout.pipe(ffmpeg.stdin);

  const kill = () => {
    try { ytdlp.kill("SIGKILL"); } catch {}
    try { ffmpeg.kill("SIGKILL"); } catch {}
  };
  ytdlp.on("close", kill);
  ffmpeg.on("error", kill);

  return ffmpeg.stdout;
}

// Minimal metadata fallback via yt-dlp -J
function getInfo(query) {
  ensureExec(YTDLP);
  return new Promise((resolve, reject) => {
    const p = spawn(YTDLP, ["-J", "--no-playlist", query], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", d => (out += d));
    p.stderr.on("data", d => (err += d));
    p.on("close", (code) => {
      if (code === 0) {
        try { resolve(JSON.parse(out)); } catch (e) { reject(e); }
      } else reject(new Error(err || `yt-dlp exited ${code}`));
    });
  });
}

module.exports = { streamAudio, getInfo };