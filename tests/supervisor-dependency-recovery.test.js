import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
const source = fs.readFileSync('scripts/vibehost-supervisor.sh', 'utf8').split('trap shutdown_supervisor')[0];
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-dependency-test-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.vibehost'));
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'original'), 'working');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"dependencies":{"nonexistent-cenar-test-package":"1.0.0"}}');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  fs.writeFileSync(path.join(dir, 'functions.sh'), source);
  return dir;
}
describe('supervisor dependency recovery', () => {
  it('a failed staged install leaves the working directory untouched', () => {
    const dir = setup();
    const result = spawnSync(bash, ['-c', 'export VIBEHOST_APP_ROOT="$PWD"; source functions.sh; timeout() { mkdir -p node_modules; return 23; }; install_dependencies'], { cwd: dir, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(fs.readFileSync(path.join(dir, 'node_modules/original'), 'utf8')).toBe('working');
  });
  it('does not activate a completed install that fails runtime validation', () => {
    const dir = setup();
    const result = spawnSync(bash, ['-c', 'export VIBEHOST_APP_ROOT="$PWD"; source functions.sh; timeout() { mkdir -p node_modules; return 0; }; node() { return 1; }; install_dependencies'], { cwd: dir, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(fs.existsSync(path.join(dir, 'node_modules/original'))).toBe(true);
  });
  it('rejects a nonempty but incomplete node_modules directory', () => {
    const dir = setup();
    const result = spawnSync(process.execPath, ['scripts/check-runtime-dependencies.mjs', dir], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('[runtime-deps] invalid');
  });
  it('does not accept dependencies inherited from the parent application', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-parent-dependencies-'));
    dirs.push(dir);
    fs.symlinkSync(path.resolve('node_modules'), path.join(dir, 'node_modules'), 'junction');
    const stage = path.join(dir, 'stage');
    fs.mkdirSync(stage);
    fs.copyFileSync('package.json', path.join(stage, 'package.json'));
    fs.copyFileSync('package-lock.json', path.join(stage, 'package-lock.json'));
    const result = spawnSync(process.execPath, ['scripts/check-runtime-dependencies.mjs', stage], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('[runtime-deps] invalid');
  });

  it('backs up when the panel pre-pulled the target but the installed marker is older', () => {
    const dir = setup();
    fs.writeFileSync(path.join(dir, '.vibehost', 'installed-revision'), 'previoussha\n');
    const result = spawnSync(bash, ['-c', [
      'export VIBEHOST_APP_ROOT="$PWD"',
      'source functions.sh',
      'git() { if [[ "$1" == rev-parse && "$2" == HEAD ]]; then printf targetsha; return 0; fi; if [[ "$1" == reset && "$2" == --hard && "${3:-}" == targetsha ]]; then return 0; fi; return 0; }',
      'runtime_valid() { return 0; }',
      'install_dependencies_for_transition() { return 0; }',
      'validate_environment() { return 0; }',
      'backup_databases() { printf "%s" "$1" > backup-revision; }',
      'SUPERVISOR_HASH=supervisor-hash',
      'sha256sum() { printf "%s  scripts/vibehost-supervisor.sh\\n" "$SUPERVISOR_HASH"; }',
      'install_revision targetsha',
    ].join('; ')], { cwd: dir, encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(fs.readFileSync(path.join(dir, 'backup-revision'), 'utf8')).toBe('previoussha');
    expect(fs.readFileSync(path.join(dir, '.vibehost', 'installed-revision'), 'utf8').trim()).toBe('targetsha');
  });
});
