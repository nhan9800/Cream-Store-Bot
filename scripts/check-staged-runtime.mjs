import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Exercise the same isolated, production-only install and node_modules move
// used by VibeHost. This detects packages that resolve only through a parent
// checkout or through a vendor link left behind in the dependency stage.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-staged-runtime-'));
const stage = path.join(temporary, 'stage');
const promoted = path.join(temporary, 'promoted');
const npmCli = process.env.npm_execpath;
const vendorName = 'discord-voip-7.2.0-cenar.1.tgz';
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', timeout: 300_000, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error('STAGED_RUNTIME_CHECK_FAILED');
}
function prepare(destination) {
  fs.mkdirSync(path.join(destination, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(destination, 'vendor'));
  for (const name of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(root, name), path.join(destination, name));
  fs.copyFileSync(path.join(root, 'vendor', vendorName), path.join(destination, 'vendor', vendorName));
  fs.copyFileSync(path.join(root, 'scripts', 'patch-dependency-compat.js'), path.join(destination, 'scripts', 'patch-dependency-compat.js'));
}
try {
  if (!npmCli || !fs.existsSync(npmCli)) throw new Error('RUN_WITH_NPM_RUN_CHECK_STAGED_RUNTIME');
  prepare(stage);
  run(process.execPath, [npmCli, 'ci', '--omit=dev', '--no-audit', '--no-fund'], stage);
  const checker = path.join(root, 'scripts', 'check-runtime-dependencies.mjs');
  run(process.execPath, [checker, stage], stage);
  if (fs.lstatSync(path.join(stage, 'node_modules', 'discord-voip')).isSymbolicLink()) throw new Error('VENDORED_RUNTIME_MUST_NOT_BE_LINKED');
  prepare(promoted);
  fs.renameSync(path.join(stage, 'node_modules'), path.join(promoted, 'node_modules'));
  // Removing the install stage makes accidental absolute links fail as well.
  fs.rmSync(stage, { recursive: true });
  run(process.execPath, [checker, promoted], promoted);
  console.log('[staged-runtime] production install and promotion verified');
} finally {
  const resolved = fs.realpathSync(temporary);
  if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) || !path.basename(resolved).startsWith('cenar-staged-runtime-')) {
    throw new Error('UNSAFE_STAGED_CHECK_CLEANUP');
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}
