import { execFile, spawn } from 'node:child_process';
import { Playlist, QueryType, Track } from 'discord-player';
import { ensureYtDlpRuntime } from '../utils/ytDlpRuntime.js';

export const YOUTUBE_MIX_LIMIT = 50;
const EXTRACTOR_ID = 'com.dfxphoenix.youtubedlp-extractor';
const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);

export function runYoutubeMixMetadata(binary, args, {
  signal, timeout = 20_000, maxBuffer = 8 * 1024 * 1024, windowsHide = true, shell = false,
} = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('MIX_TIMEOUT'));
    // The verified Linux runtime is a one-file executable with a worker child.
    // Give it a process group so a timeout closes both parent and descendants.
    const child = spawn(binary, args, {
      detached: process.platform !== 'win32', windowsHide, shell,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const chunks = [];
    let bytes = 0;
    let settled = false;
    let timer;
    let escalationTimer;
    let stopping = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(value);
    };
    const stopTree = () => {
      if (!child.pid || stopping) return;
      stopping = true;
      if (process.platform === 'win32') {
        execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true, timeout: 2_000,
        }, (error) => { if (error) child.kill(); });
      } else {
        // PyInstaller needs a graceful termination to remove its unpacked
        // runtime directory. Escalate only if the tree does not exit promptly.
        try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
        escalationTimer = setTimeout(() => {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        }, 500);
      }
    };
    const abort = () => { stopTree(); finish(new Error('MIX_TIMEOUT')); };
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(abort, timeout);
    child.stdout.on('data', (chunk) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > maxBuffer) {
        stopTree(); finish(new Error('MIX_OUTPUT_LIMIT')); return;
      }
      chunks.push(chunk);
    });
    child.on('error', () => { if (!settled) { stopTree(); finish(new Error('MIX_PROCESS_ERROR')); } });
    child.on('close', (code) => {
      if (stopping && process.platform !== 'win32') {
        // A redirected worker may outlive a parent that closed its pipes.
        // Keep escalation while the process group still exists.
        try { process.kill(-child.pid, 0); } catch { clearTimeout(escalationTimer); }
      } else {
        clearTimeout(escalationTimer);
      }
      if (settled) return;
      if (code !== 0) { stopTree(); finish(new Error('MIX_PROCESS_ERROR')); return; }
      finish(null, { stdout: Buffer.concat(chunks).toString('utf8') });
    });
    if (signal?.aborted) abort();
  });
}

export function normalizeYoutubeMixUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw new Error('Link YouTube Mix/Radio không hợp lệ.'); }
  const listId = url.searchParams.get('list');
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname.toLowerCase()) || !/^RD[a-zA-Z0-9_-]{1,148}$/.test(listId || '')) {
    throw new Error('Link YouTube Mix/Radio không hợp lệ.');
  }
  // Mix needs its seed video; never turn a shared watch URL into a browse-only
  // playlist. Remove index/time/tracking fields so the batch begins at the seed.
  const shortId = url.hostname.toLowerCase() === 'youtu.be' ? url.pathname.slice(1) : null;
  if (shortId == null && !['/watch', '/playlist'].includes(url.pathname.replace(/\/$/, ''))) {
    throw new Error('Link YouTube Mix/Radio không hợp lệ.');
  }
  const videoId = url.searchParams.get('v') ?? shortId;
  if (videoId != null && !VIDEO_ID.test(videoId)) {
    throw new Error('Mã video mở đầu Mix/Radio không hợp lệ. Hãy sao chép lại link YouTube.');
  }
  const seed = videoId || /^(?:RDAMVM|RDMM|RD)([a-zA-Z0-9_-]{11})$/.exec(listId)?.[1];
  return seed
    ? `https://www.youtube.com/watch?v=${seed}&list=${encodeURIComponent(listId)}&start_radio=1`
    : `https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}`;
}

function videoUrl(entry) {
  const candidate = entry?.webpage_url || entry?.url;
  if (candidate && /^https?:\/\//i.test(candidate)) {
    let url;
    try { url = new URL(candidate); } catch { return null; }
    if (url.protocol !== 'https:' || !HOSTS.has(url.hostname.toLowerCase())) return null;
    const id = url.searchParams.get('v') || (url.hostname.toLowerCase() === 'youtu.be' ? url.pathname.slice(1) : null);
    return VIDEO_ID.test(id || '') ? `https://www.youtube.com/watch?v=${id}` : null;
  }
  return VIDEO_ID.test(entry?.id || '') ? `https://www.youtube.com/watch?v=${entry.id}` : null;
}

