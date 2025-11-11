const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const _RESOLVE_PROMISES = new Map();
const _RESOLVE_CACHE = new Map();
const RESOLVE_TTL_MS = 5 * 60 * 1000;

function looksLikeUrl(str) { try { new URL(str); return true; } catch { return false; } }

/* ------------------------------ yt-dlp binary ----------------------------- */
const YTDLP_BASE = process.env.YTDLP_PATH || path.resolve(__dirname, '..', 'bin', 'yt-dlp');
const YTDLP = (process.platform === 'win32' && fs.existsSync(YTDLP_BASE + '.exe')) ? (YTDLP_BASE + '.exe') : YTDLP_BASE;
function ensureExec(p) { try { const st = fs.statSync(p); if ((st.mode & 0o111) === 0) fs.chmodSync(p, 0o755); } catch {} }
function have(p) { try { return fs.existsSync(p); } catch { return false; } }

function ytdlp(args, { json = true } = {}) {
  ensureExec(YTDLP);
  return new Promise((resolve, reject) => {
    if (!have(YTDLP)) return reject(new Error('yt-dlp binary not found at ' + YTDLP));
    const p = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('close', (code) => {
      if (code === 0) {
        if (!json) return resolve(out);
        try { resolve(JSON.parse(out)); }
        catch { reject(new Error('Invalid JSON from yt-dlp')); }
      } else {
        reject(new Error((err || '').trim() || `yt-dlp exited ${code}`));
      }
    });
    p.on('error', (e) => reject(e));
  });
}

// single item resolve (no playlist) → fast
async function ytdlpInfo(queryOrSearch) {
  const args = [
    '--default-search', 'ytsearch',
    '-J',
    '--no-playlist',
    '-f', 'bestaudio[acodec=opus][abr>=64]/bestaudio[acodec=opus]/bestaudio/best',
    '--extractor-args', 'youtube:player_client=android',
    queryOrSearch
  ];
  const j = await ytdlp(args, { json: true });
  return Array.isArray(j?.entries) ? (j.entries[0] || j) : j;
}

/* --------------------------- YouTube playlist expand ---------------------- */
function toYouTubePlaylistURL(input) {
  try {
    const u = new URL(input);
    const host = u.hostname.replace(/^www\./, '');
    if ((host.includes('youtube.com') || host.includes('youtu.be')) && u.searchParams.has('list')) {
      const listId = u.searchParams.get('list');
      if (listId) return `https://www.youtube.com/playlist?list=${listId}`;
    }
  } catch {}
  return input;
}

async function expandYouTubePlaylist(playlistUrl) {
  const plURL = toYouTubePlaylistURL(playlistUrl);
  const args = ['-J','--yes-playlist','--flat-playlist','--playlist-start','1','--playlist-end','10000', plURL];
  const j = await ytdlp(args, { json: true });
  const entries = Array.isArray(j?.entries) ? j.entries : [];
  return entries
    .filter(e => e && (e.url || e.id))
    .map(e => {
      let page;
      if (e.url && typeof e.url === 'string' && e.url.startsWith('http')) page = e.url;
      else {
        const id = e.id || e.url || '';
        page = id ? `https://www.youtube.com/watch?v=${id}` : null;
      }
      let thumb = null;
      const thumbs = Array.isArray(e.thumbnails) ? e.thumbnails : (Array.isArray(e.thumbnail) ? e.thumbnail : null);
      if (thumbs && thumbs[0]) thumb = thumbs[0].url || thumbs[0];
      return { title: e.title || 'Untitled', webpage_url: page, thumbnail: thumb, duration: null };
    })
    .filter(t => t.webpage_url);
}

/* ---------------------------- Spotify expand (no API) --------------------- */
function parseSpotifyEntry(e) {
  const name = e?.title || e?.track || e?.name || 'Untitled';
  const artist =
    (Array.isArray(e?.artists) && e.artists.map(a => a?.name || a)[0]) ||
    e?.artist ||
    (Array.isArray(e?.author) && e.author[0]) ||
    e?.uploader || '';
  const title = [artist, name].filter(Boolean).join(' - ') || name;

  let page = null;
  if (typeof e?.url === 'string' && e.url.startsWith('http')) page = e.url;
  if (!page) {
    const id =
      (typeof e?.id === 'string' && e.id.startsWith('spotify:track:')) ? e.id.split(':').pop() :
      (typeof e?.url === 'string' && e.url.startsWith('spotify:track:')) ? e.url.split(':').pop() :
      (typeof e?.id === 'string' && !e.id.includes(':')) ? e.id : null;
    if (id) page = `https://open.spotify.com/track/${id}`;
  }
  return { title, webpage_url: page || null, thumbnail: null, duration: null };
}

