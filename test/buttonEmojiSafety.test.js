import { afterEach, describe, expect, it, vi } from 'vitest';
import { ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { buildAnnouncementMessageV2, isPriceRelatedAnnouncement, publishAnnouncement } from '../src/services/announcementService.js';
import { buildCardPanelPayload } from '../src/services/cardPanelService.js';
import { buildCreditOfferV2 } from '../src/utils/embeds.js';
import { normalizeButtonEmoji, withButtonEmoji } from '../src/utils/emojiHelper.js';
import { safeReply } from '../src/events/shared.js';
import { sendTicketComponents } from '../src/events/ticketHandlers.js';

const GUILD_ID = '1070676180103086132';
const previousDiscordClient = global.discordClient;

afterEach(() => {
  global.discordClient = previousDiscordClient;
});

describe('safe custom emoji components', () => {
  it('does not pass null, undefined or unicode emoji into ButtonBuilder.setEmoji', () => {
    const button = new ButtonBuilder()
      .setCustomId('safe:test')
      .setLabel('Safe')
      .setStyle(ButtonStyle.Secondary);

    expect(() => withButtonEmoji(button, null, undefined, '', '🔒')).not.toThrow();
    expect(button.toJSON().emoji).toBeUndefined();
  });

  it('normalizes a valid custom emoji and keeps it on the button', () => {
    const button = withButtonEmoji(
      new ButtonBuilder().setCustomId('safe:valid').setLabel('Valid').setStyle(ButtonStyle.Primary),
      '<a:cenar_loading:1535910626088583190>',
    );

    expect(normalizeButtonEmoji(button.toJSON().emoji)).toEqual({
      id: '1535910626088583190',
      name: 'cenar_loading',
      animated: true,
    });
  });

  it('builds the full card panel when the guild has none of the mapped emoji IDs', () => {
    const unrelatedEmoji = {
      id: '1999999999999999999',
      name: 'unrelated',
      animated: false,
    };
    global.discordClient = {
      guilds: {
        cache: new Map([[GUILD_ID, { emojis: { cache: new Map([[unrelatedEmoji.id, unrelatedEmoji]]) } }]]),
      },
      emojis: { cache: new Map() },
    };

    let payload;
    expect(() => {
      payload = buildCardPanelPayload(GUILD_ID);
    }).not.toThrow();

    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    const json = payload.components.map((component) => component.toJSON());
    const buttons = json[1].components;
    expect(buttons).toHaveLength(4);
    expect(buttons.every((button) => button.emoji === undefined)).toBe(true);
  });

  it('builds the BNPL ticket controls without stale hard-coded emoji IDs', () => {
    const unrelatedEmoji = {
      id: '1999999999999999999',
      name: 'unrelated',
      animated: false,
    };
    global.discordClient = {
      guilds: {
        cache: new Map([[GUILD_ID, { emojis: { cache: new Map([[unrelatedEmoji.id, unrelatedEmoji]]) } }]]),
      },
      emojis: { cache: new Map() },
    };

    const payload = buildCreditOfferV2({ limit: 500_000, available: 350_000 }, 'customer-1', GUILD_ID);
    const buttons = payload.row.toJSON().components;
    const text = payload.container.toJSON().components
      .filter((component) => component.type === 10)
      .map((component) => component.content)
      .join('\n');

    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => button.emoji === undefined)).toBe(true);
    expect(text).not.toContain('1481127479702847646');
    expect(text).not.toContain('1442876095442714748');
  });

  it('converts deprecated ephemeral replies to Discord message flags', async () => {
    const interaction = {
      id: 'interaction-1',
      createdTimestamp: Date.now(),
      replied: false,
      deferred: false,
      reply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    };

    await safeReply(interaction, { content: 'private', ephemeral: true });
    const response = interaction.reply.mock.calls[0][0];
    expect(response).not.toHaveProperty('ephemeral');
    expect(response.flags & MessageFlags.Ephemeral).toBeTruthy();
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  it('retries ticket creation without component emojis when Discord rejects a stale ID', async () => {
    const invalidEmojiError = Object.assign(new Error('Invalid Form Body'), {
      code: 50035,
      rawError: {
        errors: {
          components: {
            3: { components: { 1: { emoji: { id: { _errors: [{ code: 'COMPONENT_INVALID_EMOJI' }] } } } } },
          },
        },
      },
    });
    const channel = {
      id: 'ticket-channel-1',
      send: vi.fn()
        .mockRejectedValueOnce(invalidEmojiError)
        .mockResolvedValueOnce({ id: 'welcome-message' }),
    };
    const payload = {
      flags: MessageFlags.IsComponentsV2,
      components: [{
        type: 1,
        components: [{
          type: 2,
          custom_id: 'ticket:credit_rules',
          label: 'Xem Quy Chế',
          style: 2,
          emoji: { id: '1481127479702847646', name: 'verifybadge' },
        }],
      }],
    };

    await expect(sendTicketComponents(channel, payload)).resolves.toEqual({ id: 'welcome-message' });
    expect(channel.send).toHaveBeenCalledTimes(2);
    expect(channel.send.mock.calls[1][0].components[0].components[0]).not.toHaveProperty('emoji');
  });

  it('builds /thongbao safely and limits mentions to the selected targets', () => {
    const unrelatedEmoji = {
      id: '1999999999999999999',
      name: 'unrelated',
      animated: false,
    };
    global.discordClient = {
      guilds: {
        cache: new Map([[GUILD_ID, { emojis: { cache: new Map([[unrelatedEmoji.id, unrelatedEmoji]]) } }]]),
      },
      emojis: { cache: new Map() },
    };

    const payload = buildAnnouncementMessageV2({
      guildId: GUILD_ID,
      content: 'Nội dung kiểm thử',
      roleIds: ['123456789012345678', 'invalid', '123456789012345678'],
      tagEveryone: true,
    });

    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(payload.allowedMentions).toEqual({
      parse: ['everyone'],
      roles: ['123456789012345678'],
      users: [],
      repliedUser: false,
    });

    const json = payload.components.map((component) => component.toJSON());
    expect(json[1].components).toHaveLength(2);
    expect(json[1].components.every((button) => button.emoji === undefined)).toBe(true);
  });

  it('does not report /thongbao success when Discord rejects the message', async () => {
    const guild = {
      id: GUILD_ID,
      channels: {
        fetch: async () => ({
          isTextBased: () => true,
          isThread: () => false,
          send: async () => {
            throw new Error('Unknown Emoji');
          },
        }),
      },
      members: {
        me: null,
        fetchMe: async () => null,
      },
    };

    await expect(publishAnnouncement({
      guild,
      channelId: '123456789012345679',
      content: 'Nội dung kiểm thử',
    })).rejects.toThrow('Unknown Emoji');
  });

  it('recognizes pricing announcements without treating ordinary participation text as pricing', () => {
    expect(isPriceRelatedAnnouncement('Thông báo tăng giá Nitro lên 115k từ hôm nay')).toBe(true);
    expect(isPriceRelatedAnnouncement('Bảng giá mới đã được cập nhật')).toBe(true);
    expect(isPriceRelatedAnnouncement('Mời mọi người tham gia sự kiện cuối tuần')).toBe(false);
  });
});
