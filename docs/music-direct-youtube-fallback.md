# Direct YouTube audio fallback — 2026-10-18

## Why

The previous path let `discord-player-youtubedlp` own the entire audio stream. That path can be healthy in the aggregate health check while a hosting network hiccup, expired Googlevideo URL or extractor process stops the first audio frames.

## Runtime path

`musicPlayerService.js` now uses a direct YouTube path by default:

1. `yt-dlp` resolves a fresh `bestaudio` URL for the exact YouTube video.
2. FFmpeg reads that URL with HTTP reconnect enabled and emits 48 kHz stereo `s16le` PCM.
3. The stream is returned as Discord Player's demuxable raw shape and frame-aligned before the native Opus encoder. This avoids a second FFmpeg pass over PCM.
4. If resolution/startup fails, the code retries with a public `android,web` client and then falls back to the installed extractor stream. Errors are sanitized before they can reach logs or API responses.

## Lifecycle repair — 2026-10-20

- The entire startup has one 45-second budget (`YOUTUBE_DIRECT_STARTUP_TIMEOUT_MS`), including runtime resolution, both direct attempts and extractor fallback. Individual resolution and FFmpeg startup remain bounded at 15 and 20 seconds; retrying does not restart the total budget.
- First-byte observation happens inside a Transform, preserving PCM and backpressure before Discord Player attaches. Successful EOF drains remaining stdout before ending the public stream.
- A child process emitting both `error` and a later `close` can trigger only one transition. Old children cannot clear or kill a newer attempt.
- Cancelling the returned stream aborts resolution and kills active FFmpeg immediately. Cleanup does not wait for a potentially missing process-close event.
- HTTP reconnect remains enabled for interruptions. `reconnect_at_eof` is omitted because finite songs should end once, rather than reopen at normal EOF.
- A successful process exit without any PCM is treated as a startup failure. Once PCM has begun, an error ends that source without replaying the same song from its beginning.

Deterministic process/stream regression coverage is in `tests/music-youtube-direct.test.js`, including delayed errors/close, cancellation, the shared deadline, empty EOF and byte-for-byte eight-MiB backpressure continuity. Production audibility requires a real Discord voice check and cannot be inferred from health readiness.

The YouTube source remains authoritative for metadata, videos and playlists. Cookies and proxy settings remain optional environment inputs (`YOUTUBE_COOKIES_FILE`, `YOUTUBE_PROXY_URL`) and are never stored in project memory.

## Rollback switch

Set `MUSIC_YOUTUBE_STREAM_MODE=extractor` in the bot runtime to return to the previous extractor-owned stream without changing catalog or queue data. The public health response exposes only the aggregate `youtubeStreamMode` (`direct-with-extractor-fallback` or `extractor`).

## Verification

- Direct owner-link probe emitted PCM locally from `https://youtu.be/J-P69SaDPXE`.
- Focused music tests: 57 passed.
- Full bot suite: 138 files / 909 tests passed.
