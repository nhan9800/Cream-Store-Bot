import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const STAGE_NAME = /^dependencies-[A-Za-z0-9]{8}$/;
const ALLOWED = new Set(['package.json', 'package-lock.json', 'node_modules', 'previous-node_modules', 'rejected-node_modules']);
const MIN_AGE = 24 * 60 * 60 * 1000;
function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}
function budget(context) {
  if (++context.entries > 500000 || performance.now() > context.deadline) throw new Error('SCAN_LIMIT_REACHED');
}
async function walk(target, context, visit, seen = new Set()) {
  budget(context);
  const stat = await fs.lstat(target);
  const key = `${stat.dev}:${stat.ino}`;
  if (seen.has(key)) return;
  seen.add(key);
  await visit(target, stat);
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    for (const name of await fs.readdir(target)) await walk(path.join(target, name), context, visit, seen);
  }
}
async function shape(stage) {
  const names = await fs.readdir(stage);
  if (!names.includes('package.json') || !names.includes('package-lock.json') || names.some(name => !ALLOWED.has(name))) return null;
  for (const name of ['package.json', 'package-lock.json']) {
    const stat = await fs.lstat(path.join(stage, name));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) return null;
  }
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(stage, 'package.json'), 'utf8'));
    const lock = JSON.parse(await fs.readFile(path.join(stage, 'package-lock.json'), 'utf8'));
    if (manifest.name !== 'cenar-store-bot' || lock.name !== manifest.name || !manifest.dependencies || !lock.packages) return null;
    return { rollback: names.includes('previous-node_modules') };
  } catch { return null; }
}
async function validateRoot(input) {
  if (!path.isAbsolute(input) || input === path.parse(input).root) throw new Error('INVALID_APP_ROOT');
  const root = await fs.realpath(input);
  const state = path.join(root, '.vibehost');
  const stateStat = await fs.lstat(state);
  if (!stateStat.isDirectory() || stateStat.isSymbolicLink() || await fs.realpath(state) !== state) throw new Error('INVALID_STATE_DIRECTORY');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const installed = (await fs.readFile(path.join(state, 'installed-revision'), 'utf8')).trim();
  const revision = (await fs.readFile(path.join(root, 'REVISION'), 'utf8')).trim();
  if (manifest.name !== 'cenar-store-bot' || !/^[a-f0-9]{40}$/.test(installed) || revision !== installed) throw new Error('REVISION_NOT_VALIDATED');
  return { root, state, revision };
}
async function runtimeReferences(root, context) {
  const references = [path.join(root, 'node_modules'), await fs.realpath(path.join(root, 'node_modules'))];
  await walk(path.join(root, 'node_modules'), context, async (target, stat) => {
    if (!stat.isSymbolicLink()) return;
    references.push(path.resolve(path.dirname(target), await fs.readlink(target)));
    try { references.push(await fs.realpath(target)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  });
  return references;
}
function verifyRuntime(root) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/check-runtime-dependencies.mjs'), root], {
    cwd: root, timeout: 45000, stdio: 'ignore', env: { ...process.env, NODE_ENV: 'production' },
  });
  return result.status === 0 && !result.error;
}

/** Only the exclusively locked supervisor calls apply, after native runtime validation. */
export async function cleanupDependencyStages(input, { apply = false, activeStage = '', now = Date.now(), runtimeCheck = verifyRuntime, onAudit = () => {} } = {}) {
  const { root, state, revision } = await validateRoot(input);
  const context = { entries: 0, deadline: performance.now() + 60000 };
  const references = await runtimeReferences(root, context);
  const stages = [];
  let skipped = 0;
  for (const name of await fs.readdir(state)) {
    if (!STAGE_NAME.test(name)) continue;
    const target = path.join(state, name);
    const stat = await fs.lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(target) !== target) { skipped++; continue; }
    const identity = await shape(target);
    if (!identity) { skipped++; continue; }
    let bytes = 0, crossDevice = false;
    await walk(target, context, async (_, entry) => {
      bytes += Number.isFinite(entry.blocks) ? entry.blocks * 512 : entry.size;
      if (entry.dev !== stat.dev) crossDevice = true;
    });
    stages.push({ name, target, modified: stat.mtimeMs, ino: stat.ino, dev: stat.dev, bytes, rollback: identity.rollback,
      protected: crossDevice || references.some(reference => inside(target, reference)) || (activeStage && path.resolve(activeStage) === target) });
  }
  stages.sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
  // Keep two latest stages, plus the latest successful rollback even if newer installs failed.
  const retained = new Set(stages.slice(0, 2).map(stage => stage.name));
  const rollback = stages.find(stage => stage.rollback);
  if (rollback) retained.add(rollback.name);
  for (const stage of stages) if (stage.protected || now - stage.modified < MIN_AGE) retained.add(stage.name);
  const candidates = stages.filter(stage => !retained.has(stage.name));
  const report = {
    revision, mode: apply ? 'apply' : 'audit', stageBytesBefore: stages.reduce((sum, stage) => sum + stage.bytes, 0),
    reclaimableBytes: candidates.reduce((sum, stage) => sum + stage.bytes, 0),
    kept: stages.filter(stage => retained.has(stage.name)).map(({ name, bytes }) => ({ name, bytes })),
    candidates: candidates.map(({ name, bytes }) => ({ name, bytes })), skipped, removed: [], reclaimedBytes: 0,
  };
  await onAudit(report);
  if (!apply || !candidates.length) return report;
  if (runtimeCheck(root) !== true) throw new Error('CURRENT_RUNTIME_INVALID');
  for (const stage of candidates) {
    budget(context);
    if ((await validateRoot(root)).revision !== revision) throw new Error('REVISION_CHANGED');
    const current = await fs.lstat(stage.target);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== stage.dev || current.ino !== stage.ino
      || await fs.realpath(stage.target) !== stage.target || !await shape(stage.target)) throw new Error('STAGE_CHANGED');
    const quarantine = path.join(state, `.cleanup-dependencies-${randomUUID()}`);
    await fs.rename(stage.target, quarantine);
    try {
      const moved = await fs.lstat(quarantine);
      if (!inside(state, quarantine) || path.dirname(quarantine) !== state || moved.isSymbolicLink()
        || moved.dev !== stage.dev || moved.ino !== stage.ino || await fs.realpath(quarantine) !== quarantine) throw new Error('UNSAFE_DELETE_TARGET');
      // Node rm unlinks symlinks; it does not traverse their external destinations.
      await fs.rm(quarantine, { recursive: true, force: false, maxRetries: 2, retryDelay: 100 });
    } catch (error) {
      await fs.rename(quarantine, stage.target).catch(() => {});
      throw error;
    }
    report.removed.push(stage.name);
    report.reclaimedBytes += stage.bytes;
  }
  report.stageBytesAfter = report.stageBytesBefore - report.reclaimedBytes;
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const root = args.includes('--root') ? args[args.indexOf('--root') + 1] : process.cwd();
  const activeStage = args.includes('--active-stage') ? args[args.indexOf('--active-stage') + 1] : '';
  try {
    const report = await cleanupDependencyStages(root, { apply: args.includes('--apply'), activeStage,
      onAudit: plan => console.log(`[hosting-cleanup] plan ${JSON.stringify(plan)}`),
    });
    console.log(`[hosting-cleanup] result ${JSON.stringify(report)}`);
  } catch (error) {
    console.error(`[hosting-cleanup] stopped code=${/^[A-Z_]+$/.test(error.message) ? error.message : error.code || 'SCAN_FAILED'}`);
    process.exitCode = 1;
  }
}
