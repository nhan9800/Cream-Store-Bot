import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const supervisorPath = new URL('../scripts/vibehost-supervisor.sh', import.meta.url);

describe('VibeHost supervisor dependency staging', () => {
  it('copies the packed vendor runtime before isolated npm ci', async () => {
    const source = await readFile(supervisorPath, 'utf8');

    expect(source).toContain('cp vendor/discord-voip-7.2.0-cenar.1.tgz "$stage/vendor/" || return 1');
    expect(source.indexOf('cp vendor/discord-voip-7.2.0-cenar.1.tgz')).toBeLessThan(
      source.indexOf("npm ci --omit=dev --no-audit --no-fund"),
    );
  });
});
