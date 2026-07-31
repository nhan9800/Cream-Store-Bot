import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/i;

export function normalizeCommitSha(value) {
  const candidate = String(value ?? '').trim();
  return COMMIT_SHA_PATTERN.test(candidate) ? candidate.toLowerCase() : null;
}

export function resolveCommitSha({ cwd = process.cwd(), env = process.env } = {}) {
  const envSha = normalizeCommitSha(
    env.DEPLOY_REVISION || env.GITHUB_SHA || env.SOURCE_VERSION,
  );
  if (envSha) return envSha;

  try {
    const fileSha = normalizeCommitSha(
      fs.readFileSync(path.join(cwd, 'REVISION'), 'utf8'),
    );
    if (fileSha) return fileSha;
  } catch {
    // A revision file is optional in local development.
  }

  try {
    return normalizeCommitSha(
      execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    ) || 'unknown';
  } catch {
    return 'unknown';
  }
}

// Resolve once at process startup so an old process cannot claim a newly
// written REVISION before it has actually restarted.
export const runtimeCommitSha = resolveCommitSha();
