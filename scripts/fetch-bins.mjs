// scripts/fetch-bins.mjs
import { createWriteStream, chmodSync } from "node:fs";
import { pipeline } from "node:stream";
import { promisify } from "node:util";
import https from "node:https";
import { mkdirSync } from "node:fs";

const pipe = promisify(pipeline);
mkdirSync("./bin", { recursive: true });

function dl(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`GET ${url} ${res.statusCode}`));
      const file = createWriteStream(dest, { mode: 0o755 });
      pipe(res, file).then(() => resolve()).catch(reject);
    }).on("error", reject);
  });
}

// Pinned example URLs (replace with the latest stable you trust)
const YTDLP_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";
const FFMPEG_URL = "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"; // extract 'ffmpeg'

import { execSync } from "node:child_process";
await dl(YTDLP_URL, "./bin/yt-dlp");

await (async () => {
  // Download and extract static ffmpeg, pick the 'ffmpeg' binary
  const tarball = "./bin/ffmpeg.tar.xz";
  await dl(FFMPEG_URL, tarball);
  execSync(`tar -xf ${tarball} -C ./bin`);
  const dir = execSync(`ls -d bin/ffmpeg-*-amd64-static`).toString().trim();
  execSync(`cp ${dir}/ffmpeg ./bin/ffmpeg`);
  chmodSync("./bin/ffmpeg", 0o755);
})();
