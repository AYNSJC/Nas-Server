import os
import sys
import json
import argparse
import yt_dlp

# ─────────────────────────────────────────────────────────────────────
#  MusicExtractor v2 — Download audio from YouTube/YouTube Music
#  Supports: single videos, playlists, full channels
#  NEW: --list mode to browse videos (returns JSON for UI selection)
#  NEW: --artist flag to tag all tracks with a given artist name
#  Output formats: mp3 (default) | wav
# ─────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="Download or list audio from YouTube URLs")
    p.add_argument("--format", choices=["mp3", "wav"], default="mp3",
                   help="Output audio format (default: mp3)")
    p.add_argument("--quality", default="192",
                   help="MP3 bitrate quality, e.g. 192 or 320 (default: 192)")
    p.add_argument("--no-thumbnail", action="store_true",
                   help="Skip downloading album art / thumbnail (.webp)")
    p.add_argument("--allow-playlist", action="store_true",
                   help="Allow playlist/channel URLs (downloads all videos)")
    p.add_argument("--artist", default="",
                   help="Artist name to prefix all downloaded filenames (e.g. 'Taylor Swift')")
    p.add_argument("--source", choices=["videos", "releases", "both"], default="videos",
                   help="What to download from a channel: videos, releases, or both")
    p.add_argument("--limit", type=int, default=0,
                   help="Max number of videos to download (0 = all)")
    # ── Browse / list mode (no download, just return JSON) ──
    p.add_argument("--list", action="store_true",
                   help="List available videos as JSON instead of downloading")
    p.add_argument("--list-output", default="-",
                   help="File to write JSON list to, or '-' for stdout (default: -)")
    # ── Batch mode (download specific video IDs/URLs from a file) ──
    p.add_argument("--batch", default="",
                   help="Path to a text file containing URLs to download, one per line")
    p.add_argument("urls", nargs="*",
                   help="YouTube URLs to download (overrides tracks.txt)")
    return p.parse_args()


def build_urls_for_source(base_url: str, source: str) -> list:
    """Expand a channel URL into one or two URLs based on source type."""
    # Normalise trailing slashes
    base = base_url.rstrip("/")
    # Remove existing /videos or /releases suffix so we can add our own
    for suffix in ["/videos", "/releases", "/shorts"]:
        if base.endswith(suffix):
            base = base[:-len(suffix)]
            break

    if source == "videos":
        return [base + "/videos"]
    elif source == "releases":
        return [base + "/releases"]
    elif source == "both":
        return [base + "/videos", base + "/releases"]
    return [base_url]


def build_opts(fmt: str, quality: str, save_thumb: bool, allow_playlist: bool,
               out_dir: str, artist: str = "", limit: int = 0) -> dict:
    postprocessors = []

    if fmt == "mp3":
        postprocessors.append({
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": quality,
        })
    elif fmt == "wav":
        postprocessors.append({
            "key": "FFmpegExtractAudio",
            "preferredcodec": "wav",
        })

    if save_thumb:
        postprocessors.append({"key": "FFmpegMetadata"})
        if fmt == "mp3":
            postprocessors.append({"key": "EmbedThumbnail"})

    # Build output template – prefix with artist name if provided
    if artist:
        outtmpl = os.path.join(out_dir, f"{artist} - %(title)s.%(ext)s")
    else:
        outtmpl = os.path.join(out_dir, "%(title)s.%(ext)s")

    opts = {
        "format": "bestaudio/best",
        "outtmpl": outtmpl,
        "postprocessors": postprocessors,
        "noplaylist": not allow_playlist,
        "ignoreerrors": True,
        "quiet": False,
        "no_warnings": True,
    }

    if limit > 0:
        opts["playlistend"] = limit

    if save_thumb:
        opts["writethumbnail"] = True

    return opts


