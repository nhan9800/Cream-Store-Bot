import fs from 'node:fs';
import path from 'node:path';
import { Collection, ChannelType, PermissionsBitField, PermissionFlagsBits } from 'discord.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const databasePath = vi.hoisted(() => {
  const value = `./data/test-supplier-flow-${process.pid}-${Date.now()}.sqlite`;
  Object.assign(process.env, {
    ENV_FILE: '.env.supplier-flow-integration-absent', DATABASE_PATH: value,
    ENCRYPTION_KEY: 'synthetic-integration-encryption-key-never-used-in-production',
  });
  return value;
});
// Only out-of-band presentation refreshes are stubbed. Commerce, SQLite
// transactions, payment ledger, ticket reservation and AES-GCM remain real.
vi.mock('../src/services/ctvOrderLogService.js', () => ({ syncCtvOrderLog: vi.fn().mockResolvedValue(null) }));
vi.mock('../src/services/adminOrderCenterService.js', () => ({
  markAdminOrderReminderLifecycleChanged: vi.fn(), scheduleAdminOrderCenterRefresh: vi.fn(),
}));

import { db, initDatabase } from '../src/database/db.js';
import { createOrder, getOrderByCode, markOrderCompleted, payOrderWithWallet, saveDelivery, savePaymentLinkData, recordOrderPayment } from '../src/services/orderService.js';
import { createTicket, getOpenTicketByCustomer } from '../src/services/ticketService.js';
import { addWalletBalance, getWalletBalance } from '../src/services/walletService.js';
import { encrypt, decrypt } from '../src/utils/crypto.js';
import { createSupplierAutobuyCatalog } from '../src/services/supplierAutobuyCatalogService.js';
import { createSupplierAutobuyOrderService } from '../src/services/supplierAutobuyOrderService.js';
import { createSupplierAutobuyCheckout } from '../src/services/supplierAutobuyCheckoutService.js';
import { createDopermindClient, DOPERMIND_ORIGIN } from '../src/services/dopermindClient.js';
import { STORE_ONE_GUILD_ID } from '../src/utils/locale.js';
import { buildSupplierPaymentView } from '../src/services/supplierAutobuyPanelService.js';

const NOW = Date.parse('2026-11-10T16:30:00Z');
const PRODUCT = 'desc_integration-product';
const BOT = '1382729296724099132';
const CATEGORY = '1514606994256957600';
const LOG = '1514607026247045121';
const COST = 36000;
const NAME = 'CapCut Pro 30 Ngày (BHF)';
const DELIVERABLE = 'synthetic-customer@example.invalid|synthetic-private-password';
let sequence = 0;

const json = data => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });
const intentFor = code => db.prepare('SELECT * FROM supplier_autobuy_intents WHERE order_code=?').get(code);
const ledgerFor = code => db.prepare("SELECT * FROM wallet_transactions WHERE related_code=? AND type='PAYMENT'").all(code);

