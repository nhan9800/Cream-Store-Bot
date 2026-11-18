import { spawn } from 'node:child_process';
import { Readable, Transform, pipeline } from 'node:stream';
import ffmpegPath from 'ffmpeg-static';
import { MUSIC_COMMONS_USER_AGENT, normalizeMusicCommonsStream } from './musicCommonsCatalog.js';

export const MUSIC_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
export const MUSIC_ATTACHMENT_STARTUP_TIMEOUT_MS = 15_000;
const OUTPUT_IDLE_TIMEOUT_MS = 15_000;
const STREAM_BUFFER_BYTES = 64 * 1024;
const MAX_DURATION_SECONDS = 20 * 60;
const MAX_ATTACHMENT_DECODERS = 2;
const DISCORD_DOWNLOAD = {
  idle: 'Tệp âm thanh ngừng tải hoặc giải mã. Hãy tải tệp lên lại.',
  unavailable: 'Không thể tải tệp Discord. Hãy tải tệp lên lại.',
  badStatus: 'Tệp Discord đã hết hạn hoặc không thể tải. Hãy tải tệp lên lại.',
  invalid: 'Tệp Discord trả về không khớp với định dạng hoặc dung lượng tệp đính kèm.',
  incomplete: 'Tệp Discord tải không đầy đủ hoặc vượt dung lượng đã khai báo.',
};
const COMMONS_DOWNLOAD = {
  headers: { 'User-Agent': MUSIC_COMMONS_USER_AGENT },
  idle: 'Bản thu Wikimedia Commons ngừng tải hoặc giải mã. Hãy thử lại.',
  unavailable: 'Không thể tải bản thu từ Wikimedia Commons. Hãy thử lại.',
  badStatus: 'Bản thu Wikimedia Commons hiện không tải được. Hãy chọn bản thu khác hoặc thử lại sau.',
  invalid: 'Bản thu Wikimedia Commons có định dạng hoặc dung lượng khác thông tin đã công bố.',
  incomplete: 'Bản thu Wikimedia Commons tải không đầy đủ hoặc vượt dung lượng đã công bố.',
};
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

export function normalizeMusicAttachment(attachment) {
  const name = typeof attachment?.name === 'string' ? attachment.name : '';
  const extension = name.match(/\.(mp3|ogg)$/i)?.[1].toLowerCase();
  // Client MIME labels are advisory and vary between browsers and platforms.
  // The CDN path must still match, and FFmpeg validates the actual format.
  if (!extension || name.length > 255 || /[\/\\\p{C}]/u.test(name)) {
    throw new Error('Chỉ nhận tệp âm thanh MP3 hoặc OGG.');
  }

  const { id, size } = attachment;
  if (!Number.isSafeInteger(size) || size < 1 || size > MUSIC_ATTACHMENT_MAX_BYTES) {
    throw new Error('Tệp phải có dung lượng từ 1 byte đến 8 MB.');
  }

  const rawUrl = typeof attachment.url === 'string' ? attachment.url : '';
  // Check the authority before parsing so explicit default ports, whitespace,
  // backslashes and credentials can't be normalized away by URL.
  const path = rawUrl.match(/^https:\/\/cdn\.discordapp\.com\/(?:ephemeral-)?attachments\/[0-9]{17,20}\/([0-9]{17,20})\/([^/?#]+)(?:\?[^#]*)?$/i);
  if (!path || path[1] !== id || rawUrl.length > 4096 || /[\u0000-\u0020\u007f\\]/.test(rawUrl)) {
    throw new Error('Hãy tải tệp trực tiếp qua tùy chọn file của Discord.');
  }

  let filename;
  try {
    filename = decodeURIComponent(path[2]);
  } catch {
    throw new Error('Tên tệp đính kèm của Discord không hợp lệ.');
  }
  if (/[\/\\\p{C}]/u.test(filename) || !filename.toLowerCase().endsWith(`.${extension}`)) {
    throw new Error('Tên tệp đính kèm của Discord không khớp.');
  }
  return { id, name, format: extension, url: rawUrl, size };
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

function boundedInput(expectedBytes, sizeError) {
  let receivedBytes = 0;
  return new Transform({
    highWaterMark: STREAM_BUFFER_BYTES,
    transform(chunk, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > expectedBytes) {
        callback(new Error(sizeError));
      } else {
        callback(null, chunk);
      }
    },
    flush(callback) {
      if (receivedBytes !== expectedBytes) {
        callback(new Error(sizeError));
      } else {
        callback();
      }
    },
  });
}

export function createMusicAttachmentPcmStream(source, options) {
  return createMusicFilePcmStream(normalizeMusicAttachment(source), DISCORD_DOWNLOAD, options);
}

export function createMusicCommonsPcmStream(source, options) {
  return createMusicFilePcmStream(normalizeMusicCommonsStream(source), COMMONS_DOWNLOAD, options);
}

function createMusicFilePcmStream({ url, format, size }, provider, {
  fetchAttachment = fetch, spawnFfmpeg = spawn,
} = {}) {
  if (!ffmpegPath) throw new Error('Bộ giải mã âm thanh chưa sẵn sàng.');
  if (activeDecoders >= MAX_ATTACHMENT_DECODERS) {
    throw new Error('Bot đang phát tệp ở các phòng khác. Hãy thử lại sau.');
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
      else fail(provider.idle);
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
    fail('Tệp MP3 hoặc OGG chưa có âm thanh sau 15 giây.');
  }, MUSIC_ATTACHMENT_STARTUP_TIMEOUT_MS);
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
    else fail('Tệp MP3 hoặc OGG không chứa âm thanh có thể phát.');
  };

  void (async () => {
    let response;
    try {
      response = await fetchAttachment(url, {
        signal: download.signal,
        redirect: 'error',
        credentials: 'omit',
        headers: { 'Accept-Encoding': 'identity', ...provider.headers },
      });
    } catch {
      if (!output.destroyed) fail(provider.unavailable);
      return;
    }

    if (output.destroyed) return;
    if (response.status !== 200 || !response.body) {
      fail(provider.badStatus);
      return;
    }
    const length = response.headers.get('content-length');
    const encoding = response.headers.get('content-encoding');
    if ((length !== null && (!/^\d+$/.test(length) || Number(length) !== size))
      || (encoding && encoding.toLowerCase() !== 'identity')
      || !isAudioResponse(response.headers.get('content-type'))) {
      fail(provider.invalid);
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
          fail('Không thể giải mã tệp MP3 hoặc OGG. Hãy kiểm tra định dạng tệp.');
          return;
        }
        processExited = true;
        finish();
      });
      child.stdout.pipe(output, { end: false });
      pipeline(Readable.fromWeb(response.body, { highWaterMark: STREAM_BUFFER_BYTES }),
        boundedInput(size, provider.incomplete), child.stdin, (error) => {
          if (output.destroyed || !error) return;
          // The decoder may close its input after the playback duration cap.
          // The child exit code and PCM decide whether playback succeeded.
          if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
          fail(provider.incomplete);
        });
    } catch {
      fail('Không thể mở bộ giải mã tệp âm thanh.');
    }
  })();

  return output;
}
