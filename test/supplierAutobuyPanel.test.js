import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelType, Collection, MessageFlags, PermissionsBitField } from 'discord.js';

const state = vi.hoisted(() => ({ settings: new Map(), support: '1514607020098191393', emojis: true }));
vi.mock('../src/database/db.js', () => ({ db: { prepare: sql => ({
  get: key => sql.includes('guild_settings') ? { ticket_panel_channel_id: state.support } : state.settings.has(key) ? { value: state.settings.get(key) } : undefined,
  run: (key, value) => state.settings.set(key, value),
}) } }));
vi.mock('../src/utils/emojiHelper.js', () => ({
  createEmojiResolver: () => { const E = slot => state.emojis ? `<:${slot}:1382729296724099132>` : ''; E.component = slot => state.emojis ? { id: '1382729296724099132', name: slot } : null; return E; },
  withButtonEmoji: (button, emoji) => emoji ? button.setEmoji({ id: '1382729296724099132', name: emoji.match(/^<:(\w+):/)?.[1] || 'invalid' }) : button,
}));
import {
  buildSupplierAutobuyPanel, buildSupplierAutobuyReply, ensureSupplierAutobuyChannel, getSupplierAutobuyPanelHealth,
} from '../src/services/supplierAutobuyPanelService.js';

const GUILD = '1282637033340403754';
const BOT = '1382729296724099132';
const CATEGORY = '1514606994256957600';
const CHANNEL = '1569999999999999991';
const MESSAGE = '1569999999999999992';
const prefix = `supplier-autobuy:${GUILD}:`;
const context = { guildId: GUILD, envFile: '.env', snapshot: { status: 'AUTH_REJECTED', checkedAt: '2026-11-10T14:00:00.000Z' } };
const controls = [{ type: 1, components: [{ type: 2, custom_id: 'supplier-autobuy:catalog' }, { type: 2, custom_id: 'supplier-autobuy:status' }] }];
function fixture({ existing = false, messages = [] } = {}) {
  const panel = { id: MESSAGE, author: { id: BOT }, components: controls, edit: vi.fn(async () => panel) };
  const history = new Collection(messages.map(message => [message.id, message]));
  const channel = {
    id: CHANNEL, guildId: GUILD, type: ChannelType.GuildText, parentId: CATEGORY, name: '🛒・autobuy',
    topic: `Cenar AutoBuy · Cenar Store quản lý · Bot ${BOT}`,
    permissionOverwrites: { cache: new Collection([[GUILD, { id: GUILD, allow: new PermissionsBitField(['ViewChannel', 'ReadMessageHistory']), deny: new PermissionsBitField(['SendMessages', 'CreatePublicThreads', 'CreatePrivateThreads', 'SendMessagesInThreads']) }]]) },
    permissionsFor: vi.fn(() => new PermissionsBitField(['ViewChannel', 'SendMessages', 'ReadMessageHistory'])),
    messages: { fetch: vi.fn(async arg => typeof arg === 'string' ? history.get(arg) : history) },
    send: vi.fn(async () => { history.set(panel.id, panel); return panel; }),
  };
  const parent = { id: CATEGORY, guildId: GUILD, type: ChannelType.GuildCategory, permissionsFor: vi.fn(() => new PermissionsBitField(['ManageChannels'])) };
  const inventory = new Collection([[CATEGORY, parent], [state.support, { id: state.support, guildId: GUILD, type: ChannelType.GuildText }]]);
  if (existing) inventory.set(CHANNEL, channel);
  const guild = { id: GUILD, channels: { fetch: vi.fn(async () => inventory), create: vi.fn(async () => { inventory.set(CHANNEL, channel); return channel; }) } };
  const client = { user: { id: BOT }, guilds: { fetch: vi.fn(async () => guild) } };
  return { client, guild, channel, parent, panel, inventory, history };
}
beforeEach(() => { state.settings.clear(); state.emojis = true; vi.clearAllMocks(); });

