import fs from 'node:fs';
import Database from 'better-sqlite3';
import { Collection, ChannelType, PermissionsBitField } from 'discord.js';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(process.env, { ENV_FILE: '.env.supplier-checkout-test-absent', DATABASE_PATH: `./data/test-supplier-checkout-${process.pid}.sqlite` }));
import { db } from '../src/database/db.js';
import { createSupplierAutobuyCheckout } from '../src/services/supplierAutobuyCheckoutService.js';

const guildId = '1282637033340403754', customerId = '1138315103821889566', botId = '1382729296724099132';
const ticketChannelId = '1569729564115206214', categoryId = '1514606994256957600', logId = '1514607026247045121';
const databases = [];
function fixture(options = {}) {
  const database = new Database(':memory:'); databases.push(database);
  database.exec(`CREATE TABLE orders(order_code TEXT PRIMARY KEY,guild_id TEXT,customer_id TEXT,fulfillment_mode TEXT,payment_status TEXT,status TEXT,total_amount INTEGER,quantity INTEGER,payment_link_id TEXT,
    payment_checkout_url TEXT,payment_qr_code TEXT,payment_qr_text TEXT,payment_expired_at TEXT);
    INSERT INTO orders(order_code,guild_id,customer_id,fulfillment_mode,payment_status,status,total_amount,quantity) VALUES('CN_123456','${guildId}','${customerId}','SUPPLIER','UNPAID','PENDING_PAYMENT',61000,1);
    CREATE TABLE tickets(id INTEGER PRIMARY KEY,ticket_code TEXT,guild_id TEXT,customer_id TEXT,channel_id TEXT,status TEXT);
    CREATE TABLE supplier_autobuy_intents(order_code TEXT PRIMARY KEY,guild_id TEXT,customer_id TEXT,provider TEXT,product_key TEXT);
    INSERT INTO supplier_autobuy_intents VALUES('CN_123456','${guildId}','${customerId}','dopermind','desc_test');`);
  const readOrder = vi.fn(code => database.prepare('SELECT * FROM orders WHERE order_code=?').get(code));
  const safeOrder = () => ({ orderCode: 'CN_123456', productName: 'CapCut Pro', status: readOrder('CN_123456').status });
  const owned = vi.fn(async args => { if (args.customerId !== customerId) throw Object.assign(new Error('not found'), { code: 'ORDER_NOT_FOUND' }); return safeOrder(); });
  const engine = {
    getSupplierOrderForCustomer: owned,
    getSupplierQuoteForCustomer: vi.fn(async args => { if (args.customerId !== customerId) throw Object.assign(new Error('not found'), { code: 'QUOTE_NOT_FOUND' }); return { quoteId: args.quoteId }; }),
    confirmSupplierCheckout: vi.fn(async () => ({ ...readOrder('CN_123456'), orderCode: 'CN_123456' })),
    validateSupplierOrderForPayment: vi.fn().mockResolvedValue(safeOrder()),
    fulfillSupplierOrder: vi.fn(async () => ({ delivered: true, updated: { status: 'COMPLETED' } })),
  };
  const debitWallet = vi.fn(() => { database.prepare("UPDATE orders SET payment_status='PAID',status='PROCESSING' WHERE order_code='CN_123456'").run(); return { order: readOrder('CN_123456') }; });
  const payosLink = vi.fn(async order => ({ ...order, payment_checkout_url: 'https://pay.payos.vn/web/test-link', payment_qr_code: 'test-safe-qr' }));
  const channel = { id: ticketChannelId, type: ChannelType.GuildText, guildId, parentId: categoryId,
    permissionOverwrites: { cache: new Collection([[guildId, { deny: new PermissionsBitField(['ViewChannel']) }], [customerId, { allow: new PermissionsBitField(['ViewChannel']) }]]) } };
  const inventory = new Collection([[categoryId, { id: categoryId, type: ChannelType.GuildCategory }]]);
  const guild = { id: guildId, members: { fetch: vi.fn(async () => ({ id: customerId })) }, channels: { fetch: vi.fn(async id => id ? channel : inventory), create: vi.fn(async input => { channel.topic = input.topic; inventory.set(channel.id, channel); return channel; }) } };
  const client = { user: { id: botId }, guilds: { fetch: vi.fn(async () => guild) } };
  const findOpenTicket = vi.fn(() => database.prepare("SELECT * FROM tickets WHERE guild_id=? AND customer_id=? AND status='OPEN' ORDER BY id DESC LIMIT 1").get(guildId, customerId));
  const insertTicket = vi.fn(input => {
    database.prepare("INSERT INTO tickets(ticket_code,guild_id,customer_id,channel_id,status) VALUES('TKT_123456',?,?,?,'OPEN')").run(input.guildId, input.customerId, input.channelId);
    return findOpenTicket();
  });
  const publishTicketOrder = vi.fn().mockResolvedValue({ status: 'SENT' });
  const facade = createSupplierAutobuyCheckout({ database, enabled: () => true, engine,
    customerFlag: () => ({}), ticketMute: () => ({}), guildConfig: () => ({ ticket_category_id: categoryId, order_log_channel_id: logId }),
    readOrder, debitWallet, payosLink, findOpenTicket, insertTicket, publishTicketOrder, ...options });
  return { facade, database, engine, client, guild, channel, readOrder, debitWallet, payosLink, publishTicketOrder };
}
afterEach(() => { for (const d of databases.splice(0)) if (d.open) d.close(); });
afterAll(() => { if (db.open) db.close(); for (const s of ['', '-wal', '-shm']) fs.rmSync(process.env.DATABASE_PATH + s, { force: true }); });
const payment = { guildId, customerId, orderCode: 'CN_123456', method: 'wallet' };

