import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const heldLocks = new Map();

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    if (process.platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const state = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0];
      if (state === 'Z' || state === 'X') return false;
    }
    return true;
  } catch (error) {
    return !['ESRCH', 'ENOENT'].includes(error?.code);
  }
}

function readLockPid(lockPath) {
  try {
    const raw = fs.readFileSync(lockPath, 'utf8').trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Number(parsed?.pid);
  } catch {
    return null;
  }
}

/**
 * Acquire an atomic, process-owned launcher lock.
 *
 * VibeHost may briefly invoke the configured startup command more than once
 * during a restart. Without a lock, both launchers fork Store 1 and Store 2;
 * the second Store 1 then crashes with EADDRINUSE on port 5000 and both bot
 * sessions compete for the same Discord token.
 */
export function acquireProcessLock(lockPath, options = {}) {
  const ownerPid = Number(options.pid ?? process.pid);
  const isAlive = options.isAlive || processIsAlive;
  const resolvedPath = path.resolve(lockPath);
  const instanceId = randomUUID();
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(resolvedPath, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify({ pid: ownerPid, instanceId, startedAt: new Date().toISOString() }));
      fs.closeSync(fd);
      heldLocks.set(resolvedPath, { pid: ownerPid, instanceId });

      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (heldLocks.get(resolvedPath)?.instanceId !== instanceId) return;
        heldLocks.delete(resolvedPath);
        if (readLockPid(resolvedPath) !== ownerPid) return;
        try {
          fs.unlinkSync(resolvedPath);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const activePid = readLockPid(resolvedPath);
      if (activePid && (activePid !== ownerPid || heldLocks.get(resolvedPath)?.pid === ownerPid) && isAlive(activePid)) {
        const duplicateError = new Error(`Cenar launcher is already running with PID ${activePid}`);
        duplicateError.code = 'EALREADY';
        throw duplicateError;
      }
      try {
        fs.unlinkSync(resolvedPath);
      } catch (unlinkError) {
        if (unlinkError?.code !== 'ENOENT') throw unlinkError;
      }
    }
  }

  throw new Error(`Unable to acquire launcher lock at ${resolvedPath}`);
}
