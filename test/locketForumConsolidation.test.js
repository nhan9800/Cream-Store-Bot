import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelType, Collection, MessageFlags } from 'discord.js';
vi.hoisted(() => Object.assign(process.env, {
  ENV_FILE: '.env.locket-forum-test-absent', DATABASE_PATH: `./data/test-locket-forum-${process.pid}-${Date.now()}.sqlite`,
}));
import { db, initDatabase } from '../src/database/db.js';
import { STORE_FORUMS } from '../src/config/storeForums202611.js';
import { getProductByName } from '../src/services/productCatalogService.js';
import { buildLocketProductPanel, LOCKET_PANEL_IMAGE } from '../src/services/locketProductPanel.js';
import { setupPremiumProducts, publishPremiumProducts, publishPremiumProductsForGuild,
  autoSetupAndPublishPremiumProducts, handlePremiumProductInteraction } from '../src/services/premiumProductSetupService.js';
import { upsertForumPost } from '../src/services/forumPublicationService.js';

const botId = '1555555555555555555', secondary = '1666666666666666666';
const legacyCategory = '1531297028695658576', legacyChannel = '1531297033317777408';
const bannerPath = path.resolve('assets/products/locket-gold', LOCKET_PANEL_IMAGE);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonComponents = payload => payload.components.map(component => component.toJSON?.() || component);
const controlIds = message => {
  const queue = [...message.components], result = [];
  while (queue.length) { const component = queue.shift(); if (component.custom_id) result.push(component.custom_id); if (component.components) queue.push(...component.components); }
  return result;
};

function message(id, components, attachments = []) {
  const result = { id, author: { id: botId }, components, attachments: new Collection(attachments.map(attachment => [attachment.id, attachment])), delete: vi.fn(),
    toJSON() { return { components: this.components }; } };
  result.edit = vi.fn().mockImplementation(async payload => { result.components = jsonComponents(payload); return result; });
  return result;
}
function forumGuild({ withCard = false } = {}) {
  const starter = message(STORE_FORUMS.pricePosts.locket, [{ type: 1, components: [{ type: 3, custom_id: 'product:select' }] }]);
  const human = { ...message('1568249645497450607', [{ type: 10, content: 'Keep history' }]), author: { id: 'customer' } };
  const messages = new Collection([[starter.id, starter], [human.id, human]]);
  const thread = { id: starter.id, guildId: STORE_FORUMS.guildId, parentId: STORE_FORUMS.priceForumId,
    ownerId: botId, type: ChannelType.PublicThread, archived: false, setArchived: vi.fn().mockResolvedValue(null) };
  thread.messages = { fetch: vi.fn().mockImplementation(async arg => {
    if (typeof arg === 'string') { if (!messages.has(arg)) throw new Error('Unknown message'); return messages.get(arg); }
    return new Collection(messages);
  }) };
  const product = getProductByName('WEB', 'Locket Gold — 1 năm');
  if (withCard) {
    const card = message('1568249645497450610', jsonComponents(buildLocketProductPanel(STORE_FORUMS.guildId, product, true)), [
      { id: 'banner-attachment', name: LOCKET_PANEL_IMAGE, bytes: fs.readFileSync(bannerPath) },
      { id: 'history-attachment', name: 'retained-history.png', bytes: Buffer.from('history bytes') },
    ]);
    messages.set(card.id, card);
  }
  thread.send = vi.fn().mockImplementation(async payload => {
    const card = message('1568249645497450611', jsonComponents(payload), payload.files.length
      ? [{ id: 'uploaded-banner', name: LOCKET_PANEL_IMAGE, bytes: fs.readFileSync(payload.files[0].attachment) }] : []);
    messages.set(card.id, card); return card;
  });
  const forum = { id: STORE_FORUMS.priceForumId, type: ChannelType.GuildForum, guildId: STORE_FORUMS.guildId };
  const oldChannel = { id: legacyChannel, messages: { fetch: vi.fn() }, delete: vi.fn() };
  const cache = new Collection([[legacyChannel, oldChannel], [legacyCategory, { id: legacyCategory }]]);
  const guild = { id: STORE_FORUMS.guildId, name: 'Cenar fixture', client: { user: { id: botId } },
    channels: { cache, create: vi.fn(), fetch: vi.fn().mockImplementation(async id => id === forum.id ? forum : id === thread.id ? thread : null) } };
  forum.client = guild.client;
  return { guild, forum, thread, starter, human, messages, oldChannel };
}
function command(guild) {
  const interaction = { guild, deferred: false, replied: false, editReply: vi.fn() };
  interaction.deferReply = vi.fn().mockImplementation(async () => { interaction.deferred = true; });
  return interaction;
}
function settings(guildId = STORE_FORUMS.guildId) { return db.prepare('SELECT * FROM guild_settings WHERE guild_id=?').get(guildId); }
function legacySettings() {
  db.prepare(`INSERT INTO guild_settings(guild_id,ticket_category_id,order_log_channel_id,feedback_channel_id,
    premium_category_id,locket_channel_id,locket_product_message_id) VALUES (?,'tickets','orders','feedback',?,?,?)`)
    .run(STORE_FORUMS.guildId, legacyCategory, legacyChannel, 'old-panel');
}

