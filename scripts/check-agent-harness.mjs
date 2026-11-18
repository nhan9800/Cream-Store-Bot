import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const indexedPaths = new Set(git('ls-files', '-z').split('\0').filter(Boolean));
const problems = [];
const map = readFileSync(resolve(root, 'AGENTS.md'), 'utf8');
const links = new Set(Array.from(map.matchAll(/\]\((docs\/[^)#\s]+)(?:#[^)\s]+)?\)/g), (match) => match[1]));

if (!links.has('docs/agent-harness.md')) {
  problems.push('AGENTS.md must link to docs/agent-harness.md.');
}

for (const link of links) {
  const target = resolve(root, link);
  if (!target.startsWith(resolve(root, 'docs') + sep)
    || !indexedPaths.has(link)
    || !lstatSync(target, { throwIfNoEntry: false })?.isFile()) {
    problems.push(`AGENTS.md guide is missing from this checkout or Git index: ${JSON.stringify(link)}`);
  }
}

// Check only filenames. This never opens environment files, databases, or recovery data.
const privatePaths = [...indexedPaths].filter((file) => {
  const components = file.toLowerCase().split('/');
  const name = components.at(-1);
  return components.some(part => ['.project-memory', 'recovery-backups'].includes(part))
    || (name.startsWith('.env.') && name !== '.env.example')
    || name === '.env'
    || /\.(sqlite3?|db)(?:-(?:wal|shm|journal))?$/.test(name);
});

if (privatePaths.length) {
  problems.push(`Git index contains ${privatePaths.length} private path(s). Review indexed filenames before committing.`);
}

if (problems.length) {
  for (const problem of problems) console.error(problem);
  process.exitCode = 1;
} else {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
  const commit = git('rev-parse', 'HEAD').trim();
  const state = git('status', '--porcelain=v1').length === 0 ? 'clean' : 'has changes';
  console.log(`Agent harness OK: ${links.size} guide links, Node ${process.version}, ${branch} at ${commit} (${state}).`);
}
