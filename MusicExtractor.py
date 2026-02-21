import os
import sys
import argparse
import yt_dlp

# ─────────────────────────────────────────────────────────────────────
#  MusicExtractor — Download audio from YouTube/YouTube Music
#  Supports: single videos, playlists, and full channels
#  Output formats: mp3 (default) | wav
#  Thumbnails saved as .webp alongside each track
# ─────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="Download audio from YouTube URLs")
    p.add_argument("--format", choices=["mp3", "wav"], default="mp3",
                   help="Output audio format (default: mp3)")
    p.add_argument("--quality", default="192",
                   help="MP3 bitrate quality, e.g. 192 or 320 (default: 192)")
    p.add_argument("--no-thumbnail", action="store_true",
                   help="Skip downloading album art / thumbnail (.webp)")
    p.add_argument("--allow-playlist", action="store_true",
                   help="Allow playlist/channel URLs (downloads all videos)")
    p.add_argument("urls", nargs="*",
                   help="YouTube URLs to download (overrides tracks.txt)")
    return p.parse_args()


def build_opts(fmt: str, quality: str, save_thumb: bool, allow_playlist: bool, out_dir: str) -> dict:
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
        # Embeds thumbnail into MP3/WAV metadata AND saves a .webp sidecar
        postprocessors.append({"key": "FFmpegMetadata"})
        if fmt == "mp3":
            postprocessors.append({"key": "EmbedThumbnail"})

    opts = {
        "format": "bestaudio/best",
        "outtmpl": os.path.join(out_dir, "%(title)s.%(ext)s"),
        "postprocessors": postprocessors,
        # Playlist / channel handling
        "noplaylist": not allow_playlist,
        "ignoreerrors": True,       # skip unavailable videos in playlists
        "quiet": False,
        "no_warnings": True,
    }

    if save_thumb:
        # Also write the raw .webp thumbnail file next to the audio
        opts["writethumbnail"] = True
        opts["postprocessor_args"] = {
            "thumbnailsconvertor": ["-vf", "scale=300:300"]
        }

    return opts


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

    urls = args.urls if args.urls else load_urls_from_file("tracks.txt")

    if not urls:
        print("❌ No URLs to process. Pass URLs as arguments or add them to tracks.txt.")
        sys.exit(1)

    save_thumb = not args.no_thumbnail
    opts = build_opts(
        fmt=args.format,
        quality=args.quality,
        save_thumb=save_thumb,
        allow_playlist=args.allow_playlist,
        out_dir=out_dir,
    )

    fmt_label = args.format.upper()
    thumb_label = "🖼  Thumbnails (.webp): ON" if save_thumb else "🖼  Thumbnails: OFF"
    playlist_label = "📋 Playlist/Channel mode: ON" if args.allow_playlist else "📋 Single video mode"
    print(f"\n{'─'*55}")
    print(f"  MusicExtractor  •  Format: {fmt_label}  •  {thumb_label}")
    print(f"  {playlist_label}")
    print(f"  Output folder  : ./{out_dir}/")
    print(f"{'─'*55}\n")

    with yt_dlp.YoutubeDL(opts) as ydl:
        for url in urls:
            try:
                print(f"🔊 Downloading: {url}")
                ydl.download([url])
            except Exception as e:
                print(f"❌ Failed to download {url}: {e}")

    print(f"\n✅ Done! Tracks saved to ./{out_dir}/")


if __name__ == "__main__":
    main()