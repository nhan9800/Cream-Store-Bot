import { describe, expect, it } from 'vitest';
import { priceBoardChannelId, STORE_FORUMS } from '../src/config/storeForums202611.js';

describe('price board links', () => {
  it('sends Store1 customers to the live price forum, never the deleted text channel', () => {
    expect(priceBoardChannelId(STORE_FORUMS.guildId, { price_list_channel_id: '1514606995842273280' })).toBe('1568246895812280350');
  });
  it('uses the configured channel for other stores and omits the link when none exists', () => {
    expect(priceBoardChannelId('store2', { price_list_channel_id: '999' })).toBe('999');
    expect(priceBoardChannelId('store2', null)).toBeNull();
  });
});