describe('supplier checkout payment boundaries', () => {
  it('normalizes UI lowercase methods, checks owned quote before debit and coalesces duplicate clicks', async () => {
    const { facade, engine, client, debitWallet, database } = fixture();
    const results = await Promise.all([facade.payment({ ...payment, client }), facade.payment({ ...payment, client })]);
    expect(results[0]).toEqual(results[1]);
    expect(debitWallet).toHaveBeenCalledTimes(1);
    expect(engine.validateSupplierOrderForPayment.mock.invocationCallOrder[0]).toBeLessThan(debitWallet.mock.invocationCallOrder[0]);
    expect(engine.fulfillSupplierOrder).toHaveBeenCalledTimes(1);
    expect(database.prepare('SELECT method FROM supplier_autobuy_payment_methods').get().method).toBe('WALLET');
    await facade.payment({ ...payment, client });
    expect(debitWallet).toHaveBeenCalledTimes(1);
    expect(engine.fulfillSupplierOrder).toHaveBeenCalledTimes(1);
  });
  it.each(['ENCRYPTION_UNAVAILABLE', 'QUOTE_CHANGED', 'OUT_OF_STOCK'])('never creates invoice or debits when preflight says %s', async code => {
    const { facade, engine, debitWallet, payosLink, database } = fixture();
    engine.validateSupplierOrderForPayment.mockRejectedValue(Object.assign(new Error('safe failure'), { code }));
    await expect(facade.payment({ ...payment, method: 'payos' })).rejects.toMatchObject({ code });
    expect(payosLink).not.toHaveBeenCalled();
    expect(debitWallet).not.toHaveBeenCalled();
    expect(database.prepare('SELECT COUNT(*) n FROM supplier_autobuy_payment_methods').get().n).toBe(0);
  });
  it('locks PayOS choice even on an uncertain external link response, preventing a wallet race', async () => {
    const { facade, payosLink, debitWallet } = fixture();
    payosLink.mockRejectedValueOnce(new Error('timeout'));
    await expect(facade.payment({ ...payment, method: 'payos' })).rejects.toThrow('timeout');
    await expect(facade.payment(payment)).rejects.toMatchObject({ code: 'PAYMENT_METHOD_LOCKED' });
    expect(debitWallet).not.toHaveBeenCalled();
    expect((await facade.payment({ ...payment, method: 'payos' })).checkoutUrl).toContain('pay.payos.vn');
    expect(payosLink).toHaveBeenCalledTimes(2);
    expect(payosLink.mock.calls.every(([order]) => order.order_code === payment.orderCode)).toBe(true);
  });
  it('allows another method after a safe insufficient customer-wallet failure', async () => {
    const { facade, debitWallet, payosLink } = fixture();
    debitWallet.mockImplementationOnce(() => { throw Object.assign(new Error('wallet low'), { code: 'INSUFFICIENT_BALANCE' }); });
    await expect(facade.payment(payment)).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    await facade.payment({ ...payment, method: 'payos' });
    expect(payosLink).toHaveBeenCalledTimes(1);
  });
  it('checks ownership before any provider/funds/payment work', async () => {
    const { facade, engine, debitWallet, payosLink } = fixture();
    await expect(facade.payment({ ...payment, customerId: '1070676180103086132' })).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
    expect(engine.validateSupplierOrderForPayment).not.toHaveBeenCalled(); expect(debitWallet).not.toHaveBeenCalled(); expect(payosLink).not.toHaveBeenCalled();
  });
  it.each(['CANCELLED', 'REFUNDED', 'COMPLETED'])('never charges a terminal order (%s)', async status => {
    const { facade, database, debitWallet, payosLink } = fixture();
    database.prepare('UPDATE orders SET status=?').run(status);
    await expect(facade.payment(payment)).rejects.toMatchObject({ code: 'ORDER_NOT_PAYABLE' });
    expect(debitWallet).not.toHaveBeenCalled(); expect(payosLink).not.toHaveBeenCalled();
  });
});