async function expandSpotifyPlaylist_try(args) {
  try {
    const j = await ytdlp(args, { json: true });
    const entries = Array.isArray(j?.entries) ? j.entries : [];
    return entries.map(parseSpotifyEntry).filter(t => !!t.title);
  } catch { return []; }
}

async function expandSpotifyPlaylist(spotifyUrl) {
  const attempts = [
    ['--ignore-config','-J','--yes-playlist','--flat-playlist','--extractor-args','spotify:playlist_items=0-2000,album_items=0-2000', spotifyUrl],
    ['--ignore-config','-J','--yes-playlist','--extractor-args','spotify:playlist_items=0-2000,album_items=0-2000', spotifyUrl],
    ['--ignore-config','-J','--yes-playlist','--flat-playlist','--playlist-items','1-2000', spotifyUrl],
    ['--ignore-config','-J','--yes-playlist','--flat-playlist','--extractor-args','spotify:use_api=none,playlist_items=0-2000,album_items=0-2000', spotifyUrl],
  ];
  for (const args of attempts) {
    const items = await expandSpotifyPlaylist_try(args);
    if (items.length > 1) return items;
  }
  const minimal = await expandSpotifyPlaylist_try(['--ignore-config','-J','--yes-playlist', spotifyUrl]);
  return minimal.length ? minimal : [];
}

/* ------------------------------- cache utils ------------------------------ */
function _getCachedResolve(query) {
  const rec = _RESOLVE_CACHE.get(query);
  if (!rec) return null;
  if ((Date.now() - rec.t) < RESOLVE_TTL_MS) return rec.json;
  _RESOLVE_CACHE.delete(query);
  return null;
}

/* --------------------------------- public -------------------------------- */
async function pyResolve(query) {
  const hit = _getCachedResolve(query);
  if (hit) return hit;
  if (_RESOLVE_PROMISES.has(query)) return _RESOLVE_PROMISES.get(query);

  const p = (async () => {
    try {
      let basis = String(query || '').trim();
      if (!basis) return { ok: false, error: 'Empty query' };

      // If Spotify TRACK URL → convert to a title for YouTube search via oEmbed
      const isSpotify = /(^https?:\/\/)?(open\.)?spotify\.com\//i.test(basis);
      if (isSpotify && /\/track\//i.test(basis)) {
        try {
          const ctl = new AbortController();
          const to = setTimeout(() => ctl.abort(), 400);
          const r = await fetch('https://open.spotify.com/oembed?url=' + encodeURIComponent(basis), { signal: ctl.signal });
          clearTimeout(to);
          if (r.ok) {
            const j = await r.json();
            const t = typeof j.title === 'string' ? j.title.replace(/\s*–\s*/g, ' ').trim() : null;
            if (t) basis = t;
          }
        } catch {}
      }

      const q = looksLikeUrl(basis) ? basis : `ytsearch1:${basis}`;
      const info = await ytdlpInfo(q);

      const pageUrl = info?.webpage_url || info?.original_url || info?.url || basis;
      const title = info?.title || null;
      const thumb = info?.thumbnail || null;
      const duration = typeof info?.duration === 'number' ? info.duration : null;

      let direct = info?.url || null;
      if (!direct && Array.isArray(info?.formats)) {
        const audio = info.formats
          .filter(f => f && f.url && f.acodec && f.acodec !== 'none')
          .sort((a, b) => (b.abr || 0) - (a.abr || 0));
        direct = audio[0]?.url || null;
      }
      if (!direct) throw new Error('No direct audio stream URL found');

      return { ok: true, stream_url: direct, webpage_url: pageUrl, title, thumbnail: thumb, duration };
    } catch (error) {
      return { ok: false, error: String(error && error.message ? error.message : error) };
    }
  })();

  _RESOLVE_PROMISES.set(query, p);
  try {
    const json = await p;
    _RESOLVE_CACHE.set(query, { json, t: Date.now() });
    return json;
  } finally {
    _RESOLVE_PROMISES.delete(query);
  }
}

module.exports = { pyResolve, expandYouTubePlaylist, expandSpotifyPlaylist };