import { ChannelType, Collection, MessageFlags, PermissionsBitField } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ settings: new Map(), snapshots: {} }));
vi.mock('../src/config.js', () => ({ config: { guildId: '1282637033340403754' } }));
vi.mock('../src/database/db.js', () => ({ db: { prepare: sql => ({
  get: key => sql.includes('guild_settings') ? {} : state.settings.has(key) ? { value: state.settings.get(key) } : undefined,
  run: (key, value) => state.settings.set(key, value),
}) } }));
vi.mock('../src/utils/emojiHelper.js', () => ({
  createEmojiResolver: () => { const E = slot => `<:${slot}:1382729296724099132>`; E.component = slot => ({ id: '1382729296724099132', name: slot }); return E; },
  withButtonEmoji: (button, token) => token ? button.setEmoji({ id: '1382729296724099132', name: token.match(/^<:(\w+):/)?.[1] || 'test' }) : button,
}));
vi.mock('../src/utils/uniqueCustomEmoji.js', async importOriginal => ({
  ...await importOriginal(), withUniqueCustomEmoji: payload => JSON.parse(JSON.stringify(payload)),
}));
vi.mock('../src/services/supplierAutobuyRuntime.js', () => ({ supplierAutobuyRuntime: {
  forProvider: provider => ({ getHealth: () => state.snapshots[provider] }),
  getHealth: () => state.snapshots.cdkvietnam,
} }));
import { ensureSupplierAutobuyChannel, getSupplierAutobuyPanelHealth,
  getSupplierAutobuyPanelsHealth, buildSupplierOrderView, buildSupplierPaymentView,
  buildSupplierNoticeView } from '../src/services/supplierAutobuyPanelService.js';
import { createSupplierAutobuyInteractionHandler } from '../src/events/supplierAutobuyHandlers.js';

const guildId = '1282637033340403754', categoryId = '1514606994256957600', botId = '1382729296724099132';
const userId = '111111111111111111', cdkChannel = '1569729564115206214', cdkMessage = '1569729568695255211';
const doperChannel = '1571000000000000001', doperMessage = '1571000000000000002';
const prefix = `supplier-autobuy:${guildId}:`;
const controls = [{ type: 1, components: [
  { type: 2, custom_id: 'supplier-autobuy:catalog' }, { type: 2, custom_id: 'supplier-autobuy:status' },
] }];
beforeEach(() => {
  state.settings.clear(); vi.clearAllMocks(); vi.stubEnv('ENV_FILE', '.env');
  state.snapshots = Object.fromEntries(['cdkvietnam', 'dopermind'].map(provider => [provider,
    { status: 'CONNECTED', provider, purchasesEnabled: true, productCount: provider === 'cdkvietnam' ? 12 : 101 }]));
});
afterEach(() => vi.unstubAllEnvs());

