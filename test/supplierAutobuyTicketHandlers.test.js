import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelType, Client, Message, MessageFlags, PermissionFlagsBits, PermissionsBitField } from 'discord.js';

const state = vi.hoisted(() => ({ ready: {}, render: {} }));
vi.mock('../src/config.js', () => ({ config: { guildId: '1282637033340403754' } }));
vi.mock('../src/services/supplierAutobuyRuntime.js', () => ({
  supplierAutobuyRuntime: {
    forProvider: provider => ({ getHealth: () => ({ provider, status: 'CONNECTED', purchasesEnabled: state.ready[provider] }) }),
    getHealth: () => ({ purchasesEnabled: false }),
  },
}));
vi.mock('../src/services/supplierAutobuyPanelService.js', () => ({
  getSupplierAutobuyPanelHealth: () => ({ status: 'NOT_STARTED' }),
  hasSupplierPrepayDisclosure: message => JSON.stringify(message?.components).includes('Thanh toán trước:'),
  buildSupplierOrderView: options => state.render.order(options),
  buildSupplierPaymentView: options => state.render.payment(options),
  buildSupplierNoticeView: options => state.render.notice(options),
}));

import { config } from '../src/config.js';
import { createSupplierAutobuyInteractionHandler } from '../src/events/supplierAutobuyHandlers.js';

const guildId = '1282637033340403754', customerId = '111111111111111111', otherId = '222222222222222222';
const botId = '1382729296724099132', channelId = '1569729564115206214', categoryId = '1569729564115206200';
const noticeId = '1569729568695255211', ephemeralId = '1569999999999999999';
const cdkCode = 'CN_57201611', doperCode = 'CN_57201612';
const expectedTopic = `Cenar AutoBuy · customer:${customerId} · ticket:1483`;
const noMentions = { parse: [], users: [], roles: [], repliedUser: false };
const components = [{ type: 17, components: [{ type: 10, content: 'Private supplier view' }] }];
const id = (action, code = cdkCode, suffix = '') => `supplier-autobuy:${action}:${customerId}:${code}${suffix ? ':' + suffix : ''}`;
const bits = (...permissions) => new PermissionsBitField(permissions);
function channel(patch = {}) {
  return {
    id: channelId, guildId, type: ChannelType.GuildText, parentId: categoryId, topic: expectedTopic,
    permissionOverwrites: { cache: new Map([
      [guildId, { deny: bits(PermissionFlagsBits.ViewChannel) }],
      [customerId, { allow: bits(PermissionFlagsBits.ViewChannel) }],
    ]) },
    permissionsFor: () => bits(PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory),
    ...patch,
  };
}
function fixture(customId = id('order'), patch = {}) {
  return {
    customId, guildId, channelId, channel: channel(), user: { id: customerId },
    client: { user: { id: botId } },
    message: { id: noticeId, author: { id: botId }, flags: 0,
      components: [{ type: 17, components: [{ type: 10, content: '**Thanh toán trước:** Đồng ý chờ nguồn.' }] }] },
    isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false,
    deferReply: vi.fn().mockResolvedValue(undefined), reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue({ id: ephemeralId }), showModal: vi.fn().mockResolvedValue(undefined),
    update: vi.fn(), followUp: vi.fn(), ...patch,
  };
}
function fixtureEphemeral(customId = id('order'), patch = {}) {
  const click = fixture(customId);
  return { ...click, message: { ...click.message, id: ephemeralId, flags: MessageFlags.Ephemeral,
    interactionMetadata: { user: { id: customerId } } }, ...patch };
}
function dependencies(patch = {}) {
  const providerFor = code => code === doperCode ? 'dopermind' : 'cdkvietnam';
  return {
    getTicketContext: vi.fn(async args => {
      if (args.guildId !== guildId || args.channelId !== channelId || args.customerId !== customerId
        || ![cdkCode, doperCode].includes(args.orderCode) || (!args.ephemeral && args.messageId !== noticeId)) return null;
      return { provider: providerFor(args.orderCode), orderCode: args.orderCode, customerId, channelId,
        ticketId: 1483, expectedTopic, categoryId };
    }),
    getOrder: vi.fn(async args => ({ provider: providerFor(args.orderCode), orderCode: args.orderCode,
      productName: 'Supplier product', totalAmount: 55000, paymentStatus: 'UNPAID', status: 'PENDING_PAYMENT' })),
    createPayment: vi.fn(async args => ({ provider: providerFor(args.orderCode), orderCode: args.orderCode,
      method: args.method, paid: false, totalAmount: 55000 })),
    getDelivery: vi.fn(async args => ({ provider: providerFor(args.orderCode), orderCode: args.orderCode, items: ['private-account|private-password'] })),
    acknowledgeDelivery: vi.fn().mockResolvedValue({ status: 'COMPLETED' }),
    prepareCheckout: vi.fn(), confirmCheckout: vi.fn(), getCatalog: vi.fn(), listOrders: vi.fn(), setPrice: vi.fn(), canManage: vi.fn(),
    ...patch,
  };
}
function expectNoCommerce(deps) {
  for (const name of ['getOrder', 'createPayment', 'getDelivery', 'acknowledgeDelivery', 'prepareCheckout', 'confirmCheckout', 'getCatalog', 'listOrders', 'setPrice']) {
    expect(deps[name], name).not.toHaveBeenCalled();
  }
}
async function rejected(click, patch = {}) {
  const deps = dependencies(patch);
  await createSupplierAutobuyInteractionHandler(deps)(click);
  expect(click.reply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ flags: MessageFlags.Ephemeral, allowedMentions: noMentions }));
  expect(click.deferReply).not.toHaveBeenCalled();
  expectNoCommerce(deps);
  return deps;
}