function fixture({ supplierFunds = 500000, blockDm = false } = {}) {
  const n = ++sequence;
  const customerId = String(1138315103821889500n + BigInt(n));
  const ticketChannelId = String(1569729564115206200n + BigInt(n));
  const dmChannelId = String(1569999999999999700n + BigInt(n));
  const dmMessageId = String(1569999999999999800n + BigInt(n));
  let funds = supplierFunds;
  const requests = [];
  const fetchProvider = vi.fn(async (url, options) => {
    expect(new URL(url).origin).toBe(DOPERMIND_ORIGIN);
    expect(options.headers.Authorization).toBe('Bearer synthetic-integration-provider-key');
    requests.push({ path: new URL(url).pathname, method: options.method });
    if (options.method === 'GET' && new URL(url).pathname === '/v1/stock') return json({ products: [{
      product_key: PRODUCT, name: NAME, name_en: 'CapCut Pro 30 Days', type: 'description',
      price: COST, base_price: COST, unlimited: false, stock: 20,
    }] });
    if (options.method === 'GET' && new URL(url).pathname === '/v1/balance') return json({
      balance: funds, currency: 'VND', updated_at: new Date(NOW).toISOString(),
    });
    if (options.method === 'POST' && new URL(url).pathname === '/v1/orders') {
      const body = JSON.parse(options.body);
      expect(Object.keys(body).sort()).toEqual(['product_key', 'quantity', 'request_id']);
      const persisted = db.prepare('SELECT * FROM supplier_autobuy_intents WHERE request_id=?').get(body.request_id);
      // The durable identity and atomic customer payment must precede POST.
      expect(persisted).toMatchObject({ product_key: PRODUCT, quantity: body.quantity, status: 'SUBMITTING' });
      expect(JSON.parse(persisted.request_json)).toEqual(body);
      expect(getOrderByCode(persisted.order_code)).toMatchObject({ payment_status: 'PAID', payment_provider: 'WALLET', amount_paid: persisted.sale_amount });
      expect(ledgerFor(persisted.order_code)).toHaveLength(1);
      funds -= COST * body.quantity;
      return json({ request_id: body.request_id, product_key: body.product_key, quantity: body.quantity,
        order_code: `SUPPLIER_TEST_${n}`, unit_price: COST, total_amount: COST * body.quantity,
        balance_after: funds, created_at: new Date(NOW).toISOString(), idempotent: false,
        items: Array.from({ length: body.quantity }, () => DELIVERABLE) });
    }
    throw new Error('Unexpected synthetic provider operation');
  });
  const provider = createDopermindClient({ apiKey: 'synthetic-integration-provider-key', fetchImpl: fetchProvider, enforceRateLimits: false });
  const policy = {
    version: 'integration-reviewed-v1', referenceMaxAgeDays: 30,
    pricingDefaults: { feeReserveBps: 300, minProfitVnd: 20000, roundToVnd: 1000 },
    references: { official: { kind: 'BENCHMARK', url: 'https://www.capcut.com/pricing', checkedAt: new Date(NOW).toISOString() } },
    products: [{ productKey: PRODUCT, expectedName: NAME, enabled: true, category: 'Thiết kế', markupVnd: 20000,
      reserveVnd: 3000, referenceId: 'official', referenceCapVnd: 500000, termLabel: '30 ngày',
      warrantyLabel: 'Bảo hành đủ thời hạn gói', accountForm: 'Tài khoản cấp sẵn',
      comparisonDisclosure: 'Gói tham chiếu khác hình thức tài khoản.' }],
  };
  const catalog = createSupplierAutobuyCatalog({ policy, database: db, enabled: () => true, now: () => NOW, clientFactory: () => provider });
  const dmSend = vi.fn(async payload => {
    const owned = db.prepare('SELECT * FROM supplier_autobuy_intents WHERE customer_id=?').get(customerId);
    expect(owned.encrypted_payload).toMatch(/^enc:v1:/);
    expect(owned.encrypted_payload).not.toContain(DELIVERABLE);
    expect(JSON.parse(decrypt(owned.encrypted_payload)).items).toEqual([DELIVERABLE]);
    expect(getOrderByCode(owned.order_code).payment_status).toBe('PAID');
    expect(payload.allowedMentions).toEqual({ parse: [], users: [], roles: [], repliedUser: false });
    expect(payload.files[0].attachment.toString('utf8')).toContain(DELIVERABLE);
    if (blockDm) throw new Error('Synthetic DM blocked');
    return { id: dmMessageId };
  });
  const createDM = vi.fn(async () => ({ id: dmChannelId, send: dmSend }));
  const channels = new Collection([[CATEGORY, { id: CATEGORY, type: ChannelType.GuildCategory }]]);
  const guild = {
    id: STORE_ONE_GUILD_ID,
    members: { fetch: vi.fn(async ({ user }) => ({ id: user })) },
    channels: {
      fetch: vi.fn(async id => id ? channels.get(id) : channels),
      create: vi.fn(async input => {
        const channel = { id: ticketChannelId, guildId: STORE_ONE_GUILD_ID, type: input.type,
          parentId: input.parent, topic: input.topic, permissionOverwrites: { cache: new Collection(
            input.permissionOverwrites.map(entry => [entry.id, { allow: new PermissionsBitField(entry.allow || []), deny: new PermissionsBitField(entry.deny || []) }]),
          ) } };
        channels.set(channel.id, channel);
        return channel;
      }),
    },
  };
  const client = { user: { id: BOT }, guilds: { fetch: vi.fn(async () => guild) },
    users: { fetch: vi.fn(async id => { expect(id).toBe(customerId); return { id, createDM }; }) } };
  const notifyCompletion = vi.fn().mockResolvedValue(null);
  const engine = createSupplierAutobuyOrderService({ db, getQuote: catalog.getQuote, createOrder,
    markOrderCompleted, saveDelivery, encrypt, decrypt, providerFactory: () => provider,
    enabled: () => true, customerBlocked: () => false, now: () => NOW, notifyCompletion });
  engine.init();
  const payosLink = vi.fn(async () => { throw new Error('PayOS must not be used in the wallet integration'); });
  const publishOrder = vi.fn().mockResolvedValue(null);
  const checkout = createSupplierAutobuyCheckout({ database: db, enabled: () => true, engine,
    guildConfig: () => ({ ticket_category_id: CATEGORY, order_log_channel_id: LOG }),
    customerFlag: () => ({}), ticketMute: () => ({}), findOpenTicket: getOpenTicketByCustomer,
    insertTicket: createTicket, readOrder: getOrderByCode, debitWallet: payOrderWithWallet, payosLink, publishOrder });
  const context = { guildId: STORE_ONE_GUILD_ID, customerId };
  async function confirm() {
    const quote = await engine.prepareSupplierCheckout({ ...context, productKey: PRODUCT });
    const order = await checkout.confirm({ client, ...context, quoteId: quote.quoteId });
    return { quote, order };
  }
  return { context, client, guild, checkout, engine, catalog, provider, fetchProvider, requests, dmSend, createDM,
    notifyCompletion, payosLink, confirm, ticketChannelId, dmChannelId, dmMessageId };
}