function durationString(value) {
  const seconds = Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    : `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

export async function loadYoutubeMix(player, input, requestedBy, {
  timeoutMs = 20_000, resolveBinary = ensureYtDlpRuntime, runFile = runYoutubeMixMetadata, env = process.env,
} = {}) {
  const url = normalizeYoutubeMixUrl(input);
  const extractor = player.extractors?.get(EXTRACTOR_ID);
  if (!extractor) throw new Error('Bộ phát YouTube chưa sẵn sàng. Hãy thử lại sau.');
  const controller = new AbortController();
  let rejectOnAbort;
  const cancelled = new Promise((_, reject) => {
    rejectOnAbort = () => reject(new Error('MIX_TIMEOUT'));
    controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
  });
  // Kill the metadata child when the whole operation expires. A Promise race
  // alone would leave an endless Radio continuation running on shared hosting.
  const deadline = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const binary = await Promise.race([resolveBinary(), cancelled]);
    if (controller.signal.aborted) throw new Error('MIX_TIMEOUT');
    const args = [
      '--ignore-config', '--no-cache-dir', '--no-warnings', '--no-progress',
      '--flat-playlist', '--yes-playlist', '--playlist-items', `1:${YOUTUBE_MIX_LIMIT}`,
      '--dump-single-json', '--skip-download', '--force-ipv4',
      '--socket-timeout', '8', '--retries', '1', '--extractor-retries', '1',
    ];
    const cookies = String(env.YOUTUBE_COOKIES_FILE || '').trim();
    const proxy = String(env.YOUTUBE_PROXY_URL || '').trim();
    if (cookies) args.push('--cookies', cookies);
    if (proxy) args.push('--proxy', proxy);
    args.push('--', url);
    const { stdout } = await Promise.race([runFile(binary, args, {
      signal: controller.signal, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024,
      windowsHide: true, shell: false, encoding: 'utf8',
    }), cancelled]);
    if (controller.signal.aborted) throw new Error('MIX_TIMEOUT');
    const raw = JSON.parse(stdout);
    if (raw?._type !== 'playlist' || !Array.isArray(raw.entries)) throw new Error('MIX_NOT_A_PLAYLIST');
    const listId = new URL(url).searchParams.get('list');
    if ((raw.id && raw.id !== listId) || (raw.playlist_id && raw.playlist_id !== listId)) throw new Error('MIX_ID_MISMATCH');
    const playlist = new Playlist(player, {
      id: listId, title: String(raw.title || 'YouTube Mix / Radio'),
      description: 'Danh sách Mix/Radio tại thời điểm thêm, tối đa 50 bài mỗi lượt.',
      type: 'playlist', source: 'youtube', url, tracks: [],
      author: { name: String(raw.uploader || raw.channel || 'YouTube') },
      thumbnail: '', rawPlaylist: { id: listId, source: 'youtube', mix: true },
    });
    playlist.mix = true;
    playlist.limit = YOUTUBE_MIX_LIMIT;
    const seen = new Set();
    // Respect the first 50 source positions even if some are unavailable. Do
    // not keep following Radio to fill gaps or substitute unrelated videos.
    for (const entry of raw.entries.slice(0, YOUTUBE_MIX_LIMIT)) {
      if (!entry || /^(?:private|premium_only|subscriber_only|needs_auth|unavailable)$/.test(entry.availability || '')
        || /^\[(?:Deleted|Private) video\]$/i.test(entry.title || '')) continue;
      const trackUrl = videoUrl(entry);
      if (!trackUrl || seen.has(trackUrl)) continue;
      seen.add(trackUrl);
      const track = new Track(player, {
        title: String(entry.title || 'YouTube'), description: '',
        author: String(entry.uploader || entry.channel || entry.artist || 'YouTube'),
        url: trackUrl, thumbnail: String(entry.thumbnail || entry.thumbnails?.at(-1)?.url || ''),
        duration: durationString(entry.duration), views: Number(entry.view_count) || 0,
        requestedBy: requestedBy || undefined, playlist, source: 'youtube',
        queryType: QueryType.YOUTUBE_VIDEO,
        // Keep raw data minimal: metadata subprocess output is not retained in
        // API/state/history and may include credentials supplied by the host.
        raw: { sourceUrl: trackUrl, extractor: 'youtube-ytdlp' },
        metadata: { youtubeMixId: listId },
      });
      track.extractor = extractor;
      playlist.tracks.push(track);
    }
    if (!playlist.tracks.length) throw new Error('MIX_EMPTY');
    return { playlist, tracks: playlist.tracks };
  } catch {
    // execFile error messages include command arguments/stdout/stderr. Never
    // surface configured proxy credentials or cookie paths in Discord/API.
    throw new Error(controller.signal.aborted
      ? 'YouTube Mix/Radio tải quá lâu. Chưa thêm bài nào; hãy thử lại sau.'
      : 'Không đọc được danh sách Mix/Radio này. Hãy gửi link chia sẻ có video mở đầu (watch?v=…&list=RD…) rồi thử lại.');
  } finally {
    clearTimeout(deadline);
    controller.signal.removeEventListener('abort', rejectOnAbort);
  }
}
