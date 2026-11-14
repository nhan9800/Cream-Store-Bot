import Database from 'better-sqlite3';
import { EventEmitter } from 'node:events';
import { Collection, PermissionsBitField } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/database/db.js', () => ({ db: { transaction: fn => Object.assign(fn, { immediate: fn }) }, nowIso: () => '2026-11-14T01:01:00Z' }));
vi.mock('../src/config.js', () => ({ config: { guildId: '1282637033340403754', storeName: 'Synthetic Store', accentColorSuccess: 0x2ecc71 } }));
vi.mock('../src/services/notificationService.js', () => ({ updateOrderLogMessage: vi.fn(async () => {}) }));
import { createSupplierPaymentNoticeService } from '../src/services/supplierAutobuyPaymentNoticeService.js';

const guildId = '1282637033340403754', customerId = '111111111111111111', botId = '666666666666666666';
const channelId = '333333333333333333', categoryId = '444444444444444444', code = 'CN_123456';
const ticketMessageId = '777777777777777777', dmChannelId = '888888888888888888', dmMessageId = '999999999999999999';
const databases = [];
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
async function flush() { for (let n = 0; n < 30; n++) await Promise.resolve(); }

function fixture() {
  const database = new Database(':memory:'); databases.push(database);
  database.exec(`CREATE TABLE orders(order_code TEXT PRIMARY KEY,guild_id TEXT,customer_id TEXT,ticket_id INTEGER,ticket_channel_id TEXT,
    fulfillment_mode TEXT,status TEXT,payment_status TEXT,payment_provider TEXT,total_amount INTEGER,amount_paid INTEGER,quantity INTEGER,
    product_name TEXT,created_at TEXT,order_log_channel_id TEXT,order_log_message_id TEXT,paid_transaction_content TEXT,paid_transaction_id TEXT,
    payos_order_code INTEGER,payment_link_id TEXT);
    CREATE TABLE tickets(id INTEGER PRIMARY KEY,guild_id TEXT,customer_id TEXT,channel_id TEXT,status TEXT,ticket_type TEXT,support_source TEXT);
    CREATE TABLE supplier_autobuy_intents(order_code TEXT PRIMARY KEY,guild_id TEXT,customer_id TEXT,provider TEXT,product_key TEXT,request_id TEXT,
      sale_amount INTEGER,quantity INTEGER,product_name TEXT,status TEXT,quote_id TEXT,request_hash TEXT,encrypted_payload TEXT);
    CREATE TABLE staff_logs(id INTEGER PRIMARY KEY,guild_id TEXT,action TEXT,related_order_code TEXT,detail TEXT,created_at TEXT);
    CREATE TABLE payment_events(id INTEGER PRIMARY KEY AUTOINCREMENT,order_code TEXT,provider TEXT,transaction_id TEXT,amount INTEGER,raw_payload TEXT,created_at TEXT);
    INSERT INTO orders VALUES('${code}','${guildId}','${customerId}',1483,'${channelId}','SUPPLIER','PROCESSING','PAID','PAYOS',72000,72000,1,
      'Synthetic subscription','2026-11-14T01:00:00Z','${categoryId}',NULL,'Synthetic payment','synthetic-tx',123456,'synthetic-link');
    INSERT INTO tickets VALUES(1483,'${guildId}','${customerId}','${channelId}','OPEN','ORDER','DISCORD_AUTOBUY');
    INSERT INTO supplier_autobuy_intents VALUES('${code}','${guildId}','${customerId}','dopermind','desc_synthetic','cenar-synthetic-request',
      72000,1,'Synthetic subscription','PENDING','synthetic-quote','synthetic-request-hash',NULL);`);
  let clock = Date.parse('2026-11-14T01:01:00Z'), ready = true, scoped = true;
  const channel = { id: channelId, guildId, type: 0, parentId: categoryId,
    topic: `Cenar AutoBuy · customer:${customerId} · ticket:1483`,
    permissionOverwrites: { cache: new Collection([[guildId, { deny: new PermissionsBitField(['ViewChannel']) }],
      [customerId, { allow: new PermissionsBitField(['ViewChannel']) }]]) },
    permissionsFor: () => new PermissionsBitField(['ViewChannel', 'SendMessages', 'ReadMessageHistory']),
    isTextBased: () => true };
  const client = new EventEmitter(); client.user = { id: botId }; client.isReady = () => ready;
  client.guilds = { fetch: vi.fn(async () => ({ id: guildId, channels: { fetch: vi.fn(async () => channel) } })) };
  const fulfill = vi.fn(async () => ({})), syncRoles = vi.fn(async () => ({})), recordLog = vi.fn(async () => ({}));
  const sendNotice = vi.fn(async ({ assertCurrent, recordReceipt }) => {
    assertCurrent();
    recordReceipt('ticket', { messageId: ticketMessageId, channelId });
    recordReceipt('dm', { messageId: dmMessageId, channelId: dmChannelId });
  });
  const settings = { database, now: () => clock, scopeEnabled: () => scoped,
    settings: () => ({ ticket_category_id: categoryId, order_log_channel_id: categoryId }), fulfill, syncRoles, sendNotice, recordLog };
  const service = createSupplierPaymentNoticeService(settings);
  const order = () => database.prepare('SELECT * FROM orders WHERE order_code=?').get(code);
  return { database, client, channel, fulfill, syncRoles, sendNotice, recordLog, settings, service, order,
    start: (freshReceipt = true) => service.start({ client, order: order(), freshReceipt }), restart: () => createSupplierPaymentNoticeService(settings),
    advance: ms => { clock += ms; }, setReady: value => { ready = value; }, setScope: value => { scoped = value; } };
}
beforeEach(() => vi.stubEnv('ENV_FILE', '.env'));
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); for (const database of databases.splice(0)) if (database.open) database.close(); });

