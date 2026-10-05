import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupDependencyStages } from '../scripts/cleanup-dependency-stages.mjs';

let fixture, root, state, outside;
const now = Date.now(), day = 86400000;
const runtimeCheck = vi.fn(() => true);
beforeEach(async () => {
  fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'cenar-cleanup-'));
  root = path.join(fixture, 'bot'); state = path.join(root, '.vibehost'); outside = path.join(fixture, 'outside');
  await fs.mkdir(state, { recursive: true }); await fs.mkdir(outside);
  await fs.mkdir(path.join(root, 'node_modules')); await fs.writeFile(path.join(root, 'node_modules/live'), 'current-library');
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'cenar-store-bot' }));
  await fs.writeFile(path.join(root, 'REVISION'), 'a'.repeat(40));
  await fs.writeFile(path.join(state, 'installed-revision'), 'a'.repeat(40));
  for (const name of ['data', 'backups']) { await fs.mkdir(path.join(root, name)); await fs.writeFile(path.join(root, name, 'protected'), 'keep'); }
  for (const name of ['.env', '.env.store2']) await fs.writeFile(path.join(root, name), 'fixture-only');
  await fs.writeFile(path.join(outside, 'protected'), 'outside-keep'); runtimeCheck.mockClear();
});
afterEach(async () => {
  vi.restoreAllMocks();
  const resolved = await fs.realpath(fixture);
  if (path.dirname(resolved) !== await fs.realpath(os.tmpdir()) || !path.basename(resolved).startsWith('cenar-cleanup-')) throw new Error('Unsafe test cleanup');
  await fs.rm(resolved, { recursive: true, force: true });
});
async function stage(id, ageDays = 10 - id, rollback = true) {
  const target = path.join(state, `dependencies-${String(id).padStart(8, '0')}`);
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'package.json'), JSON.stringify({ name: 'cenar-store-bot', dependencies: { example: '1.0.0' } }));
  await fs.writeFile(path.join(target, 'package-lock.json'), JSON.stringify({ name: 'cenar-store-bot', packages: {} }));
  await fs.mkdir(path.join(target, rollback ? 'previous-node_modules' : 'node_modules'));
  await fs.writeFile(path.join(target, rollback ? 'previous-node_modules' : 'node_modules', 'library'), Buffer.alloc(8192));
  await fs.utimes(target, (now - ageDays * day) / 1000, (now - ageDays * day) / 1000);
  return target;
}
async function exists(target) { return fs.stat(target).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; }); }
const apply = () => cleanupDependencyStages(root, { apply: true, now, runtimeCheck });

