import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { createPCMStream } from 'discord-player-youtubedlp';
import { ensureYtDlpRuntime } from '../utils/ytDlpRuntime.js';

const DIRECT_RESOLVE_TIMEOUT_MS = 15_000;
const DIRECT_START_TIMEOUT_MS = 20_000;
const MAX_START_ATTEMPTS = 2;

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
    '-reconnect_at_eof', '1',
    '-reconnect_delay_max', '5',
    '-rw_timeout', '15000000',
    '-i', url,
    '-vn', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1',
  ];
}

function spawnYtDlpDirect(url, options = {}) {
  return new Promise(async (resolve, reject) => {
    let binary;
    try {
      binary = await ensureYtDlpRuntime();
    } catch (error) {
      reject(error);
      return;
    }
    const child = spawn(binary, buildYtDlpDirectArgs(url, options), {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    options.onProcess?.(child);
    options.onProcess?.(child);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('YouTube không trả audio URL trong thời gian cho phép.'));
    }, DIRECT_RESOLVE_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-2000); });
    child.once('error', (error) => {
      clearTimeout(timer);
      options.onProcess?.(null);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      options.onProcess?.(null);
      const directUrl = stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => /^https?:\/\//i.test(line));
      if (code === 0 && directUrl) {
        resolve(directUrl);
        return;
      }
      reject(new Error(`YouTube direct resolver thất bại (${code ?? 'unknown'}): ${cleanError(stderr)}`));
    });
  });
}

function directOptions() {
  return {
    proxyUri: String(process.env.YOUTUBE_PROXY_URL || '').trim(),
    cookiesFile: String(process.env.YOUTUBE_COOKIES_FILE || '').trim(),
  };
}

/**
 * Resolve a fresh YouTube audio URL and let FFmpeg reconnect the HTTP stream.
 * If the direct path cannot start, fall back to the installed extractor stream
 * so a transient client/format issue cannot disable the whole music queue.
 */
export function createResilientYoutubePcmStream(videoUrl, { fallback = true } = {}) {
  const exposed = new PassThrough({ allowHalfOpen: false, highWaterMark: 4 * 1024 * 1024 });
  let active = null;
  let closed = false;
  let started = false;
  let attempt = 0;
  let startupTimer = null;
  let resolver = null;

  const cleanup = () => {
    clearTimeout(startupTimer);
    startupTimer = null;
    try { resolver?.kill('SIGKILL'); } catch {}
    resolver = null;
    if (!active) return;
    try { active.stdout?.unpipe(exposed); } catch {}
    try { active.unpipe?.(exposed); } catch {}
    try { active.kill('SIGKILL'); } catch {}
    try { active.destroy?.(); } catch {}
    active = null;
  };
  const close = (error = null) => {
    if (closed) return;
    closed = true;
    cleanup();
    if (error) exposed.destroy(error);
    else exposed.end();
  };
  exposed.on('data', (chunk) => {
    if (chunk.length) started = true;
  });
  exposed.on('close', () => { closed = true; cleanup(); });
  exposed.on('error', () => { closed = true; cleanup(); });

  const start = async () => {
    if (closed) return;
    attempt += 1;
    try {
      const directUrl = await spawnYtDlpDirect(videoUrl, {
        ...directOptions(),
        // Keep the normal yt-dlp client first for the best available audio;
        // retry once with a public client when YouTube rejects that URL.
        playerClient: attempt > 1 ? 'android,web' : '',
        onProcess: (process) => { resolver = process; },
      });
      resolver = null;
      if (closed) return;
      if (!ffmpegPath) throw new Error('Không tìm thấy FFmpeg runtime.');
      const child = spawn(ffmpegPath, buildFfmpegDirectArgs(directUrl), {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      active = child;
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-2000); });
      child.stdout.pipe(exposed, { end: false });
      startupTimer = setTimeout(() => {
        if (!started) child.kill('SIGKILL');
      }, DIRECT_START_TIMEOUT_MS);
      child.once('error', (error) => {
        if (!started && fallback && attempt < MAX_START_ATTEMPTS && !closed) {
          cleanup();
          void start();
          return;
        }
        close(error);
      });
      child.once('close', (code) => {
        clearTimeout(startupTimer);
        startupTimer = null;
        active = null;
        if (closed) return;
        if (code === 0) {
          close();
          return;
        }
        if (!started && fallback && attempt < MAX_START_ATTEMPTS) {
          void start();
          return;
        }
        // If the direct path failed before its first frame, use the existing
        // extractor as a last resort; once PCM has started, preserve the
        // original error instead of duplicating audio from the beginning.
        if (!started && fallback) {
          try {
            const extractor = createPCMStream(videoUrl, { agent: directOptions() });
            active = extractor;
            extractor.on('error', (error) => close(error));
            extractor.once('end', () => close());
            extractor.pipe(exposed, { end: false });
            return;
          } catch (error) {
            close(error);
            return;
          }
        }
        close(new Error(`YouTube audio stream stopped (${code ?? 'unknown'}): ${cleanError(stderr)}`));
      });
    } catch (error) {
      if (!started && fallback && attempt < MAX_START_ATTEMPTS && !closed) {
        void start();
        return;
      }
      if (!started && fallback && !closed) {
        try {
          const extractor = createPCMStream(videoUrl, { agent: directOptions() });
          active = extractor;
          extractor.on('error', (fallbackError) => close(fallbackError));
          extractor.once('end', () => close());
          extractor.pipe(exposed, { end: false });
          return;
        } catch (fallbackError) {
          close(fallbackError);
          return;
        }
      }
      close(new Error(cleanError(error?.message || error)));
    }
  };

  void start();
  return exposed;
}
