import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindVerifiedBinary, configureMediaTempDirectory, prepareVerifiedBinary } from '../src/utils/ytDlpRuntime.js';

const dirs = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cenar-media-test-'));
  dirs.push(cacheDir);
  const bytes = Buffer.from('verified fixture binary');
  return {
    cacheDir, asset: 'yt-dlp-test', version: '2026.10.26',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    url: 'https://example.invalid/yt-dlp-test',
    fetchImpl: vi.fn(async () => new Response(bytes)),
    runVersion: vi.fn(async () => ({ stdout: '2026.10.26\n' })),
  };
}

async function bindingFixture() {
  const options = await fixture();
  const sourcePath = await prepareVerifiedBinary(options);
  const oldCache = path.join(options.cacheDir, 'old-runtime');
  await fs.writeFile(oldCache, 'old verified runtime');
  const targetDirectory = path.join(options.cacheDir, 'extractor-bin');
  const targetPath = path.join(targetDirectory, options.asset);
  await fs.mkdir(targetDirectory);
  await fs.link(oldCache, targetPath);
  return { ...options, sourcePath, oldCache, targetDirectory, targetPath };
}

describe('optional yt-dlp runtime recovery', () => {
  it('gives Linux media subprocesses a disk-backed temp directory', async () => {
    const { cacheDir: root } = await fixture();
    const env = { KEEP: 'unchanged', TMPDIR: '/tmp' };
    await configureMediaTempDirectory({ platform: 'linux', root, env });
    expect(env).toEqual({ KEEP: 'unchanged', TMPDIR: path.join(root, '.vibehost', 'media', 'tmp') });
    expect((await fs.stat(env.TMPDIR)).isDirectory()).toBe(true);
    const windowsEnv = { TMPDIR: 'original' };
    await configureMediaTempDirectory({ platform: 'win32', root, env: windowsEnv });
    expect(windowsEnv.TMPDIR).toBe('original');
  });
  it('checks checksum and executable version before activation, then reuses cache', async () => {
    const options = await fixture();
    const file = await prepareVerifiedBinary(options);
    expect(await fs.readFile(file, 'utf8')).toBe('verified fixture binary');
    expect(options.runVersion).toHaveBeenCalledWith(expect.any(String), ['--ignore-config', '--version'],
      expect.objectContaining({ timeout: 60_000, windowsHide: true }));
    expect(options.fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(await prepareVerifiedBinary(options)).toBe(file);
    expect(options.fetchImpl).toHaveBeenCalledTimes(1);
    expect(await fs.readdir(options.cacheDir)).toEqual([options.asset]);
  });
  it('does not execute or activate bytes with a bad checksum', async () => {
    const options = await fixture();
    options.fetchImpl.mockImplementation(async () => new Response('corrupted'));
    await expect(prepareVerifiedBinary(options)).rejects.toThrow(/checksum/);
    expect(options.runVersion).not.toHaveBeenCalled();
    expect(await fs.readdir(options.cacheDir)).toEqual([]);
  });
  it('keeps the previous cache if download fails', async () => {
    const options = await fixture();
    const file = path.join(options.cacheDir, options.asset);
    await fs.writeFile(file, 'previous binary');
    options.fetchImpl.mockRejectedValue(new Error('timeout'));
    await expect(prepareVerifiedBinary(options)).rejects.toThrow(/timeout/);
    expect(await fs.readFile(file, 'utf8')).toBe('previous binary');
  });
  it('cleans temporary files and preserves cache when the executable check fails', async () => {
    const options = await fixture();
    const file = path.join(options.cacheDir, options.asset);
    await fs.writeFile(file, 'previous binary');
    options.runVersion.mockResolvedValue({ stdout: 'wrong version' });
    await expect(prepareVerifiedBinary(options)).rejects.toThrow(/version/);
    expect(await fs.readFile(file, 'utf8')).toBe('previous binary');
    expect(await fs.readdir(options.cacheDir)).toEqual([options.asset]);
  });
  it('rejects download HTTP failures', async () => {
    const options = await fixture();
    options.fetchImpl.mockImplementation(async () => new Response('unavailable', { status: 503 }));
    await expect(prepareVerifiedBinary(options)).rejects.toThrow(/HTTP 503/);
    expect(options.runVersion).not.toHaveBeenCalled();
  });
  it('does not permit asset paths to escape the cache directory', async () => {
    const options = await fixture();
    await expect(prepareVerifiedBinary({ ...options, asset: '../outside' })).rejects.toThrow(/asset/);
    expect(options.fetchImpl).not.toHaveBeenCalled();
  });
});

describe('verified yt-dlp extractor binding', () => {
  it('creates the wrapper binary on a fresh installation', async () => {
    const options = await fixture();
    const sourcePath = await prepareVerifiedBinary(options);
    const targetDirectory = path.join(options.cacheDir, 'new-extractor-bin');
    const targetPath = path.join(targetDirectory, options.asset);

    await bindVerifiedBinary({ sourcePath, targetPath, sha256: options.sha256 });

    expect(await fs.readFile(targetPath, 'utf8')).toBe('verified fixture binary');
    expect(await fs.readdir(targetDirectory)).toEqual([options.asset]);
  });

  it('atomically replaces an old hardlink without modifying its retained runtime cache', async () => {
    const options = await bindingFixture();
    const oldInode = (await fs.stat(options.oldCache)).ino;
    expect((await fs.stat(options.targetPath)).ino).toBe(oldInode);

    expect(await bindVerifiedBinary(options)).toBe(options.targetPath);

    expect(await fs.readFile(options.targetPath, 'utf8')).toBe('verified fixture binary');
    expect((await fs.stat(options.targetPath)).ino).toBe((await fs.stat(options.sourcePath)).ino);
    expect(await fs.readFile(options.oldCache, 'utf8')).toBe('old verified runtime');
    expect((await fs.stat(options.oldCache)).ino).toBe(oldInode);
    expect(await fs.readdir(options.targetDirectory)).toEqual([options.asset]);
  });

  it('reuses an exact verified extractor binary without relinking or renaming it', async () => {
    const options = await bindingFixture();
    await bindVerifiedBinary(options);
    const link = vi.fn();
    const rename = vi.fn();

    await bindVerifiedBinary({ ...options, operations: { link, rename } });

    expect(link).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    expect(await fs.readdir(options.targetDirectory)).toEqual([options.asset]);
  });

  it('does not replace the working extractor if the selected cache fails verification', async () => {
    const options = await bindingFixture();
    await fs.writeFile(options.sourcePath, 'unverified runtime');

    await expect(bindVerifiedBinary(options)).rejects.toThrow(/source checksum/);

    expect(await fs.readFile(options.targetPath, 'utf8')).toBe('old verified runtime');
    expect(await fs.readFile(options.oldCache, 'utf8')).toBe('old verified runtime');
    expect(await fs.readdir(options.targetDirectory)).toEqual([options.asset]);
  });

  it('preserves the old extractor and cleans the staged link when activation fails', async () => {
    const options = await bindingFixture();
    const failure = Object.assign(new Error('target temporarily busy'), { code: 'EBUSY' });

    await expect(bindVerifiedBinary({
      ...options,
      operations: { rename: vi.fn().mockRejectedValue(failure) },
    })).rejects.toBe(failure);

    expect(await fs.readFile(options.targetPath, 'utf8')).toBe('old verified runtime');
    expect(await fs.readFile(options.oldCache, 'utf8')).toBe('old verified runtime');
    expect(await fs.readdir(options.targetDirectory)).toEqual([options.asset]);
  });

  it('stages a separate executable copy if the cache and extractor are on different filesystems', async () => {
    const options = await bindingFixture();
    const link = vi.fn().mockRejectedValue(Object.assign(new Error('cross-device link'), { code: 'EXDEV' }));

    await bindVerifiedBinary({ ...options, operations: { link } });

    expect(await fs.readFile(options.targetPath, 'utf8')).toBe('verified fixture binary');
    expect((await fs.stat(options.targetPath)).ino).not.toBe((await fs.stat(options.sourcePath)).ino);
    if (process.platform !== 'win32') expect((await fs.stat(options.targetPath)).mode & 0o777).toBe(0o755);
    expect(await fs.readFile(options.oldCache, 'utf8')).toBe('old verified runtime');
    expect(await fs.readdir(options.targetDirectory)).toEqual([options.asset]);
  });

  it('preserves the old binding when staging a cross-device copy fails', async () => {
    const options = await bindingFixture();
    const failure = new Error('no space for staged binary');
    const copyFile = vi.fn().mockRejectedValue(failure);

    await expect(bindVerifiedBinary({
      ...options,
      operations: {
        link: vi.fn().mockRejectedValue(Object.assign(new Error('cross-device'), { code: 'EXDEV' })),
        copyFile,
      },
    })).rejects.toBe(failure);

    expect(await fs.readFile(options.targetPath, 'utf8')).toBe('old verified runtime');
    expect(await fs.readdir(options.targetDirectory)).toEqual([options.asset]);
  });

  it('keeps concurrent binders on the exact verified binary without leftover staging files', async () => {
    const options = await bindingFixture();

    await Promise.all([bindVerifiedBinary(options), bindVerifiedBinary(options)]);

    expect(await fs.readFile(options.targetPath, 'utf8')).toBe('verified fixture binary');
    expect(await fs.readFile(options.oldCache, 'utf8')).toBe('old verified runtime');
    expect(await fs.readdir(options.targetDirectory)).toEqual([options.asset]);
  });

  it('cleans its stage when rename succeeds without removing a same-inode hardlink', async () => {
    const options = await bindingFixture();
    await bindVerifiedBinary({
      ...options,
      operations: {
        rename: async (stage, target) => {
          // A competing binder installs the same verified inode first.
          // POSIX rename(stage, target) can now succeed without removing stage.
          await fs.unlink(target);
          await fs.link(options.sourcePath, target);
        },
      },
    });
    expect(await fs.readFile(options.targetPath, 'utf8')).toBe('verified fixture binary');
    expect(await fs.readFile(options.oldCache, 'utf8')).toBe('old verified runtime');
    expect(await fs.readdir(options.targetDirectory)).toEqual([options.asset]);
  });
});
