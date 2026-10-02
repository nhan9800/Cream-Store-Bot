import { Collection, ButtonBuilder, ButtonStyle } from 'discord.js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/database/db.js', async () => {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE guild_settings (
    guild_id TEXT PRIMARY KEY, custom_emojis TEXT, updated_at TEXT,
    ticket_category_id TEXT, order_log_channel_id TEXT, feedback_channel_id TEXT,
    financial_marker TEXT DEFAULT 'untouched'
  )`);
  return { db, nowIso: () => new Date().toISOString() };
});

import { db } from '../src/database/db.js';
import {
  applyVerifiedEmojiMappings, autoSyncGuildEmojis, getEmoji, getEmojiMap,
  parseDiscordEmoji, resetAllEmojis, resolveEmojiText, resolveLiveCustomEmoji,
  resolveProductEmoji, resolveSelectMenuEmoji, resolveVerifiedCustomEmoji,
  sanitizeCustomEmojiText, setEmoji,
} from '../src/services/emojiService.js';
import { createEmojiResolver, normalizeButtonEmoji, withButtonEmoji } from '../src/utils/emojiHelper.js';

const guildId = 'test-live-emoji-guild';
const previousClient = global.discordClient;
let guild;
let app;
const emoji = (id, name, animated = false, extras = {}) => ({ id, name, animated, ...extras });
beforeEach(() => {
  db.prepare('DELETE FROM guild_settings').run();
  resetAllEmojis(guildId);
  guild = { id: guildId, emojis: { cache: new Collection() } };
  app = new Collection();
  global.discordClient = { guilds: { cache: new Collection([[guildId, guild]]) },
    application: { emojis: { cache: app } }, emojis: { cache: new Collection() } };
});
afterEach(() => { global.discordClient = previousClient; });
afterAll(() => db.close());

describe('live verified emoji resolution', () => {
  it('rejects stale raw and configured IDs while the cache is empty or unavailable', () => {
    db.prepare('INSERT INTO guild_settings (guild_id, custom_emojis) VALUES (?, ?)')
      .run(guildId, JSON.stringify({ icon_star: '<:old_star:1550000000000000001>' }));
    expect(getEmoji(guildId, 'icon_star')).toBe('');
    expect(getEmojiMap(guildId).icon_star).toBe('');
    expect(resolveProductEmoji(guildId, '<:old_star:1550000000000000001>')).toBe('');
    expect(normalizeButtonEmoji('<:old_star:1550000000000000001>')).toBeNull();
    global.discordClient = undefined;
    expect(resolveVerifiedCustomEmoji(guildId, '<:old_star:1550000000000000001>')).toBe('');
    expect(createEmojiResolver(guildId)('icon_star')).toBe('');
  });

  it('accepts live application artwork even when the target guild has a different nonempty emoji inventory', () => {
    const unrelated = emoji('1550000000000000001', 'unrelated');
    guild.emojis.cache.set(unrelated.id, unrelated);
    const fresh = emoji('1550000000000000002', 'cenar_ui26_star');
    app.set(fresh.id, fresh);
    expect(getEmoji(guildId, 'icon_star')).toBe(`<:${fresh.name}:${fresh.id}>`);
    expect(resolveSelectMenuEmoji(guildId, 'icon_star')).toEqual({ id: fresh.id, name: fresh.name, animated: false });
    expect(createEmojiResolver(guildId).component('icon_star')).toEqual({ id: fresh.id, name: fresh.name, animated: false });
  });

  it('uses the actual renamed name and animation from inventory instead of stored metadata', () => {
    const live = emoji('1550000000000000003', 'cenar_spotify', true);
    guild.emojis.cache.set(live.id, live);
    db.prepare('INSERT INTO guild_settings (guild_id, custom_emojis) VALUES (?, ?)')
      .run(guildId, JSON.stringify({ brand_spotify: `<:spotify2:${live.id}>` }));
    expect(getEmoji(guildId, 'brand_spotify')).toBe(`<a:${live.name}:${live.id}>`);
    expect(resolveVerifiedCustomEmoji(guildId, `<:old_name:${live.id}>`)).toBe(`<a:${live.name}:${live.id}>`);
    expect(normalizeButtonEmoji({ id: live.id, name: 'old_name', animated: false }, { guildId }))
      .toEqual({ id: live.id, name: live.name, animated: true });
  });

  it('does not treat a different guild or the unscoped global cache as the target guild inventory', () => {
    const external = emoji('1550000000000000004', 'external');
    global.discordClient.guilds.cache.set('other-guild', { id: 'other-guild', emojis: { cache: new Collection([[external.id, external]]) } });
    global.discordClient.emojis.cache.set(external.id, external);
    expect(resolveVerifiedCustomEmoji(guildId, `<:external:${external.id}>`)).toBe('');
    expect(resolveVerifiedCustomEmoji(null, external, { allowAnyGuild: true })).toBe(`<:external:${external.id}>`);
  });

  it('prefers new semantic core artwork over an old icon that is still live, while retaining live product brands', () => {
    const old = emoji('1550000000000000005', 'cr_shop');
    const brand = emoji('1550000000000000006', 'cenar_spotify');
    const fresh = emoji('1550000000000000007', 'cenar_ui26_store');
    guild.emojis.cache.set(old.id, old).set(brand.id, brand);
    app.set(fresh.id, fresh);
    expect(resolveLiveCustomEmoji(`<:cr_shop:${old.id}>`, guildId)).toBe(`<:${fresh.name}:${fresh.id}>`);
    expect(resolveEmojiText(`<:cr_shop:${old.id}> Store <:spotify:${brand.id}> Spotify`, guildId))
      .toBe(`<:${fresh.name}:${fresh.id}> Store <:${brand.name}:${brand.id}> Spotify`);
  });

  it('existing resolver instances observe replacement and deletion immediately', () => {
    const first = emoji('1550000000000000008', 'cenar_ui26_check');
    app.set(first.id, first);
    const E = createEmojiResolver(guildId);
    expect(E('status_check')).toContain(first.id);
    app.delete(first.id);
    expect(E('status_check')).toBe('');
    const replacement = emoji('1550000000000000009', 'cenar_ui26_check');
    app.set(replacement.id, replacement);
    expect(E('status_check')).toContain(replacement.id);
  });

  it('binds all verified aliases atomically, preserves guild commerce fields, and rejects an unverified batch without partial changes', () => {
    const fresh = emoji('1550000000000000010', 'cenar_ui26_check');
    app.set(fresh.id, fresh);
    const result = applyVerifiedEmojiMappings(guild, { status_check: fresh, cenar_verified: fresh });
    expect(result.updatedSlots).toEqual(['status_check']);
    expect(getEmoji(guildId, 'cenar_verified')).toContain(fresh.id);
    const rowBefore = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
    expect(rowBefore.financial_marker).toBe('untouched');
    expect(() => applyVerifiedEmojiMappings(guild, { status_check: fresh, icon_star: '<:dead:1550000000000000011>' }))
      .toThrow('EMOJI_NOT_VERIFIED:icon_star');
    expect(db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId)).toEqual(rowBefore);
  });

  it('prunes a stale mapping only when explicitly requested after a successful fetch', () => {
    db.prepare('INSERT INTO guild_settings (guild_id, custom_emojis) VALUES (?, ?)')
      .run(guildId, JSON.stringify({ brand_adobe: '<:removed_adobe:1550000000000000012>' }));
    autoSyncGuildEmojis(guild);
    expect(JSON.parse(db.prepare('SELECT custom_emojis FROM guild_settings WHERE guild_id = ?').get(guildId).custom_emojis)).toHaveProperty('brand_adobe');
    expect(autoSyncGuildEmojis(guild, { pruneStale: true }).removedSlots).toContain('brand_adobe');
    expect(JSON.parse(db.prepare('SELECT custom_emojis FROM guild_settings WHERE guild_id = ?').get(guildId).custom_emojis)).not.toHaveProperty('brand_adobe');
  });

  it('retains text, prices, mentions and literal credential code fences while replacing only emoji tokens', () => {
    const user = emoji('1550000000000000013', 'cenar_ui26_user');
    app.set(user.id, user);
    const content = 'Mã đơn: CN_123456\nKhách: <:verifybadge:1481127479702847646> <@123>\nGiá: **150.000đ**\n<:unknown_removed:1550000000000000044>  done\n```json\n{"secret":":unknown_removed:"}\n```';
    const normalized = sanitizeCustomEmojiText(guildId, content, { legacySlots: { '1481127479702847646': 'ticket_user' } });
    expect(normalized).toBe(`Mã đơn: CN_123456\nKhách: <:${user.name}:${user.id}> <@123>\nGiá: **150.000đ**\n  done\n\`\`\`json\n{"secret":":unknown_removed:"}\n\`\`\``);
  });

  it('preserves clocks, IPv6 URLs, unknown colon sequences and protected credential spans', () => {
    const fresh = emoji('1550000000000000045', 'cenar_ui26_store');
    app.set(fresh.id, fresh);
    const content = '20:30:15 · 09:00:00 · :unknown_password: · https://[2001:db8:1234::1]/:cr_shop:\n`<:cr_shop:1392749981332541501>`\n||:cr_shop:literal-secret||\n```\n:cr_shop:json-secret\n```\n:cr_shop: ngoài dữ liệu';
    expect(sanitizeCustomEmojiText(guildId, content)).toBe(content.replace(':cr_shop: ngoài dữ liệu', `<:${fresh.name}:${fresh.id}> ngoài dữ liệu`));
  });

  it('omits deleted component emoji, preserves usable buttons, and rejects malformed custom values', () => {
    const fresh = emoji('1550000000000000014', 'cenar_ui26_ticket');
    app.set(fresh.id, fresh);
    const button = withButtonEmoji(new ButtonBuilder().setCustomId('test:safe').setLabel('Ticket').setStyle(ButtonStyle.Primary),
      { id: '1550000000000000015', name: 'dead_unknown' }, fresh);
    expect(button.toJSON().emoji).toEqual({ id: fresh.id, name: fresh.name, animated: false });
    expect(normalizeButtonEmoji('not-emoji')).toBeNull();
    expect(parseDiscordEmoji({ name: 'not-a-string' })).toBeNull();
    expect(parseDiscordEmoji('<:x:1234>')).toBeNull();
    expect(() => setEmoji(guildId, 'icon_star', '<:dead:1550000000000000015>')).toThrow('Emoji không tồn tại');
  });
});
