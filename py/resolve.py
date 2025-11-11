#!/usr/bin/env python3
import argparse, json, yt_dlp, sys, re

URL_RE = re.compile(r'^(?:https?://|//)')

def is_url(s: str) -> bool:
    return bool(URL_RE.match(s or ''))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--query", required=True)
    args = ap.parse_args()
    q = (args.query or "").strip()

    # Use single-result search to avoid fetching/normalizing a whole list
    search_or_url = q if is_url(q) else f"ytsearch1:{q}"

    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "skip_download": True,
        "extract_flat": False,            # we need a real URL
        "format": "bestaudio/best",       # let yt-dlp pick and expose info["url"]
        "socket_timeout": 7,
        "retries": 2,
        # To experiment with YouTube client selection (can be faster in some regions):
        # "extractor_args": {"youtube": {"player_client": ["android"]}},
    }

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(search_or_url, download=False)

            if isinstance(info, dict) and "entries" in info and info["entries"]:
                info = info["entries"][0]

            title = info.get("title") or "Unknown title"
            page = info.get("webpage_url") or info.get("original_url") or q
            thumb = info.get("thumbnail")
            dur = info.get("duration")

            stream_url = info.get("url")  # provided by format="bestaudio/best"
            if not stream_url:
                # Rare fallback: pick highest-abr audio manually
                fmts = info.get("formats") or []
                audio = [f for f in fmts if f.get("acodec") not in (None, "none") and f.get("url")]
                audio.sort(key=lambda f: (f.get("abr") or 0), reverse=True)
                stream_url = audio[0]["url"] if audio else None

            if not stream_url:
                raise RuntimeError("No direct audio stream URL found")

        print(json.dumps({
            "ok": True,
            "title": title,
            "webpage_url": page,
            "thumbnail": thumb,
            "duration": dur,
            "stream_url": stream_url
        }))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()