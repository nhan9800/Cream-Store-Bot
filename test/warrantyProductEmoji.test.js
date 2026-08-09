import { afterEach, describe, expect, it } from 'vitest';
import { formatProductDisplayName } from '../src/services/emojiService.js';

const GUILD_ID = '1282637033340403754';
const previousDiscordClient = global.discordClient;

afterEach(() => {
  global.discordClient = previousDiscordClient;
});

describe('warranty product emoji rendering', () => {
  it('converts a legacy Spotify token into the active custom emoji', () => {
    const unrelated = { id: '1999999999999999999', name: 'unrelated', animated: false };
    global.discordClient = {
      guilds: {
        cache: new Map([[GUILD_ID, { emojis: { cache: new Map([[unrelated.id, unrelated]]) } }]]),
      },
      emojis: { cache: new Map() },
    };

    const display = formatProductDisplayName(
      GUILD_ID,
      ':spotify2: spo12m',
      (slot) => slot === 'brand_spotify' ? '<:cenar_spotify:1459181297288220704>' : '',
    );

    expect(display).toBe('<:cenar_spotify:1459181297288220704> spo12m');
  });

  it('removes a deleted unknown token instead of exposing broken emoji text', () => {
    global.discordClient = {
      guilds: { cache: new Map([[GUILD_ID, { emojis: { cache: new Map() } }]]) },
      emojis: { cache: new Map() },
    };

    expect(formatProductDisplayName(GUILD_ID, ':emoji_da_xoa: Gói Spotify')).toBe('Gói Spotify');
  });

  it('rebuilds a custom emoji mention with its current server name', () => {
    const live = { id: '1459181297288220704', name: 'cenar_spotify', animated: false };
    global.discordClient = {
      guilds: {
        cache: new Map([[GUILD_ID, { emojis: { cache: new Map([[live.id, live]]) } }]]),
      },
      emojis: { cache: new Map([[live.id, live]]) },
    };

    expect(formatProductDisplayName(
      GUILD_ID,
      '<:spotify2:1459181297288220704> Spotify Premium 12 tháng',
    )).toBe('<:cenar_spotify:1459181297288220704> Spotify Premium 12 tháng');
  });
});
