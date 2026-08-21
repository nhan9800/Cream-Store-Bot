import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireProcessLock } from '../processLock.js';

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryLockPath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-launcher-lock-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'launcher.lock');
}

describe('launcher process lock', () => {
  it('rejects a second live launcher and releases only its own lock', () => {
    const lockPath = temporaryLockPath();
    const release = acquireProcessLock(lockPath, { pid: 101, isAlive: (pid) => pid === 101 });

    expect(() => acquireProcessLock(lockPath, { pid: 202, isAlive: (pid) => pid === 101 }))
      .toThrow(/already running/i);
    expect(fs.existsSync(lockPath)).toBe(true);

    release();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('recovers an orphaned lock left by a terminated process', () => {
    const lockPath = temporaryLockPath();
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 303 }));

    const release = acquireProcessLock(lockPath, { pid: 404, isAlive: () => false });
    expect(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid).toBe(404);

    release();
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});