describe('supplier paid payment effects are independent from customer response', () => {
  it('returns synchronously and starts source, roles and notice independently while each is stalled', async () => {
    const t = fixture(), source = deferred(), roles = deferred(), notice = deferred();
    t.fulfill.mockReturnValue(source.promise); t.syncRoles.mockReturnValue(roles.promise); t.sendNotice.mockReturnValue(notice.promise);
    const result = t.start(); expect(result?.then).toBeUndefined();
    await flush();
    expect(t.fulfill).toHaveBeenCalledOnce(); expect(t.syncRoles).toHaveBeenCalledOnce(); expect(t.sendNotice).toHaveBeenCalledOnce();
    expect(t.order()).toMatchObject({ status: 'PROCESSING', payment_status: 'PAID', amount_paid: 72000 });
    source.resolve({}); roles.resolve({}); notice.resolve(); await flush();
  });
  it('coalesces duplicate paid callbacks and stores two positive notice receipts without another payment effect', async () => {
    const t = fixture(), source = deferred(), roles = deferred(), notice = deferred();
    t.fulfill.mockReturnValue(source.promise); t.syncRoles.mockReturnValue(roles.promise);
    const send = t.sendNotice.getMockImplementation(); t.sendNotice.mockImplementation(async args => { await notice.promise; return send(args); });
    t.start(); t.start(); await flush();
    expect(t.fulfill).toHaveBeenCalledOnce(); expect(t.syncRoles).toHaveBeenCalledOnce(); expect(t.sendNotice).toHaveBeenCalledOnce();
    notice.resolve(); source.resolve({}); roles.resolve({}); await flush();
    expect(t.service.get(code)).toMatchObject({ status: 'SENT' });
    t.start(); await flush(); expect(t.sendNotice).toHaveBeenCalledOnce();
  });
  it('does not let metadata enqueue failure suppress independent source/role recovery or change payment', async () => {
    const t = fixture(), prepare = t.database.prepare.bind(t.database);
    t.database.prepare = sql => {
      if (/INSERT(?: OR \w+)? INTO supplier_autobuy_payment_notices/i.test(sql)) throw Object.assign(new Error('Synthetic metadata contention'), { code: 'SQLITE_BUSY' });
      return prepare(sql);
    };
    expect(() => t.start()).not.toThrow(); await flush();
    expect(t.fulfill).toHaveBeenCalledOnce(); expect(t.syncRoles).toHaveBeenCalledOnce(); expect(t.sendNotice).not.toHaveBeenCalled();
    expect(t.order()).toMatchObject({ status: 'PROCESSING', payment_status: 'PAID', total_amount: 72000, amount_paid: 72000 });
  });
  it('contains untrusted background errors without rejecting the already committed payment', async () => {
    const t = fixture(); t.fulfill.mockRejectedValue(new Error('private-source-token')); t.syncRoles.mockRejectedValue(new Error('private-role-details'));
    const result = t.start(); await flush();
    expect(result?.then).toBeUndefined(); expect(JSON.stringify(result ?? {})).not.toContain('private-');
    expect(t.sendNotice).toHaveBeenCalledOnce(); expect(t.order().payment_status).toBe('PAID');
  });
});