describe('supplier autobuy preparing panels', () => {
  it('uses native separators/custom emoji, no payment or invented catalog, and safe mentions', () => {
    const payload = buildSupplierAutobuyPanel({ snapshot: context.snapshot, supportChannelId: state.support });
    const json = JSON.stringify(payload);
    expect(json).toContain('"type":14');
    expect(json).toContain('Đang chuẩn bị mở bán');
    expect(json).toContain('chưa nhận thanh toán');
    expect(json).toContain('supplier-autobuy:catalog');
    expect(json).toContain('supplier-autobuy:status');
    expect(json).toContain('"name":"icon_doc"');
    expect(json).toContain(`https://discord.com/channels/${GUILD}/${state.support}`);
    expect(json).not.toMatch(/Bearer|401|50\.000|checkout|wallet/);
    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(payload.flags & MessageFlags.SuppressNotifications).toBeTruthy();
    expect(payload.allowedMentions.parse).toEqual([]);
  });

  it('omits unavailable icons and invalid support links, never substitutes unicode icons', () => {
    state.emojis = false;
    const json = JSON.stringify(buildSupplierAutobuyPanel({ supportChannelId: 'https://malicious.invalid' }));
    expect(json).not.toContain('emoji');
    expect(json).not.toContain('url');
    expect(json).not.toMatch(/🛒|🔑|⚠/);
  });

  it.each(['catalog', 'status'])('returns private %s information from cached allowlisted state only', action => {
    const secret = 'never-expose-secret';
    const payload = buildSupplierAutobuyReply({ action, snapshot: { status: secret, checkedAt: secret, error: secret, products: [secret] } });
    expect(JSON.stringify(payload)).not.toContain(secret);
    expect(payload.flags & MessageFlags.Ephemeral).toBeTruthy();
    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
  });
});