function fixture() {
  const inventory = new Collection();
  const parent = { id: categoryId, guildId, type: ChannelType.GuildCategory,
    permissionsFor: () => new PermissionsBitField(['ManageChannels']) };
  inventory.set(categoryId, parent);
  function channel(id, messageId, name, topic, existingPanel) {
    const history = new Collection();
    const panel = { id: messageId, author: { id: botId }, components: controls,
      edit: vi.fn(async payload => { panel.components = payload.components; return panel; }) };
    if (existingPanel) history.set(messageId, panel);
    const value = { id, guildId, type: ChannelType.GuildText, parentId: categoryId, name, topic,
      permissionOverwrites: { cache: new Collection([[guildId, { id: guildId,
        allow: new PermissionsBitField(['ViewChannel', 'ReadMessageHistory']),
        deny: new PermissionsBitField(['SendMessages', 'CreatePublicThreads', 'CreatePrivateThreads', 'SendMessagesInThreads']) }]]) },
      permissionsFor: () => new PermissionsBitField(['ViewChannel', 'SendMessages', 'ReadMessageHistory']),
      messages: { fetch: vi.fn(async query => typeof query === 'string' ? history.get(query) : history) },
      send: vi.fn(async payload => { panel.components = payload.components; history.set(messageId, panel); return panel; }),
      history, panel,
    };
    return value;
  }
  const cdk = channel(cdkChannel, cdkMessage, '🛒・autobuy', `Cenar AutoBuy · Cenar Store quản lý · Bot ${botId}`, true);
  inventory.set(cdk.id, cdk);
  state.settings.set(`${prefix}channel_id`, cdkChannel); state.settings.set(`${prefix}message_id`, cdkMessage);
  const create = vi.fn(async options => {
    const doper = channel(doperChannel, doperMessage, options.name, options.topic, false);
    inventory.set(doper.id, doper); return doper;
  });
  const guild = { id: guildId, channels: { fetch: vi.fn(async () => inventory), create } };
  const client = { user: { id: botId }, guilds: { fetch: vi.fn(async () => guild) } };
  const setup = provider => ensureSupplierAutobuyChannel(client, { guildId, envFile: '.env',
    provider, snapshot: state.snapshots[provider] });
  return { client, guild, inventory, cdk, setup };
}
async function readyFixture() {
  const value = fixture(); await Promise.all([value.setup('cdkvietnam'), value.setup('dopermind')]); return value;
}
function interaction(client, provider, action = 'catalog', extra = {}) {
  const panel = getSupplierAutobuyPanelHealth(provider);
  const publicControl = action === 'catalog' || action === 'status';
  const customId = `supplier-autobuy:${action}`;
  return { customId, guildId, channelId: panel.channelId, client, user: { id: userId },
    message: { id: publicControl ? panel.messageId : '1571000000000000999', author: { id: botId },
      flags: publicControl ? 0 : MessageFlags.Ephemeral,
      interactionMetadata: { user: { id: userId } },
      components: [{ type: 17, components: [{ type: 10, content: '**Thanh toán trước:** Đơn có thể chờ nguồn.' }] }] },
    isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false,
    reply: vi.fn(async () => {}), deferReply: vi.fn(async () => {}), editReply: vi.fn(async () => ({ id: '1571000000000000888' })),
    showModal: vi.fn(async () => {}), ...extra,
  };
}
const order = { orderCode: 'CN_123456', productName: 'Gói riêng', totalPriceVnd: 100000,
  status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' };
function dependencies() {
  return { getCatalog: vi.fn(async ({ provider }) => ({ provider, offers: [] })),
    prepareCheckout: vi.fn(), confirmCheckout: vi.fn(async context => ({ ...order, provider: context.provider })),
    createPayment: vi.fn(async () => ({ orderCode: order.orderCode, method: 'WALLET', paid: true, status: 'PROCESSING' })),
    getOrder: vi.fn(async context => ({ ...order, provider: context.provider })),
    listOrders: vi.fn(async () => []), getDelivery: vi.fn(async () => ({ items: ['owned-item'] })),
    prepareDeliveryPublication: vi.fn(async () => () => ({ items: ['owned-item'] })),
    acknowledgeDelivery: vi.fn(async () => {}), canManage: vi.fn(async () => false), setPrice: vi.fn(),
  };
}

describe('separate CDK and Dopermind AutoBuy channels', () => {
  it('links a ticket card only to its saved source storefront and keeps generic navigation out of ticket replies', async () => {
    await readyFixture();
    const nodes = payload => payload.components.flatMap(function visit(node) {
      return [node, ...(node.components || []).flatMap(visit)];
    });
    for (const provider of ['cdkvietnam', 'dopermind']) {
      const owned = { ...order, provider };
      const reference = getSupplierAutobuyPanelHealth(provider);
      const expected = `https://discord.com/channels/${guildId}/${reference.channelId}/${reference.messageId}`;
      for (const payload of [buildSupplierOrderView({ order: owned, customerId: userId, ticketContext: true }),
        await buildSupplierPaymentView({ order: owned, customerId: userId, ticketContext: true }),
        buildSupplierNoticeView({ title: 'Đơn hàng', text: 'Đã kiểm tra.', customerId: userId, ticketContext: true, order: owned })]) {
        expect(nodes(payload).filter(node => node.url).map(node => node.url)).toEqual([expected]);
        expect(nodes(payload).map(node => node.custom_id).filter(Boolean).some(id => /:(?:page|orders):/.test(id))).toBe(false);
      }
    }
    const unknown = buildSupplierOrderView({ order: { ...order, provider: 'spoofed' }, customerId: userId, ticketContext: true });
    expect(nodes(unknown).some(node => node.url)).toBe(false);
    const notice = buildSupplierNoticeView({ text: 'Kiểm tra lại đơn.', customerId: userId, ticketContext: true });
    expect(nodes(notice).some(node => node.url || node.custom_id)).toBe(false);
  });
  it('preserves existing CDK IDs and creates one independent Dopermind channel/panel on the same client', async () => {
    const value = fixture();
    const cdk = value.setup('cdkvietnam'), doper = value.setup('dopermind');
    expect(value.setup('cdkvietnam')).toBe(cdk); expect(value.setup('dopermind')).toBe(doper);
    expect(cdk).not.toBe(doper); await Promise.all([cdk, doper]);
    expect(getSupplierAutobuyPanelHealth()).toEqual({ status: 'READY', channelId: cdkChannel, messageId: cdkMessage });
    expect(getSupplierAutobuyPanelHealth('dopermind')).toEqual({ status: 'READY', provider: 'dopermind', channelId: doperChannel, messageId: doperMessage });
    expect(value.guild.channels.create).toHaveBeenCalledTimes(1);
    expect(value.guild.channels.create.mock.calls[0][0]).toMatchObject({ name: '🛒・autobuy-dopermind', parent: categoryId });
    expect(value.cdk.send).not.toHaveBeenCalled(); expect(value.cdk.name).toBe('🛒・autobuy');
    expect(value.cdk.panel.edit).toHaveBeenCalledTimes(1);
    expect(state.settings.get(`${prefix}channel_id`)).toBe(cdkChannel);
    expect(state.settings.get(`${prefix}message_id`)).toBe(cdkMessage);
    expect(state.settings.get(`${prefix}dopermind:channel_id`)).toBe(doperChannel);
    expect(state.settings.get(`${prefix}dopermind:message_id`)).toBe(doperMessage);
  });
  it('reuses both persisted panels after a restart without creating or sending duplicates', async () => {
    const value = await readyFixture();
    const restarted = { ...value.client };
    for (const provider of ['cdkvietnam', 'dopermind']) await ensureSupplierAutobuyChannel(restarted,
      { guildId, envFile: '.env', provider, snapshot: state.snapshots[provider] });
    expect(value.guild.channels.create).toHaveBeenCalledTimes(1);
    expect(value.inventory.get(doperChannel).send).toHaveBeenCalledTimes(1);
    expect(value.cdk.send).not.toHaveBeenCalled();
  });
  it('does not adopt the CDK channel through a Dopermind saved-reference collision', async () => {
    const value = fixture(); state.settings.set(`${prefix}dopermind:channel_id`, cdkChannel);
    state.settings.set(`${prefix}dopermind:message_id`, cdkMessage);
    expect((await value.setup('dopermind')).status).toBe('DEGRADED_SAVED_CHANNEL');
    expect(value.guild.channels.create).not.toHaveBeenCalled(); expect(value.cdk.panel.edit).not.toHaveBeenCalled();
  });
  it('keeps unrelated same-name channels and rejects unknown provider setup', async () => {
    const value = fixture(); value.inventory.set(doperChannel, { id: doperChannel, parentId: categoryId,
      name: '🛒・autobuy-dopermind', guildId, type: ChannelType.GuildText, topic: 'Another owner' });
    expect((await value.setup('dopermind')).status).toBe('DEGRADED_CHANNEL_CONFLICT');
    const invalid = await ensureSupplierAutobuyChannel(value.client, { guildId, envFile: '.env', provider: 'spoofed' });
    expect(invalid.status).toBe('DISABLED_PROVIDER'); expect(value.guild.channels.create).not.toHaveBeenCalled();
  });
});

describe('channel-authoritative provider routing', () => {
  it('opens only the catalog associated with each saved channel/panel and ignores client provider fields', async () => {
    const value = await readyFixture(), deps = dependencies(), handle = createSupplierAutobuyInteractionHandler(deps);
    for (const provider of ['cdkvietnam', 'dopermind']) {
      const click = interaction(value.client, provider, 'catalog', { provider: provider === 'cdkvietnam' ? 'dopermind' : 'cdkvietnam' });
      await handle(click); expect(deps.getCatalog).toHaveBeenLastCalledWith({ provider });
      expect(click.editReply).toHaveBeenCalledOnce();
    }
  });
  it('passes the trusted provider for confirmation, payment and private order/delivery history', async () => {
    const value = await readyFixture(), deps = dependencies(), handle = createSupplierAutobuyInteractionHandler(deps);
    for (const provider of ['cdkvietnam', 'dopermind']) {
      const quote = 'b9d30c1d-cb9a-4321-95dc-2994ac587ac1';
      await handle(interaction(value.client, provider, `confirm:${userId}:${quote}`));
      expect(deps.confirmCheckout).toHaveBeenLastCalledWith({ client: value.client, guildId, customerId: userId, provider, quoteId: quote });
      await handle(interaction(value.client, provider, `pay:${userId}:CN_123456:wallet`));
      expect(deps.createPayment).toHaveBeenLastCalledWith({ client: value.client, guildId, customerId: userId, provider, orderCode: 'CN_123456', method: 'wallet' });
      await handle(interaction(value.client, provider, `orders:${userId}`));
      expect(deps.listOrders).toHaveBeenLastCalledWith({ guildId, customerId: userId, provider, limit: 10 });
      await handle(interaction(value.client, provider, `delivery:${userId}:CN_123456`));
      expect(deps.getDelivery).toHaveBeenLastCalledWith({ guildId, customerId: userId, provider, orderCode: 'CN_123456' });
      expect(deps.acknowledgeDelivery).toHaveBeenLastCalledWith(expect.objectContaining({ provider, customerId: userId }));
    }
  });
  it('fails closed for copied public controls, forged provider arguments and another customer', async () => {
    const value = await readyFixture(), deps = dependencies(), handle = createSupplierAutobuyInteractionHandler(deps);
    const copied = interaction(value.client, 'dopermind'); copied.message.id = cdkMessage;
    await handle(copied); expect(copied.reply).toHaveBeenCalledOnce();
    const spoofed = interaction(value.client, 'dopermind', 'catalog:cdkvietnam');
    await handle(spoofed); expect(spoofed.reply).toHaveBeenCalledOnce();
    const privateClick = interaction(value.client, 'dopermind', `pay:${userId}:CN_123456:wallet`, { user: { id: '222222222222222222' } });
    await handle(privateClick); expect(privateClick.reply).toHaveBeenCalledOnce();
    expect(deps.getCatalog).not.toHaveBeenCalled(); expect(deps.createPayment).not.toHaveBeenCalled();
  });
  it('does not use CDK sales readiness for a paused Dopermind catalog', async () => {
    const value = await readyFixture(), deps = dependencies(), handle = createSupplierAutobuyInteractionHandler(deps);
    state.snapshots.dopermind = { status: 'AUTH_REJECTED', provider: 'dopermind', purchasesEnabled: false };
    await handle(interaction(value.client, 'dopermind'));
    expect(deps.getCatalog).not.toHaveBeenCalled();
    await handle(interaction(value.client, 'cdkvietnam'));
    expect(deps.getCatalog).toHaveBeenCalledExactlyOnceWith({ provider: 'cdkvietnam' });
  });
});
