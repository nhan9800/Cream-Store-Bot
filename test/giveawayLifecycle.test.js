import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
}));

vi.mock('../src/database/db.js', () => ({
  db: { prepare: mocks.prepare },
}));

vi.mock('../src/utils/emojiHelper.js', () => ({
  createEmojiResolver: vi.fn(() => (key) => key),
}));

vi.mock('../src/services/walletService.js', () => ({
  getWalletBalance: vi.fn(),
  addWalletBalance: vi.fn(),
}));

import { autoSetupGiveawayChannel } from '../src/services/autoSetupGiveawayService.js';
import { cancelBotHostedGiveaways, endGiveaway } from '../src/services/giveawayService.js';

describe('giveaway lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never creates an automatic giveaway on startup', async () => {
    await expect(autoSetupGiveawayChannel()).resolves.toEqual({ enabled: false, created: 0 });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('cancels and removes active giveaways hosted by the bot', async () => {
    const transitionRun = vi.fn(() => ({ changes: 1 }));
    mocks.prepare.mockImplementation((sql) => {
      if (sql.includes('SELECT message_id, channel_id')) {
        return { all: vi.fn(() => [{ message_id: 'message-1', channel_id: 'channel-1' }]) };
      }
      if (sql.includes('UPDATE giveaways')) return { run: transitionRun };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const deleteMessage = vi.fn(async () => undefined);
    const fetchMessage = vi.fn(async () => ({ delete: deleteMessage }));
    const client = {
      user: { id: 'bot-1' },
      channels: { fetch: vi.fn(async () => ({ messages: { fetch: fetchMessage } })) },
    };

    await expect(cancelBotHostedGiveaways(client)).resolves.toEqual({ cancelled: 1, deleted: 1 });
    expect(transitionRun).toHaveBeenCalledWith('CANCELLED', 'message-1', 'ACTIVE');
    expect(deleteMessage).toHaveBeenCalledOnce();
  });

  it('does not announce an end when another process already claimed it', async () => {
    mocks.prepare.mockImplementation((sql) => {
      if (sql.startsWith('SELECT * FROM giveaways')) {
        return { get: vi.fn(() => ({ message_id: 'message-1', channel_id: 'channel-1' })) };
      }
      if (sql.includes('UPDATE giveaways')) return { run: vi.fn(() => ({ changes: 0 })) };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const client = { channels: { fetch: vi.fn() } };
    await expect(endGiveaway(client, 'message-1')).resolves.toBeNull();
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });
});