beforeAll(() => {
  // An accidental call outside the explicitly injected mock transport fails.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('External network forbidden in integration tests'); }));
  initDatabase();
});
afterAll(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  db.close();
  const absolutePath = path.resolve(process.cwd(), databasePath);
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(absolutePath + suffix, { force: true });
  vi.unstubAllGlobals();
});

describe('supplier autobuy real commerce integration without external I/O', () => {
  it('persists a private PayOS invoice and re-renders its QR without duplicate creation, then hides it after payment', async () => {
    const t = fixture();
    const { order } = await t.confirm();
    const qrCode = '000201010212' + '1234567890'.repeat(6);
    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    t.payosLink.mockImplementationOnce(async current => savePaymentLinkData(current.order_code, {
      paymentLinkId: 'synthetic-link', checkoutUrl: 'https://pay.payos.vn/web/synthetic-link',
      qrCode, qrText: qrCode, expiredAt: expiresAt,
    }));
    const payment = await t.checkout.payment({ client: t.client, ...t.context, orderCode: order.orderCode, method: 'payos' });
    expect(payment).toMatchObject({ totalAmount: 61000, qrCode, expiresAt });
    const reopened = await t.checkout.status({ ...t.context, orderCode: order.orderCode });
    expect(reopened.payment).toEqual(payment);
    const card = await buildSupplierPaymentView({ order: reopened, customerId: t.context.customerId });
    expect(card.files[0].attachment.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(card.files[0].name).toBe(`payos-${order.orderCode}.png`);
    expect(JSON.stringify(card.components)).toContain('61.000đ');
    expect(t.payosLink).toHaveBeenCalledOnce(); expect(ledgerFor(order.orderCode)).toHaveLength(0);
    expect(t.requests.filter(request => request.method === 'POST')).toHaveLength(0);
    recordOrderPayment({ orderCode: order.orderCode, provider: 'PAYOS', transactionId: 'synthetic-invoice-receipt', amount: 61000, content: order.orderCode });
    const paid = await t.checkout.status({ ...t.context, orderCode: order.orderCode });
    expect(paid.payment).toBeUndefined();
    expect((await buildSupplierPaymentView({ order: paid, customerId: t.context.customerId, payment })).files).toBeUndefined();
    expect(t.payosLink).toHaveBeenCalledOnce(); expect(t.dmSend).not.toHaveBeenCalled();
  });

  it('quotes, creates one private ticket, debits once, persists encrypted receipt before private DM and survives repeated actions', async () => {
    const t = fixture();
    const offers = await t.catalog.getOffers();
    expect(offers.offers[0]).toMatchObject({ productKey: PRODUCT, priceVnd: 61000, available: true });
    const { quote, order } = await t.confirm();
    expect(quote).toMatchObject({ totalPriceVnd: 61000, termLabel: '30 ngày' });
    expect(quote).not.toHaveProperty('unitCostVnd');
    expect(order).toMatchObject({ fulfillment_mode: 'SUPPLIER', product_id: null, payment_status: 'UNPAID', status: 'PENDING_PAYMENT', total_amount: 61000 });
    const ticket = getOpenTicketByCustomer(t.context.guildId, t.context.customerId, 'ORDER');
    expect(ticket).toMatchObject({ id: order.ticket_id, channel_id: t.ticketChannelId, support_source: 'DISCORD_AUTOBUY' });
    const created = t.guild.channels.create.mock.calls[0][0];
    expect(created.parent).toBe(CATEGORY);
    expect(created.permissionOverwrites.find(entry => entry.id === STORE_ONE_GUILD_ID).deny).toContain(PermissionFlagsBits.ViewChannel);
    expect(created.permissionOverwrites.find(entry => entry.id === t.context.customerId).allow).toContain(PermissionFlagsBits.ViewChannel);
    expect(t.requests.filter(request => request.method === 'POST')).toHaveLength(0);
    addWalletBalance(t.context.guildId, t.context.customerId, 100000, 'TOPUP', 'Synthetic test funds');
    const args = { client: t.client, ...t.context, orderCode: order.orderCode, method: 'wallet' };
    const [first, duplicate] = await Promise.all([t.checkout.payment(args), t.checkout.payment(args)]);
    expect(first).toEqual(duplicate);
    expect(first).toMatchObject({ paid: true, status: 'COMPLETED' });
    expect(getWalletBalance(t.context.guildId, t.context.customerId)).toBe(39000);
    expect(ledgerFor(order.orderCode)).toHaveLength(1);
    expect(ledgerFor(order.orderCode)[0].amount).toBe(-61000);
    expect(getOrderByCode(order.orderCode)).toMatchObject({ status: 'COMPLETED', payment_status: 'PAID', amount_paid: 61000,
      delivery_dm_channel_id: t.dmChannelId, delivery_dm_message_id: t.dmMessageId, credential_password: null });
    const intent = intentFor(order.orderCode);
    expect(intent).toMatchObject({ status: 'DELIVERED', attempts: 1, charged_unit_cost: COST, charged_total_cost: COST });
    expect(intent.encrypted_payload).toMatch(/^enc:v1:/);
    expect(intent.encrypted_payload).not.toContain(DELIVERABLE);
    const replay = await t.checkout.confirm({ client: t.client, ...t.context, quoteId: quote.quoteId });
    expect(replay.orderCode).toBe(order.orderCode);
    await t.checkout.payment(args);
    await t.engine.fulfillSupplierOrder(t.client, order.orderCode);
    const restarted = createSupplierAutobuyOrderService({ db, getQuote: t.catalog.getQuote, createOrder, markOrderCompleted,
      saveDelivery, encrypt, decrypt, providerFactory: () => t.provider, enabled: () => true, customerBlocked: () => false, now: () => NOW });
    expect(await restarted.fulfillSupplierOrder(t.client, order.orderCode)).toMatchObject({ delivered: true, reused: true });
    expect(restarted.getSupplierDeliveryForCustomer({ ...t.context, orderCode: order.orderCode }).items).toEqual([DELIVERABLE]);
    expect(() => restarted.getSupplierDeliveryForCustomer({ ...t.context, customerId: '1070676180103086132', orderCode: order.orderCode })).toThrow();
    expect(t.guild.channels.create).toHaveBeenCalledTimes(1);
    expect(t.requests.filter(request => request.method === 'POST')).toHaveLength(1);
    expect(t.dmSend).toHaveBeenCalledTimes(1);
    expect(ledgerFor(order.orderCode)).toHaveLength(1);
    expect(t.payosLink).not.toHaveBeenCalled();
  });

  it('leaves the actual order and wallet untouched when supplier funds fail preflight for either payment method', async () => {
    const t = fixture({ supplierFunds: 0 });
    const { order } = await t.confirm();
    addWalletBalance(t.context.guildId, t.context.customerId, 100000, 'TOPUP', 'Synthetic test funds');
    for (const method of ['wallet', 'payos']) await expect(t.checkout.payment({ client: t.client, ...t.context,
      orderCode: order.orderCode, method })).rejects.toMatchObject({ code: 'SUPPLIER_UNFUNDED' });
    expect(getWalletBalance(t.context.guildId, t.context.customerId)).toBe(100000);
    expect(ledgerFor(order.orderCode)).toHaveLength(0);
    expect(getOrderByCode(order.orderCode)).toMatchObject({ status: 'PENDING_PAYMENT', payment_status: 'UNPAID', amount_paid: 0 });
    expect(db.prepare('SELECT * FROM supplier_autobuy_payment_methods WHERE order_code=?').get(order.orderCode)).toBeUndefined();
    expect(t.requests.filter(request => request.method === 'POST')).toHaveLength(0);
    expect(t.dmSend).not.toHaveBeenCalled();
    expect(t.payosLink).not.toHaveBeenCalled();
  });

  it('retains one charged receipt after blocked DM and completes through owned private retrieval without rebuying', async () => {
    const t = fixture({ blockDm: true });
    const { order } = await t.confirm();
    addWalletBalance(t.context.guildId, t.context.customerId, 100000, 'TOPUP', 'Synthetic test funds');
    await t.checkout.payment({ client: t.client, ...t.context, orderCode: order.orderCode, method: 'wallet' });
    expect(intentFor(order.orderCode).status).toBe('DELIVERY_PENDING');
    expect(getOrderByCode(order.orderCode).status).toBe('PROCESSING');
    expect(t.engine.getSupplierDeliveryForCustomer({ ...t.context, orderCode: order.orderCode }).items).toEqual([DELIVERABLE]);
    expect(() => t.engine.acknowledgeSupplierDeliveryRetrieval({ ...t.context, customerId: '1070676180103086132', orderCode: order.orderCode, messageId: t.dmMessageId })).toThrow();
    t.engine.acknowledgeSupplierDeliveryRetrieval({ ...t.context, orderCode: order.orderCode, messageId: t.dmMessageId, channelId: t.ticketChannelId });
    await t.engine.fulfillSupplierOrder(t.client, order.orderCode);
    expect(getOrderByCode(order.orderCode).status).toBe('COMPLETED');
    expect(intentFor(order.orderCode)).toMatchObject({ status: 'DELIVERED', delivery_kind: 'EPHEMERAL' });
    expect(getWalletBalance(t.context.guildId, t.context.customerId)).toBe(39000);
    expect(ledgerFor(order.orderCode)).toHaveLength(1);
    expect(t.requests.filter(request => request.method === 'POST')).toHaveLength(1);
    expect(t.dmSend).toHaveBeenCalledTimes(1);
  });
});
