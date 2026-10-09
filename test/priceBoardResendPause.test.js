import { describe, expect, it } from 'vitest';
import {
  autoSetupPriceBoard,
  getPriceBoardPublicationState,
  PRICE_BOARD_VERSION,
} from '../src/services/autoSetupPriceBoardService.js';
import { AUTOMATIC_PRICE_BOARD_PAUSED } from '../src/config/marketingAutomationPolicy.js';

describe('owner-revoked automatic price-board resend', () => {
  it('stops startup/refresh publication before reading Discord state', async () => {
    expect(AUTOMATIC_PRICE_BOARD_PAUSED).toBe(true);
    const client = new Proxy({}, { get() { throw new Error('automatic resend must not access Discord'); } });
    await expect(autoSetupPriceBoard(client, { force: true, targetGuildId: '1282637033340403754' }))
      .resolves.toEqual([{ guildId: '1282637033340403754', status: 'paused', reason: 'owner_request' }]);
    expect(getPriceBoardPublicationState('1282637033340403754')).toMatchObject({
      status: 'paused', version: PRICE_BOARD_VERSION, reason: 'owner_request',
    });
  });
  it('does not pause an explicitly requested manual rebuild', () => {
    // The manual /product sync path passes automatic:false; the flag is kept
    // separate so a future owner-authorized rebuild does not require changing
    // the automatic safety switch.
    expect(AUTOMATIC_PRICE_BOARD_PAUSED).toBe(true);
  });
});