beforeAll(() => {
  initDatabase();
  const columns = db.prepare('PRAGMA table_info(guild_settings)').all();
  for (const column of ['premium_category_id', 'locket_channel_id', 'locket_product_message_id']) {
    if (!columns.some(entry => entry.name === column)) db.exec(`ALTER TABLE guild_settings ADD COLUMN ${column} TEXT`);
  }
});
beforeEach(() => { vi.clearAllMocks(); db.prepare('DELETE FROM guild_settings WHERE guild_id IN (?,?)').run(STORE_FORUMS.guildId, secondary); });
afterAll(() => { db.close(); for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${process.env.DATABASE_PATH}${suffix}`, { force: true }); });

describe('Store1 Locket workflow consolidation', () => {
  it('publishes one silent owned workflow card beside the unchanged price starter and adopts settings', async () => {
    legacySettings(); const fixture = forumGuild(); const before = JSON.stringify(fixture.starter.components);
    const result = await publishPremiumProductsForGuild(fixture.guild, { locket_channel_id: legacyChannel });
    expect(result).toMatchObject({ status: 'published', channelId: STORE_FORUMS.pricePosts.locket });
    expect(fixture.guild.channels.create).not.toHaveBeenCalled(); expect(fixture.oldChannel.messages.fetch).not.toHaveBeenCalled();
    expect(fixture.starter.edit).not.toHaveBeenCalled(); expect(JSON.stringify(fixture.starter.components)).toBe(before);
    const payload = fixture.thread.send.mock.calls[0][0];
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications);
    expect(payload.allowedMentions).toEqual({ parse: [] }); expect(payload.files).toHaveLength(1);
    const card = fixture.messages.get(result.messageId);
    expect(controlIds(card)).toEqual(['product:locket:buy', 'product:locket:features', 'product:locket:policy']);
    expect(JSON.stringify(card.components)).toContain('80.000đ');
    expect(JSON.stringify(card.components)).toContain(`attachment://${LOCKET_PANEL_IMAGE}`);
    expect(digest(card.attachments.first().bytes)).toBe(digest(fs.readFileSync(bannerPath)));
    expect(settings()).toMatchObject({ premium_category_id: null, locket_channel_id: fixture.thread.id, locket_product_message_id: card.id });
    expect(fixture.human.delete).not.toHaveBeenCalled(); expect(fixture.oldChannel.delete).not.toHaveBeenCalled();
  });

  it('edits the existing workflow card without replacing attachments or posting another card', async () => {
    legacySettings(); const fixture = forumGuild({ withCard: true });
    const card = [...fixture.messages.values()].find(value => value.id !== fixture.thread.id && controlIds(value).includes('product:locket:buy'));
    const hashes = [...card.attachments.values()].map(attachment => digest(attachment.bytes));
    await publishPremiumProductsForGuild(fixture.guild);
    expect(fixture.thread.send).not.toHaveBeenCalled(); expect(card.edit).toHaveBeenCalledTimes(1);
    const payload = card.edit.mock.calls[0][0];
    expect(payload.attachments).toEqual([{ id: 'banner-attachment', filename: LOCKET_PANEL_IMAGE }, { id: 'history-attachment', filename: 'retained-history.png' }]);
    expect(payload.files).toEqual([]); expect([...card.attachments.values()].map(attachment => digest(attachment.bytes))).toEqual(hashes);
    expect(settings().locket_product_message_id).toBe(card.id);
  });

  it('is idempotent across concurrent startup and all manual setup/repair/publish paths', async () => {
    legacySettings(); const fixture = forumGuild();
    await Promise.all([publishPremiumProductsForGuild(fixture.guild), autoSetupAndPublishPremiumProducts(fixture.guild)]);
    const interaction = command(fixture.guild);
    await setupPremiumProducts(interaction); await publishPremiumProducts(interaction);
    expect(fixture.thread.send).toHaveBeenCalledTimes(1);
    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(fixture.guild.channels.create).not.toHaveBeenCalled(); expect(fixture.oldChannel.messages.fetch).not.toHaveBeenCalled();
    expect(fixture.starter.delete).not.toHaveBeenCalled(); expect(fixture.human.delete).not.toHaveBeenCalled();
  });

  it('fails closed on a missing/foreign forum without recreating the old Premium category', async () => {
    legacySettings(); const fixture = forumGuild(); fixture.thread.parentId = 'foreign-forum';
    await expect(publishPremiumProductsForGuild(fixture.guild)).rejects.toThrow(/không tạo lại/);
    expect(settings()).toMatchObject({ premium_category_id: legacyCategory, locket_channel_id: legacyChannel });
    expect(fixture.thread.send).not.toHaveBeenCalled(); expect(fixture.guild.channels.create).not.toHaveBeenCalled();
    fixture.guild.channels.fetch.mockResolvedValue(null);
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    try { await autoSetupAndPublishPremiumProducts(fixture.guild); } finally { logger.mockRestore(); }
    expect(fixture.guild.channels.create).not.toHaveBeenCalled();
  });

  it('does not adopt settings or send a duplicate after an existing-card edit failure', async () => {
    legacySettings(); const fixture = forumGuild({ withCard: true });
    const card = [...fixture.messages.values()].find(value => controlIds(value).includes('product:locket:buy'));
    card.edit.mockRejectedValue(new Error('Discord edit failed'));
    await expect(publishPremiumProductsForGuild(fixture.guild)).rejects.toThrow('Discord edit failed');
    expect(settings().locket_channel_id).toBe(legacyChannel); expect(fixture.thread.send).not.toHaveBeenCalled();
  });

  it.each(['duplicate', 'incomplete'])('preserves unfamiliar history rather than creating/deleting cards (%s)', async scenario => {
    legacySettings(); const fixture = forumGuild({ withCard: scenario === 'duplicate' });
    if (scenario === 'duplicate') {
      const card = [...fixture.messages.values()].find(value => controlIds(value).includes('product:locket:buy'));
      const duplicate = message('1568249645497450612', card.components, [...card.attachments.values()]);
      fixture.messages.set(duplicate.id, duplicate);
    } else {
      const fetch = fixture.thread.messages.fetch.getMockImplementation();
      const fullPage = new Collection(Array.from({ length: 100 }, (_, index) => {
        const entry = message(String(1000 + index), [{ type: 10, content: 'Retain history' }]); return [entry.id, entry];
      }));
      fixture.thread.messages.fetch.mockImplementation(async arg => typeof arg === 'string' ? fetch(arg) : fullPage);
    }
    await expect(publishPremiumProductsForGuild(fixture.guild)).rejects.toThrow(/Lịch sử/);
    expect(fixture.thread.send).not.toHaveBeenCalled(); expect(settings().locket_channel_id).toBe(legacyChannel);
    expect([...fixture.messages.values()].every(entry => entry.delete.mock.calls.length === 0)).toBe(true);
  });

  it('requires the uploaded banner to be present before adopting the new forum pointer', async () => {
    legacySettings(); const fixture = forumGuild();
    fixture.thread.send.mockImplementation(async payload => message('1568249645497450611', jsonComponents(payload)));
    await expect(publishPremiumProductsForGuild(fixture.guild)).rejects.toThrow(/hình ảnh Locket/);
    expect(settings().locket_channel_id).toBe(legacyChannel); expect(fixture.thread.send).toHaveBeenCalledTimes(1);
  });

  it('preserves the added workflow card and human history when the price forum is manually synced', async () => {
    const fixture = forumGuild({ withCard: true }); fixture.thread.name = 'Locket Gold';
    const card = [...fixture.messages.values()].find(value => controlIds(value).includes('product:locket:buy'));
    await upsertForumPost(fixture.forum, new Map([[fixture.thread.id, fixture.thread]]), {
      name: fixture.thread.name, payloads: [{ components: fixture.starter.components, allowedMentions: { parse: [] } }],
    });
    expect(fixture.starter.edit).toHaveBeenCalledTimes(1); expect(card.edit).not.toHaveBeenCalled();
    expect(card.delete).not.toHaveBeenCalled(); expect(fixture.human.delete).not.toHaveBeenCalled(); expect(fixture.thread.send).not.toHaveBeenCalled();
  });

  it('keeps username purchase, live 80k features and policy controls functional from the forum', async () => {
    const user = { guildId: STORE_FORUMS.guildId, showModal: vi.fn().mockResolvedValue(null), reply: vi.fn() };
    await handlePremiumProductInteraction({ ...user, customId: 'product:locket:buy' });
    expect(user.showModal.mock.calls[0][0].toJSON()).toMatchObject({ custom_id: 'product:locket:modal_buy' });
    expect(user.showModal.mock.calls[0][0].toJSON().components[0].components[0].custom_id).toBe('username');
    for (const page of ['features', 'policy']) await handlePremiumProductInteraction({ ...user, customId: `product:locket:${page}` });
    expect(JSON.stringify(user.reply.mock.calls[0][0].components.map(component => component.toJSON()))).toContain('80.000đ');
    expect(JSON.stringify(user.reply.mock.calls[1][0].components.map(component => component.toJSON()))).toContain('Username');
  });
});

