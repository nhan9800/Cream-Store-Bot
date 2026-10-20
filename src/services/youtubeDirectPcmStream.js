import { Transform } from 'node:stream';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { createPCMStream } from 'discord-player-youtubedlp';
import { ensureYtDlpRuntime } from '../utils/ytDlpRuntime.js';

const DIRECT_RESOLVE_TIMEOUT_MS = 15_000;
const DIRECT_START_TIMEOUT_MS = 20_000;
const MAX_START_ATTEMPTS = 2;
// Shared by the caller's first-frame wait: retries do not reset this budget.
export const YOUTUBE_DIRECT_STARTUP_TIMEOUT_MS = 45_000;

function cleanError(value) {
  return String(value || '')
    .replace(/https?:\/\/\S+/gi, '[youtube-url]')
    .replace(/(?:cookie|proxy|authorization|token|signature)[^\n]*/gi, '[redacted]')
    .slice(-1200);
}

export function buildYtDlpDirectArgs(url, {
  proxyUri = '',
  cookiesFile = '',
  playerClient = '',
} = {}) {
  return [
    '--quiet', '--no-warnings', '--no-playlist', '--no-cache-dir',
    '--js-runtimes', 'node', '--force-ipv4',
    ...(playerClient ? ['--extractor-args', `youtube:player_client=${playerClient}`] : []),
    '-f', 'bestaudio[acodec!=none]/bestaudio/best', '-g', url,
    ...(proxyUri ? ['--proxy', proxyUri] : []),
    ...(cookiesFile ? ['--cookies', cookiesFile] : []),
  ];
}

export function buildFfmpegDirectArgs(url) {
  return [
    '-hide_banner', '-loglevel', 'error',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-rw_timeout', '15000000',
    '-i', url,
    '-vn', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1',
  ];
}