describe('bounded hosting dependency cleanup', () => {
  it('starts a fresh deletion budget after a slow scan/native preflight and emits confirmed progress', async () => {
    for (let id = 1; id <= 4; id++) await stage(id);
    let elapsed = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    const progress = vi.fn();
    const report = await cleanupDependencyStages(root, { apply: true, now, runtimeCheck: () => { elapsed = 65000; return true; }, onProgress: progress });
    expect(report.removed).toHaveLength(2);
    expect(progress).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ removedCount: 2, reclaimedBytes: report.reclaimedBytes }));
  });
  it('audit measures old stages without deleting anything', async () => {
    for (let id = 1; id <= 5; id++) await stage(id);
    const report = await cleanupDependencyStages(root, { now });
    expect(report.candidates).toHaveLength(3); expect(report.reclaimableBytes).toBeGreaterThan(0);
    expect(report.removed).toEqual([]); expect((await fs.readdir(state)).filter(name => name.startsWith('dependencies-'))).toHaveLength(5);
  });
  it('deletes only obsolete stages and keeps two latest rollbacks, data, env and live modules', async () => {
    const stages = []; for (let id = 1; id <= 5; id++) stages.push(await stage(id));
    const report = await apply();
    expect(report.removed).toHaveLength(3); expect(report.reclaimedBytes).toBe(report.reclaimableBytes);
    expect(await exists(stages[0])).toBe(false); expect(await exists(stages[3])).toBe(true); expect(await exists(stages[4])).toBe(true);
    for (const name of ['data/protected', 'backups/protected', '.env', '.env.store2', 'node_modules/live']) expect(await exists(path.join(root, name))).toBe(true);
    expect(await fs.readFile(path.join(root, 'node_modules/live'), 'utf8')).toBe('current-library');
    expect(await fs.readFile(path.join(outside, 'protected'), 'utf8')).toBe('outside-keep');
    const second = await apply(); expect(second.removed).toEqual([]);
  });
  it('refuses deletion if current native runtime validation fails', async () => {
    for (let id = 1; id <= 4; id++) await stage(id);
    await expect(cleanupDependencyStages(root, { apply: true, now, runtimeCheck: () => false })).rejects.toThrow('CURRENT_RUNTIME_INVALID');
    expect(await exists(path.join(state, 'dependencies-00000001'))).toBe(true);
  });
  it('retains latest successful rollback even when two newer installs failed', async () => {
    for (let id = 1; id <= 5; id++) await stage(id, 10 - id, id <= 3);
    const report = await apply(); expect(report.removed).toHaveLength(2);
    expect(report.kept.map(entry => entry.name)).toContain('dependencies-00000003');
  });
  it('preserves any older stage referenced by active node_modules symlinks', async () => {
    let old; for (let id = 1; id <= 5; id++) { const item = await stage(id); if (id === 1) old = item; }
    await fs.symlink(path.join(old, 'previous-node_modules'), path.join(root, 'node_modules/linked-package'), 'junction');
    const report = await apply(); expect(report.removed).not.toContain(path.basename(old)); expect(await exists(old)).toBe(true);
  });
  it('does not traverse a stage symlink or an external symlink inside deleted modules', async () => {
    const old = await stage(1); await fs.symlink(outside, path.join(old, 'previous-node_modules/external'), 'junction');
    await fs.utimes(old, (now - 9 * day) / 1000, (now - 9 * day) / 1000);
    await stage(2); await stage(3);
    await fs.symlink(outside, path.join(state, 'dependencies-EXTERNAL'), 'junction');
    const report = await apply(); expect(report.removed).toContain(path.basename(old)); expect(report.skipped).toBe(1);
    expect(await fs.readFile(path.join(outside, 'protected'), 'utf8')).toBe('outside-keep');
  });
  it('retains stages with unexpected content and a declared active install', async () => {
    const old = await stage(1); await fs.writeFile(path.join(old, '.env'), 'preserve-unexpected');
    const active = await stage(2); await stage(3); await stage(4);
    const report = await cleanupDependencyStages(root, { apply: true, now, runtimeCheck, activeStage: active });
    expect(report.removed).toEqual([]); expect(report.skipped).toBe(1);
    expect(await fs.readFile(path.join(old, '.env'), 'utf8')).toBe('preserve-unexpected');
  });
  it('keeps all stages created within the last 24 hours', async () => {
    for (let id = 1; id <= 4; id++) await stage(id, 0.25);
    expect((await apply()).removed).toEqual([]);
  });
  it('rejects a state-directory symlink outside the application', async () => {
    await fs.rm(state, { recursive: true }); await fs.symlink(outside, state, 'junction');
    await expect(apply()).rejects.toThrow('INVALID_STATE_DIRECTORY');
    expect(await fs.readFile(path.join(outside, 'protected'), 'utf8')).toBe('outside-keep');
  });
  it('stops if a candidate was replaced after audit', async () => {
    const old = await stage(1); await stage(2); await stage(3);
    await expect(cleanupDependencyStages(root, { apply: true, now, runtimeCheck, onAudit: async () => {
      await fs.rename(old, `${old}-preserved`); await fs.mkdir(old); await fs.writeFile(path.join(old, 'protected'), 'do-not-delete');
    } })).rejects.toThrow('STAGE_CHANGED');
    expect(await fs.readFile(path.join(old, 'protected'), 'utf8')).toBe('do-not-delete');
  });
  it('does not clean when revision markers disagree', async () => {
    await stage(1); await fs.writeFile(path.join(root, 'REVISION'), 'b'.repeat(40));
    await expect(apply()).rejects.toThrow('REVISION_NOT_VALIDATED'); expect(runtimeCheck).not.toHaveBeenCalled();
  });
});