describe('payment notice ownership, persistence and recovery', () => {
  it.each([
    ['owner', `UPDATE orders SET customer_id='222222222222222222'`],
    ['provider', `UPDATE supplier_autobuy_intents SET provider='cdkvietnam',product_key='cdkvietnam:1'`],
    ['amount', 'UPDATE orders SET total_amount=73000'],
    ['short receipt', 'UPDATE orders SET amount_paid=1'],
    ['refund', "UPDATE orders SET status='REFUNDED',payment_status='REFUNDED'"],
    ['closed ticket', "UPDATE tickets SET status='CLOSED'"],
    ['ticket channel', `UPDATE tickets SET channel_id='222222222222222222'`],
  ])('vetoes a changed %s before notice publication from its pinned context', async (_label, mutation) => {
    const t = fixture(), wait = deferred();
    const send = t.sendNotice.getMockImplementation(); t.sendNotice.mockImplementation(async args => { await wait.promise; return send(args); });
    t.start(); await flush(); expect(t.sendNotice).toHaveBeenCalledOnce();
    t.database.exec(mutation); wait.resolve(); await flush();
    expect(t.service.get(code)).toMatchObject({ status: 'REVIEW' });
    expect(t.service.get(code)).toMatchObject({ ticket_message_id: null, dm_message_id: null });
  });
  it('does not blindly resend an uncertain publication across a restart', async () => {
    const t = fixture(); t.sendNotice.mockRejectedValueOnce(new Error('Synthetic unknown Discord send'));
    t.start(); await flush(); expect(t.service.get(code)).toMatchObject({ status: 'UNKNOWN' });
    const restarted = t.restart(); restarted.repair(t.client, { limit: 3 }); await flush();
    expect(restarted.get(code)).toMatchObject({ status: 'UNKNOWN' }); expect(t.sendNotice).toHaveBeenCalledOnce();
    expect(t.order().payment_status).toBe('PAID');
  });
  it('restores a crashed SENDING claim as unknown instead of blindly replaying it', async () => {
    const t = fixture(), wait = deferred(); t.sendNotice.mockReturnValue(wait.promise);
    t.start(); await flush(); expect(t.service.get(code)).toMatchObject({ status: 'SENDING' });
    const restarted = t.restart(); restarted.repair(t.client, { limit: 3 }); await flush();
    expect(restarted.get(code)).toMatchObject({ status: 'UNKNOWN' }); expect(t.sendNotice).toHaveBeenCalledOnce();
    wait.resolve(); await flush();
  });
  it('keeps its ledger metadata-only and does no work outside configured scope', async () => {
    const t = fixture(); t.setScope(false); t.start(); t.service.repair(t.client, { limit: 3 }); await flush();
    expect(t.fulfill).not.toHaveBeenCalled(); expect(t.syncRoles).not.toHaveBeenCalled(); expect(t.sendNotice).not.toHaveBeenCalled();
    t.setScope(true); t.start(); await flush();
    const row = t.service.get(code);
    expect(row).toMatchObject({ order_code: code, status: 'SENT' });
    expect(JSON.stringify(row)).not.toContain('private-source-token'); expect(JSON.stringify(row)).not.toContain('Synthetic subscription');
    expect(t.database.prepare('SELECT COUNT(*) AS n FROM orders').get().n).toBe(1);
  });
  it('allows normal paid PROCESSING to COMPLETED progression while the notice waits', async () => {
    const t = fixture(), wait = deferred(), send = t.sendNotice.getMockImplementation();
    t.sendNotice.mockImplementation(async input => { await wait.promise; return send(input); });
    t.start(); await flush(); t.database.prepare("UPDATE orders SET status='COMPLETED'").run(); wait.resolve(); await flush();
    expect(t.service.get(code)).toMatchObject({ status: 'SENT', ticket_message_id: ticketMessageId, dm_message_id: dmMessageId });
  });
  it('records a late cancelled payment for staff review without an ordinary customer confirmation', async () => {
    const t = fixture(); t.database.prepare("UPDATE orders SET status='CANCELLED'").run();
    t.start(); await flush();
    expect(t.service.get(code)).toMatchObject({ status: 'REVIEW', ticket_message_id: null, dm_message_id: null });
    expect(t.sendNotice).not.toHaveBeenCalled();
    expect(t.recordLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'PAYMENT_RECEIVED_AFTER_CANCEL', relatedOrderCode: code }));
  });
});