describe('supplier owned invoice recovery', () => {
  function saveInvoice(t, overrides = {}) {
    // Initialize additive checkout tables without making a payment.
    const ready = t.facade.status({ guildId, customerId, orderCode: payment.orderCode });
    return ready.then(() => {
      t.database.prepare("INSERT INTO supplier_autobuy_payment_methods VALUES (?,'PAYOS',?)").run(payment.orderCode, new Date().toISOString());
      t.database.prepare(`UPDATE orders SET payment_link_id='owned-link',payment_checkout_url=?,payment_qr_code=?,payment_expired_at=? WHERE order_code=?`)
        .run(overrides.url || 'https://pay.payos.vn/web/owned-link', overrides.qr || '000201synthetic-emv-invoice', '2026-11-12T12:00:00Z', payment.orderCode);
    });
  }
  it('restores the existing owner-bound QR, expiry and amount without new invoice/debit/purchase', async () => {
    const t = fixture(); await saveInvoice(t);
    const result = await t.facade.status({ guildId, customerId, orderCode: payment.orderCode });
    expect(result.payment).toEqual({ orderCode: payment.orderCode, method: 'PAYOS', paid: false, status: 'PENDING_PAYMENT',
      totalAmount: 61000, checkoutUrl: 'https://pay.payos.vn/web/owned-link', qrCode: '000201synthetic-emv-invoice', expiresAt: '2026-11-12T12:00:00.000Z' });
    expect(t.payosLink).not.toHaveBeenCalled(); expect(t.debitWallet).not.toHaveBeenCalled();
    expect(t.engine.validateSupplierOrderForPayment).not.toHaveBeenCalled(); expect(t.engine.fulfillSupplierOrder).not.toHaveBeenCalled();
  });
  it('checks ownership before returning any stored invoice', async () => {
    const t = fixture(); await saveInvoice(t);
    await expect(t.facade.status({ guildId, customerId: '1070676180103086132', orderCode: payment.orderCode })).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
  });
  it('removes the QR when authoritative status sync changes an invoice to paid', async () => {
    const syncPayos = vi.fn(async () => t.database.prepare("UPDATE orders SET status='PROCESSING',payment_status='PAID'").run());
    const t = fixture({ syncPayos }); await saveInvoice(t);
    const result = await t.facade.status({ client: t.client, guildId, customerId, orderCode: payment.orderCode });
    expect(result.payment).toBeUndefined(); expect(syncPayos).toHaveBeenCalledOnce();
  });
  it.each(['CANCELLED', 'REFUNDED', 'COMPLETED'])('does not restore a QR for terminal order %s', async status => {
    const t = fixture(); await saveInvoice(t); t.database.prepare('UPDATE orders SET status=?').run(status);
    expect((await t.facade.status({ guildId, customerId, orderCode: payment.orderCode })).payment).toBeUndefined();
  });
  it('does not expose arbitrary URLs or image addresses as payment data', async () => {
    const t = fixture(); await saveInvoice(t, { url: 'https://pay.payos.vn.evil.invalid/steal', qr: 'https://images.invalid/qr.png' });
    const result = await t.facade.status({ guildId, customerId, orderCode: payment.orderCode });
    expect(result.payment).toMatchObject({ checkoutUrl: null, qrCode: null });
  });
  it('allows existing invoice recovery while new sales are paused', async () => {
    let enabled = true;
    const t = fixture({ enabled: () => enabled }); await saveInvoice(t); enabled = false;
    expect((await t.facade.status({ guildId, customerId, orderCode: payment.orderCode })).payment.qrCode).toMatch(/^000201/);
  });
});

