import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const UNICODE_EMOJI = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u;

function sourceFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return entry.name.endsWith('.js') ? [fullPath] : [];
  });
}

describe('Discord component emoji policy', () => {
  it('does not pass default Unicode emoji to setEmoji()', () => {
    const violations = [];
    for (const file of sourceFiles(path.resolve('src'))) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        if (line.includes('setEmoji') && UNICODE_EMOJI.test(line)) {
          violations.push(`${path.relative(process.cwd(), file)}:${index + 1}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });
});
