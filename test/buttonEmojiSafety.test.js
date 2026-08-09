import { afterEach, describe, expect, it } from 'vitest';
import { ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { buildCardPanelPayload } from '../src/services/cardPanelService.js';
import { normalizeButtonEmoji, withButtonEmoji } from '../src/utils/emojiHelper.js';

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
});