describe('supplier channel deliberate one-shot setup', () => {
  it('creates one read-only Store1 channel and one silent owned card, persists IDs and coalesces starts', async () => {
    const { client, guild, channel } = fixture();
    const first = ensureSupplierAutobuyChannel(client, context);
    expect(ensureSupplierAutobuyChannel(client, context)).toBe(first);
    expect(await first).toEqual({ status: 'READY', channelId: CHANNEL, messageId: MESSAGE });
    expect(guild.channels.fetch).toHaveBeenCalledExactlyOnceWith();
    expect(guild.channels.create).toHaveBeenCalledTimes(1);
    expect(guild.channels.create.mock.calls[0][0]).toMatchObject({ parent: CATEGORY, name: '🛒・autobuy', type: 0 });
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(state.settings.get(`${prefix}channel_id`)).toBe(CHANNEL);
    expect(state.settings.get(`${prefix}message_id`)).toBe(MESSAGE);
    expect(getSupplierAutobuyPanelHealth()).toEqual(await first);
    expect(Object.isFrozen(getSupplierAutobuyPanelHealth())).toBe(true);
  });

  it.each([{ guildId: 'other' }, { envFile: '.env.store2' }])('does not read/write Discord or DB for another store %j', async patch => {
    const { client } = fixture();
    expect((await ensureSupplierAutobuyChannel(client, { ...context, ...patch })).status).toBe('DISABLED_OTHER_STORE');
    expect(client.guilds.fetch).not.toHaveBeenCalled();
    expect(state.settings.size).toBe(0);
  });

  it('resumes exact orphan channel after create-before-save crash without creating a second channel', async () => {
    const { client, guild, channel } = fixture({ existing: true });
    expect((await ensureSupplierAutobuyChannel(client, context)).status).toBe('READY');
    expect(guild.channels.create).not.toHaveBeenCalled();
    expect(channel.send).toHaveBeenCalledTimes(1);
  });

  it('recovers exact bot-owned orphan panel after send-before-save without sending another', async () => {
    const f = fixture({ existing: true });
    f.history.set(MESSAGE, f.panel);
    state.settings.set(`${prefix}channel_id`, CHANNEL);
    state.settings.set(`${prefix}panel_pending`, '1');
    expect((await ensureSupplierAutobuyChannel(f.client, context)).status).toBe('READY');
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(f.panel.edit).toHaveBeenCalledTimes(1);
    expect(f.panel.edit.mock.calls[0][0].flags).toBe(MessageFlags.IsComponentsV2);
    expect(state.settings.get(`${prefix}message_id`)).toBe(MESSAGE);
  });

  it('does not blindly recreate missing saved channels', async () => {
    const f = fixture();
    state.settings.set(`${prefix}channel_id`, CHANNEL);
    expect((await ensureSupplierAutobuyChannel(f.client, context)).status).toBe('DEGRADED_SAVED_CHANNEL');
    expect(f.guild.channels.create).not.toHaveBeenCalled();
    expect(f.channel.send).not.toHaveBeenCalled();
  });

  it.each(['foreign', 'missing', 'controls'])('does not replace a saved %s message', async mode => {
    const f = fixture({ existing: true });
    state.settings.set(`${prefix}channel_id`, CHANNEL);
    state.settings.set(`${prefix}message_id`, MESSAGE);
    if (mode !== 'missing') f.history.set(MESSAGE, { ...f.panel, ...(mode === 'foreign' ? { author: { id: 'other' } } : { components: [] }) });
    expect((await ensureSupplierAutobuyChannel(f.client, context)).status).toBe('DEGRADED_SAVED_MESSAGE');
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(f.panel.edit).not.toHaveBeenCalled();
  });

  it('preserves unrelated history and never adopts a foreign author mimicking panel controls', async () => {
    const foreign = { id: '1569999999999999998', author: { id: 'other' }, components: controls, edit: vi.fn() };
    const f = fixture({ existing: true, messages: [foreign] });
    expect((await ensureSupplierAutobuyChannel(f.client, context)).status).toBe('READY');
    expect(f.channel.send).toHaveBeenCalledTimes(1);
    expect(foreign.edit).not.toHaveBeenCalled();
    expect(f.history.has(foreign.id)).toBe(true);
  });

  it('stops on uncertain prior send outcome instead of duplicate publication', async () => {
    const f = fixture({ existing: true });
    state.settings.set(`${prefix}panel_pending`, '1');
    expect((await ensureSupplierAutobuyChannel(f.client, context)).status).toBe('DEGRADED_PUBLICATION_UNCERTAIN');
    expect(f.channel.send).not.toHaveBeenCalled();
  });

  it('does not recreate an uncertain channel, but can adopt its exact recovered identity', async () => {
    state.settings.set(`${prefix}channel_pending`, '1');
    const absent = fixture();
    expect((await ensureSupplierAutobuyChannel(absent.client, context)).status).toBe('DEGRADED_CHANNEL_UNCERTAIN');
    expect(absent.guild.channels.create).not.toHaveBeenCalled();
    const recovered = fixture({ existing: true });
    expect((await ensureSupplierAutobuyChannel(recovered.client, context)).status).toBe('READY');
    expect(recovered.guild.channels.create).not.toHaveBeenCalled();
    expect(state.settings.get(`${prefix}channel_pending`)).toBe('0');
  });

  it('does not create on missing access or failed authoritative channel fetch', async () => {
    const f = fixture();
    f.parent.permissionsFor.mockReturnValue(new PermissionsBitField());
    expect((await ensureSupplierAutobuyChannel(f.client, context)).status).toBe('DEGRADED_NO_ACCESS');
    expect(f.guild.channels.create).not.toHaveBeenCalled();
    const second = fixture();
    second.guild.channels.fetch.mockRejectedValue(new Error('private-provider-error'));
    const result = await ensureSupplierAutobuyChannel(second.client, context);
    expect(result.status).toBe('DEGRADED_SETUP_FAILED');
    expect(JSON.stringify(result)).not.toContain('private-provider-error');
    expect(second.guild.channels.create).not.toHaveBeenCalled();
  });

  it('does not adopt altered ownership or permissive channel overwrites', async () => {
    const f = fixture({ existing: true });
    f.channel.topic = 'another bot';
    expect((await ensureSupplierAutobuyChannel(f.client, context)).status).toBe('DEGRADED_CHANNEL_CONFLICT');
    expect(f.guild.channels.create).not.toHaveBeenCalled();
    const second = fixture({ existing: true });
    second.channel.permissionOverwrites.cache.clear();
    expect((await ensureSupplierAutobuyChannel(second.client, context)).status).toBe('DEGRADED_CHANNEL_PERMISSIONS');
    expect(second.channel.send).not.toHaveBeenCalled();
    const third = fixture({ existing: true });
    third.channel.permissionOverwrites.cache.set('customer-role', { id: 'customer-role', allow: new PermissionsBitField(['SendMessages']) });
    expect((await ensureSupplierAutobuyChannel(third.client, context)).status).toBe('DEGRADED_CHANNEL_PERMISSIONS');
    expect(third.channel.send).not.toHaveBeenCalled();
  });
});
