import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/database/db.js', () => ({
  db: {
    prepare: vi.fn(() => ({
      get: vi.fn(() => null),
      run: vi.fn(),
    })),
  },
}));

vi.mock('../src/utils/permissions.js', () => ({
  isBotDeveloper: vi.fn(() => false),
  hasConfiguredOwnerRole: vi.fn(() => false),
}));

vi.mock('../src/utils/emojiHelper.js', () => ({
  createEmojiResolver: vi.fn(() => (key) => key),
}));

import { execute } from '../src/commands/setadmin.js';
import { hasConfiguredOwnerRole, isBotDeveloper } from '../src/utils/permissions.js';

function interaction({ userId = 'owner', ownerId = 'owner' } = {}) {
  return {
    user: { id: userId },
    guildId: 'guild-1',
    guild: { ownerId },
    options: {
      getString: vi.fn((name) => (name === 'email' ? 'owner@example.com' : 'admin')),
    },
    reply: vi.fn(),
    deferReply: vi.fn(),
    editReply: vi.fn(),
  };
}

describe('/setadmin permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isBotDeveloper.mockReturnValue(false);
    hasConfiguredOwnerRole.mockReturnValue(false);
  });

  it('allows the Discord server owner through the permission gate', async () => {
    const mockInteraction = interaction();

    await execute(mockInteraction);

    expect(mockInteraction.reply).not.toHaveBeenCalled();
    expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
  });

  it('rejects a non-owner who is not a configured bot developer', async () => {
    const mockInteraction = interaction({ userId: 'member', ownerId: 'owner' });

    await execute(mockInteraction);

    expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    expect(mockInteraction.deferReply).not.toHaveBeenCalled();
  });

  it('allows a member with a configured Owner role', async () => {
    const mockInteraction = interaction({ userId: 'role-owner', ownerId: 'server-owner' });
    hasConfiguredOwnerRole.mockReturnValue(true);

    await execute(mockInteraction);

    expect(mockInteraction.reply).not.toHaveBeenCalled();
    expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
  });
});
