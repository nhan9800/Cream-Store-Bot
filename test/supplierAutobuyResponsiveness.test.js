import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageFlags, PermissionsBitField } from 'discord.js';

const state = vi.hoisted(() => ({ quoteView: vi.fn(), catalogView: vi.fn(), noticeView: vi.fn(), replyView: vi.fn(), enabled: {} }));
vi.mock('../src/config.js', () => ({ config: { guildId: '1282637033340403754' } }));
vi.mock('../src/services/supplierAutobuyRuntime.js', () => ({ supplierAutobuyRuntime: {
  forProvider: provider => ({ getHealth: () => ({ provider, purchasesEnabled: state.enabled[provider] ?? true }) }),
} }));
vi.mock('../src/services/supplierAutobuyPanelService.js', () => ({
  getSupplierAutobuyPanelHealth: provider => ({ status: 'READY', provider,
    channelId: provider === 'cdkvietnam' ? '1569729564115206214' : '1571000000000000001',
    messageId: provider === 'cdkvietnam' ? '1569729568695255211' : '1571000000000000002' }),
  buildSupplierQuoteView: options => state.quoteView(options),
  buildSupplierCatalogView: options => state.catalogView(options),
  buildSupplierNoticeView: options => state.noticeView(options),
  buildSupplierAutobuyReply: options => state.replyView(options),
  buildSupplierOrderListView: () => view('orders'),
  buildSupplierPaymentView: async options => view(`order:${options.order.orderCode}`),
  isSupplierPaymentViewExpired: () => false,
  buildSupplierOrderView: () => view('order'),
  hasSupplierPrepayDisclosure: () => true,
}));
import { createSupplierAutobuyInteractionHandler } from '../src/events/supplierAutobuyHandlers.js';

