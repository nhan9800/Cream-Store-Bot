import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Collection, MessageFlags } from 'discord.js';
import { CORE_UI_EMOJI_ASSETS } from '../src/config/coreEmojiPack2026.js';
import { createEmojiResolver } from '../src/utils/emojiHelper.js';
import {
  TRANSCRIPT_ARCHIVE_LAUNCH,
  buildTranscriptArchiveLaunchMessage,
  buildTranscriptArchiveLaunchSections,
} from '../src/campaigns/transcriptArchiveLaunch2026.js';

const NATIVE_EMOJI = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u;

const previousClient = global.discordClient;
const liveInventory = new Collection(CORE_UI_EMOJI_ASSETS.map((asset, index) => {
  const id = String(1550000000000000600n + BigInt(index));
  return [id, { id, name: asset.name, animated: false }];
}));
const emojiResolver = createEmojiResolver(TRANSCRIPT_ARCHIVE_LAUNCH.guildId);
beforeAll(() => {
  global.discordClient = {
    guilds: { cache: new Collection([[TRANSCRIPT_ARCHIVE_LAUNCH.guildId,
      { id: TRANSCRIPT_ARCHIVE_LAUNCH.guildId, emojis: { cache: new Collection() } }]]) },
    application: { emojis: { cache: liveInventory } },
  };
});
afterAll(() => { global.discordClient = previousClient; });

describe('secure transcript launch announcement', () => {
  it('explains the customer experience, storage and privacy rules', () => {
    const sections = buildTranscriptArchiveLaunchSections(
      TRANSCRIPT_ARCHIVE_LAUNCH.guildId,
      emojiResolver,
    );
    const content = Object.values(sections).join('\n');

    expect(content).toContain('liên kết riêng tư');
    expect(content).toContain('Tìm kiếm nhanh');
    expect(content).toContain('in/lưu PDF');
    expect(content).toContain('GZIP');
    expect(content).toContain('phục hồi từ bản sao dự phòng trên Discord');
    expect(content).toContain('không được công cụ tìm kiếm lập chỉ mục');
    expect(content).toContain('Liên kết chính là chìa khóa truy cập');
    expect(content).toContain(TRANSCRIPT_ARCHIVE_LAUNCH.marker);
    expect(content).not.toMatch(NATIVE_EMOJI);
  });

  it('builds a zero-mention Components V2 payload with custom emoji buttons', () => {
    const payload = buildTranscriptArchiveLaunchMessage({
      guildId: TRANSCRIPT_ARCHIVE_LAUNCH.guildId,
      E: emojiResolver,
    });
    const json = JSON.stringify(payload);

    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(payload.allowedMentions).toEqual({
      parse: [], roles: [], users: [], repliedUser: false,
    });
    expect(json).not.toContain('@everyone');
    expect(json).not.toContain('@here');
    expect(payload.components).toHaveLength(5);
    expect(json).toContain(TRANSCRIPT_ARCHIVE_LAUNCH.storeUrl);
    expect(json).toContain(TRANSCRIPT_ARCHIVE_LAUNCH.privacyUrl);
    expect(json).toContain(TRANSCRIPT_ARCHIVE_LAUNCH.supportChannelId);

    const buttons = payload.components.at(-1).toJSON().components;
    expect(buttons).toHaveLength(3);
    expect(buttons.every((button) => button.emoji?.id)).toBe(true);
    expect(buttons.every((button) => liveInventory.has(button.emoji.id))).toBe(true);
  });
});
