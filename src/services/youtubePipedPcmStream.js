import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform, pipeline } from 'node:stream';
import ffmpegPath from 'ffmpeg-static';
import { ensureYtDlpRuntime } from '../utils/ytDlpRuntime.js';

const INFO_MARKER = 'CENAR_YT_INFO:';
const MAX_STDERR_BYTES = 4_096;
const BUFFER_BYTES = 256 * 1024;
const FIRST_PCM_METADATA_WAIT_MS = 120;

async function prepareCookieCopy(file) {
  if (!file) return null;
  const directory = await mkdtemp(join(tmpdir(), 'cenar-yt-session-'));
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    const path = join(directory, 'session.txt');
    await writeFile(path, await readFile(file), { flag: 'wx', mode: 0o600 });
    return { path, cleanup };
  } catch (error) {
    await cleanup().catch(() => {});
    throw error;
  }
}

function youtubeArgs(videoUrl, cookiesFile, proxyUri) {
  return [
    '--ignore-config', '--no-playlist', '--no-cache-dir', '--no-progress', '--no-warnings',
    '--js-runtimes', 'node', '--force-ipv4', '--socket-timeout', '10',
    '--retries', '1', '--extractor-retries', '1', '--fragment-retries', '1',
    '--no-part', '--no-keep-fragments',
    // In stdout-download mode yt-dlp directs its text output to stderr.
    '--print', `before_dl:${INFO_MARKER}%(.{duration,is_live})j`, '--no-simulate', '--logtostderr',
    ...(cookiesFile ? ['--cookies', cookiesFile] : []),
    ...(proxyUri ? ['--proxy', proxyUri] : []),
    '-f', 'bestaudio[acodec!=none]/bestaudio/best', '-o', '-', '--', videoUrl,
  ];
}

const decoderArgs = [
  '-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1', '-filter_threads', '1',
  '-probesize', '262144', '-analyzeduration', '3000000', '-max_alloc', '33554432',
  '-protocol_whitelist', 'pipe', '-i', 'pipe:0', '-map', '0:a:0', '-vn', '-sn', '-dn',
  '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1',
];

function youtubeError(stderr, fallback = 'Không lấy được luồng âm thanh YouTube.') {
  // Keep only the signals used by playback recovery. stderr can contain URLs
  // and account information, so never include it in the thrown message.
  if (/confirm[^\n]*not a bot/i.test(stderr)) return new Error('YouTube yêu cầu sign in to confirm you are not a bot.');
  if (/captcha/i.test(stderr)) return new Error('YouTube yêu cầu CAPTCHA trước khi phát.');
  if (/\b429\b|too many requests/i.test(stderr)) return new Error('YouTube đang giới hạn yêu cầu (HTTP 429).');
  if (/\b403\b/i.test(stderr)) return new Error('YouTube từ chối luồng âm thanh (HTTP 403).');
  if (/sign in/i.test(stderr)) return new Error('YouTube yêu cầu sign in để phát video này.');
  return new Error(fallback);
}

function terminateYoutubeProcess(child) {
  if (!child?.pid) {
    child?.kill('SIGKILL');
    return;
  }
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 2_000 }, (error) => {
      if (error) child.kill('SIGKILL');
    });
    return;
  }
  // The standalone runtime unpacks a worker. Signal its whole process group
  // and give the unpacker a moment to remove its own temporary directory.
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  const killTimer = setTimeout(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }, 500);
  killTimer.unref();
  child.once('close', () => {
    try { process.kill(-child.pid, 0); } catch { clearTimeout(killTimer); }
  });
}

