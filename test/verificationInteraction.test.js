import { Collection, MessageFlags, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config.js', () => ({ config: { guildId: '1282637033340403754', publicBaseUrl: 'https://api.example.test' } }));
vi.mock('../src/database/db.js', async () => {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE guild_settings(guild_id TEXT PRIMARY KEY,custom_emojis TEXT,updated_at TEXT)');
  return { db, nowIso: () => new Date().toISOString() };
});
import { db } from '../src/database/db.js';
import { CORE_UI_EMOJI_ASSETS } from '../src/config/coreEmojiPack2026.js';
import { resetAllEmojis } from '../src/services/emojiService.js';
import { normalizeMessagePresentation } from '../src/utils/discordEmojiBoundary.js';
import { handleVerificationInteraction, verificationLoginUrl } from '../src/services/verificationInteractionService.js';
import { buildVerificationPanelV2, buildVerificationPromptV2, buildVerificationSuccessDmV2,
  buildVerificationUnavailableV2 } from '../src/services/verificationPanelService.js';

const guildId = '1282637033340403754', userId = '111111111111111111', roleId = '1282638730812854345';
const previousClient = global.discordClient;
const env = { CLIENT_SECRET: 'isolated-test-client-secret', ENCRYPTION_KEY: 'isolated-test-encryption-key' };
let application;
beforeEach(() => {
  vi.stubEnv('VERIFIED_ROLE_ID', '');
  resetAllEmojis(guildId); db.prepare('DELETE FROM guild_settings').run();
  application = new Collection(CORE_UI_EMOJI_ASSETS.map((asset, index) => {
    const emoji = { id: String(1560000000000000000n + BigInt(index)), name: asset.name, animated: false };
    return [emoji.id, emoji];
  }));
  global.discordClient = { application: { emojis: { cache: application } },
    guilds: { cache: new Collection([[guildId, { id: guildId, emojis: { cache: new Collection() } }]]) } };
});
afterEach(() => { global.discordClient = previousClient; vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(() => db.close());

function fixture({ hasRole = false, consent = false, cached = true } = {}) {
  const events = [];
  const role = { id: roleId, name: 'Cenar Explorer', managed: false, position: 1, permissions: new PermissionsBitField() };
  const member = { id: userId, guild: { id: guildId }, roles: {
    cache: new Collection(hasRole ? [[roleId, role]] : []), add: vi.fn(),
  } };
  const guild = { id: guildId, roles: { cache: new Collection([[roleId, role]]) }, members: {
    cache: new Collection(cached ? [[userId, member]] : []), fetch: vi.fn(async () => { events.push('fetch'); return member; }),
    me: { permissions: new PermissionsBitField(PermissionFlagsBits.ManageRoles), roles: { highest: { position: 10 } } },
  } };
  const interaction = { customId: 'oauth:verify:button', guildId, guild, user: { id: userId, username: 'Thành viên' },
    deferred: false, replied: false, reply: vi.fn(), followUp: vi.fn(),
    deferReply: vi.fn(async () => { events.push('defer'); interaction.deferred = true; }),
    editReply: vi.fn(async () => { events.push('edit'); interaction.replied = true; }),
  };
  const getRecovery = vi.fn(() => consent ? { recovery_consent_at: '2026-11-01', scopes: 'identify guilds.join' } : null);
  const options = { env, publicBaseUrl: 'https://api.example.test/', getRecovery };
  return { interaction, member, guild, role, events, options, getRecovery };
}
function nodes(payload) {
  return (payload.components || []).flatMap(function visit(node) {
    return [node, ...(node.components || []).flatMap(visit), ...(node.options || []).flatMap(visit)];
  });
}
const textOf = payload => nodes(payload).map(node => node.content || '').join('\n');
const reply = value => value.interaction.editReply.mock.calls[0]?.[0];
function verified(payload, targetGuildId = guildId) {
  const wire = normalizeMessagePresentation(payload, targetGuildId);
  const ids = nodes(wire).flatMap(node => [
    ...(node.emoji ? [node.emoji.id] : []), ...[...String(node.content || '').matchAll(/<a?:\w+:(\d+)>/g)].map(match => match[1]),
  ]);
  expect(ids.length).toBeGreaterThan(0);
  expect(ids.length).toBe(new Set(ids).size);
  expect(ids.every(id => application.has(id))).toBe(true);
  expect(textOf(wire)).not.toMatch(/\p{Extended_Pictographic}/u);
  expect(wire.allowedMentions).toEqual({ parse: [], users: [], roles: [], repliedUser: false });
}

describe('verification click acknowledgement and bounded member reads', () => {
  it('acknowledges privately before an unresolved member request, then edits exactly once without granting a role', async () => {
    const value = fixture({ cached: false });
    let finish;
    value.guild.members.fetch.mockImplementation(() => { value.events.push('fetch'); return new Promise(resolve => { finish = resolve; }); });
    const task = handleVerificationInteraction(value.interaction, value.options);
    await vi.waitFor(() => expect(value.guild.members.fetch).toHaveBeenCalledOnce());
    expect(value.events).toEqual(['defer', 'fetch']);
    expect(value.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(value.interaction.editReply).not.toHaveBeenCalled();
    finish(value.member); expect(await task).toBe(true);
    expect(value.events).toEqual(['defer', 'fetch', 'edit']);
    expect(value.interaction.editReply).toHaveBeenCalledOnce();
    expect(value.interaction.followUp).not.toHaveBeenCalled(); expect(value.interaction.reply).not.toHaveBeenCalled();
    expect(value.member.roles.add).not.toHaveBeenCalled(); verified(reply(value));
    expect(reply(value).flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(reply(value).flags & MessageFlags.Ephemeral).toBe(0);
  });
  it('uses a complete cached member without any REST or OAuth request', async () => {
    const value = fixture(); const upstream = vi.spyOn(globalThis, 'fetch');
    await handleVerificationInteraction(value.interaction, value.options);
    expect(value.guild.members.fetch).not.toHaveBeenCalled(); expect(upstream).not.toHaveBeenCalled();
    expect(value.events).toEqual(['defer', 'edit']); expect(value.member.roles.add).not.toHaveBeenCalled();
  });
  it('coalesces pending cache misses for the same member while acknowledging each permitted interaction', async () => {
    const first = fixture({ cached: false }), second = fixture({ cached: false });
    second.interaction.guild = first.guild;
    let finish; first.guild.members.fetch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const a = handleVerificationInteraction(first.interaction, first.options);
    const b = handleVerificationInteraction(second.interaction, second.options);
    await vi.waitFor(() => expect(first.guild.members.fetch).toHaveBeenCalledOnce());
    expect(first.interaction.deferReply).toHaveBeenCalledOnce(); expect(second.interaction.deferReply).toHaveBeenCalledOnce();
    finish(first.member); await Promise.all([a, b]);
    expect(first.interaction.editReply).toHaveBeenCalledOnce(); expect(second.interaction.editReply).toHaveBeenCalledOnce();
    expect(first.member.roles.add).not.toHaveBeenCalled();
  });
  it('ignores other controls and never duplicates an already acknowledged response', async () => {
    const value = fixture(); value.interaction.customId = 'other';
    expect(await handleVerificationInteraction(value.interaction, value.options)).toBe(false);
    value.interaction.customId = 'oauth:verify:button'; value.interaction.deferred = true;
    expect(await handleVerificationInteraction(value.interaction, value.options)).toBe(true);
    expect(value.interaction.deferReply).not.toHaveBeenCalled(); expect(value.interaction.editReply).not.toHaveBeenCalled();
    expect(value.guild.members.fetch).not.toHaveBeenCalled();
  });
});

describe('accurate role and recorded-consent presentation', () => {
  it.each([
    [false, false, 'BƯỚC 1/2 • CHỜ XÁC NHẬN OAUTH'],
    [true, false, 'ĐÃ CÓ QUYỀN · CHỜ ĐỒNG Ý RECOVERY'],
    [false, true, 'ĐÃ LƯU ĐỒNG Ý · CHƯA CÓ VAI TRÒ'],
    [true, true, 'ĐÃ XÁC MINH · ĐÃ LƯU ĐỒNG Ý'],
  ])('represents role=%s consent=%s independently', async (hasRole, consent, heading) => {
    const value = fixture({ hasRole, consent }); await handleVerificationInteraction(value.interaction, value.options);
    const payload = reply(value), text = textOf(payload); verified(payload);
    expect(text).toContain(heading);
    expect(text).toContain(hasRole ? 'hiện đã có vai trò xác minh' : 'chưa có vai trò xác minh');
    expect(text).not.toContain('recovery backup đang hoạt động');
    if (consent) expect(text).toContain('không xác nhận được bạn đã thu hồi quyền');
    expect(nodes(payload).find(node => node.url)?.url).toBe(`https://api.example.test/oauth/login?guild_id=${guildId}`);
    expect(value.member.roles.add).not.toHaveBeenCalled();
  });
  it.each(['guilds.join', 'identify', 'fooidentify guilds.join', 'identify guilds.join.evil', 'identify notguilds.join'])
    ('does not treat incomplete or substring scopes as required consent: %s', async scopes => {
      const value = fixture({ hasRole: true }); value.getRecovery.mockReturnValue({ recovery_consent_at: '2026-11-01', scopes });
      await handleVerificationInteraction(value.interaction, value.options);
      expect(textOf(reply(value))).toContain('ĐÃ CÓ QUYỀN · CHỜ ĐỒNG Ý RECOVERY');
    });
  it('requires a consent timestamp, accepts extra exact scopes, and does not infer a live grant from metadata', async () => {
    const value = fixture({ hasRole: true }); value.getRecovery.mockReturnValue({ scopes: 'identify guilds.join' });
    await handleVerificationInteraction(value.interaction, value.options);
    expect(textOf(reply(value))).toContain('CHỜ ĐỒNG Ý RECOVERY');
    const recorded = fixture({ hasRole: true }); recorded.getRecovery.mockReturnValue({
      recovery_consent_at: '2026-11-01', scopes: 'identify\tguilds.join email', token_expires_at: '2020-01-01',
    });
    await handleVerificationInteraction(recorded.interaction, recorded.options);
    expect(textOf(reply(recorded))).toContain('ĐÃ LƯU ĐỒNG Ý');
    expect(textOf(reply(recorded))).toContain('không xác nhận được bạn đã thu hồi quyền');
  });
  it.each([[false, false], [true, false], [false, true], [true, true]])
    ('keeps the international role=%s consent=%s prompt accurate with distinct custom artwork', (hasRole, recoveryActive) => {
      const targetGuildId = '1070676180103086132';
      const payload = buildVerificationPromptV2({ guildId: targetGuildId, username: 'Member', hasRole, recoveryActive,
        loginUrl: `https://api.example.test/store2/oauth/login?guild_id=${targetGuildId}` });
      verified(payload, targetGuildId);
      expect(textOf(payload)).toContain(hasRole ? 'currently has the verification role' : 'does not currently have the verification role');
      expect(textOf(payload)).toContain(recoveryActive ? 'Recovery consent has been recorded' : 'Required recovery consent has not been recorded');
      if (recoveryActive) expect(textOf(payload)).toContain('cannot confirm whether you later revoked');
    });
});

describe('safe launch and unavailable states', () => {
  it.each(['', 'http://api.example.test', 'javascript:alert(1)', '/relative', 'https://user:password@api.example.test',
    'https://api.example.test?token=private', 'https://api.example.test/#private', 'https://api.exa mple.test', 'https://'])
    ('refuses an invalid configured launch base: %s', async base => {
      expect(verificationLoginUrl(base, guildId)).toBeNull();
      const value = fixture({ consent: true }); await handleVerificationInteraction(value.interaction, { ...value.options, publicBaseUrl: base });
      expect(textOf(reply(value))).toContain('Shop đang kiểm tra lại đường dẫn xác minh an toàn');
      expect(nodes(reply(value)).some(node => node.url)).toBe(false);
    });
  it('normalizes configured HTTPS paths without changing the selected guild or exposing credentials', () => {
    expect(verificationLoginUrl('https://api.example.test/store2///', guildId))
      .toBe(`https://api.example.test/store2/oauth/login?guild_id=${guildId}`);
    expect(verificationLoginUrl('https://api.example.test', 'bad-guild')).toBeNull();
  });
  it('can show complete recorded status without a launch host and blocks every incomplete combination', async () => {
    for (const [hasRole, consent] of [[false, false], [true, false], [false, true], [true, true]]) {
      const value = fixture({ hasRole, consent }); await handleVerificationInteraction(value.interaction, { ...value.options, publicBaseUrl: '' });
      expect(nodes(reply(value)).some(node => node.url)).toBe(false);
      expect(textOf(reply(value))).toContain(hasRole && consent ? 'ĐÃ XÁC MINH · ĐÃ LƯU ĐỒNG Ý' : 'XÁC MINH TẠM CHƯA SẴN SÀNG');
    }
  });
  it.each(['config', 'member', 'role', 'database', 'guild'])('reports %s failures privately without fetching tokens or leaking details', async kind => {
    const value = fixture(); let options = value.options;
    if (kind === 'config') options = { ...options, env: { CLIENT_SECRET: '', ENCRYPTION_KEY: env.ENCRYPTION_KEY } };
    if (kind === 'member') { value.guild.members.cache.clear(); value.guild.members.fetch.mockRejectedValue(new Error('private-member-diagnostic')); }
    if (kind === 'role') value.guild.roles.cache.clear();
    if (kind === 'database') value.getRecovery.mockImplementation(() => { throw new Error('private-db-diagnostic'); });
    if (kind === 'guild') value.interaction.guild = null;
    await handleVerificationInteraction(value.interaction, options);
    const payload = reply(value); expect(value.interaction.deferReply).toHaveBeenCalledOnce(); expect(value.interaction.editReply).toHaveBeenCalledOnce();
    expect(nodes(payload).some(node => node.url)).toBe(false); expect(value.member.roles.add).not.toHaveBeenCalled();
    expect(JSON.stringify(payload)).not.toMatch(/private-|CLIENT_SECRET|ENCRYPTION_KEY|isolated-test/);
    if (kind === 'config' || kind === 'guild') expect(value.guild.members.fetch).not.toHaveBeenCalled();
    verified(payload);
  });
  it('keeps all public/private/success/unavailable artwork distinct and user names inert after final normalization', () => {
    const unsafe = '@everyone **unsafe** <:source:1999999999999999999> 🛒';
    for (const payload of [buildVerificationPanelV2(guildId, unsafe),
      buildVerificationPromptV2({ guildId, username: unsafe, hasRole: false, recoveryActive: false, loginUrl: 'https://api.example.test/oauth/login' }),
      buildVerificationSuccessDmV2({ guildId, guildName: unsafe, roleName: unsafe }), buildVerificationUnavailableV2(guildId)]) {
      verified(payload); expect(JSON.stringify(payload)).not.toMatch(/@everyone|1999999999999999999|\p{Extended_Pictographic}/u);
    }
  });
});
