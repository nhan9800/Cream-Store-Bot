import { ChannelType } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ products: vi.fn(), settings: vi.fn(), icons: vi.fn(), entries: vi.fn(), posts: vi.fn(),
  config: { guildId: '1282637033340403754', clientId: '1666666666666666666' } }));
vi.mock('../src/config.js', () => ({ config: m.config }));
vi.mock('../src/utils/emojiHelper.js', () => ({ createEmojiResolver: () => () => '' }));
vi.mock('../src/services/productCatalogService.js', () => ({ getActiveProducts: m.products }));
vi.mock('../src/services/guildConfigService.js', () => ({ getGuildConfig: m.settings }));
vi.mock('../src/services/coreEmojiPackService.js', () => ({ getCoreEmojiPackStatus: m.icons }));
vi.mock('../src/services/autoSetupPriceBoardService.js', () => ({ buildPriceForumEntries: m.entries }));
vi.mock('../src/services/forumPublicationService.js', () => ({ listForumPosts: m.posts }));

import { NITRO_RENEWAL_KEY, getNitroPriceUpdateHealth, runNitroPriceUpdate } from '../src/services/nitroPriceUpdateService.js';
import { consumeManualAnnouncementWrite } from '../src/utils/manualAnnouncementWrite.js';
import { formatCurrency } from '../src/utils/formatters.js';
import { STORE_FORUMS } from '../src/config/storeForums202611.js';