describe('new-receipt boundary and bounded notice-only repair', () => {
  const event = (t, { orderCode = code, transactionId = 'synthetic-tx', amount = 72000 } = {}) => t.database.prepare(`INSERT INTO payment_events
    (order_code,provider,transaction_id,amount,created_at) VALUES (?,'PAYOS',?,?,?)`).run(orderCode, transactionId, amount, '2026-11-14T01:01:00Z');
  it('recovers a new post-boundary receipt after metadata enqueue failed and process restarted', async () => {
    const t = fixture();
    event(t, { orderCode: 'CN_000001', transactionId: 'old-unrelated-event' }); t.service.prepare(); event(t);
    const boundary = t.database.prepare('SELECT after_event_id FROM supplier_autobuy_payment_notice_boundary').get().after_event_id;
    const prepare = t.database.prepare.bind(t.database); let reject = true;
    t.database.prepare = sql => {
      if (reject && /INSERT(?: OR \w+)? INTO supplier_autobuy_payment_notices/i.test(sql)) { reject = false; throw Object.assign(new Error('Synthetic metadata failure'), { code: 'SQLITE_BUSY' }); }
      return prepare(sql);
    };
    t.start(); await flush(); expect(t.service.get(code)).toBeUndefined(); expect(t.sendNotice).not.toHaveBeenCalled();
    const restarted = t.restart(), result = restarted.repair(t.client, { limit: 3 }); expect(result?.then).toBeUndefined(); await flush();
    expect(t.database.prepare('SELECT after_event_id FROM supplier_autobuy_payment_notice_boundary').get().after_event_id).toBe(boundary);
    expect(restarted.get(code)).toMatchObject({ status: 'SENT' }); expect(t.sendNotice).toHaveBeenCalledOnce();
    expect(t.order()).toMatchObject({ payment_status: 'PAID', amount_paid: 72000, status: 'PROCESSING' });
  });
  it('holds an unproven historical duplicate instead of sweeping a new customer notice', async () => {
    const t = fixture(); event(t); t.service.prepare();
    t.start(false); await flush();
    expect(t.service.get(code)).toMatchObject({ status: 'UNKNOWN', last_error: 'NOTICE_LEGACY_UNCERTAIN' });
    expect(t.sendNotice).not.toHaveBeenCalled(); expect(t.recordLog).not.toHaveBeenCalled();
    t.restart().repair(t.client, { limit: 3 }); await flush(); expect(t.sendNotice).not.toHaveBeenCalled();
  });
  it('never re-sends an already staff-confirmed historical supplier payment', async () => {
    const t = fixture();
    t.database.prepare(`INSERT INTO staff_logs(guild_id,action,related_order_code,detail,created_at)
      VALUES (?,'PAYMENT_CONFIRMED_PENDING_DELIVERY',?,'Prior positive confirmation','2026-11-14T01:00:00Z')`).run(guildId, code);
    t.start(); await flush();
    expect(t.service.get(code)).toMatchObject({ status: 'UNKNOWN', last_error: 'NOTICE_LEGACY_UNCERTAIN' });
    expect(t.sendNotice).not.toHaveBeenCalled(); expect(t.recordLog).not.toHaveBeenCalled();
  });
  it.each(['wrong transaction', 'short amount'])('requires exact full receipt proof before repairing %s', async kind => {
    const t = fixture(); t.service.prepare();
    event(t, kind === 'wrong transaction' ? { transactionId: 'another-receipt' } : { amount: 1 });
    expect(t.service.repair(t.client, { limit: 3 })).toMatchObject({ scanned: 0, queued: 0 }); await flush();
    expect(t.service.get(code)).toBeUndefined(); expect(t.sendNotice).not.toHaveBeenCalled();
  });
  it('keeps a persisted identity mismatch in REVIEW after a duplicate enqueue transaction', async () => {
    const t = fixture(); t.start(); await flush();
    t.database.prepare("UPDATE supplier_autobuy_intents SET request_id='changed-request'").run();
    t.start(); await flush();
    expect(t.service.get(code)).toMatchObject({ status: 'REVIEW', last_error: 'NOTICE_IDENTITY_CHANGED' });
    expect(t.sendNotice).toHaveBeenCalledOnce();
  });
  it('restarts a persisted PENDING notice without waiting for stalled source or role effects', async () => {
    const t = fixture(), source = deferred(), roles = deferred(); t.setReady(false);
    t.fulfill.mockReturnValue(source.promise); t.syncRoles.mockReturnValue(roles.promise); t.start(); await flush();
    expect(t.service.get(code)).toMatchObject({ status: 'PENDING' }); expect(t.sendNotice).not.toHaveBeenCalled();
    t.setReady(true); const restarted = t.restart(); restarted.repair(t.client, { limit: 3 }); await flush();
    expect(restarted.get(code)).toMatchObject({ status: 'SENT' }); expect(t.sendNotice).toHaveBeenCalledOnce();
    source.resolve({}); roles.resolve({}); await flush();
  });
  it('pauses maintenance on disconnect and resumes without a new start while source work is unresolved', async () => {
    vi.useFakeTimers(); const t = fixture(), source = deferred(); t.fulfill.mockReturnValue(source.promise);
    t.setReady(false); t.start(); await flush();
    t.service.startMaintenance(t.client, { intervalMs: 1000, limit: 3 });
    await vi.advanceTimersByTimeAsync(1000); expect(t.sendNotice).not.toHaveBeenCalled();
    t.setReady(true); await vi.advanceTimersByTimeAsync(1000); expect(t.sendNotice).toHaveBeenCalledOnce();
    expect(t.service.get(code)).toMatchObject({ status: 'SENT' });
    t.service.stopMaintenance(t.client); source.resolve({}); await flush();
  });
  it('stops maintenance on invalidation or explicit stop and does no work outside scope', async () => {
    vi.useFakeTimers(); const t = fixture(); t.setReady(false); t.start(); await flush();
    t.service.startMaintenance(t.client, { intervalMs: 1000, limit: 3 }); t.client.emit('invalidated'); t.setReady(true);
    await vi.advanceTimersByTimeAsync(2000); expect(t.sendNotice).not.toHaveBeenCalled();
    t.service.startMaintenance(t.client, { intervalMs: 1000, limit: 3 }); t.service.stopMaintenance(t.client);
    await vi.advanceTimersByTimeAsync(2000); expect(t.sendNotice).not.toHaveBeenCalled();
    t.setScope(false); t.service.startMaintenance(t.client, { intervalMs: 1000, limit: 3 });
    await vi.advanceTimersByTimeAsync(2000); expect(t.sendNotice).not.toHaveBeenCalled();
  });
});

