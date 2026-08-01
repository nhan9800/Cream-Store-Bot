import { describe, expect, it } from 'vitest';
import { backupTagForEnvironment } from '../src/utils/backupNaming.js';

describe('deployment backup naming', () => {
  it('keeps Store 1 and Store 2 retention namespaces disjoint', () => {
    expect(backupTagForEnvironment('.env')).toBe('store1');
    expect(backupTagForEnvironment('.env.store2')).toBe('store2');
    expect('store2-release.sqlite'.startsWith(`${backupTagForEnvironment('.env')}-`)).toBe(false);
  });

  it('sanitizes custom environment file names', () => {
    expect(backupTagForEnvironment('../.env.preview one')).toBe('env-preview-one');
  });
});
