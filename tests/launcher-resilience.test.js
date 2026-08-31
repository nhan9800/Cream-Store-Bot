import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('launcher resilience', () => {
  it('lets the supervisor restart when one store child exits unexpectedly', () => {
    const source = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
    expect(source).toContain('childExitHandled');
    expect(source).toContain("void shutdownLauncher('CHILD_EXIT', 1)");
    expect(source).toContain('if (launcherStopping || childExitHandled) return;');
  });
});