def list_videos(urls: list, source: str = "videos", limit: int = 0) -> list:
    """
    Use yt-dlp to fetch metadata only (no download) and return a list of
    dicts suitable for the browser UI:
      { id, title, url, thumbnail, duration, type }
    """
    results = []
    seen_ids = set()

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "ignoreerrors": True,
        "extract_flat": True,   # Flat extraction — fast, no full download
        "noplaylist": False,
    }
    if limit > 0:
        ydl_opts["playlistend"] = limit

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        for url in urls:
            try:
                info = ydl.extract_info(url, download=False)
                if not info:
                    continue
                entries = info.get("entries") or [info]
                for entry in entries:
                    if not entry:
                        continue
                    vid_id = entry.get("id") or entry.get("url", "")
                    if vid_id in seen_ids:
                        continue
                    seen_ids.add(vid_id)

                    # Duration formatting
                    dur_s = entry.get("duration") or 0
                    m, s  = divmod(int(dur_s), 60)
                    dur_str = f"{m}:{s:02d}" if dur_s else ""

                    # Best thumbnail
                    thumbs = entry.get("thumbnails") or []
                    thumb_url = ""
                    if thumbs:
                        # Prefer medium-res
                        thumbs_sorted = sorted(thumbs, key=lambda t: (t.get("width") or 0))
                        mid = thumbs_sorted[len(thumbs_sorted) // 2]
                        thumb_url = mid.get("url", "")
                    elif entry.get("thumbnail"):
                        thumb_url = entry["thumbnail"]

                    entry_url = entry.get("webpage_url") or entry.get("url") or ""
                    entry_type = "release" if "releases" in url else "video"

                    results.append({
                        "id":        vid_id,
                        "title":     entry.get("title") or "Untitled",
                        "url":       entry_url,
                        "thumbnail": thumb_url,
                        "duration":  dur_str,
                        "type":      entry_type,
                        "uploader":  entry.get("uploader") or entry.get("channel") or "",
                    })
            except Exception as e:
                sys.stderr.write(f"List error for {url}: {e}\n")

    return results


def load_urls_from_file(path: str) -> list:
    if not os.path.exists(path):
        print(f"⚠️  '{path}' not found. Create it and add one YouTube URL per line.")
        return []
    with open(path, "r", encoding="utf-8") as f:
        return [line.strip() for line in f if line.strip() and not line.startswith("#")]


def main():
    args = parse_args()

    out_dir = "tracks"
    os.makedirs(out_dir, exist_ok=True)

    # ── Gather raw URLs ──────────────────────────────────────────────
    raw_urls = []
    if args.urls:
        raw_urls = args.urls
    elif args.batch:
        raw_urls = load_urls_from_file(args.batch)
    else:
        raw_urls = load_urls_from_file("tracks.txt")

    if not raw_urls:
        print("❌ No URLs to process. Pass URLs as arguments, use --batch, or add them to tracks.txt.")
        sys.exit(1)

    # ── Expand channel URLs based on --source ────────────────────────
    expanded_urls = []
    for url in raw_urls:
        is_channel = ("/@" in url or "/channel/" in url or "/c/" in url or "/user/" in url)
        if is_channel and args.source != "videos":
            expanded_urls.extend(build_urls_for_source(url, args.source))
        else:
            expanded_urls.append(url)

    # ── LIST MODE ────────────────────────────────────────────────────
    if args.list:
        videos = list_videos(expanded_urls, source=args.source, limit=args.limit)
        output = json.dumps({"videos": videos, "count": len(videos)}, ensure_ascii=False, indent=2)
        if args.list_output == "-":
            print(output)
        else:
            with open(args.list_output, "w", encoding="utf-8") as f:
                f.write(output)
        return

    # ── DOWNLOAD MODE ────────────────────────────────────────────────
    save_thumb = not args.no_thumbnail
    artist     = args.artist.strip()
    allow_pl   = args.allow_playlist or len(expanded_urls) > 1 or (
        # Auto-enable playlist for channel URLs
        any("/@" in u or "/playlist" in u or "/channel/" in u for u in expanded_urls)
    )

    opts = build_opts(
        fmt=args.format,
        quality=args.quality,
        save_thumb=save_thumb,
        allow_playlist=allow_pl,
        out_dir=out_dir,
        artist=artist,
        limit=args.limit,
    )

    fmt_label    = args.format.upper()
    thumb_label  = "🖼  Thumbnails (.webp): ON" if save_thumb else "🖼  Thumbnails: OFF"
    artist_label = f"🎤 Artist prefix: {artist}" if artist else "🎤 Artist: auto-detect from title"
    source_label = f"📋 Source: {args.source}"

    print(f"\n{'─'*60}")
    print(f"  MusicExtractor v2  •  Format: {fmt_label}  •  {thumb_label}")
    print(f"  {artist_label}")
    print(f"  {source_label}")
    print(f"  Output folder : ./{out_dir}/")
    print(f"{'─'*60}\n")

    with yt_dlp.YoutubeDL(opts) as ydl:
        for url in expanded_urls:
            try:
                print(f"🔊 Downloading: {url}")
                ydl.download([url])
            except Exception as e:
                print(f"❌ Failed: {url}: {e}")

    print(f"\n✅ Done! Tracks saved to ./{out_dir}/")


if __name__ == "__main__":
    main()
