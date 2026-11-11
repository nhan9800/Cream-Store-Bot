import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageFlags, PermissionsBitField } from 'discord.js';
const state = vi.hoisted(() => ({ snapshot: {}, panel: {} }));
vi.mock('../src/config.js', () => ({ config: { guildId: '1282637033340403754' } }));
vi.mock('../src/database/db.js', () => ({ db: { prepare: () => { throw new Error('No database in interaction test'); } } }));
vi.mock('../src/utils/emojiHelper.js', () => ({
  createEmojiResolver: () => { const E = name => '<:' + name + ':1382729296724099132>'; return E; },
  withButtonEmoji: (button, emoji) => button.setEmoji({ name: emoji.match(/^<:(\w+):/)?.[1] || 'test', id: '1382729296724099132' }),
}));
vi.mock('../src/services/supplierAutobuyRuntime.js', () => ({ supplierAutobuyRuntime: { getHealth: () => state.snapshot } }));
vi.mock('../src/services/supplierAutobuyPanelService.js', async importOriginal => ({ ...await importOriginal(), getSupplierAutobuyPanelHealth: () => state.panel }));
import { createSupplierAutobuyInteractionHandler } from '../src/events/supplierAutobuyHandlers.js';

const guildId = '1282637033340403754', customerId = '111111111111111111', otherId = '222222222222222222';
const botId = '1382729296724099132', channelId = '1569729564115206214', messageId = '1569729568695255211';
const quoteId = 'b9d30c1d-cb9a-4321-95dc-2994ac587ac1';
const productKey = 'desc_12345678-abcd-abcd-abcd-123456789012';
const quote = { quoteId, productKey, productName: 'Capcut Pro', quantity: 1, unitPriceVnd: 55000, totalPriceVnd: 55000, termLabel: '30 ngày', warrantyLabel: 'Bảo hành full', accountForm: 'Cấp tài khoản', expiresAt: '2026-11-10T17:00:00Z' };
const order = { orderCode: 'CN_123456', productName: 'Capcut Pro', totalPriceVnd: 55000, paymentStatus: 'UNPAID', status: 'PENDING_PAYMENT' };
function fixture(customId = 'supplier-autobuy:catalog', patch = {}) {
  const privateAction = customId !== 'supplier-autobuy:catalog' && customId !== 'supplier-autobuy:status';
  return {
    customId, guildId, channelId, user: { id: customerId },
    client: { user: { id: botId } },
    message: { id: privateAction ? '1569999999999999999' : messageId, author: { id: botId }, flags: privateAction ? MessageFlags.Ephemeral : 0,
      components: privateAction ? [{ type: 17, components: [{ type: 10, content: '**Thanh toán trước:** Chỉ tiếp tục nếu đồng ý chờ nguồn.' }] }] : [],
      ...(privateAction ? { interactionMetadata: { user: { id: customerId } } } : {}) },
    isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false,
    deferReply: vi.fn().mockResolvedValue(undefined), reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue({ id: '1569999999999999998' }), showModal: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn(), update: vi.fn(), ...patch,
  };
}
function dependencies(patch = {}) {
  return {
    getCatalog: vi.fn().mockResolvedValue({ offers: [{ productKey, name: 'Capcut Pro', priceVnd: 55000, available: true, category: 'Sáng tạo' }] }),
    prepareCheckout: vi.fn().mockResolvedValue(quote), confirmCheckout: vi.fn().mockResolvedValue(order),
    createPayment: vi.fn().mockResolvedValue({ orderCode: order.orderCode, method: 'payos', paid: false, checkoutUrl: 'https://pay.payos.vn/web/test' }),
    getOrder: vi.fn().mockResolvedValue(order), listOrders: vi.fn().mockResolvedValue([order]),
    getDelivery: vi.fn().mockResolvedValue({ orderCode: order.orderCode, items: ['secret-account|secret-password'] }),
    acknowledgeDelivery: vi.fn().mockResolvedValue({ status: 'COMPLETED' }),
    setPrice: vi.fn().mockResolvedValue(undefined), canManage: vi.fn().mockResolvedValue(false), ...patch,
  };
}
const privateId = (action, suffix = '') => 'supplier-autobuy:' + action + ':' + customerId + (suffix ? ':' + suffix : '');
const context = { guildId, customerId };
beforeEach(() => {
  vi.stubEnv('ENV_FILE', '.env');
  state.snapshot = { status: 'CONNECTED', provider: 'dopermind', purchasesEnabled: true, productCount: 101, checkedAt: '2026-11-10T15:57:34.914Z' };
  state.panel = { status: 'READY', channelId, messageId };
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('supplier autobuy customer commerce interactions', () => {
  it('opens the live catalog only after a private acknowledgement and never buys on browsing', async () => {
    const deps = dependencies(), interaction = fixture();
    await createSupplierAutobuyInteractionHandler(deps)(interaction);
    expect(interaction.deferReply).toHaveBeenCalledExactlyOnceWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.deferReply.mock.invocationCallOrder[0]).toBeLessThan(deps.getCatalog.mock.invocationCallOrder[0]);
    expect(deps.getCatalog).toHaveBeenCalledTimes(1);
    expect(deps.confirmCheckout).not.toHaveBeenCalled();
    expect(deps.createPayment).not.toHaveBeenCalled();
    expect(interaction.editReply.mock.calls[0][0]).toMatchObject({ flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [], users: [], roles: [], repliedUser: false } });
    expect(interaction.reply).not.toHaveBeenCalled();
  });
  it('keeps public status cache-only while exposing owned history access', async () => {
    const deps = dependencies(), interaction = fixture('supplier-autobuy:status');
    await createSupplierAutobuyInteractionHandler(deps)(interaction);
    expect(deps.getCatalog).not.toHaveBeenCalled();
    expect(JSON.stringify(interaction.editReply.mock.calls)).toContain('Đơn của tôi');
    expect(JSON.stringify(interaction.editReply.mock.calls)).toContain('Autobuy đã sẵn sàng');
  });
  it('prepares a server-priced quote from a selected opaque product identity', async () => {
    const deps = dependencies(), interaction = fixture(privateId('select'), { isButton: () => false, isStringSelectMenu: () => true, values: [productKey] });
    await createSupplierAutobuyInteractionHandler(deps)(interaction);
    expect(deps.prepareCheckout).toHaveBeenCalledExactlyOnceWith({ ...context, productKey, quantity: 1 });
    expect(JSON.stringify(interaction.editReply.mock.calls)).toContain(quoteId);
    expect(deps.confirmCheckout).not.toHaveBeenCalled();
    expect(deps.createPayment).not.toHaveBeenCalled();
  });
  it.each([
    { user: { id: otherId } },
    { message: { id: '1569999999999999999', author: { id: botId }, flags: 0 } },
    { message: { id: '1569999999999999999', author: { id: otherId }, flags: MessageFlags.Ephemeral } },
    { message: { id: '1569999999999999999', author: { id: botId }, flags: MessageFlags.Ephemeral, interactionMetadata: { user: { id: otherId } } } },
    { guildId: '1070676180103086132' }, { channelId: '1569999999999999997' },
  ])('rejects forged or cross-customer controls before durable work %j', async patch => {
    const deps = dependencies(), interaction = fixture(privateId('confirm', quoteId), patch);
    await createSupplierAutobuyInteractionHandler(deps)(interaction);
    expect(interaction.reply).toHaveBeenCalledOnce();
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(deps.confirmCheckout).not.toHaveBeenCalled();
    expect(deps.createPayment).not.toHaveBeenCalled();
  });
  it.each(['supplier-autobuy:confirm:' + customerId + ':not-a-uuid', 'supplier-autobuy:pay:' + customerId + ':CN_123456:arbitrary', 'supplier-autobuy:order:' + customerId + ':../../private', 'supplier-autobuy:select:' + customerId + ':forged-price'])('rejects malformed action identities %s', async customId => {
    const deps = dependencies(), interaction = fixture(customId);
    await createSupplierAutobuyInteractionHandler(deps)(interaction);
    expect(interaction.reply).toHaveBeenCalledOnce();
    expect(deps.confirmCheckout).not.toHaveBeenCalled();
    expect(deps.createPayment).not.toHaveBeenCalled();
  });
  it('routes confirmation to the ticket-owning facade with only the bound quote ID', async () => {
    const deps = dependencies(), interaction = fixture(privateId('confirm', quoteId));
    await createSupplierAutobuyInteractionHandler(deps)(interaction);
    expect(deps.confirmCheckout).toHaveBeenCalledExactlyOnceWith({ client: interaction.client, ...context, quoteId });
    expect(deps.createPayment).not.toHaveBeenCalled();
    expect(JSON.stringify(interaction.editReply.mock.calls)).toContain('Dùng ví Cenar');
    expect(JSON.stringify(interaction.editReply.mock.calls)).toContain('CN_123456');
  });
  it.each(['wallet', 'payos'])('routes payment once with no customer-controlled price (%s)', async method => {
    const deps = dependencies(), interaction = fixture(privateId('pay', 'CN_123456:' + method));
    await createSupplierAutobuyInteractionHandler(deps)(interaction);
    expect(deps.createPayment).toHaveBeenCalledExactlyOnceWith({ client: interaction.client, ...context, orderCode: 'CN_123456', method });
    expect(deps.getOrder).toHaveBeenCalledExactlyOnceWith({ client: interaction.client, ...context, orderCode: 'CN_123456' });
    expect(deps.confirmCheckout).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledOnce();
  });
  it.each(['wallet', 'payos'])('refreshes stale private %s payment buttons before creating an invoice or debit, then accepts the next click', async method => {
    const deps = dependencies(), handler = createSupplierAutobuyInteractionHandler(deps);
    const stale = fixture(privateId('pay', 'CN_123456:' + method));
    stale.message.components = [{ type: 17, components: [{ type: 10, content: 'Thanh toán để nhận hàng ngay.' }] }];
    await handler(stale);
    expect(deps.createPayment).not.toHaveBeenCalled();
    expect(deps.getOrder).toHaveBeenCalledExactlyOnceWith({ client: stale.client, ...context, orderCode: order.orderCode });
    expect(JSON.stringify(stale.editReply.mock.calls[0][0].components)).toContain('Thanh toán trước');
    expect(JSON.stringify(stale.editReply.mock.calls[0][0].components)).toContain('chỉ tiếp tục nếu bạn đồng ý chờ');
    const next = fixture(privateId('pay', 'CN_123456:' + method));
    next.message.components = stale.editReply.mock.calls[0][0].components;
    await handler(next);
    expect(deps.createPayment).toHaveBeenCalledExactlyOnceWith({ client: next.client, ...context, orderCode: order.orderCode, method });
    expect(next.editReply).toHaveBeenCalledOnce();
  });
  it('attaches a locally rendered PayOS QR to the same private receipt after successful payment creation', async () => {
    const deps = dependencies({ createPayment: vi.fn().mockResolvedValue({ orderCode: order.orderCode, method: 'PAYOS', paid: false,
      status: 'PENDING_PAYMENT', totalAmount: 55000, checkoutUrl: 'https://pay.payos.vn/web/test',
      qrCode: '00020100000000000000000000000000000000000000', expiresAt: new Date(Date.now() + 3600000).toISOString() }) });
    const interaction = fixture(privateId('pay', 'CN_123456:payos'));
    await createSupplierAutobuyInteractionHandler(deps)(interaction);
    const payload = interaction.editReply.mock.calls[0][0];
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].name).toBe('payos-CN_123456.png');
    expect(payload.files[0].attachment.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(JSON.stringify(payload.components)).toContain('attachment://payos-CN_123456.png');
    expect(JSON.stringify(payload.components)).toContain('55.000đ');
    expect(JSON.stringify(payload.components)).toContain('Hạn thanh toán');
    expect(interaction.deferReply).toHaveBeenCalledExactlyOnceWith({ flags: MessageFlags.Ephemeral });
    expect(payload.allowedMentions.parse).toEqual([]);
    expect(deps.createPayment).toHaveBeenCalledTimes(1);
    expect(deps.acknowledgeDelivery).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
  });
  it('keeps the successful invoice and QR even if the subsequent order-status refresh fails', async () => {
    const deps = dependencies({ createPayment: vi.fn().mockResolvedValue({ orderCode: order.orderCode, method: 'PAYOS', paid: false,
      status: 'PENDING_PAYMENT', totalAmount: 55000, checkoutUrl: 'https://pay.payos.vn/web/test' }),
      getOrder: vi.fn().mockRejectedValue(new Error('private-provider-error')) });
    const interaction = fixture(privateId('pay', 'CN_123456:payos'));
    await createSupplierAutobuyInteractionHandler(deps)(interaction);
    const payload = interaction.editReply.mock.calls[0][0];
    expect(payload.files).toHaveLength(1);
    expect(JSON.stringify(payload.components)).toContain('attachment://payos-CN_123456.png');
    expect(JSON.stringify(payload.components)).toContain('55.000đ');
    expect(JSON.stringify(payload.components)).not.toContain('private-provider-error');
    expect(deps.createPayment).toHaveBeenCalledTimes(1);
    expect(deps.confirmCheckout).not.toHaveBeenCalled();
  });
  it('shows paid preorders waiting for source funding with automatic resumption and no second payment action', async () => {
    const deps = dependencies({ createPayment: vi.fn().mockResolvedValue({ orderCode: order.orderCode, method: 'WALLET', paid: true, status: 'PROCESSING' }),
      getOrder: vi.fn().mockResolvedValue({ ...order, paymentStatus: 'PAID', status: 'PROCESSING', deliveryStatus: 'WAITING_SUPPLIER_FUNDS' }) });
    const interaction = fixture(privateId('pay', 'CN_123456:wallet'));
    await createSupplierAutobuyInteractionHandler(deps)(interaction);
    const payload = interaction.editReply.mock.calls[0][0];
    const text = JSON.stringify(payload.components);
    expect(text).toContain('Đã thanh toán · Chờ shop bổ sung nguồn');
    expect(text).toContain('không cần thanh toán lại hoặc tạo đơn mới');
    expect(text).toContain('Hệ thống tự mua và giao khi shop bổ sung nguồn');
    expect(text).not.toContain('supplier-autobuy:pay:');
    expect(text).not.toContain('chưa tạo mã QR');
    expect(payload.files).toBeUndefined();
    expect(deps.createPayment).toHaveBeenCalledTimes(1);
    expect(deps.acknowledgeDelivery).not.toHaveBeenCalled();
  });
  it.each(['order', 'orderselect'])('restores a persisted owned PayOS invoice on %s without requesting a new invoice', async action => {
    const deps = dependencies({ getOrder: vi.fn().mockResolvedValue({ ...order, payment: {
      method: 'PAYOS', paid: false, checkoutUrl: 'https://pay.payos.vn/web/existing', expiresAt: new Date(Date.now() + 3600000).toISOString(),
    } }) });
    const interaction = action === 'order' ? fixture(privateId('order', order.orderCode))
      : fixture(privateId('orderselect'), { isButton: () => false, isStringSelectMenu: () => true, values: [order.orderCode] });
    await createSupplierAutobuyInteractionHandler(deps)(interaction);
    const payload = interaction.editReply.mock.calls[0][0];
    expect(payload.files).toHaveLength(1);
    expect(JSON.stringify(payload.components)).toContain('attachment://payos-CN_123456.png');
    expect(JSON.stringify(payload.components)).toContain('https://pay.payos.vn/web/existing');
    expect(deps.createPayment).not.toHaveBeenCalled();
    expect(deps.getOrder).toHaveBeenCalledExactlyOnceWith({ client: interaction.client, ...context, orderCode: order.orderCode });
  });
  it('does not repeat a payment when the private acknowledgement or notification fails', async () => {
    const deps = dependencies(), interaction = fixture(privateId('pay', 'CN_123456:wallet'), { editReply: vi.fn().mockRejectedValue(new Error('raw-private-data')) });
    await createSupplierAutobuyInteractionHandler(deps)(interaction);
    expect(deps.createPayment).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).not.toHaveBeenCalled();
    const failedAck = fixture(privateId('pay', 'CN_123456:wallet'), { deferReply: vi.fn().mockRejectedValue(new Error('expired')) });
    await createSupplierAutobuyInteractionHandler(deps)(failedAck);
    expect(deps.createPayment).toHaveBeenCalledTimes(1);
  });
  it('turns quote changes into a safe reselect notice without making an invoice or charge', async () => {
    const deps = dependencies({ confirmCheckout: vi.fn().mockRejectedValue(Object.assign(new Error('provider-key-private'), { code: 'SUPPLIER_QUOTE_CHANGED' })) });
    const interaction = fixture(privateId('confirm', quoteId));
    await createSupplierAutobuyInteractionHandler(deps)(interaction);
    const output = JSON.stringify(interaction.editReply.mock.calls);
    expect(output).toContain('Báo giá đã hết hạn hoặc thay đổi');
    expect(output).not.toContain('provider-key-private');
    expect(deps.createPayment).not.toHaveBeenCalled();
  });
  it.each([
    ['SUPPLIER_UNFUNDED', 'không thanh toán lại'],
    ['PAYMENT_METHOD_LOCKED', 'Đơn đã chọn một phương thức thanh toán'],
  ])('shows a safe payment preflight notice for %s without retrying another method', async (code, message) => {
    const deps = dependencies({ createPayment: vi.fn().mockRejectedValue(Object.assign(new Error('provider-secret-private'), { code })) });
    const interaction = fixture(privateId('pay', 'CN_123456:wallet'));
    await createSupplierAutobuyInteractionHandler(deps)(interaction);
    const output = JSON.stringify(interaction.editReply.mock.calls);
    expect(output).toContain(message);
    if (code === 'SUPPLIER_UNFUNDED') expect(output).not.toMatch(/chưa tạo mã QR|chưa trừ|chưa mở bán/);
    expect(output).not.toContain('provider-secret-private');
    expect(deps.createPayment).toHaveBeenCalledOnce();
    expect(deps.getOrder).not.toHaveBeenCalled();
    expect(deps.confirmCheckout).not.toHaveBeenCalled();
  });
  it('permits existing owned history and delivery while new sales are paused', async () => {
    state.snapshot.purchasesEnabled = false;
    const deps = dependencies(), handler = createSupplierAutobuyInteractionHandler(deps);
    const history = fixture(privateId('orders'));
    await handler(history);
    expect(deps.listOrders).toHaveBeenCalledExactlyOnceWith({ ...context, limit: 10 });
    const pay = fixture(privateId('pay', 'CN_123456:wallet'));
    await handler(pay);
    expect(deps.createPayment).not.toHaveBeenCalled();
    expect(pay.reply).toHaveBeenCalledOnce();
  });
  it('retrieves credentials only as a private attachment and acknowledges delivery after a successful edit', async () => {
    const deps = dependencies(), interaction = fixture(privateId('delivery', 'CN_123456'));
    await createSupplierAutobuyInteractionHandler(deps)(interaction);
    expect(deps.getDelivery).toHaveBeenCalledExactlyOnceWith({ ...context, orderCode: 'CN_123456' });
    const payload = interaction.editReply.mock.calls[0][0];
    expect(JSON.stringify(payload.components)).not.toMatch(/secret-account|secret-password/);
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].attachment.toString()).toBe('secret-account|secret-password');
    expect(deps.acknowledgeDelivery).toHaveBeenCalledExactlyOnceWith({ ...context, orderCode: 'CN_123456', messageId: '1569999999999999998', channelId });
    expect(interaction.editReply.mock.invocationCallOrder[0]).toBeLessThan(deps.acknowledgeDelivery.mock.invocationCallOrder[0]);
    expect(deps.createPayment).not.toHaveBeenCalled();
  });
  it('never acknowledges blocked private delivery and never exposes payload on an ownership rejection', async () => {
    const deps = dependencies(), interaction = fixture(privateId('delivery', 'CN_123456'), { editReply: vi.fn().mockRejectedValue(new Error('blocked')) });
    await createSupplierAutobuyInteractionHandler(deps)(interaction);
    expect(deps.acknowledgeDelivery).not.toHaveBeenCalled();
    const second = dependencies({ getDelivery: vi.fn().mockRejectedValue(Object.assign(new Error('raw-payload'), { code: 'OWNER_MISMATCH' })) });
    const forbidden = fixture(privateId('delivery', 'CN_123456'));
    await createSupplierAutobuyInteractionHandler(second)(forbidden);
    expect(forbidden.editReply.mock.calls[0][0]).not.toHaveProperty('files');
    expect(JSON.stringify(forbidden.editReply.mock.calls)).not.toContain('raw-payload');
    expect(second.acknowledgeDelivery).not.toHaveBeenCalled();
  });
  it('opens a bounded quantity modal without acknowledging a purchase or charge', async () => {
    const deps = dependencies(), interaction = fixture(privateId('qty', productKey));
    await createSupplierAutobuyInteractionHandler(deps)(interaction);
    expect(interaction.showModal).toHaveBeenCalledOnce();
    expect(JSON.stringify(interaction.showModal.mock.calls)).toContain('qtymodal');
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(deps.prepareCheckout).not.toHaveBeenCalled();
  });
  it.each(['0', '11', '100', '-1', '1e2', '', 'nan'])('rejects invalid quantities before preparing a quote (%s)', async value => {
    const deps = dependencies(), interaction = fixture(privateId('qtymodal', productKey), { message: undefined, isButton: () => false, isModalSubmit: () => true, fields: { getTextInputValue: () => value } });
    await createSupplierAutobuyInteractionHandler(deps)(interaction);
    expect(deps.prepareCheckout).not.toHaveBeenCalled();
    expect(JSON.stringify(interaction.editReply.mock.calls)).toContain('Số lượng hợp lệ');
  });
  it('prepares the exact selected quantity after modal submission', async () => {
    const deps = dependencies(), interaction = fixture(privateId('qtymodal', productKey), { message: undefined, isButton: () => false, isModalSubmit: () => true, fields: { getTextInputValue: () => '10' } });
    await createSupplierAutobuyInteractionHandler(deps)(interaction);
    expect(deps.prepareCheckout).toHaveBeenCalledExactlyOnceWith({ ...context, productKey, quantity: 10 });
  });
  it('requires fresh Admin permissions on both price modal opening and submission', async () => {
    const deps = dependencies(), handler = createSupplierAutobuyInteractionHandler(deps);
    const opening = fixture(privateId('editprice', productKey));
    await handler(opening);
    expect(opening.showModal).not.toHaveBeenCalled();
    expect(opening.reply).toHaveBeenCalledOnce();
    const submission = fixture(privateId('pricemodal', productKey), { message: undefined, isButton: () => false, isModalSubmit: () => true, fields: { getTextInputValue: () => '65000' } });
    await handler(submission);
    expect(deps.setPrice).not.toHaveBeenCalled();
    expect(deps.canManage).toHaveBeenCalledTimes(2);
  });
  it('persists an approved Admin price through the server-side guard and passes no client quote cost', async () => {
    const deps = dependencies({ canManage: vi.fn().mockResolvedValue(true) });
    const interaction = fixture(privateId('pricemodal', productKey), { message: undefined, isButton: () => false, isModalSubmit: () => true, fields: { getTextInputValue: () => '65000' } });
    await createSupplierAutobuyInteractionHandler(deps)(interaction);
    expect(deps.setPrice).toHaveBeenCalledExactlyOnceWith({ client: interaction.client, guildId, productKey, priceVnd: 65000, actorId: customerId });
    expect(JSON.stringify(interaction.editReply.mock.calls)).toContain('Đã cập nhật giá');
  });
  it('uses a forced fresh guild member lookup for the default Admin guard', async () => {
    const deps = dependencies(); delete deps.canManage;
    const interaction = fixture(privateId('editprice', productKey), { guild: { members: { fetch: vi.fn().mockResolvedValue({ id: customerId, permissions: new PermissionsBitField(['ManageGuild']) }) } } });
    await createSupplierAutobuyInteractionHandler(deps)(interaction);
    expect(interaction.guild.members.fetch).toHaveBeenCalledExactlyOnceWith({ user: customerId, force: true });
    expect(interaction.showModal).toHaveBeenCalledOnce();
  });
});