export function createYoutubePipedPcmStream(videoUrl, {
  cookiesFile = '', proxyUri = '', spawnProcess = spawn, resolveRuntime = ensureYtDlpRuntime,
  prepareCookies = prepareCookieCopy, onDuration, startupTimeoutMs = 22_000,
} = {}) {
  let youtube;
  let decoder;
  let cookieCopy;
  let metadataTimer;
  let pendingFirstPcm;
  let receivedPcm = false;
  let youtubeExited = false;
  let decoderExited = false;
  let decodedOutputEnded = false;
  let receivedInfo = false;
  let trailingLine = '';
  let stderrTail = '';

  const releaseCookieCopy = () => {
    const copy = cookieCopy;
    cookieCopy = null;
    void copy?.cleanup().catch(() => {});
  };
  const releaseFirstPcm = () => {
    clearTimeout(metadataTimer);
    const pending = pendingFirstPcm;
    pendingFirstPcm = null;
    pending?.();
  };

  const stream = new Transform({
    allowHalfOpen: false,
    highWaterMark: BUFFER_BYTES,
    transform(chunk, _encoding, callback) {
      if (!receivedPcm && chunk.length) {
        receivedPcm = true;
        clearTimeout(startupTimer);
        if (!receivedInfo && !youtubeExited) {
          // stdout and stderr can arrive in either order. Give the narrow
          // before-download record time to update the Track before playback.
          pendingFirstPcm = () => callback(null, chunk);
          metadataTimer = setTimeout(releaseFirstPcm, FIRST_PCM_METADATA_WAIT_MS);
          metadataTimer.unref();
          return;
        }
      }
      callback(null, chunk);
    },
  });
  const fail = (error) => stream.destroy(error);
  const startupTimer = setTimeout(() => {
    fail(youtubeError(stderrTail, 'YouTube chưa trả âm thanh trong thời gian khởi động.'));
  }, startupTimeoutMs);
  startupTimer.unref();

  // A failing subprocess can report before the consumer attaches its listener.
  stream.on('error', () => {});
  stream.once('close', () => {
    clearTimeout(startupTimer);
    clearTimeout(metadataTimer);
    pendingFirstPcm = null;
    if (!youtubeExited) terminateYoutubeProcess(youtube);
    if (!decoderExited) decoder?.kill('SIGKILL');
    releaseCookieCopy();
  });

  const finish = () => {
    if (stream.destroyed || !youtubeExited || !decoderExited || !decodedOutputEnded) return;
    if (receivedPcm) stream.end();
    else fail(new Error('YouTube kết thúc mà chưa có âm thanh.'));
  };

  const inspectStderrLine = (line) => {
    if (stream.destroyed || receivedInfo || !line.startsWith(INFO_MARKER)) return;
    let info;
    try { info = JSON.parse(line.slice(INFO_MARKER.length)); } catch { return; }
    if (!info || typeof info !== 'object' || Array.isArray(info)) return;
    receivedInfo = true;
    if (info.is_live === true) {
      fail(new Error('Luồng YouTube trực tiếp cần chế độ phát thông thường.'));
      return;
    }
    if (Number.isFinite(info.duration) && info.duration > 0) onDuration?.(info.duration);
    releaseFirstPcm();
  };

  void (async () => {
    try {
      const runtimePath = await resolveRuntime();
      if (stream.destroyed) return;
      if (!ffmpegPath) throw new Error('Bộ giải mã âm thanh chưa sẵn sàng.');
      // yt-dlp writes its jar on exit. Isolate each authenticated subprocess
      // so a playing stream and a warmed next track do not update one file.
      cookieCopy = await prepareCookies(cookiesFile);
      if (stream.destroyed) {
        releaseCookieCopy();
        return;
      }
      youtube = spawnProcess(runtimePath, youtubeArgs(videoUrl, cookieCopy?.path, proxyUri), {
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32',
      });
      youtube.once('error', () => fail(new Error('Không mở được bộ lấy nguồn YouTube.')));
      youtube.stderr.setEncoding('utf8');
      youtube.stderr.on('data', (chunk) => {
        stderrTail = (stderrTail + chunk).slice(-MAX_STDERR_BYTES);
        const lines = (trailingLine + chunk).split(/\r?\n/);
        trailingLine = lines.pop().slice(-MAX_STDERR_BYTES);
        for (const line of lines) inspectStderrLine(line);
      });
      youtube.once('close', (code) => {
        youtubeExited = true;
        releaseCookieCopy();
        if (stream.destroyed) return;
        inspectStderrLine(trailingLine);
        if (code !== 0) {
          fail(youtubeError(stderrTail));
        } else if (!stream.destroyed) {
          releaseFirstPcm();
          finish();
        }
      });

      decoder = spawnProcess(ffmpegPath, decoderArgs, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
      decoder.once('error', () => fail(new Error('Không mở được bộ giải mã âm thanh YouTube.')));
      decoder.once('close', (code) => {
        decoderExited = true;
        if (code !== 0) {
          // When yt-dlp itself failed, its close supplies the useful diagnosis.
          // Defer this generic error until the upstream failure can be read.
          if (!youtubeExited && !receivedPcm) return;
          fail(new Error('Không giải mã được âm thanh YouTube.'));
        } else finish();
      });
      decoder.stdout.once('end', () => {
        decodedOutputEnded = true;
        finish();
      });
      decoder.stdout.once('error', () => fail(new Error('Luồng giải mã âm thanh YouTube bị gián đoạn.')));
      decoder.stdout.pipe(stream, { end: false });
      pipeline(youtube.stdout, decoder.stdin, () => {
        // Early decoder closure also breaks stdin. The two child exit codes
        // retain the useful distinction between a rejection and decode error.
      });
    } catch {
      fail(new Error('Không khởi động được nguồn âm thanh YouTube.'));
    }
  })();

  return stream;
}
