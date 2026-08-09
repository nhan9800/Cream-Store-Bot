import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const interactionSource = readFileSync(
  new URL('../src/events/interactionCreate.js', import.meta.url),
  'utf8',
);

describe('YouTube warranty handler safety', () => {
  it('does not shadow module-level Discord builders inside warranty flows', () => {
    const start = interactionSource.indexOf('// Xử lý duyệt bảo hành YouTube Premium - Đồng Ý');
    const end = interactionSource.indexOf('// Xử lý khi khách bấm nút sao feedback đơn boost');
    const warrantySection = interactionSource.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(warrantySection).not.toMatch(
      /const\s+\{[^}]*\bEmbedBuilder\b[^}]*\}\s*=\s*await\s+import\(['"]discord\.js['"]\)/,
    );
  });
});
