# Direct YouTube audio fallback — 2026-10-18

## Why

The previous path let `discord-player-youtubedlp` own the entire audio stream. That path can be healthy in the aggregate health check while a hosting network hiccup, expired Googlevideo URL or extractor process stops the first audio frames.

## Runtime path

`musicPlayerService.js` now uses a direct YouTube path by default:

1. `yt-dlp` resolves a fresh `bestaudio` URL for the exact YouTube video.
2. FFmpeg reads that URL with HTTP reconnect enabled and emits 48 kHz stereo `s16le` PCM.
3. The stream is returned as Discord Player's demuxable raw shape and frame-aligned before the native Opus encoder. This avoids a second FFmpeg pass over PCM.
4. If resolution/startup fails, the code retries with a public `android,web` client and then falls back to the installed extractor stream. Errors are sanitized before they can reach logs or API responses.

The YouTube source remains authoritative for metadata, videos and playlists. Cookies and proxy settings remain optional environment inputs (`YOUTUBE_COOKIES_FILE`, `YOUTUBE_PROXY_URL`) and are never stored in project memory.

## Rollback switch

Set `MUSIC_YOUTUBE_STREAM_MODE=extractor` in the bot runtime to return to the previous extractor-owned stream without changing catalog or queue data. The public health response exposes only the aggregate `youtubeStreamMode` (`direct-with-extractor-fallback` or `extractor`).

## Verification

- Direct owner-link probe emitted PCM locally from `https://youtu.be/J-P69SaDPXE`.
- Focused music tests: 57 passed.
- Full bot suite: 138 files / 909 tests passed.