describe('supplier private ticket confirmation', () => {
  it('publishes the existing order to its private ticket without invoice, debit or source purchase', async () => {
    const t = fixture();
    await t.facade.confirm({ client: t.client, guildId, customerId, quoteId: 'quote-a' });
    expect(t.publishTicketOrder).toHaveBeenCalledWith({ client: t.client, orderCode: 'CN_123456', guildId, envFile: process.env.ENV_FILE });
    expect(t.payosLink).not.toHaveBeenCalled(); expect(t.debitWallet).not.toHaveBeenCalled();
    expect(t.engine.fulfillSupplierOrder).not.toHaveBeenCalled();
  });
  it('repairs the same ticket card when confirmation is reused even if a staff log already exists', async () => {
    const t = fixture();
    t.database.exec('ALTER TABLE orders ADD COLUMN order_log_message_id TEXT');
    t.database.prepare("UPDATE orders SET order_log_message_id='1569729564115206999'").run();
    t.engine.getSupplierQuoteForCustomer.mockResolvedValue({ orderCode: 'CN_123456' });
    await t.facade.confirm({ client: t.client, guildId, customerId, quoteId: 'quote-a' });
    expect(t.publishTicketOrder).toHaveBeenCalledOnce();
    expect(t.guild.channels.create).not.toHaveBeenCalled(); expect(t.engine.confirmSupplierCheckout).not.toHaveBeenCalled();
  });
  it('keeps confirmation usable after a ticket card failure so durable repair can retry it', async () => {
    const publishTicketOrder = vi.fn().mockRejectedValue(new Error('Synthetic message failure'));
    const t = fixture({ publishTicketOrder });
    await expect(t.facade.confirm({ client: t.client, guildId, customerId, quoteId: 'quote-a' })).resolves.toMatchObject({ orderCode: 'CN_123456' });
    expect(publishTicketOrder).toHaveBeenCalledOnce(); expect(t.payosLink).not.toHaveBeenCalled(); expect(t.debitWallet).not.toHaveBeenCalled();
  });
  it('creates and persists one private ticket for simultaneous quote confirmations', async () => {
    const { facade, client, guild, engine, database } = fixture();
    await Promise.all([facade.confirm({ client, guildId, customerId, quoteId: 'quote-a' }), facade.confirm({ client, guildId, customerId, quoteId: 'quote-a' })]);
    expect(guild.channels.create).toHaveBeenCalledTimes(1);
    expect(database.prepare('SELECT channel_id FROM tickets').get().channel_id).toBe(ticketChannelId);
    expect(engine.confirmSupplierCheckout).toHaveBeenCalledWith(expect.objectContaining({ guildId, customerId, ticketId: 1, ticketChannelId, orderLogChannelId: logId }));
  });
  it('does not create a ticket when the quote belongs to another customer', async () => {
    const { facade, client, guild } = fixture();
    await expect(facade.confirm({ client, guildId, customerId: '1070676180103086132', quoteId: 'other' })).rejects.toMatchObject({ code: 'QUOTE_NOT_FOUND' });
    expect(guild.channels.create).not.toHaveBeenCalled();
  });
  it('does not create duplicates when Discord may have created a channel but its response was lost', async () => {
    const { facade, client, guild, database } = fixture();
    guild.channels.create.mockRejectedValue(new Error('unknown create outcome'));
    const args = { client, guildId, customerId, quoteId: 'same-quote' };
    await expect(facade.confirm(args)).rejects.toMatchObject({ code: 'TICKET_CREATION_UNCERTAIN' });
    await expect(facade.confirm(args)).rejects.toMatchObject({ code: 'TICKET_CREATION_UNCERTAIN' });
    expect(guild.channels.create).toHaveBeenCalledTimes(1);
    expect(database.prepare('SELECT COUNT(*) n FROM tickets').get().n).toBe(1);
  });
  it('rejects a reused ticket that is not private to this customer', async () => {
    const { facade, client, channel, database } = fixture();
    database.prepare("INSERT INTO tickets VALUES(1,'TKT_1',?,?,?,'OPEN')").run(guildId, customerId, ticketChannelId);
    channel.permissionOverwrites.cache.clear();
    await expect(facade.confirm({ client, guildId, customerId, quoteId: 'same-quote' })).rejects.toMatchObject({ code: 'TICKET_ACCESS_UNVERIFIED' });
  });
});

