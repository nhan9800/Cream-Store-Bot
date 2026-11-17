import fs from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const runFile = promisify(execFile);
const VERSION = '2026.10.26';
// Pinned official release and SHA2-256SUMS:
// https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.26
const ASSETS = {
  'linux-x64': ['yt-dlp_linux', '767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795'],
  'linux-arm64': ['yt-dlp_linux_aarch64', 'e87e9533e89fe5889abaa21f5114dfe7756d6aa6219b83551add04d48b18e483'],
  'win32-x64': ['yt-dlp.exe', 'f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d'],
  'darwin-x64': ['yt-dlp_macos', '0f922c15ccc0b83eefa1c8bc9104e434318c4bf16e408e1ee93b7745a6efe0aa'],
  'darwin-arm64': ['yt-dlp_macos', '0f922c15ccc0b83eefa1c8bc9104e434318c4bf16e408e1ee93b7745a6efe0aa'],
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fileOps = {
  mkdir: fs.mkdir,
  link: fs.link,
  copyFile: fs.copyFile,
  chmod: fs.chmod,
  rename: fs.rename,
  unlink: fs.unlink,
};

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const input = createReadStream(filePath);
    input.on('data', (chunk) => hash.update(chunk));
    input.once('error', reject);
    input.once('end', () => resolve(hash.digest('hex')));
  });
}

export async function bindVerifiedBinary({
  sourcePath, targetPath, sha256, operations: overrides = {},
}) {
  const operations = { ...fileOps, ...overrides };
  const actualSourceHash = await sha256File(sourcePath);
  if (actualSourceHash !== sha256) throw new Error('yt-dlp extractor source checksum mismatch');

  const parent = path.dirname(targetPath);
  const name = path.basename(targetPath);
  await operations.mkdir(parent, { recursive: true });
  const existingHash = await sha256File(targetPath).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (existingHash === sha256) return targetPath;

  // Stage beside the target, then rename the directory entry. The old target
  // may be hardlinked to a retained cache; never write through that inode.
  const stagedPath = path.join(parent, `.${name}.${randomUUID()}.tmp`);
  let activationError;
  try {
    try {
      await operations.link(sourcePath, stagedPath);
    } catch (error) {
      if (!['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error;
      await operations.copyFile(sourcePath, stagedPath, constants.COPYFILE_EXCL);
      await operations.chmod(stagedPath, 0o755);
    }
    await operations.rename(stagedPath, targetPath);
    return targetPath;
  } catch (error) {
    activationError = error;
    throw error;
  } finally {
    // POSIX rename is a successful no-op when a concurrent binder already
    // installed a hardlink to the same inode. Remove our own stage then too.
    try {
      await operations.unlink(stagedPath);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') {
        if (activationError) activationError.cleanupError = cleanupError;
        else throw cleanupError;
      }
    }
  }
}

export async function prepareVerifiedBinary({
  cacheDir, asset, sha256, version, url, fetchImpl = fetch, runVersion = runFile,
}) {
  if (path.basename(asset) !== asset || !/^[a-zA-Z0-9._-]+$/.test(asset)) throw new Error('Invalid runtime asset');
  await fs.mkdir(cacheDir, { recursive: true });
  const destination = path.join(cacheDir, asset);
  const checkVersion = async (file) => {
    const { stdout } = await runVersion(file, ['--ignore-config', '--version'], {
      // The official Linux standalone expands its bundled Python runtime.
      // Cold shared-host disk IO can exceed 10s, especially with both stores
      // starting together. This initialization budget is separate from the
      // bounded music-source/first-frame deadlines.
      timeout: 60_000, maxBuffer: 16_384, windowsHide: true,
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
    await bindVerifiedBinary({
      sourcePath: binaryPath,
      targetPath: path.join(BIN_DIR, asset),
      sha256,
    });
    return binaryPath;
  })().catch((error) => {
    // Retry a failed initialization, but keep a verified runtime for this
    // process lifetime. Source lookup must not unpack a second --version
    // process on every song and consume its independent startup budget.
    preparing = null;
    throw error;
  });
  return preparing;
}