const guildId = '1282637033340403754', botId = '1666666666666666666', threadId = '1777777777777777777';
const foreignId = '1888888888888888888';
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function fixture() {
  const product = { id: 42, product_key: NITRO_RENEWAL_KEY, price: 650000, duration_months: 12, is_active: 1,
    name: 'Discord Nitro Boost 12 Tháng (Gia Hạn Tự Động 2 Tháng/Lần)',
    description: 'Giá 650.000đ cho toàn bộ 12 tháng Nitro Boost, gồm 6 kỳ, mỗi kỳ 2 tháng và gia hạn tự động theo kỳ.' };
  const payload = (price = 650000) => ({ components: [{ type: 17, components: [{ type: 10,
    content: `### ${product.name}\n**Giá bán:** \`${formatCurrency(price)}\`\n**Thời hạn:** \`12 tháng\`\n${product.description}` }] },
  { type: 1, components: [{ type: 3, custom_id: 'product:select', options: [{ label: product.name, value: String(product.id) }] }] }], flags: 32768 });
  const client = { user: { id: botId }, isReady: vi.fn(() => true), rest: {}, guilds: { fetch: vi.fn() } };
  const starter = { id: threadId, channelId: threadId, author: { id: botId }, webhookId: null, components: [], delete: vi.fn(), edit: vi.fn() };
  const thread = { id: threadId, name: '01 · Discord Nitro', ownerId: botId, parentId: STORE_FORUMS.priceForumId,
    guildId, archived: false, setArchived: vi.fn(async () => {}), messages: { fetch: vi.fn(async () => starter), delete: vi.fn() },
    send: vi.fn(), delete: vi.fn() };
  const forum = { id: STORE_FORUMS.priceForumId, type: ChannelType.GuildForum, guildId,
    client, threads: { create: vi.fn() }, send: vi.fn(), delete: vi.fn() };
  const guild = { id: guildId, client, channels: { fetch: vi.fn(async () => forum) } };
  client.guilds.fetch.mockResolvedValue(guild);
  starter.edit.mockImplementation(async body => ({ ...starter, components: body.components }));
  m.products.mockImplementation(() => [product]);
  m.entries.mockImplementation(() => [{ key: 'nitro', name: thread.name, payloads: [payload()] }]);
  m.posts.mockResolvedValue(new Map([[threadId, thread]]));
  return { product, payload, client, starter, thread, forum, guild, run: options => runNitroPriceUpdate(client, options) };
}
function assertNoOtherWrites(t) {
  for (const spy of [t.forum.threads.create, t.forum.send, t.forum.delete, t.thread.send,
    t.thread.delete, t.thread.messages.delete, t.starter.delete]) expect(spy).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('ENV_FILE', '.env');
  m.config.guildId = guildId; m.config.clientId = botId;
  m.icons.mockReturnValue({ status: 'ready' }); m.settings.mockReturnValue({});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('owner-requested update of the existing Nitro price post', () => {
  it('silently edits only the verified existing starter and reports the canonical annual price/cycle and URL', async () => {
    const t = fixture();
    const result = await t.run();
    expect(result).toEqual({ status: 'UPDATED', channelId: threadId, messageId: threadId,
      url: `https://discord.com/channels/${guildId}/${threadId}/${threadId}`,
      productKey: NITRO_RENEWAL_KEY, price: 650000, totalMonths: 12, renewalCycleMonths: 2 });
    expect(t.client.guilds.fetch).toHaveBeenCalledExactlyOnceWith(guildId);
    expect(t.guild.channels.fetch).toHaveBeenCalledExactlyOnceWith(STORE_FORUMS.priceForumId);
    expect(m.posts).toHaveBeenCalledExactlyOnceWith(t.forum);
    expect(t.thread.messages.fetch).toHaveBeenCalledExactlyOnceWith({ message: threadId, force: true });
    expect(t.starter.edit).toHaveBeenCalledOnce();
    expect(t.starter.edit.mock.calls[0][0].allowedMentions).toEqual({ parse: [], users: [], roles: [], repliedUser: false });
    assertNoOtherWrites(t);
    result.price = 1; expect(getNitroPriceUpdateHealth().price).toBe(650000);
  });

  it('grants one exact quiet PATCH compatible with the existing REST boundary', async () => {
    const t = fixture();
    t.starter.edit.mockImplementation(async body => {
      const options = { method: 'PATCH', fullRoute: `/channels/${threadId}/messages/${threadId}`,
        body: { allowed_mentions: { parse: body.allowedMentions.parse, roles: body.allowedMentions.roles, users: body.allowedMentions.users } } };
      expect(consumeManualAnnouncementWrite({}, options)).toBe(false);
      expect(consumeManualAnnouncementWrite(t.client.rest, { ...options, fullRoute: `/channels/${threadId}/messages/${foreignId}` })).toBe(false);
      expect(consumeManualAnnouncementWrite(t.client.rest, options)).toBe(true);
      expect(consumeManualAnnouncementWrite(t.client.rest, options)).toBe(false);
      return { ...t.starter, components: body.components };
    });
    expect((await t.run()).status).toBe('UPDATED'); assertNoOtherWrites(t);
  });

  it('coalesces concurrent startup calls into one edit', async () => {
    const t = fixture(), wait = deferred();
    t.client.guilds.fetch.mockImplementationOnce(async () => { await wait.promise; return t.guild; });
    const first = t.run(), second = t.run(); expect(first).toBe(second);
    wait.resolve(); await Promise.all([first, second]);
    expect(t.starter.edit).toHaveBeenCalledOnce(); expect(t.client.guilds.fetch).toHaveBeenCalledOnce(); assertNoOtherWrites(t);
  });

  it('adopts an already correct card without editing it again', async () => {
    const t = fixture(); t.starter.components = t.payload().components;
    expect((await t.run()).status).toBe('CURRENT'); expect((await t.run()).status).toBe('CURRENT');
    expect(t.starter.edit).not.toHaveBeenCalled(); assertNoOtherWrites(t);
  });

  it('does not borrow the price or renewal evidence from another product block', async () => {
    const t = fixture(), wrong = t.payload(700000);
    wrong.components[0].components.push({ type: 10,
      content: 'A different package\n**Giá bán:** `650.000đ`\n**Thời hạn:** `12 tháng`\nGia hạn mỗi 2 tháng' });
    t.starter.components = wrong.components;
    expect((await t.run()).status).toBe('UPDATED');
    expect(t.starter.edit).toHaveBeenCalledOnce(); assertNoOtherWrites(t);
  });

  it('does not call a card current when the exact product selector is missing', async () => {
    const t = fixture(), wrong = t.payload(); wrong.components[1].components[0].options[0].value = '99';
    t.starter.components = wrong.components;
    expect((await t.run()).status).toBe('UPDATED'); expect(t.starter.edit).toHaveBeenCalledOnce(); assertNoOtherWrites(t);
  });

  it('unarchives the one verified existing thread rather than creating a replacement', async () => {
    const t = fixture(); t.thread.archived = true;
    expect((await t.run()).status).toBe('UPDATED');
    expect(t.thread.setArchived).toHaveBeenCalledExactlyOnceWith(false); assertNoOtherWrites(t);
  });

  it.each(['price', 'duration', 'inactive', 'missing key'])('fails closed when the canonical 650k annual product changed: %s', async change => {
    const t = fixture();
    if (change === 'price') t.product.price = 600000;
    if (change === 'duration') t.product.duration_months = 2;
    if (change === 'inactive') t.product.is_active = 0;
    if (change === 'missing key') t.product.product_key = 'unrelated';
    expect(await t.run()).toEqual({ status: 'REVIEW_REQUIRED', code: 'NITRO_CATALOG_CHANGED' });
    expect(t.client.guilds.fetch).not.toHaveBeenCalled(); expect(t.starter.edit).not.toHaveBeenCalled(); assertNoOtherWrites(t);
  });

  it('rechecks the canonical product after awaited starter discovery', async () => {
    const t = fixture(); t.thread.messages.fetch.mockImplementationOnce(async () => { t.product.price = 700000; return t.starter; });
    expect(await t.run()).toEqual({ status: 'REVIEW_REQUIRED', code: 'NITRO_CATALOG_CHANGED' });
    expect(t.starter.edit).not.toHaveBeenCalled(); assertNoOtherWrites(t);
  });

  it.each(['foreign owner', 'duplicate posts', 'wrong parent', 'wrong guild', 'missing post'])('refuses an unverified existing post: %s', async change => {
    const t = fixture();
    if (change === 'foreign owner') t.thread.ownerId = foreignId;
    if (change === 'duplicate posts') m.posts.mockResolvedValue(new Map([[threadId, t.thread], [foreignId, { ...t.thread, id: foreignId }]]));
    if (change === 'wrong parent') t.thread.parentId = foreignId;
    if (change === 'wrong guild') t.thread.guildId = foreignId;
    if (change === 'missing post') m.posts.mockResolvedValue(new Map());
    expect(await t.run()).toEqual({ status: 'REVIEW_REQUIRED', code: 'NITRO_POST_UNVERIFIED' });
    expect(t.thread.messages.fetch).not.toHaveBeenCalled(); expect(t.starter.edit).not.toHaveBeenCalled(); assertNoOtherWrites(t);
  });

  it.each(['foreign author', 'webhook', 'wrong message', 'wrong channel'])('refuses a starter with %s', async change => {
    const t = fixture();
    if (change === 'foreign author') t.starter.author.id = foreignId;
    if (change === 'webhook') t.starter.webhookId = foreignId;
    if (change === 'wrong message') t.starter.id = foreignId;
    if (change === 'wrong channel') t.starter.channelId = foreignId;
    expect(await t.run()).toEqual({ status: 'REVIEW_REQUIRED', code: 'NITRO_MESSAGE_UNVERIFIED' });
    expect(t.starter.edit).not.toHaveBeenCalled(); assertNoOtherWrites(t);
  });

  it('requires one Nitro page instead of creating additional pages', async () => {
    const t = fixture(); m.entries.mockReturnValue([{ key: 'nitro', name: t.thread.name, payloads: [t.payload(), t.payload()] }]);
    expect(await t.run()).toEqual({ status: 'REVIEW_REQUIRED', code: 'NITRO_LAYOUT_REVIEW' });
    expect(m.posts).not.toHaveBeenCalled(); expect(t.starter.edit).not.toHaveBeenCalled(); assertNoOtherWrites(t);
  });

  it('keeps an uncertain or unverified edit receipt honest and does no replacement publication', async () => {
    const t = fixture(); t.starter.edit.mockResolvedValue({ ...t.starter, components: [] });
    expect(await t.run()).toEqual({ status: 'REVIEW_REQUIRED', code: 'NITRO_UPDATE_UNVERIFIED' });
    expect(t.starter.edit).toHaveBeenCalledOnce(); assertNoOtherWrites(t);
  });

  it('does not put raw Discord errors in its public health or log', async () => {
    const t = fixture(); t.starter.edit.mockRejectedValue(new Error('private-token-and-payload'));
    expect(await t.run()).toEqual({ status: 'REVIEW_REQUIRED', code: 'NITRO_UPDATE_FAILED' });
    expect(JSON.stringify(console.log.mock.calls)).not.toContain('private-token-and-payload'); assertNoOtherWrites(t);
  });

  it.each(['Store2', 'Store2 env', 'inherited env', 'wrong client', 'not ready', 'icons incomplete'])('skips before catalog or Discord work for %s', async change => {
    const t = fixture(); let options;
    if (change === 'Store2') { m.config.guildId = '1070676180103086132'; options = { guildId: m.config.guildId }; }
    if (change === 'Store2 env') options = { envFile: '.env.store2' };
    if (change === 'inherited env') vi.stubEnv('ENV_FILE', '.env.store2');
    if (change === 'wrong client') t.client.user.id = foreignId;
    if (change === 'not ready') t.client.isReady.mockReturnValue(false);
    if (change === 'icons incomplete') m.icons.mockReturnValue({ status: 'retry_required' });
    expect((await t.run(options)).status).toBe(['Store2', 'Store2 env', 'inherited env'].includes(change) ? 'SKIPPED_OTHER_STORE' : 'NOT_READY');
    expect(m.products).not.toHaveBeenCalled(); expect(t.client.guilds.fetch).not.toHaveBeenCalled(); assertNoOtherWrites(t);
  });
});
