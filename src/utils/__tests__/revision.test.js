import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeCommitSha, resolveCommitSha } from '../revision.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';

describe('deployment revision', () => {
  it('accepts only full commit SHAs', () => {
    expect(normalizeCommitSha(SHA.toUpperCase())).toBe(SHA);
    expect(normalizeCommitSha('main')).toBeNull();
    expect(normalizeCommitSha('abc123')).toBeNull();
  });

  it('prefers the deployment environment revision', () => {
    expect(resolveCommitSha({ cwd: os.tmpdir(), env: { DEPLOY_REVISION: SHA } })).toBe(SHA);
  });

  it('reads an immutable release revision file', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-revision-'));
    try {
      fs.writeFileSync(path.join(directory, 'REVISION'), `${SHA}\n`);
      expect(resolveCommitSha({ cwd: directory, env: {} })).toBe(SHA);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