function transportFixture() {
  const t = fixture();
  t.channel.send = vi.fn(async () => ({ id: ticketMessageId, channelId }));
  const dm = { id: dmChannelId, type: 1, recipientId: customerId, send: vi.fn(async () => ({ id: dmMessageId, channelId: dmChannelId })) };
  const customer = { id: customerId, createDM: vi.fn(async () => dm) };
  const guild = { id: guildId, client: t.client, channels: { fetch: vi.fn(async () => t.channel) } };
  t.client.guilds.fetch = vi.fn(async () => guild); t.client.users = { fetch: vi.fn(async () => customer) };
  t.settings.sendNotice = undefined;
  const service = t.restart();
  return { ...t, dm, customer, guild, service, start: () => service.start({ client: t.client, order: t.order(), freshReceipt: true }) };
}

describe('actual supplier paid notice publication boundaries', () => {
  it('publishes only the verified private ticket and exact customer DM with retained positive IDs', async () => {
    const t = transportFixture(); t.start(); await flush();
    expect(t.service.get(code)).toMatchObject({ status: 'SENT', ticket_message_id: ticketMessageId, dm_message_id: dmMessageId, dm_channel_id: dmChannelId });
    expect(t.channel.send).toHaveBeenCalledOnce(); expect(t.dm.send).toHaveBeenCalledOnce();
    for (const payload of [t.channel.send.mock.calls[0][0], t.dm.send.mock.calls[0][0]]) {
      expect(payload.allowedMentions).toEqual({ parse: [], users: [], roles: [], repliedUser: false });
      expect(payload.nonce).toMatch(/^[a-f0-9]{24}$/); expect(payload.enforceNonce).toBe(true);
    }
    expect(t.channel.send.mock.calls[0][0].nonce).not.toBe(t.dm.send.mock.calls[0][0].nonce);
  });
  it.each(['guild', 'channel', 'customer', 'createDM'])('rechecks authoritative owner after %s preparation awaits', async stage => {
    const t = transportFixture(), wait = deferred();
    const selected = stage === 'guild' ? t.client.guilds.fetch : stage === 'channel' ? t.guild.channels.fetch
      : stage === 'customer' ? t.client.users.fetch : t.customer.createDM;
    const original = selected.getMockImplementation(); selected.mockImplementationOnce(async (...args) => { await wait.promise; return original(...args); });
    t.start(); await flush(); expect(selected).toHaveBeenCalledOnce();
    t.database.prepare("UPDATE orders SET customer_id='222222222222222222'").run(); wait.resolve(); await flush();
    expect(t.service.get(code)).toMatchObject({ status: 'REVIEW', dm_message_id: null }); expect(t.dm.send).not.toHaveBeenCalled();
    expect(t.channel.send).toHaveBeenCalledTimes(stage === 'guild' || stage === 'channel' ? 0 : 1);
  });
  it.each(['everyone visible', 'customer denied', 'category changed', 'ticket closed'])('rechecks private ticket %s after createDM awaits', async change => {
    const t = transportFixture(), wait = deferred(), original = t.customer.createDM.getMockImplementation();
    t.customer.createDM.mockImplementationOnce(async () => { await wait.promise; return original(); });
    t.start(); await flush(); expect(t.customer.createDM).toHaveBeenCalledOnce();
    if (change === 'everyone visible') t.channel.permissionOverwrites.cache.get(guildId).deny = new PermissionsBitField();
    if (change === 'customer denied') t.channel.permissionOverwrites.cache.get(customerId).allow = new PermissionsBitField();
    if (change === 'category changed') t.channel.parentId = dmChannelId;
    if (change === 'ticket closed') t.database.prepare("UPDATE tickets SET status='CLOSED'").run();
    wait.resolve(); await flush();
    expect(t.service.get(code)).toMatchObject({ status: 'REVIEW', ticket_message_id: ticketMessageId, dm_message_id: null });
    expect(t.dm.send).not.toHaveBeenCalled();
  });
  it.each(['wrong customer', 'wrong DM recipient', 'group DM', 'missing typed recipient'])('does not publish a private confirmation through %s', async change => {
    const t = transportFixture();
    if (change === 'wrong customer') t.customer.id = botId;
    if (change === 'wrong DM recipient') t.dm.recipientId = botId;
    if (change === 'group DM') t.dm.type = 3;
    if (change === 'missing typed recipient') delete t.dm.recipientId;
    t.start(); await flush();
    expect(t.service.get(code)).toMatchObject({ status: 'REVIEW', ticket_message_id: ticketMessageId, dm_message_id: null });
    expect(t.dm.send).not.toHaveBeenCalled();
  });
  it('retains a positive ticket receipt and never blindly repeats either message when DM send fails', async () => {
    const t = transportFixture(); t.dm.send.mockRejectedValueOnce(new Error('Synthetic unknown DM network response'));
    t.start(); await flush();
    expect(t.service.get(code)).toMatchObject({ status: 'UNKNOWN', ticket_message_id: ticketMessageId, dm_message_id: null });
    t.restart().repair(t.client, { limit: 3 }); await flush();
    expect(t.channel.send).toHaveBeenCalledOnce(); expect(t.dm.send).toHaveBeenCalledOnce();
  });
  it('retains an accepted ticket receipt after cancellation during its send and suppresses the later DM', async () => {
    const t = transportFixture(), wait = deferred();
    t.channel.send.mockImplementationOnce(async () => { await wait.promise; return { id: ticketMessageId, channelId }; });
    t.start(); await flush(); expect(t.channel.send).toHaveBeenCalledOnce();
    t.database.prepare("UPDATE orders SET status='CANCELLED'").run(); wait.resolve(); await flush();
    expect(t.service.get(code)).toMatchObject({ status: 'REVIEW', ticket_message_id: ticketMessageId, dm_message_id: null });
    expect(t.dm.send).not.toHaveBeenCalled();
  });
});
