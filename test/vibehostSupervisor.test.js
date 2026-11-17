import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const supervisorPath = new URL('../scripts/vibehost-supervisor.sh', import.meta.url);

describe('VibeHost supervisor dependency staging', () => {
  it('copies local vendor dependencies before isolated npm ci', async () => {
    const source = await readFile(supervisorPath, 'utf8');

    expect(source).toContain('if [[ -d vendor ]]; then');
    expect(source).toContain('cp -a vendor "$stage/" || return 1');
    expect(source.indexOf('cp -a vendor "$stage/"')).toBeLessThan(
      source.indexOf("npm ci --omit=dev --no-audit --no-fund"),
    );
  });
});
