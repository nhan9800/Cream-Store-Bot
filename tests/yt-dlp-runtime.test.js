import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureMediaTempDirectory, prepareVerifiedBinary } from '../src/utils/ytDlpRuntime.js';

const dirs = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cenar-media-test-'));
  dirs.push(cacheDir);
  const bytes = Buffer.from('verified fixture binary');
  return {
    cacheDir, asset: 'yt-dlp-test', version: '2026.08.19',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    url: 'https://example.invalid/yt-dlp-test',
    fetchImpl: vi.fn(async () => new Response(bytes)),
    runVersion: vi.fn(async () => ({ stdout: '2026.08.19\n' })),
  };
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
      expect.objectContaining({ timeout: 10_000, windowsHide: true }));
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
