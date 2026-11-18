import { spawn } from 'node:child_process';
import { Readable, Transform, pipeline } from 'node:stream';
import ffmpegPath from 'ffmpeg-static';
import { MUSIC_COMMONS_USER_AGENT, normalizeMusicCommonsStream } from './musicCommonsCatalog.js';

export const MUSIC_COMMONS_STARTUP_TIMEOUT_MS = 15_000;
const OUTPUT_IDLE_TIMEOUT_MS = 15_000;
const STREAM_BUFFER_BYTES = 64 * 1024;
const MAX_DURATION_SECONDS = 20 * 60;
const MAX_DECODERS = 2;
const INCOMPLETE_AUDIO = 'Bản thu Wikimedia Commons tải không đầy đủ hoặc vượt dung lượng đã công bố.';
const CODECS = {
  mp3: 'mp3,mp3float',
  ogg: 'opus,libopus,vorbis,libvorbis,flac,speex,libspeex',
};

let activeDecoders = 0;

function isAudioResponse(contentType) {
  const mime = contentType?.split(';', 1)[0].trim().toLowerCase();
  return !mime || mime.startsWith('audio/')
    || mime === 'application/octet-stream' || mime === 'application/ogg';
}

function decoderArgs(format) {
  return [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-xerror',
    '-max_alloc', '33554432', '-filter_threads', '1', '-threads', '1',
    '-protocol_whitelist', 'pipe', '-codec_whitelist', CODECS[format],
    '-probesize', '262144', '-analyzeduration', '3000000', '-f', format,
    '-vn', '-sn', '-dn', '-i', 'pipe:0',
    '-map', '0:a:0', '-map_metadata', '-1', '-vn', '-sn', '-dn',
    '-t', String(MAX_DURATION_SECONDS), '-c:a', 'pcm_s16le',
    '-ar', '48000', '-ac', '2', '-f', 's16le', 'pipe:1',
  ];
}

function boundedInput(expectedBytes) {
  let receivedBytes = 0;
  return new Transform({
    highWaterMark: STREAM_BUFFER_BYTES,
    transform(chunk, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > expectedBytes) {
        callback(new Error(INCOMPLETE_AUDIO));
      } else {
        callback(null, chunk);
      }
    },
    flush(callback) {
      if (receivedBytes !== expectedBytes) {
        callback(new Error(INCOMPLETE_AUDIO));
      } else {
        callback();
      }
    },
  });
}

export function createMusicCommonsPcmStream(source, {
  fetchCommons = fetch, spawnFfmpeg = spawn,
} = {}) {
  const { url, format, size } = normalizeMusicCommonsStream(source);
  if (!ffmpegPath) throw new Error('Bộ giải mã âm thanh chưa sẵn sàng.');
  if (activeDecoders >= MAX_DECODERS) {
    throw new Error('Bot đang phát bản thu Wikimedia Commons ở các phòng khác. Hãy thử lại sau.');
  }
  activeDecoders += 1;

  const download = new AbortController();
  let child;
  let idleTimer;
  let started = false;
  let outputEnded = false;
  let processExited = false;

  const fail = (message) => output.destroy(new Error(message));
  const armIdleCheck = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      // A paused player stops draining the bounded pipe. Wait for the listener
      // instead of interpreting intentional backpressure as a stalled decoder.
      if (child?.stdout.isPaused()) armIdleCheck();
      else fail('Bản thu Wikimedia Commons ngừng tải hoặc giải mã. Hãy thử lại.');
    }, OUTPUT_IDLE_TIMEOUT_MS);
    idleTimer.unref();
  };
  const output = new Transform({
    highWaterMark: STREAM_BUFFER_BYTES,
    transform(chunk, _encoding, callback) {
      if (chunk.length) {
        started = true;
        clearTimeout(startupTimer);
        armIdleCheck();
      }
      callback(null, chunk);
    },
  });
  const startupTimer = setTimeout(() => {
    fail('Bản thu Wikimedia Commons chưa có âm thanh sau 15 giây.');
  }, MUSIC_COMMONS_STARTUP_TIMEOUT_MS);
  startupTimer.unref();

  // Errors are also delivered to the consuming pipeline. Guard the short
  // interval before its listener is attached.
  output.on('error', () => {});
  output.once('close', () => {
    clearTimeout(startupTimer);
    clearTimeout(idleTimer);
    download.abort();
    child?.kill('SIGKILL');
    activeDecoders -= 1;
  });

  const finish = () => {
    if (!outputEnded || !processExited || output.destroyed) return;
    if (started) output.end();
    else fail('Bản thu Wikimedia Commons không chứa âm thanh có thể phát.');
  };

  void (async () => {
    let response;
    try {
      response = await fetchCommons(url, {
        signal: download.signal,
        redirect: 'error',
        credentials: 'omit',
        headers: { 'Accept-Encoding': 'identity', 'User-Agent': MUSIC_COMMONS_USER_AGENT },
      });
    } catch {
      if (!output.destroyed) fail('Không thể tải bản thu từ Wikimedia Commons. Hãy thử lại.');
      return;
    }

    if (output.destroyed) return;
    if (response.status !== 200 || !response.body) {
      fail('Bản thu Wikimedia Commons hiện không tải được. Hãy chọn bản thu khác hoặc thử lại sau.');
      return;
    }
    const length = response.headers.get('content-length');
    const encoding = response.headers.get('content-encoding');
    if ((length !== null && (!/^\d+$/.test(length) || Number(length) !== size))
      || (encoding && encoding.toLowerCase() !== 'identity')
      || !isAudioResponse(response.headers.get('content-type'))) {
      fail('Bản thu Wikimedia Commons có định dạng hoặc dung lượng khác thông tin đã công bố.');
      return;
    }

    try {
      child = spawnFfmpeg(ffmpegPath, decoderArgs(format), {
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      });
      child.once('error', () => fail('Không thể mở bộ giải mã tệp âm thanh.'));
      child.stdout.once('error', () => fail('Không thể đọc âm thanh đã giải mã.'));
      child.stdout.once('end', () => {
        outputEnded = true;
        finish();
      });
      child.once('close', (code) => {
        if (output.destroyed) return;
        if (code !== 0) {
          fail('Không thể giải mã bản thu Wikimedia Commons. Hãy chọn bản thu khác.');
          return;
        }
        processExited = true;
        finish();
      });
      child.stdout.pipe(output, { end: false });
      pipeline(Readable.fromWeb(response.body, { highWaterMark: STREAM_BUFFER_BYTES }),
        boundedInput(size), child.stdin, (error) => {
          if (output.destroyed || !error) return;
          // The decoder may close its input after the playback duration cap.
          // The child exit code and PCM decide whether playback succeeded.
          if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
          fail(INCOMPLETE_AUDIO);
        });
    } catch {
      fail('Không thể mở bộ giải mã tệp âm thanh.');
    }
  })();

  return output;
}