const guildId = '1282637033340403754', userId = '111111111111111111', botId = '1382729296724099132';
const quoteId = 'b9d30c1d-cb9a-4321-95dc-2994ac587ac1';
const productKey = 'cdkvietnam:6';
const context = { guildId, customerId: userId, provider: 'cdkvietnam' };
const view = value => ({ components: [{ type: 17, components: [{ type: 10, content: String(value) }] }] });
const control = (action, args = '') => `supplier-autobuy:${action}:${userId}${args ? ':' + args : ''}`;
function pending() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(action = 'select', patch = {}) {
  const member = { id: userId, permissions: new PermissionsBitField(), roles: { cache: new Map() } };
  const interaction = { customId: `supplier-autobuy:${action}:${userId}`, guildId,
    channelId: '1569729564115206214', user: { id: userId }, client: { user: { id: botId } },
    guild: { id: guildId, members: { cache: new Map([[userId, member]]), fetch: vi.fn(async () => member) } },
    memberPermissions: new PermissionsBitField(),
    message: { id: '1569999999999999999', author: { id: botId }, flags: MessageFlags.Ephemeral,
      interactionMetadata: { user: { id: userId } } },
    values: [productKey], isButton: () => action !== 'select', isStringSelectMenu: () => action === 'select', isModalSubmit: () => false,
    deferReply: vi.fn(async () => {}), reply: vi.fn(async () => {}), editReply: vi.fn(async () => ({ id: '1569999999999999999' })),
    showModal: vi.fn(async () => {}), ...patch,
  };
  return interaction;
}
beforeEach(() => {
  vi.stubEnv('ENV_FILE', '.env'); vi.clearAllMocks();
  state.enabled = {};
  state.quoteView.mockImplementation(options => view(`quote:${options.quote.quoteId}`));
  state.catalogView.mockImplementation(options => view(`catalog:${options.page}`));
  state.noticeView.mockImplementation(options => view(options.title));
  state.replyView.mockImplementation(options => view(`paused:${options.provider}`));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('AutoBuy interaction responsiveness', () => {
  it('measures the customer quote critical path with controlled provider and Discord latencies', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    const delay = (ms, value) => new Promise(resolve => setTimeout(() => resolve(value), ms));
    const click = fixture();
    click.guild.members.fetch.mockImplementation(() => delay(250, { id: userId, permissions: new PermissionsBitField() }));
    const prepareCheckout = vi.fn(() => delay(350, { quoteId, productKey }));
    let renderedAt;
    click.editReply.mockImplementation(async () => { renderedAt = performance.now(); });
    const startedAt = performance.now();
    const task = createSupplierAutobuyInteractionHandler({ prepareCheckout })(click);
    await vi.advanceTimersByTimeAsync(1000); await task;
    // The previous sequential quote + display-only member check took 600ms.
    expect(renderedAt - startedAt).toBe(350);
    expect(click.guild.members.fetch).not.toHaveBeenCalled();
  });
  it('renders ordinary quotes without calling the privileged guard and shows staff controls only as a local hint', async () => {
    const prepareCheckout = vi.fn(async () => ({ quoteId, productKey })), canManage = vi.fn(async () => true);
    const handler = createSupplierAutobuyInteractionHandler({ prepareCheckout, canManage });
    const customer = fixture(); await handler(customer);
    expect(state.quoteView).toHaveBeenLastCalledWith(expect.objectContaining({ manager: false }));
    const staff = fixture(); staff.memberPermissions = new PermissionsBitField(['ManageGuild']); await handler(staff);
    expect(state.quoteView).toHaveBeenLastCalledWith(expect.objectContaining({ manager: true }));
    expect(canManage).not.toHaveBeenCalled();
    expect(customer.guild.members.fetch).not.toHaveBeenCalled(); expect(staff.guild.members.fetch).not.toHaveBeenCalled();
  });
  it('never lets a stale positive permission hint authorize opening or submitting a price change', async () => {
    const prepareCheckout = vi.fn(async () => ({ quoteId, productKey })), setPrice = vi.fn();
    const handler = createSupplierAutobuyInteractionHandler({ prepareCheckout, setPrice });
    const selected = fixture(); selected.memberPermissions = new PermissionsBitField(['ManageGuild']);
    await handler(selected); expect(state.quoteView).toHaveBeenLastCalledWith(expect.objectContaining({ manager: true }));
    for (const action of ['editprice', 'pricemodal']) {
      const click = fixture(action, { customId: control(action, encodeURIComponent(productKey)),
        memberPermissions: new PermissionsBitField(['Administrator']),
        isButton: () => action === 'editprice', isModalSubmit: () => action === 'pricemodal',
        fields: { getTextInputValue: () => '75000' } });
      await handler(click);
      expect(click.guild.members.fetch).toHaveBeenCalledExactlyOnceWith({ user: userId, force: true });
      expect(click.showModal).not.toHaveBeenCalled();
    }
    expect(setPrice).not.toHaveBeenCalled();
  });
  it('uses an explicit negative interaction permission snapshot before an older positive guild cache hint', async () => {
    const click = fixture(); click.guild.members.cache.get(userId).permissions = new PermissionsBitField(['Administrator']);
    await createSupplierAutobuyInteractionHandler({ prepareCheckout: async () => ({ quoteId, productKey }) })(click);
    expect(state.quoteView).toHaveBeenLastCalledWith(expect.objectContaining({ manager: false }));
    expect(click.guild.members.fetch).not.toHaveBeenCalled();
  });
  it('updates a genuine own-application ephemeral webhook response in place', async () => {
    const click = fixture('select', { deferUpdate: vi.fn(async () => {}) });
    click.message.webhookId = botId; click.message.applicationId = botId;
    await createSupplierAutobuyInteractionHandler({ prepareCheckout: async () => ({ quoteId, productKey }) })(click);
    expect(click.deferUpdate).toHaveBeenCalledOnce(); expect(click.deferReply).not.toHaveBeenCalled();
    expect(click.editReply).toHaveBeenCalledOnce();
  });
  it.each(['page', 'category', 'select', 'orders', 'order', 'orderselect'])
    ('updates the verified private %s view in place and removes old attachments', async action => {
      const args = action === 'page' ? '0:1' : action === 'order' ? 'CN_123456' : '';
      const select = ['category', 'select', 'orderselect'].includes(action);
      const click = fixture(action, { customId: control(action, args),
        deferUpdate: vi.fn(async () => {}), isButton: () => !select, isStringSelectMenu: () => select,
        values: [action === 'category' ? '1' : action === 'orderselect' ? 'CN_123456' : productKey] });
      const deps = { getCatalog: vi.fn(async () => ({ offers: [] })), prepareCheckout: vi.fn(async () => ({ quoteId, productKey })),
        listOrders: vi.fn(async () => []), getOrder: vi.fn(async () => ({ orderCode: 'CN_123456' })) };
      await createSupplierAutobuyInteractionHandler(deps)(click);
      expect(click.deferUpdate).toHaveBeenCalledOnce(); expect(click.deferReply).not.toHaveBeenCalled();
      expect(click.editReply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ attachments: [], flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [], users: [], roles: [], repliedUser: false } }));
      for (const dependency of Object.values(deps)) if (dependency.mock.calls.length) {
        expect(click.deferUpdate.mock.invocationCallOrder[0]).toBeLessThan(dependency.mock.invocationCallOrder[0]);
      }
    });
  it('keeps a public storefront panel intact even when deferUpdate is available', async () => {
    const click = fixture('catalog', { customId: 'supplier-autobuy:catalog', deferUpdate: vi.fn(async () => {}) });
    click.message = { id: '1569729568695255211', author: { id: botId }, flags: 0 };
    await createSupplierAutobuyInteractionHandler({ getCatalog: async () => ({ offers: [] }) })(click);
    expect(click.deferUpdate).not.toHaveBeenCalled(); expect(click.deferReply).toHaveBeenCalledExactlyOnceWith({ flags: MessageFlags.Ephemeral });
    expect(click.editReply.mock.calls[0][0]).not.toHaveProperty('attachments');
  });
  it('uses a separate private response when the old ephemeral card has no reliable source-user metadata', async () => {
    const click = fixture('orders', { deferUpdate: vi.fn(async () => {}) }); delete click.message.interactionMetadata;
    await createSupplierAutobuyInteractionHandler({ listOrders: async () => [] })(click);
    expect(click.deferUpdate).not.toHaveBeenCalled(); expect(click.deferReply).toHaveBeenCalledOnce();
  });
  it('does no durable work after a failed private update acknowledgement', async () => {
    const prepareCheckout = vi.fn(), click = fixture('select', { deferUpdate: vi.fn(async () => { throw new Error('Unknown ack'); }) });
    await createSupplierAutobuyInteractionHandler({ prepareCheckout })(click);
    expect(prepareCheckout).not.toHaveBeenCalled(); expect(click.deferReply).not.toHaveBeenCalled(); expect(click.editReply).not.toHaveBeenCalled();
  });
  it.each(['confirm', 'pay', 'delivery', 'qtymodal'])('keeps %s on a separate private response instead of replacing a receipt', async action => {
    const args = action === 'confirm' ? quoteId : action === 'pay' ? 'CN_123456:wallet'
      : action === 'delivery' ? 'CN_123456' : encodeURIComponent(productKey);
    const click = fixture(action, { customId: control(action, args), deferUpdate: vi.fn(async () => {}),
      isModalSubmit: () => action === 'qtymodal', isButton: () => action !== 'qtymodal', fields: { getTextInputValue: () => '2' } });
    const deps = { confirmCheckout: vi.fn(async () => ({ orderCode: 'CN_123456' })),
      createPayment: vi.fn(async () => ({ orderCode: 'CN_123456' })), getOrder: vi.fn(async () => ({ orderCode: 'CN_123456' })),
      getDelivery: vi.fn(async () => ({ items: ['private-owned-secret'] })), acknowledgeDelivery: vi.fn(),
      prepareDeliveryPublication: vi.fn(async () => () => ({ items: ['private-owned-secret'] })),
      prepareCheckout: vi.fn(async () => ({ quoteId, productKey })) };
    await createSupplierAutobuyInteractionHandler(deps)(click);
    expect(click.deferUpdate).not.toHaveBeenCalled(); expect(click.deferReply).toHaveBeenCalledExactlyOnceWith({ flags: MessageFlags.Ephemeral });
    expect(click.editReply.mock.calls[0][0]).not.toHaveProperty('attachments');
    expect(JSON.stringify(click.editReply.mock.calls[0][0].components)).not.toContain('private-owned-secret');
    if (action === 'pay') expect(deps.createPayment).toHaveBeenCalledExactlyOnceWith({ client: click.client, ...context,
      orderCode: 'CN_123456', method: 'wallet' });
  });
  it('shares pending catalog work only for the same client/provider and reads again after completion', async () => {
    const first = fixture('page', { customId: control('page', '0:0') }), second = fixture('page', { customId: control('page', '0:1') });
    second.client = first.client;
    const source = pending(), getCatalog = vi.fn(() => source.promise), handler = createSupplierAutobuyInteractionHandler({ getCatalog });
    const a = handler(first), b = handler(second);
    await vi.waitFor(() => expect(getCatalog).toHaveBeenCalledExactlyOnceWith({ provider: 'cdkvietnam' }));
    source.resolve({ offers: [] }); await Promise.all([a, b]);
    expect(first.editReply).toHaveBeenCalledOnce(); expect(second.editReply).toHaveBeenCalledOnce();
    const next = fixture('page', { customId: control('page', '0:2'), client: first.client }); await handler(next);
    expect(getCatalog).toHaveBeenCalledTimes(2);
  });
  it('does not share catalog work across source providers or clients, and never shares quotes across customers', async () => {
    const source = pending(), getCatalog = vi.fn(() => source.promise), prepareCheckout = vi.fn(async options => ({ quoteId: options.customerId, productKey }));
    const handler = createSupplierAutobuyInteractionHandler({ getCatalog, prepareCheckout });
    const first = fixture('page', { customId: control('page', '0:0') });
    const otherSource = fixture('page', { customId: control('page', '0:0'), client: first.client, channelId: '1571000000000000001' });
    const otherClient = fixture('page', { customId: control('page', '0:0') });
    const tasks = [handler(first), handler(otherSource), handler(otherClient)];
    await vi.waitFor(() => expect(getCatalog).toHaveBeenCalledTimes(3)); source.resolve({ offers: [] }); await Promise.all(tasks);
    expect(getCatalog.mock.calls.map(([options]) => options.provider)).toEqual(['cdkvietnam', 'dopermind', 'cdkvietnam']);
    const customer = fixture(), other = fixture('select', { user: { id: '222222222222222222' }, customId: 'supplier-autobuy:select:222222222222222222' });
    other.message.interactionMetadata.user.id = other.user.id;
    await Promise.all([handler(customer), handler(other)]);
    expect(prepareCheckout).toHaveBeenCalledTimes(2);
    expect(prepareCheckout).toHaveBeenCalledWith({ ...context, productKey, quantity: 1 });
    expect(prepareCheckout).toHaveBeenCalledWith({ ...context, customerId: other.user.id, productKey, quantity: 1 });
  });
  it('releases failed catalog reads so a later request can retry', async () => {
    const getCatalog = vi.fn().mockRejectedValueOnce(new Error('private-source-error')).mockResolvedValue({ offers: [] });
    const first = fixture('page', { customId: control('page', '0:0') }), handler = createSupplierAutobuyInteractionHandler({ getCatalog });
    await handler(first); await handler(fixture('page', { customId: control('page', '0:0'), client: first.client }));
    expect(getCatalog).toHaveBeenCalledTimes(2); expect(state.catalogView).toHaveBeenCalledOnce();
    expect(JSON.stringify(first.editReply.mock.calls)).not.toContain('private-source-error');
  });
  it('does not overwrite a newer selected quote when an older catalog read completes later', async () => {
    const source = pending(), getCatalog = vi.fn(() => source.promise);
    const handler = createSupplierAutobuyInteractionHandler({ getCatalog, prepareCheckout: async () => ({ quoteId, productKey }) });
    const first = fixture('page', { customId: control('page', '0:1'), deferUpdate: vi.fn(async () => {}) });
    const selected = fixture('select', { client: first.client, deferUpdate: vi.fn(async () => {}) });
    const old = handler(first); await vi.waitFor(() => expect(getCatalog).toHaveBeenCalledOnce());
    await handler(selected); source.resolve({ offers: [] }); await old;
    expect(selected.editReply).toHaveBeenCalledOnce(); expect(first.editReply).not.toHaveBeenCalled();
  });
  it('reserves click order before a delayed ACK so an older click cannot replace a completed newer view', async () => {
    const acknowledgement = pending(), getCatalog = vi.fn(async () => ({ offers: [] }));
    const handler = createSupplierAutobuyInteractionHandler({ getCatalog,
      prepareCheckout: async () => ({ quoteId, productKey }) });
    const first = fixture('page', { customId: control('page', '0:1'), deferUpdate: vi.fn(() => acknowledgement.promise) });
    const old = handler(first);
    expect(first.deferUpdate).toHaveBeenCalledOnce();
    const selected = fixture('select', { client: first.client, deferUpdate: vi.fn(async () => {}) });
    await handler(selected);
    expect(selected.editReply).toHaveBeenCalledOnce();
    acknowledgement.resolve(); await old;
    expect(first.editReply).not.toHaveBeenCalled(); expect(getCatalog).not.toHaveBeenCalled();
    expect(selected.editReply).toHaveBeenCalledOnce();
  });
  it('serializes edits already in flight so the newest private navigation is published last', async () => {
    const publishing = pending(), first = fixture('page', { customId: control('page', '0:0'), deferUpdate: vi.fn(async () => {}),
      editReply: vi.fn(() => publishing.promise) });
    const handler = createSupplierAutobuyInteractionHandler({ getCatalog: async () => ({ offers: [] }),
      prepareCheckout: async () => ({ quoteId, productKey }) });
    const old = handler(first); await vi.waitFor(() => expect(first.editReply).toHaveBeenCalledOnce());
    const selected = fixture('select', { client: first.client, deferUpdate: vi.fn(async () => {}) });
    const latest = handler(selected); await vi.waitFor(() => expect(state.quoteView).toHaveBeenCalledOnce());
    expect(selected.editReply).not.toHaveBeenCalled(); publishing.resolve({ id: first.message.id });
    await Promise.all([old, latest]); expect(selected.editReply).toHaveBeenCalledOnce();
  });
  it('allows the newest view to publish even if the older Discord edit fails', async () => {
    const publishing = pending(), first = fixture('page', { customId: control('page', '0:0'), deferUpdate: vi.fn(async () => {}),
      editReply: vi.fn(() => publishing.promise) });
    const handler = createSupplierAutobuyInteractionHandler({ getCatalog: async () => ({ offers: [] }), prepareCheckout: async () => ({ quoteId, productKey }) });
    const old = handler(first); await vi.waitFor(() => expect(first.editReply).toHaveBeenCalledOnce());
    const selected = fixture('select', { client: first.client, deferUpdate: vi.fn(async () => {}) }); const latest = handler(selected);
    await vi.waitFor(() => expect(state.quoteView).toHaveBeenCalledOnce()); publishing.reject(new Error('Unknown edit result'));
    await Promise.all([old, latest]); expect(selected.editReply).toHaveBeenCalledOnce();
  });
  it.each(['catalog', 'page', 'category', 'select', 'qtymodal'])
    ('rechecks provider readiness after a pending %s view without publishing stale sale controls', async action => {
      const read = pending(), getCatalog = vi.fn(() => read.promise), prepareCheckout = vi.fn(() => read.promise);
      const args = action === 'page' ? '0:0' : action === 'qtymodal' ? encodeURIComponent(productKey) : '';
      const click = fixture(action, { customId: action === 'catalog' ? 'supplier-autobuy:catalog' : control(action, args),
        deferUpdate: vi.fn(async () => {}), isModalSubmit: () => action === 'qtymodal',
        isButton: () => ['catalog', 'page'].includes(action), isStringSelectMenu: () => ['category', 'select'].includes(action),
        values: [action === 'category' ? '0' : productKey], fields: { getTextInputValue: () => '1' } });
      if (action === 'catalog') click.message = { id: '1569729568695255211', author: { id: botId }, flags: 0 };
      const work = createSupplierAutobuyInteractionHandler({ getCatalog, prepareCheckout })(click);
      await vi.waitFor(() => expect(['select', 'qtymodal'].includes(action) ? prepareCheckout : getCatalog).toHaveBeenCalledOnce());
      state.enabled.cdkvietnam = false; read.resolve(['select', 'qtymodal'].includes(action) ? { quoteId, productKey } : { offers: [] });
      await work;
      expect(JSON.stringify(click.editReply.mock.calls[0][0].components)).toContain('paused:cdkvietnam');
      expect(state.replyView).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ provider: 'cdkvietnam', action: 'catalog',
        customerId: userId, snapshot: expect.objectContaining({ purchasesEnabled: false }) }));
    });
  it('checks readiness after an earlier private edit finishes, immediately before publishing the queued next view', async () => {
    const firstEdit = pending(), first = fixture('page', { customId: control('page', '0:0'), deferUpdate: vi.fn(async () => {}),
      editReply: vi.fn(() => firstEdit.promise) });
    const handler = createSupplierAutobuyInteractionHandler({ getCatalog: async () => ({ offers: [] }), prepareCheckout: async () => ({ quoteId, productKey }) });
    const prior = handler(first); await vi.waitFor(() => expect(first.editReply).toHaveBeenCalledOnce());
    const selected = fixture('select', { client: first.client, deferUpdate: vi.fn(async () => {}) });
    const next = handler(selected); await vi.waitFor(() => expect(state.quoteView).toHaveBeenCalledOnce());
    state.enabled.cdkvietnam = false; firstEdit.resolve({ id: first.message.id }); await Promise.all([prior, next]);
    expect(JSON.stringify(selected.editReply.mock.calls[0][0].components)).toContain('paused:cdkvietnam');
  });
  it.each(['orders', 'order'])('keeps owned %s readable when its source pauses during the read', async action => {
    const read = pending(), click = fixture(action, { customId: control(action, action === 'order' ? 'CN_123456' : ''),
      deferUpdate: vi.fn(async () => {}) });
    const listOrders = vi.fn(() => read.promise), getOrder = vi.fn(() => read.promise);
    const work = createSupplierAutobuyInteractionHandler({ listOrders, getOrder })(click);
    await vi.waitFor(() => expect(action === 'orders' ? listOrders : getOrder).toHaveBeenCalledOnce());
    state.enabled.cdkvietnam = false; read.resolve(action === 'orders' ? [] : { orderCode: 'CN_123456' }); await work;
    expect(click.editReply).toHaveBeenCalledOnce(); expect(state.replyView).not.toHaveBeenCalled();
    expect(JSON.stringify(click.editReply.mock.calls[0][0].components)).toContain(action === 'orders' ? 'orders' : 'CN_123456');
  });
  it('keeps a known successful payment receipt visible if the source pauses before the payment response resolves', async () => {
    const completed = pending(), createPayment = vi.fn(() => completed.promise), getOrder = vi.fn(async () => ({ provider: 'cdkvietnam', orderCode: 'CN_123456' }));
    const click = fixture('pay', { customId: control('pay', 'CN_123456:wallet'), deferUpdate: vi.fn(async () => {}) });
    const work = createSupplierAutobuyInteractionHandler({ createPayment, getOrder })(click);
    await vi.waitFor(() => expect(createPayment).toHaveBeenCalledOnce());
    state.enabled.cdkvietnam = false; completed.resolve({ provider: 'cdkvietnam', orderCode: 'CN_123456', paid: true, totalAmount: 55000 }); await work;
    expect(click.editReply).toHaveBeenCalledOnce(); expect(state.replyView).not.toHaveBeenCalled();
    expect(JSON.stringify(click.editReply.mock.calls[0][0].components)).toContain('CN_123456');
    expect(getOrder).toHaveBeenCalledExactlyOnceWith({ ...context, orderCode: 'CN_123456' });
  });
});
