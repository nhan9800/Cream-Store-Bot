import { describe, expect, test } from 'vitest';
import {
  PROSETTINGS_EMOJI_INDEX,
  STORE_ONE_CHANNEL_DESIGN,
  STORE_ONE_CHANNEL_NAMES,
  channelLeadingEmoji,
} from '../src/config/storeOneChannelAesthetic.js';

describe('Store 1 channel aesthetic', () => {
  test('assigns one distinct ProSettings 442+ emoji to every fixed channel', () => {
    const names = Object.values(STORE_ONE_CHANNEL_DESIGN);
    const emojis = names.map(channelLeadingEmoji);

    expect(names).toHaveLength(66);
    expect(emojis.every(Boolean)).toBe(true);
    expect(new Set(emojis).size).toBe(emojis.length);
    for (const emoji of emojis) {
      expect(PROSETTINGS_EMOJI_INDEX[emoji]).toBeGreaterThanOrEqual(442);
      const baseEmoji = [...emoji].filter((character) => character !== '\uFE0F').join('');
      const hasNativeColorPresentation = /^\p{Emoji_Presentation}+$/u.test(baseEmoji);
      expect(hasNativeColorPresentation || emoji.endsWith('\uFE0F')).toBe(true);
    }
  });

  test('keeps bot-managed workspaces on the shared naming source', () => {
    expect(STORE_ONE_CHANNEL_NAMES.premiumCategory).toBe('💎 ｜ ──・ SẢN PHẨM PREMIUM');
    expect(STORE_ONE_CHANNEL_NAMES.partnerCategory).toBe('🦄 ｜ ──・ CENAR PARTNER');
    expect(STORE_ONE_CHANNEL_NAMES.ctvCategory).toBe('🐝 ｜ ──・ CENAR CTV');
    expect(STORE_ONE_CHANNEL_NAMES.adminOrderCategory).toBe('🐙 ｜ ──・ QUẢN TRỊ ĐƠN HÀNG');
  });

  test('avoids muted symbols that look unloaded on Discord dark mode', () => {
    const mutedSymbols = new Set([
      '🛰️', '🗂️', '🛠️', '🎖️', '🗃️', '🕰️', '🎟️', '🖥️',
      '🕸️', '🎧', '🎞️', '⚙️', '⌨️', '🖼️', '🎙️', '🛡️',
      '🔊', '🔗', '🗺️', '🦅', '🧷',
    ]);
    const emojis = Object.values(STORE_ONE_CHANNEL_DESIGN).map(channelLeadingEmoji);

    expect(emojis.some((emoji) => mutedSymbols.has(emoji))).toBe(false);
  });
});