beforeEach(() => {
  config.guildId = guildId;
  vi.stubEnv('ENV_FILE', '.env');
  state.ready = { cdkvietnam: true, dopermind: true };
  state.render = { order: vi.fn(() => ({ components })), payment: vi.fn(async () => ({ components })), notice: vi.fn(() => ({ components })) };
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('durable supplier ticket interaction origin', () => {
  it.each([[cdkCode, 'cdkvietnam'], [doperCode, 'dopermind']])('reads %s from its persisted provider in the same shared customer ticket', async (orderCode, provider) => {
    const deps = dependencies(), click = fixture(id('order', orderCode));
    await createSupplierAutobuyInteractionHandler(deps)(click);
    expect(deps.getTicketContext).toHaveBeenCalledExactlyOnceWith({ guildId, channelId, messageId: noticeId, customerId, orderCode, ephemeral: false });
    expect(deps.getOrder).toHaveBeenCalledExactlyOnceWith({ client: click.client, guildId, customerId, orderCode, provider });
    expect(state.render.payment).toHaveBeenCalledExactlyOnceWith({ order: expect.objectContaining({ orderCode, provider }), customerId, ticketContext: true });
    expect(click.deferReply).toHaveBeenCalledExactlyOnceWith({ flags: MessageFlags.Ephemeral });
    expect(click.editReply).toHaveBeenCalledExactlyOnceWith({ components, flags: MessageFlags.IsComponentsV2, allowedMentions: noMentions });
    expect(deps.createPayment).not.toHaveBeenCalled();
    expect(click.update).not.toHaveBeenCalled(); expect(click.followUp).not.toHaveBeenCalled();
  });

  it.each(['payos', 'wallet'])('uses ticket-bound provider and order for %s and renders only a private receipt', async method => {
    const deps = dependencies(), click = fixture(id('pay', doperCode, method));
    await createSupplierAutobuyInteractionHandler(deps)(click);
    const context = { client: click.client, guildId, customerId, orderCode: doperCode, provider: 'dopermind' };
    expect(deps.createPayment).toHaveBeenCalledExactlyOnceWith({ ...context, method });
    expect(deps.getOrder).toHaveBeenCalledExactlyOnceWith({ guildId, customerId, orderCode: doperCode, provider: 'dopermind' });
    expect(state.render.payment).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ customerId, ticketContext: true,
      payment: expect.objectContaining({ orderCode: doperCode, provider: 'dopermind' }) }));
    expect(click.deferReply).toHaveBeenCalledExactlyOnceWith({ flags: MessageFlags.Ephemeral });
    expect(click.update).not.toHaveBeenCalled(); expect(click.followUp).not.toHaveBeenCalled();
  });

  it('refreshes stale ticket payment controls before any invoice or wallet debit', async () => {
    const deps = dependencies(), click = fixture(id('pay', cdkCode, 'wallet'));
    click.message.components = [{ type: 17, components: [{ type: 10, content: 'Old payment terms' }] }];
    await createSupplierAutobuyInteractionHandler(deps)(click);
    expect(deps.createPayment).not.toHaveBeenCalled();
    expect(deps.getOrder).toHaveBeenCalledOnce();
    expect(state.render.payment).toHaveBeenCalledWith(expect.objectContaining({ ticketContext: true }));
  });

  it('accepts the customer’s subsequent ephemeral receipt only against the same persisted ticket order', async () => {
    const deps = dependencies(), click = fixtureEphemeral();
    await createSupplierAutobuyInteractionHandler(deps)(click);
    expect(deps.getTicketContext).toHaveBeenCalledExactlyOnceWith({ guildId, channelId, messageId: ephemeralId, customerId, orderCode: cdkCode, ephemeral: true });
    expect(deps.getOrder).toHaveBeenCalledOnce();
    expect(click.reply).not.toHaveBeenCalled();
  });
  it('updates only the owner-bound ephemeral ticket status in place and preserves the durable notice', async () => {
    const deps = dependencies(), handler = createSupplierAutobuyInteractionHandler(deps);
    const publicNotice = fixture(id('order'), { deferUpdate: vi.fn().mockResolvedValue(undefined) });
    await handler(publicNotice);
    expect(publicNotice.deferReply).toHaveBeenCalledExactlyOnceWith({ flags: MessageFlags.Ephemeral });
    expect(publicNotice.deferUpdate).not.toHaveBeenCalled();
    const privateReceipt = fixtureEphemeral(id('order'), { deferUpdate: vi.fn().mockResolvedValue(undefined) });
    await handler(privateReceipt);
    expect(privateReceipt.deferUpdate).toHaveBeenCalledOnce(); expect(privateReceipt.deferReply).not.toHaveBeenCalled();
    expect(privateReceipt.editReply).toHaveBeenCalledExactlyOnceWith({ components, flags: MessageFlags.IsComponentsV2,
      allowedMentions: noMentions, attachments: [] });
    expect(deps.getTicketContext).toHaveBeenLastCalledWith({ guildId, channelId, messageId: ephemeralId,
      customerId, orderCode: cdkCode, ephemeral: true });
    expect(deps.getOrder).toHaveBeenLastCalledWith({ client: privateReceipt.client, guildId, customerId, orderCode: cdkCode, provider: 'cdkvietnam' });
    expect(deps.createPayment).not.toHaveBeenCalled();
  });
  it('accepts the exact owner-bound application-webhook shape of a Discord ephemeral ticket receipt', async () => {
    const deps = dependencies(), click = fixtureEphemeral(id('order'), { deferUpdate: vi.fn().mockResolvedValue(undefined) });
    const protocolClient = new Client({ intents: [] });
    try {
      // Exercise discord.js's raw API transformation rather than inventing a
      // camelCase metadata fixture that could hide a production mismatch.
      click.message = new Message(protocolClient, { id: ephemeralId, channel_id: channelId, guild_id: guildId,
        type: 0, timestamp: '2026-11-14T00:00:00.000Z', content: '', attachments: [], embeds: [], components: [],
        mention_everyone: false, mentions: [], mention_roles: [], pinned: false, tts: false,
        author: { id: botId, username: 'Cenar Store', discriminator: '0', avatar: null, bot: true },
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2, webhook_id: botId, application_id: botId,
        interaction_metadata: { id: '1571000000000000010', type: 3,
          user: { id: customerId, username: 'Buyer', discriminator: '0', avatar: null },
          authorizing_integration_owners: { 0: guildId }, interacted_message_id: noticeId } });
      expect(click.message.interactionMetadata.user.id).toBe(customerId);
      expect(click.message.webhookId).toBe(botId); expect(click.message.applicationId).toBe(botId);
      await createSupplierAutobuyInteractionHandler(deps)(click);
      expect(deps.getTicketContext).toHaveBeenCalledExactlyOnceWith({ guildId, channelId, messageId: ephemeralId,
        customerId, orderCode: cdkCode, ephemeral: true });
      expect(deps.getOrder).toHaveBeenCalledOnce(); expect(click.reply).not.toHaveBeenCalled();
      expect(click.deferUpdate).toHaveBeenCalledOnce();
    } finally { await protocolClient.destroy(); }
  });
  it.each([
    { webhookId: otherId, applicationId: botId },
    { webhookId: botId, applicationId: otherId },
    { webhookId: botId },
    { webhookId: botId, applicationId: botId, flags: 0 },
    { webhookId: botId, applicationId: botId, interactionMetadata: undefined },
    { webhookId: botId, applicationId: botId, interactionMetadata: { user: { id: otherId } } },
  ])('rejects ordinary or mismatched webhook provenance before ticket lookup %j', async patch => {
    const click = fixtureEphemeral(); Object.assign(click.message, patch);
    const deps = await rejected(click); expect(deps.getTicketContext).not.toHaveBeenCalled();
  });
  it('rejects an application webhook response if the executing interaction belongs to another app', async () => {
    const click = fixtureEphemeral(); click.message.webhookId = botId; click.message.applicationId = botId;
    click.applicationId = otherId;
    const deps = await rejected(click); expect(deps.getTicketContext).not.toHaveBeenCalled();
  });

  it('acknowledges retrieved credentials only after attaching them to an ephemeral reply', async () => {
    state.ready.cdkvietnam = false;
    const deps = dependencies(), click = fixture(id('delivery'));
    await createSupplierAutobuyInteractionHandler(deps)(click);
    expect(deps.getDelivery).toHaveBeenCalledExactlyOnceWith({ guildId, customerId, provider: 'cdkvietnam', orderCode: cdkCode });
    const payload = click.editReply.mock.calls[0][0];
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].attachment.toString('utf8')).toBe('private-account|private-password');
    expect(JSON.stringify(payload.components)).not.toContain('private-password');
    expect(deps.acknowledgeDelivery).toHaveBeenCalledExactlyOnceWith({ guildId, customerId, provider: 'cdkvietnam', orderCode: cdkCode,
      messageId: ephemeralId, channelId });
    expect(click.editReply.mock.invocationCallOrder[0]).toBeLessThan(deps.acknowledgeDelivery.mock.invocationCallOrder[0]);
    expect(deps.createPayment).not.toHaveBeenCalled();
  });

  it('does not acknowledge delivery after Discord fails to send the private attachment', async () => {
    const deps = dependencies(), click = fixture(id('delivery'), { editReply: vi.fn().mockRejectedValue(new Error('unknown Discord result')) });
    await createSupplierAutobuyInteractionHandler(deps)(click);
    expect(deps.getDelivery).toHaveBeenCalledOnce(); expect(deps.acknowledgeDelivery).not.toHaveBeenCalled();
  });

  it('keeps owned status readable while its provider is paused but refuses new payment', async () => {
    state.ready.cdkvietnam = false;
    const deps = dependencies(), handler = createSupplierAutobuyInteractionHandler(deps);
    const read = fixture(); await handler(read);
    expect(deps.getOrder).toHaveBeenCalledOnce();
    const pay = fixture(id('pay', cdkCode, 'wallet')); await handler(pay);
    expect(pay.reply).toHaveBeenCalledOnce(); expect(pay.deferReply).not.toHaveBeenCalled();
    expect(deps.createPayment).not.toHaveBeenCalled();
  });

  it.each([
    ['another customer', () => ({ user: { id: otherId } })],
    ['another guild', () => ({ guildId: '1070676180103086132' })],
    ['another author', () => ({ message: { id: noticeId, author: { id: otherId }, flags: 0 } })],
    ['webhook author', () => ({ message: { id: noticeId, author: { id: botId }, webhookId: '1511111111111111111', flags: 0 } })],
    ['unknown notice', () => ({ message: { id: '1569999999999999990', author: { id: botId }, flags: 0 } })],
    ['channel ID mismatch', () => ({ channel: channel({ id: '1569999999999999990' }) })],
    ['channel guild mismatch', () => ({ channel: channel({ guildId: otherId }) })],
    ['thread channel', () => ({ channel: channel({ type: ChannelType.PrivateThread }) })],
    ['public ticket', () => ({ channel: channel({ permissionOverwrites: { cache: new Map() } }) })],
    ['missing owner access', () => ({ channel: channel({ permissionOverwrites: { cache: new Map([[guildId, { deny: bits(PermissionFlagsBits.ViewChannel) }]]) } }) })],
    ['missing bot history', () => ({ channel: channel({ permissionsFor: () => bits(PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages) }) })],
    ['changed topic', () => ({ channel: channel({ topic: 'Unrelated ticket' }) })],
    ['changed category', () => ({ channel: channel({ parentId: '1569999999999999990' }) })],
  ])('rejects %s before financial or delivery work', async (_label, patch) => {
    await rejected(fixture(id('order'), patch()));
  });

  it.each([undefined, otherId])('rejects an ephemeral ticket control with missing or wrong source user %s', async sourceUser => {
    const click = fixtureEphemeral();
    click.message.interactionMetadata = sourceUser ? { user: { id: sourceUser } } : undefined;
    const deps = await rejected(click);
    expect(deps.getTicketContext).not.toHaveBeenCalled();
  });

  it.each([
    { provider: 'other' }, { orderCode: doperCode }, { customerId: otherId }, { channelId: otherId },
  ])('rejects inconsistent persisted notice context %j', async patch => {
    await rejected(fixture(), { getTicketContext: vi.fn(async () => ({ provider: 'cdkvietnam', orderCode: cdkCode, customerId, channelId, ...patch })) });
  });

  it('fails closed if the ticket-context lookup is unavailable', async () => {
    await rejected(fixture(), { getTicketContext: vi.fn().mockRejectedValue(new Error('Database unavailable')) });
  });

  it.each(['.env.store2', '/home/container/.env'])('rejects a wrong process environment %s before ticket lookup', async envFile => {
    vi.stubEnv('ENV_FILE', envFile);
    const deps = await rejected(fixture()); expect(deps.getTicketContext).not.toHaveBeenCalled();
  });

  it('rejects a Store1-looking ticket in another configured store before ticket lookup', async () => {
    config.guildId = otherId;
    const deps = await rejected(fixture()); expect(deps.getTicketContext).not.toHaveBeenCalled();
  });

  it.each([
    `supplier-autobuy:orders:${customerId}`,
    `supplier-autobuy:page:${customerId}:0:0`,
    `supplier-autobuy:confirm:${customerId}:b9d30c1d-cb9a-4321-95dc-2994ac587ac1`,
    `supplier-autobuy:qty:${customerId}:cdkvietnam%3A6`,
    `supplier-autobuy:editprice:${customerId}:cdkvietnam%3A6`,
  ])('rejects non-ticket commerce action %s even on the verified notice channel', async customId => {
    const click = fixture(customId), deps = await rejected(click);
    expect(deps.getTicketContext).not.toHaveBeenCalled(); expect(click.showModal).not.toHaveBeenCalled();
  });

  it.each(['qtymodal', 'pricemodal'])('rejects ticket %s submissions without opening a new scope', async action => {
    const click = fixture(`supplier-autobuy:${action}:${customerId}:cdkvietnam%3A6`, {
      isButton: () => false, isModalSubmit: () => true, fields: { getTextInputValue: () => '2' },
    });
    const deps = await rejected(click); expect(deps.getTicketContext).not.toHaveBeenCalled();
  });
});
