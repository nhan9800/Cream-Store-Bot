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
});
