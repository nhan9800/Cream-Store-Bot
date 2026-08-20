import { describe, expect, it } from 'vitest';
import { normalizeQueueGroup } from '../src/utils/formatters.js';

describe('queue group formatting', () => {
  it('removes custom emoji markup and snowflake ids from product names', () => {
    expect(normalizeQueueGroup('<:boost:1282677129930211380> nichu2m')).toBe('nichu2m');
    expect(normalizeQueueGroup(':claude: apiclaude100m')).toBe('apiclaude100m');
    expect(normalizeQueueGroup('17 1282677129930211380 nichu2m')).toBe('17 nichu2m');
  });
});
