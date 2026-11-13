import { Collection } from 'discord.js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config.js', () => ({ config: { guildId: 'announcement-emoji-guild' } }));
vi.mock('../src/database/db.js', async () => {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE guild_settings (
    guild_id TEXT PRIMARY KEY, custom_emojis TEXT, updated_at TEXT,
    ticket_category_id TEXT, order_log_channel_id TEXT, feedback_channel_id TEXT
  )`);
  return { db, nowIso: () => new Date().toISOString() };
});

import { db } from '../src/database/db.js';
import { CORE_UI_EMOJI_ASSETS, CORE_UI_EMOJI_SLOTS } from '../src/config/coreEmojiPack2026.js';
import { resetAllEmojis } from '../src/services/emojiService.js';
import { buildAnnouncementMessageV2, getAnnouncementEmojiReadiness, publishAnnouncement } from '../src/services/announcementService.js';
import { buildAnnouncementModal, buildAnnouncementPreview, createAnnouncementDraft,
  handleAnnouncementDraftInteraction } from '../src/services/announcementDraftService.js';
import { normalizeMessagePresentation } from '../src/utils/discordEmojiBoundary.js';

const guildId = 'announcement-emoji-guild';
const priorClient = global.discordClient;
let applicationEmojis;
beforeEach(() => {
  db.prepare('DELETE FROM guild_settings').run();
  resetAllEmojis(guildId);
  applicationEmojis = new Collection(CORE_UI_EMOJI_ASSETS.map((asset, i) => {
    const emoji = { id: String(1550000000000000100n + BigInt(i)), name: asset.name, animated: false };
    return [emoji.id, emoji];
  }));
  global.discordClient = { guilds: { cache: new Collection() },
    application: { emojis: { cache: applicationEmojis } } };
});
afterEach(() => { global.discordClient = priorClient; });
afterAll(() => db.close());

describe('custom artwork in announcement presentation', () => {
  it('uses live sourced icons in the public header, signature and both action buttons', () => {
    expect(getAnnouncementEmojiReadiness(guildId)).toMatchObject({ ready: true, missing: [] });
    const result = buildAnnouncementMessageV2({ guildId, content: 'Lịch hỗ trợ mới', requireCustomEmoji: true });
    const components = result.components.map(component => component.toJSON());
    const text = components[0].components.filter(component => component.type === 10).map(component => component.content).join('\n');
    expect(text).toContain(`:${CORE_UI_EMOJI_SLOTS.icon_announce}:`);
    expect(text).toContain(`:${CORE_UI_EMOJI_SLOTS.cenar_admin}:`);
    const buttons = components[1].components;
    expect(buttons.map(button => button.emoji.name)).toEqual([
      CORE_UI_EMOJI_SLOTS.partner_rules, CORE_UI_EMOJI_SLOTS.warranty_shield,
    ]);
    expect(new Set(buttons.map(button => button.emoji.id)).size).toBe(2);
    expect(buttons.every(button => !button.label.includes('<:'))).toBe(true);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('decorates five preview controls with distinct live custom art and never pings from the preview', () => {
    const result = buildAnnouncementPreview({ id: 'draft', guildId, content: 'Thông báo mới',
      roles: ['1550000000000000001'], tagEveryone: true, tagHere: true });
    const buttons = result.components.flatMap(row => row.toJSON().components).filter(component => component.type === 2);
    expect(buttons).toHaveLength(5);
    expect(buttons.every(button => applicationEmojis.has(button.emoji.id))).toBe(true);
    expect(new Set(buttons.map(button => button.emoji.id)).size).toBe(5);
    expect(result.allowedMentions).toEqual({ parse: [], users: [], roles: [], repliedUser: false });
  });

  it('refuses strict public publication before send when an icon was deleted from live inventory', async () => {
    const missing = applicationEmojis.find(emoji => emoji.name === CORE_UI_EMOJI_SLOTS.icon_announce);
    applicationEmojis.delete(missing.id);
    expect(getAnnouncementEmojiReadiness(guildId)).toMatchObject({ ready: false, missing: ['announce'] });
    const send = vi.fn();
    const onSend = vi.fn();
    const guild = { id: guildId, channels: { fetch: async () => ({ send, isTextBased: () => true }) },
      members: { me: null, fetchMe: async () => null } };
    await expect(publishAnnouncement({ guild, channelId: '1550000000000000002',
      content: 'Lịch hỗ trợ mới', onSend })).rejects.toMatchObject({
      code: 'ANNOUNCEMENT_EMOJI_NOT_READY', requestNotSent: true,
    });
    expect(onSend).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('explains a missing icon in the draft and leaves edit/retry available', async () => {
    const announce = applicationEmojis.find(emoji => emoji.name === CORE_UI_EMOJI_SLOTS.icon_announce);
    applicationEmojis.delete(announce.id);
    const send = vi.fn();
    const guild = { id: guildId, channels: { fetch: async () => ({ send, isTextBased: () => true }) },
      members: { me: null, fetchMe: async () => null } };
    const interaction = customId => {
      const value = { id: '1570816080459604068', guildId, channelId: '1550000000000000002', guild,
        user: { id: 'admin' }, memberPermissions: { has: () => true }, customId,
        isButton: () => true, isModalSubmit: () => false, isRoleSelectMenu: () => false,
        isFromMessage: () => true, fields: { getTextInputValue: () => 'Lịch hỗ trợ mới' },
        reply: vi.fn(async () => {}), followUp: vi.fn(async () => {}),
        editReply: vi.fn(async () => {}), showModal: vi.fn(async () => {}),
        deferUpdate: vi.fn(async () => { value.deferred = true; }) };
      return value;
    };
    const draft = createAnnouncementDraft(interaction());
    const modal = interaction(buildAnnouncementModal(draft).data.custom_id);
    modal.isModalSubmit = () => true;
    modal.isButton = () => false;
    await handleAnnouncementDraftInteraction(modal);
    const confirm = interaction(`announcement:confirm:${draft.id}`);
    await handleAnnouncementDraftInteraction(confirm);
    expect(confirm.editReply.mock.calls.at(-1)[0].content).toContain('Bộ emoji thông báo đang đồng bộ');
    expect(draft.uncertainAt).toBeUndefined();
    expect(draft.publishing).toBe(false);
    expect(send).not.toHaveBeenCalled();
    const edit = interaction(`announcement:edit:${draft.id}`);
    await handleAnnouncementDraftInteraction(edit);
    expect(edit.showModal).toHaveBeenCalledOnce();
  });

  it('repairs obsolete presentation tokens while preserving authored passwords and URLs literally', () => {
    const literal = '`password:<:gone:1999999999999999999>` https://example.com/:secret:';
    const result = normalizeMessagePresentation({ components: [{ type: 17, components: [{ type: 10,
      content: `:cenar_announce: Tin mới <:gone:1999999999999999999>\n${literal}`,
    }] }] }, guildId);
    const text = result.components[0].components[0].content;
    expect(text).toContain(`:${CORE_UI_EMOJI_SLOTS.icon_announce}:`);
    expect(text.split('\n')[0]).not.toContain('1999999999999999999');
    expect(text).toContain(literal);
  });
});
