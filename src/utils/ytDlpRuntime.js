import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const runFile = promisify(execFile);
const VERSION = '2026.08.19';
// Pinned official release and SHA2-256SUMS:
// https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19
const ASSETS = {
  'linux-x64': ['yt-dlp_linux', '58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a'],
  'linux-arm64': ['yt-dlp_linux_aarch64', 'b16e4dab368a816cd05d477d698a605a6ae87ccee1c8ffd38fa21d7254141fcc'],
  'win32-x64': ['yt-dlp.exe', '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a'],
  'darwin-x64': ['yt-dlp_macos', '0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202'],
  'darwin-arm64': ['yt-dlp_macos', '0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202'],
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function prepareVerifiedBinary({
  cacheDir, asset, sha256, version, url, fetchImpl = fetch, runVersion = runFile,
}) {
  if (path.basename(asset) !== asset || !/^[a-zA-Z0-9._-]+$/.test(asset)) throw new Error('Invalid runtime asset');
  await fs.mkdir(cacheDir, { recursive: true });
  const destination = path.join(cacheDir, asset);
  const checkVersion = async (file) => {
    const { stdout } = await runVersion(file, ['--ignore-config', '--version'], {
      timeout: 10_000, maxBuffer: 16_384, windowsHide: true,
    });
    if (stdout.trim() !== version) throw new Error('yt-dlp runtime version check failed');
  };
  let cached;
  try { cached = await fs.readFile(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (cached && digest(cached) === sha256) {
    await checkVersion(destination);
    return destination;
  }

  // Network failures and checksum failures never replace an existing runtime.
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body) throw new Error(`yt-dlp download failed: HTTP ${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 64 * 1024 * 1024) throw new Error('yt-dlp download exceeds size limit');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (digest(bytes) !== sha256) throw new Error('yt-dlp checksum verification failed');
  const temporary = path.join(cacheDir, `${randomUUID()}-${asset}`);
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o755 });
    await checkVersion(temporary);
    await fs.rename(temporary, destination);
  } finally {
    await fs.unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
  return destination;
}

let preparing;
export async function configureMediaTempDirectory({
  platform = process.platform, env = process.env, root = process.cwd(),
} = {}) {
  if (platform !== 'linux') return;
  // PyInstaller expands the standalone Linux executable before each invocation.
  // Hosting /tmp may be a small tmpfs shared by both stores. Child processes
  // (including the extractor's spawns) inherit this disk-backed location instead.
  const directory = path.resolve(root, '.vibehost', 'media', 'tmp');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  env.TMPDIR = directory;
}

export function ensureYtDlpRuntime() {
  if (preparing) return preparing;
  preparing = (async () => {
    const selected = ASSETS[`${process.platform}-${process.arch}`];
    if (!selected) throw new Error('Chưa hỗ trợ yt-dlp trên nền tảng này.');
    await configureMediaTempDirectory();
    const [asset, sha256] = selected;
    const binaryPath = await prepareVerifiedBinary({
      cacheDir: path.resolve('.vibehost', 'media', VERSION), asset, sha256, version: VERSION,
      url: `https://github.com/yt-dlp/yt-dlp/releases/download/${VERSION}/${asset}`,
    });
    // Resolve the wrapper owned by the extractor, including nested npm layouts.
    // Its default probe runs during import, so provide the verified binary first.
    const requireHere = createRequire(import.meta.url);
    const requireExtractor = createRequire(requireHere.resolve('discord-player-youtubedlp'));
    const { BIN_DIR } = requireExtractor('ytdlp-nodejs');
    await fs.mkdir(BIN_DIR, { recursive: true });
    await fs.link(binaryPath, path.join(BIN_DIR, asset)).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
    return binaryPath;
  })().finally(() => { preparing = null; });
  return preparing;
}
