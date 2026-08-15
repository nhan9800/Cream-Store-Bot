import { describe, expect, it } from 'vitest';
import {
  SERVER_BOOST_LEVEL3_SALE,
  buildServerBoostLevel3SalePayload,
  isServerBoostLevel3SaleMessage,
} from '../src/campaigns/serverBoostLevel3Sale.js';

describe('Server Boost Level 3 sale campaign', () => {
  it('renders the exact offer and only the large Store 1 member role', () => {
    const payload = buildServerBoostLevel3SalePayload();
    const serialized = JSON.stringify(payload.components.map((component) => component.toJSON()));
    expect(serialized).toContain('NÂNG CẤP SERVER LEVEL 3');
    expect(serialized).toContain('03 tháng');
    expect(serialized).toContain('250.000đ');
    expect(serialized).toContain('05 slot');
    expect(serialized).toContain(SERVER_BOOST_LEVEL3_SALE.marker);
    expect(payload.allowedMentions).toMatchObject({
      parse: ['everyone'],
      roles: ['1282638730812854345'],
      users: [],
    });
  });

  it('detects the campaign marker for idempotent publishing', () => {
    const payload = buildServerBoostLevel3SalePayload();
    const message = {
      author: { id: 'bot' },
      components: payload.components.map((component) => component.toJSON()),
    };
    expect(isServerBoostLevel3SaleMessage(message, 'bot')).toBe(true);
    expect(isServerBoostLevel3SaleMessage(message, 'another-bot')).toBe(false);
  });
});