describe('provider-bound checkout from separate supplier channels', () => {
  const mismatch = () => Object.assign(new Error('provider mismatch'), { code: 'PROVIDER_MISMATCH' });
  function bindProvider(t, provider) {
    t.database.prepare('UPDATE supplier_autobuy_intents SET provider=?,product_key=?')
      .run(provider, provider === 'cdkvietnam' ? 'cdkvietnam:1' : 'desc_test');
    const check = args => {
      if (args.provider !== undefined && args.provider !== provider) throw mismatch();
      if (args.customerId !== customerId) throw Object.assign(new Error('not found'), { code: 'ORDER_NOT_FOUND' });
    };
    t.engine.getSupplierQuoteForCustomer.mockImplementation(async args => {
      check(args); return { quoteId: args.quoteId, provider };
    });
    t.engine.getSupplierOrderForCustomer.mockImplementation(async args => {
      check(args); return { orderCode: args.orderCode, productName: 'Owned supplier product', provider,
        status: t.readOrder(args.orderCode)?.status };
    });
    t.engine.confirmSupplierCheckout.mockImplementation(async args => {
      check(args); return { orderCode: payment.orderCode, productName: 'Owned supplier product', provider };
    });
    t.engine.validateSupplierOrderForPayment.mockImplementation(async args => { check(args); return { provider }; });
  }

  it.each(['cdkvietnam', 'dopermind'])('preserves trusted %s context through quote, ticket confirmation and payment preflight', async provider => {
    const enabled = vi.fn(() => true);
    const t = fixture({ enabled, publishOrder: vi.fn(async () => {}) }); bindProvider(t, provider);
    const confirmed = await t.facade.confirm({ client: t.client, guildId, customerId, quoteId: 'owned-quote', provider });
    expect(confirmed.provider).toBe(provider);
    expect(t.engine.getSupplierQuoteForCustomer).toHaveBeenCalledWith({ guildId, customerId, quoteId: 'owned-quote', provider });
    expect(t.engine.confirmSupplierCheckout).toHaveBeenCalledWith(expect.objectContaining({ provider, ticketId: 1 }));
    const paid = await t.facade.payment({ ...payment, client: t.client, provider });
    expect(paid.provider).toBe(provider);
    expect(t.engine.validateSupplierOrderForPayment).toHaveBeenCalledWith({ guildId, customerId, orderCode: payment.orderCode, provider });
    expect(enabled.mock.calls.every(([selected, guild]) => selected === provider && guild === guildId)).toBe(true);
    expect(t.debitWallet).toHaveBeenCalledTimes(1);
  });

  it('derives omitted legacy context from the persisted quote before creating a ticket', async () => {
    const t = fixture({ publishOrder: vi.fn(async () => {}) }); bindProvider(t, 'dopermind');
    await t.facade.confirm({ client: t.client, guildId, customerId, quoteId: 'old-quote' });
    expect(t.engine.confirmSupplierCheckout).toHaveBeenCalledWith(expect.objectContaining({ provider: 'dopermind' }));
  });

  it('rejects a quote from the other supplier before ticket or order-log side effects', async () => {
    const publishOrder = vi.fn(async () => {});
    const t = fixture({ publishOrder }); bindProvider(t, 'dopermind');
    await expect(t.facade.confirm({ client: t.client, guildId, customerId, quoteId: 'doper-quote', provider: 'cdkvietnam' }))
      .rejects.toMatchObject({ code: 'PROVIDER_MISMATCH' });
    expect(t.guild.channels.create).not.toHaveBeenCalled();
    expect(t.engine.confirmSupplierCheckout).not.toHaveBeenCalled();
    expect(publishOrder).not.toHaveBeenCalled();
  });

  it('does not let a mismatched provider attach to an in-flight payment and receive its invoice', async () => {
    const t = fixture(); bindProvider(t, 'cdkvietnam');
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    t.payosLink.mockImplementation(async order => {
      await gate;
      return { ...order, payment_checkout_url: 'https://pay.payos.vn/web/owned-link', payment_qr_code: '000201owned-qr' };
    });
    const accepted = t.facade.payment({ ...payment, method: 'payos', provider: 'cdkvietnam' });
    await vi.waitFor(() => expect(t.payosLink).toHaveBeenCalledTimes(1));
    const rejected = t.facade.payment({ ...payment, provider: 'dopermind' }).catch(error => error);
    release();
    expect((await accepted).provider).toBe('cdkvietnam');
    expect(await rejected).toMatchObject({ code: 'PROVIDER_MISMATCH' });
    expect(t.payosLink).toHaveBeenCalledTimes(1); expect(t.debitWallet).not.toHaveBeenCalled();
    expect(t.database.prepare('SELECT method FROM supplier_autobuy_payment_methods').get().method).toBe('PAYOS');
  });

  it('rejects cross-provider status before PayOS reconciliation, while owned history stays readable during a pause', async () => {
    let opened = true;
    const syncPayos = vi.fn(async () => {});
    const t = fixture({ enabled: () => opened, syncPayos }); bindProvider(t, 'cdkvietnam');
    await t.facade.status({ guildId, customerId, orderCode: payment.orderCode, provider: 'cdkvietnam' });
    t.database.prepare("INSERT INTO supplier_autobuy_payment_methods VALUES (?,'PAYOS',?)").run(payment.orderCode, new Date().toISOString());
    t.database.prepare("UPDATE orders SET payment_link_id='link',payment_checkout_url='https://pay.payos.vn/web/owned',payment_qr_code='000201owned-invoice'").run();
    await expect(t.facade.status({ client: t.client, guildId, customerId, orderCode: payment.orderCode, provider: 'dopermind' }))
      .rejects.toMatchObject({ code: 'PROVIDER_MISMATCH' });
    expect(syncPayos).not.toHaveBeenCalled();
    opened = false;
    const recovered = await t.facade.status({ guildId, customerId, orderCode: payment.orderCode, provider: 'cdkvietnam' });
    expect(recovered.provider).toBe('cdkvietnam'); expect(recovered.payment.provider).toBe('cdkvietnam');
    expect(recovered.payment.qrCode).toBe('000201owned-invoice');
    expect(t.payosLink).not.toHaveBeenCalled(); expect(t.debitWallet).not.toHaveBeenCalled();
  });

  it('checks each provider configuration independently and rejects another store before readiness reads', async () => {
    const enabled = vi.fn(provider => provider === 'dopermind');
    const t = fixture({ enabled, publishOrder: vi.fn(async () => {}) }); bindProvider(t, 'dopermind');
    await expect(t.facade.confirm({ client: t.client, guildId, customerId, quoteId: 'q', provider: 'cdkvietnam' }))
      .rejects.toMatchObject({ code: 'AUTOBUY_DISABLED' });
    await t.facade.confirm({ client: t.client, guildId, customerId, quoteId: 'q', provider: 'dopermind' });
    enabled.mockClear();
    await expect(t.facade.payment({ ...payment, guildId: 'another-store', provider: 'dopermind' })).rejects.toMatchObject({ code: 'AUTOBUY_DISABLED' });
    expect(enabled).not.toHaveBeenCalled();
    await expect(t.facade.payment({ ...payment, provider: 'unknown-provider' })).rejects.toMatchObject({ code: 'PROVIDER_MISMATCH' });
  });
});