function spawnYtDlpDirect(url, options = {}) {
  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let stdout = '';
    let stderr = '';
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (error) {
        try { child?.kill('SIGKILL'); } catch {}
        reject(new Error(cleanError(error?.message || error)));
      } else resolve(result);
    };
    const abort = () => finish(new Error('Đã dừng lấy nguồn YouTube.'));
    const timer = setTimeout(() => {
      finish(new Error('YouTube không trả audio URL trong thời gian cho phép.'));
    }, DIRECT_RESOLVE_TIMEOUT_MS);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    void (async () => {
      try {
        const binary = await (options.resolveRuntime || ensureYtDlpRuntime)();
        if (settled) return;
        child = (options.spawnProcess || spawn)(binary, buildYtDlpDirectArgs(url, options), {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
        child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk.toString('utf8')}`.slice(-64 * 1024); });
        child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-2000); });
        child.on('error', (error) => finish(error));
        child.once('close', (code) => {
          const directUrl = stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => /^https?:\/\//i.test(line));
          if (code === 0 && directUrl) finish(null, directUrl);
          else finish(new Error(`YouTube direct resolver thất bại (${code ?? 'unknown'}): ${cleanError(stderr)}`));
        });
      } catch (error) {
        finish(error);
      }
    })();
  });
}

function directOptions() {
  return {
    proxyUri: String(process.env.YOUTUBE_PROXY_URL || '').trim(),
    cookiesFile: String(process.env.YOUTUBE_COOKIES_FILE || '').trim(),
    // Never inspect the host user's browser profile implicitly. A cookies
    // file is used only when the operator explicitly configured one.
    autoCookiesFromBrowser: false,
  };
}

/**
 * Resolve a fresh YouTube audio URL and let FFmpeg reconnect the HTTP stream.
 * If the direct path cannot start, fall back to the installed extractor stream
 * so a transient client/format issue cannot disable the whole music queue.
 */
export function createResilientYoutubePcmStream(videoUrl, {
  fallback = true,
  spawnProcess = spawn,
  resolveRuntime = ensureYtDlpRuntime,
  createFallback = createPCMStream,
} = {}) {
  let active = null;
  let closed = false;
  let started = false;
  let attempt = 0;
  let startupTimer = null;
  const lifetime = new AbortController();
  // Observe bytes inside the transform, never via a `data` listener. A data
  // listener would put the public stream in flowing mode before Player owns it.
  const exposed = new Transform({
    allowHalfOpen: false,
    highWaterMark: 4 * 1024 * 1024,
    transform(chunk, encoding, callback) {
      if (chunk.length && !started) {
        started = true;
        clearTimeout(totalTimer);
        clearTimeout(startupTimer);
        startupTimer = null;
      }
      callback(null, chunk);
    },
  });
  const totalTimer = setTimeout(() => {
    close(new Error('Nguồn YouTube chưa có âm thanh sau 45 giây. Vui lòng thử lại.'));
  }, YOUTUBE_DIRECT_STARTUP_TIMEOUT_MS);

  const cleanupActive = () => {
    clearTimeout(startupTimer);
    startupTimer = null;
    if (!active) return;
    const previous = active;
    // Invalidate before killing; a child can emit error/close during teardown.
    active = null;
    try { previous.stdout?.unpipe(exposed); } catch {}
    try { previous.unpipe?.(exposed); } catch {}
    try { previous.kill?.('SIGKILL'); } catch {}
    try { previous.destroy?.(); } catch {}
  };
  const cleanup = () => {
    clearTimeout(totalTimer);
    lifetime.abort();
    cleanupActive();
  };
  const close = (error = null) => {
    if (closed) return;
    closed = true;
    cleanup();
    if (error) exposed.destroy(error);
    else exposed.end();
  };
  exposed.on('close', () => { closed = true; cleanup(); });
  exposed.on('error', () => { closed = true; cleanup(); });

  const startFallback = () => {
    if (closed) return;
    try {
      const extractor = createFallback(videoUrl, { agent: directOptions() });
      active = extractor;
      let settled = false;
      const finish = (error) => {
        if (settled || closed || active !== extractor) return;
        settled = true;
        close(error ? new Error(cleanError(error?.message || error)) : null);
      };
      extractor.on('error', finish);
      extractor.once('end', () => finish(started ? null : new Error('Nguồn YouTube kết thúc mà không có âm thanh.')));
      extractor.once('close', () => finish(new Error('Nguồn YouTube đóng trước khi phát hết âm thanh.')));
      extractor.pipe(exposed, { end: false });
    } catch (error) {
      close(new Error(cleanError(error?.message || error)));
    }
  };
  const failed = (error) => {
    if (closed) return;
    cleanupActive();
    if (!started && fallback) {
      if (attempt < MAX_START_ATTEMPTS) void start();
      else startFallback();
    } else close(new Error(cleanError(error?.message || error)));
  };
  const start = async () => {
    if (closed) return;
    attempt += 1;
    try {
      const directUrl = await spawnYtDlpDirect(videoUrl, {
        ...directOptions(),
        // Keep the normal yt-dlp client first for the best available audio;
        // retry once with a public client when YouTube rejects that URL.
        playerClient: attempt > 1 ? 'android,web' : '',
        signal: lifetime.signal,
        spawnProcess,
        resolveRuntime,
      });
      if (closed) return;
      if (!ffmpegPath) throw new Error('Không tìm thấy FFmpeg runtime.');
      const child = spawnProcess(ffmpegPath, buildFfmpegDirectArgs(directUrl), {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      active = child;
      let stderr = '';
      let settled = false;
      let outputEnded = false;
      let exitCode;
      const finish = (error = null) => {
        if (settled || closed || active !== child) return;
        settled = true;
        if (error) failed(error);
        else close();
      };
      const maybeEnd = () => {
        // Child close can arrive while stdout is backpressured. Wait until the
        // readable side drains, otherwise the last PCM chunks would be lost.
        if (outputEnded && exitCode === 0) {
          finish(started ? null : new Error('YouTube trả nguồn rỗng, chưa có âm thanh.'));
        }
      };
      child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-2000); });
      child.stdout.on('error', (error) => finish(error));
      child.stdout.once('end', () => { outputEnded = true; maybeEnd(); });
      startupTimer = setTimeout(() => {
        finish(new Error('FFmpeg không trả âm thanh trong thời gian cho phép.'));
      }, DIRECT_START_TIMEOUT_MS);
      child.on('error', (error) => finish(error));
      child.once('close', (code) => {
        exitCode = code;
        if (code === 0) maybeEnd();
        else finish(new Error(`YouTube audio stream stopped (${code ?? 'unknown'}): ${cleanError(stderr)}`));
      });
      child.stdout.pipe(exposed, { end: false });
    } catch (error) {
      failed(error);
    }
  };

  void start();
  return exposed;
}