describe('Store2 legacy Premium layout remains supported', () => {
  it.each(['manual', 'automatic'])('preserves Store2 category/channel provisioning (%s)', async mode => {
    db.prepare("INSERT INTO guild_settings(guild_id,ticket_category_id,order_log_channel_id,feedback_channel_id) VALUES (?,'tickets','orders','feedback')").run(secondary);
    const cache = new Collection(); const legacy = { id: 'second-locket-channel', messages: { fetch: vi.fn().mockResolvedValue(new Collection()) }, send: vi.fn().mockResolvedValue({ id: 'second-panel' }) };
    const category = { id: 'second-category' };
    const guild = { id: secondary, name: 'Store2 fixture', roles: { everyone: { id: 'everyone' } }, members: { me: { id: botId } },
      channels: { cache, fetch: vi.fn().mockResolvedValue(legacy), create: vi.fn().mockImplementation(async payload => {
        const channel = payload.type === ChannelType.GuildCategory ? category : legacy; cache.set(channel.id, channel); return channel;
      }) } };
    if (mode === 'manual') await setupPremiumProducts(command(guild)); else await autoSetupAndPublishPremiumProducts(guild);
    expect(guild.channels.create).toHaveBeenCalledTimes(2);
    expect(settings(secondary)).toMatchObject({ premium_category_id: category.id, locket_channel_id: legacy.id, locket_product_message_id: 'second-panel' });
    expect(legacy.send).toHaveBeenCalledTimes(1);
  });
});
