import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  slots: Object.fromEntries(Array.from({ length: 180 }, (_, index) => [
    `slot_${index}`, { label: `Biểu tượng chức năng ${index}`, default: '✅' },
  ])),
  set: vi.fn(),
  sync: vi.fn(),
  verify: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('../src/services/emojiService.js', () => ({
  EMOJI_SLOTS: state.slots,
  setEmoji: state.set,
  resetAllEmojis: vi.fn(),
  getEmojiMap: () => Object.fromEntries(Object.keys(state.slots).map((key, index) => [
    key, index === 179 ? '' : `<:feature_${index}:1550000000000000100>`,
  ])),
  searchGuildEmojis: vi.fn(),
  parseDiscordEmoji: (value) => /^<a?:\w+:\d+>$/.test(String(value || '')) ? { id: '1550000000000000100' } : null,
  autoSyncGuildEmojis: state.sync,
  resolveVerifiedCustomEmoji: state.verify,
}));
vi.mock('../src/services/panelRefreshService.js', () => ({ refreshAllPanels: state.refresh }));
vi.mock('../src/utils/emojiHelper.js', () => ({
  createEmojiResolver: () => (slot) => `<:${slot}:1550000000000000101>`,
}));

import { execute } from '../src/commands/emoji-setup.js';

beforeEach(() => {
  vi.clearAllMocks();
  state.refresh.mockResolvedValue([]);
  state.sync.mockReturnValue({ syncedCount: 1, updatedSlots: ['slot_0'] });
  state.verify.mockReturnValue('<:verified:1550000000000000102>');
});

function interaction(subcommand, options = {}) {
  return {
    guildId: 'emoji-setup-guild',
    guild: { id: 'emoji-setup-guild', name: 'Cenar' },
    options: { getSubcommand: () => subcommand, getString: (key) => options[key] },
    deferReply: vi.fn(), editReply: vi.fn(), followUp: vi.fn(),
  };
}

describe('custom emoji setup command', () => {
  it('paginates a full semantic registry without exceeding embed limits or losing slots', async () => {
    const request = interaction('list');
    await execute(request);
    const payloads = [...request.editReply.mock.calls, ...request.followUp.mock.calls].map(([payload]) => payload);
    expect(payloads.length).toBeGreaterThan(1);
    const embeds = payloads.flatMap((payload) => payload.embeds.map((embed) => embed.toJSON()));
    expect(embeds.every((embed) => embed.description.length <= 3500)).toBe(true);
    const text = embeds.map((embed) => embed.description).join('\n');
    for (const key of Object.keys(state.slots)) expect(text.split(`Slot: \`${key}\``)).toHaveLength(2);
    expect(text).toContain('Chưa có custom emoji khả dụng');
    expect(text).not.toMatch(/[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u);
    expect(request.followUp.mock.calls.every(([payload]) => payload.ephemeral === true)).toBe(true);
  });

  it('calls the imported inventory synchronizer and reports its result', async () => {
    const request = interaction('sync');
    await execute(request);
    expect(state.sync).toHaveBeenCalledWith(request.guild);
    expect(state.refresh).toHaveBeenCalledWith(request.guild);
    expect(request.editReply.mock.calls[0][0].embeds[0].toJSON().description).toContain('**1** slot(s)');
  });

  it('verifies an emoji against this guild and bot before persisting it', async () => {
    const request = interaction('set', { slot: 'slot_0', emoji: 'verified' });
    await execute(request);
    expect(state.verify).toHaveBeenCalledWith(request.guildId, 'verified');
    expect(state.set).toHaveBeenCalledWith(request.guildId, 'slot_0', '<:verified:1550000000000000102>');
    expect(state.refresh).toHaveBeenCalledWith(request.guild);
  });

  it('rejects unavailable or native emoji without writing or refreshing', async () => {
    state.verify.mockReturnValue('');
    const request = interaction('set', { slot: 'slot_0', emoji: '✅' });
    await execute(request);
    expect(state.set).not.toHaveBeenCalled();
    expect(state.refresh).not.toHaveBeenCalled();
    expect(request.editReply).toHaveBeenCalledWith(expect.stringContaining('Emoji không hợp lệ'));
  });
});
