import Database from 'better-sqlite3';
import { EventEmitter } from 'node:events';
import { ChannelType, Collection, MessageFlags, PermissionsBitField } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/database/db.js', () => ({ db: {} }));
vi.mock('../src/config.js', () => ({ config: { guildId: '1282637033340403754' } }));
import { createSupplierAutobuyTicketNoticeService } from '../src/services/supplierAutobuyTicketNoticeService.js';

const guildId = '1282637033340403754', customerId = '1138315103821889566', botId = '1382729296724099132';
const channelId = '1569729564115206214', categoryId = '1514606994256957600', code = 'CN_572016';
const databases = [];
function fixture() {
  const database = new Database(':memory:'); databases.push(database);
  database.exec(`CREATE TABLE tickets(id INTEGER PRIMARY KEY,guild_id TEXT,customer_id TEXT,channel_id TEXT,status TEXT,ticket_type TEXT,support_source TEXT);
    CREATE TABLE orders(order_code TEXT PRIMARY KEY,guild_id TEXT,customer_id TEXT,ticket_id INTEGER,ticket_channel_id TEXT,
      fulfillment_mode TEXT,status TEXT,payment_status TEXT,total_amount INTEGER,created_at TEXT);
    CREATE TABLE supplier_autobuy_intents(order_code TEXT PRIMARY KEY,guild_id TEXT,customer_id TEXT,provider TEXT,product_key TEXT);
    INSERT INTO tickets VALUES(1483,'${guildId}','${customerId}','${channelId}','OPEN','ORDER','DISCORD_AUTOBUY');
    INSERT INTO orders VALUES('${code}','${guildId}','${customerId}',1483,'${channelId}','SUPPLIER','PENDING_PAYMENT','UNPAID',344000,'2026-11-14T01:00:00Z');
    INSERT INTO supplier_autobuy_intents VALUES('${code}','${guildId}','${customerId}','cdkvietnam','cdkvietnam:3');`);
  const messages = new Collection();
  let nextId = 1569729564115206300n;
  const channel = { id: channelId, guildId, type: ChannelType.GuildText, parentId: categoryId,
    topic: `Cenar AutoBuy · customer:${customerId} · ticket:1483`,
    permissionOverwrites: { cache: new Collection([[guildId, { deny: new PermissionsBitField(['ViewChannel']) }],
      [customerId, { allow: new PermissionsBitField(['ViewChannel']) }]]) },
    permissionsFor: () => new PermissionsBitField(['ViewChannel', 'SendMessages', 'ReadMessageHistory']),
    messages: { fetch: vi.fn(async input => {
      if (typeof input === 'string') {
        if (!messages.has(input)) throw Object.assign(new Error('Missing synthetic message'), { status: 404 });
        return messages.get(input);
      }
      return new Collection([...messages.entries()].reverse().filter(([id]) => !input.before || BigInt(id) < BigInt(input.before)).slice(0, 100));
    }) },
  };
  const newMessage = payload => {
    const message = { id: String(++nextId), author: { id: botId }, channelId, components: payload.components };
    messages.set(message.id, message); return message;
  };
  channel.send = vi.fn(async payload => newMessage(payload));
  const guild = { id: guildId, channels: { fetch: vi.fn(async () => channel) } };
  const client = { user: { id: botId }, guilds: { fetch: vi.fn(async () => guild) } };
  const readCustomerOrder = vi.fn(async input => ({ provider: input.provider, orderCode: input.orderCode,
    productName: 'Tài khoản ChatGPT Plus', totalAmount: 344000, status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' }));
  const buildCard = vi.fn(({ order, customerId: owner }) => ({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: ['everyone'] }, components: [
      { type: 10, content: `Đơn ${order.orderCode} · ${order.productName} · 344.000đ` },
      { type: 1, components: ['pay', 'order', 'delivery'].map((action, index) => ({ type: 2, style: 1,
        label: action, custom_id: `supplier-autobuy:${action}:${owner}:${order.orderCode}${action === 'pay' ? ':payos' : ''}`,
        emoji: { id: String(1382729296724099200n + BigInt(index)), name: `cenar_test_${index}` } })) },
    ] }));
  const settings = { database, guildConfig: () => ({ ticket_category_id: categoryId }), readCustomerOrder, buildCard,
    now: () => Date.parse('2026-11-14T01:01:00Z') };
  const service = createSupplierAutobuyTicketNoticeService(settings);
  const send = () => service.send({ client, guildId, envFile: '.env', orderCode: code });
  const notice = () => database.prepare('SELECT * FROM supplier_autobuy_ticket_notices WHERE order_code=?').get(code);
  return { database, channel, guild, client, messages, newMessage, readCustomerOrder, buildCard, settings, service, send, notice };
}
beforeEach(() => vi.stubEnv('ENV_FILE', '.env'));
afterEach(() => { vi.useRealTimers(); for (const database of databases.splice(0)) database.close(); vi.unstubAllEnvs(); });

describe('durable customer AutoBuy ticket order cards', () => {
  it('sends the existing owned order and actionable controls privately without starting payment work', async () => {
    const t = fixture(); const result = await t.send();
    expect(result).toMatchObject({ status: 'SENT', orderCode: code, channelId, provider: 'cdkvietnam', recovered: false });
    expect(t.readCustomerOrder).toHaveBeenCalledExactlyOnceWith({ guildId, customerId, orderCode: code, provider: 'cdkvietnam' });
    expect(t.buildCard).toHaveBeenCalledWith(expect.objectContaining({ customerId, ticketContext: true }));
    const payload = t.channel.send.mock.calls[0][0];
    expect(payload.flags & MessageFlags.Ephemeral).toBe(0);
    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(payload.allowedMentions).toEqual({ parse: [], users: [], roles: [], repliedUser: false });
    expect(payload.enforceNonce).toBe(true); expect(payload.nonce).toMatch(/^[a-f0-9]{24}$/);
    expect(payload.components[1].components.map(button => button.custom_id)).toContain(`supplier-autobuy:pay:${customerId}:${code}:payos`);
    const icons = payload.components[1].components.map(button => button.emoji.id);
    expect(new Set(icons).size).toBe(icons.length);
    expect(t.notice()).toMatchObject({ status: 'SENT', message_id: result.messageId, attempts: 1 });
    expect(t.database.prepare('SELECT payment_status,total_amount FROM orders').get()).toEqual({ payment_status: 'UNPAID', total_amount: 344000 });
  });
  it('coalesces repeated confirmation and reuses the exact message after restart', async () => {
    const t = fixture();
    const [a, b] = await Promise.all([t.send(), t.send()]); expect(a.messageId).toBe(b.messageId);
    const restarted = createSupplierAutobuyTicketNoticeService(t.settings);
    expect(await restarted.send({ client: t.client, guildId, envFile: '.env', orderCode: code })).toMatchObject({ status: 'SENT', messageId: a.messageId, recovered: true });
    expect(t.channel.send).toHaveBeenCalledOnce();
  });
  it('reconciles a Discord-accepted message after losing its send response and restarting', async () => {
    const t = fixture();
    t.channel.send.mockImplementationOnce(async payload => { t.newMessage(payload); throw new Error('Synthetic lost response'); });
    expect(await t.send()).toEqual({ status: 'UNKNOWN' }); expect(t.notice().status).toBe('UNKNOWN');
    const restarted = createSupplierAutobuyTicketNoticeService(t.settings);
    expect(await restarted.send({ client: t.client, guildId, envFile: '.env', orderCode: code })).toMatchObject({ status: 'SENT', recovered: true });
    expect(t.channel.send).toHaveBeenCalledOnce(); expect(t.messages.size).toBe(1);
  });
  it('retains unknown sends for reconciliation and never blindly sends a second card', async () => {
    const t = fixture(); t.channel.send.mockRejectedValue(new Error('Synthetic timeout'));
    await t.send(); await t.send();
    expect(t.notice().status).toBe('UNKNOWN'); expect(t.channel.send).toHaveBeenCalledOnce();
    const result = await t.service.repair(t.client, { guildId, envFile: '.env', orderCode: code });
    expect(result).toMatchObject({ status: 'PENDING', scanned: 1, sent: 0, pending: 1 });
    expect(t.channel.send).toHaveBeenCalledOnce();
  });
  it('retries definitive Discord send rejections instead of permanently suppressing the card', async () => {
    const t = fixture(); t.channel.send.mockRejectedValueOnce(Object.assign(new Error('Synthetic forbidden'), { status: 403 }));
    expect(await t.send()).toEqual({ status: 'RETRY' }); expect(t.notice().status).toBe('RETRY');
    expect(await t.send()).toMatchObject({ status: 'SENT' });
    expect(t.channel.send).toHaveBeenCalledTimes(2); expect(t.notice().attempts).toBe(2);
  });
  it('does not send when bounded message discovery cannot establish a complete history', async () => {
    const t = fixture();
    t.channel.messages.fetch.mockImplementation(async input => {
      const start = input.before ? BigInt(input.before) - 1n : 1569729564115299999n;
      return new Collection(Array.from({ length: 100 }, (_, index) => {
        const id = String(start - BigInt(index)); return [id, { id, author: { id: customerId }, channelId, components: [] }];
      }));
    });
    expect(await t.send()).toEqual({ status: 'UNKNOWN' });
    expect(t.channel.messages.fetch).toHaveBeenCalledTimes(10); expect(t.channel.send).not.toHaveBeenCalled();
  });
  it('sends a fresh order card in a long reused ticket after reaching its exact pre-order history boundary', async () => {
    const t = fixture();
    for (let index = 0; index < 1200; index++) {
      const id = String(1569729564115204000n + BigInt(index));
      t.messages.set(id, { id, author: { id: customerId }, channelId, components: [] });
    }
    const boundary = [...t.messages.keys()].at(-1);
    expect(t.service.registerOrigin({ guildId, customerId, orderCode: code, channelId, ticketId: 1483,
      provider: 'cdkvietnam', historyAfterMessageId: boundary, envFile: '.env' })).toEqual({ status: 'REGISTERED' });
    expect(await t.send()).toMatchObject({ status: 'SENT', recovered: false });
    expect(t.channel.messages.fetch).toHaveBeenCalledOnce();
    expect(t.channel.send).toHaveBeenCalledOnce();
  });
  it('checks receipt markers before stopping on the boundary and preserves that boundary across restart', async () => {
    const t = fixture(), boundary = '1569729564115206000';
    t.messages.set(boundary, { id: boundary, author: { id: customerId }, channelId, components: [] });
    const input = { guildId, customerId, orderCode: code, channelId, ticketId: 1483, provider: 'cdkvietnam', historyAfterMessageId: boundary, envFile: '.env' };
    t.service.registerOrigin(input);
    t.newMessage(t.buildCard({ order: { orderCode: code, productName: 'Stored order' }, customerId }));
    const restarted = createSupplierAutobuyTicketNoticeService(t.settings);
    expect(restarted.registerOrigin({ ...input, historyAfterMessageId: '1569729564115299999' })).toEqual({ status: 'EXISTS' });
    expect(t.notice().history_after_message_id).toBe(boundary);
    expect(await restarted.send({ client: t.client, guildId, orderCode: code, envFile: '.env' })).toMatchObject({ status: 'SENT', recovered: true });
    expect(t.channel.send).not.toHaveBeenCalled();
  });
  it('keeps discovery conservative if the boundary was deleted or more than 1000 later messages hide it', async () => {
    const t = fixture();
    t.service.registerOrigin({ guildId, customerId, orderCode: code, channelId, ticketId: 1483,
      provider: 'cdkvietnam', historyAfterMessageId: '1569729564115205000', envFile: '.env' });
    t.channel.messages.fetch.mockImplementation(async input => {
      const start = input.before ? BigInt(input.before) - 1n : 1569729564115299999n;
      return new Collection(Array.from({ length: 100 }, (_, index) => {
        const id = String(start - BigInt(index)); return [id, { id, author: { id: customerId }, channelId, components: [] }];
      }));
    });
    expect(await t.send()).toEqual({ status: 'UNKNOWN' });
    expect(t.channel.messages.fetch).toHaveBeenCalledTimes(10); expect(t.channel.send).not.toHaveBeenCalled();
  });
  it('refuses cross-owner or cross-ticket history registration and never advances an attempted notice', async () => {
    const t = fixture(), input = { guildId, customerId, orderCode: code, channelId, ticketId: 1483,
      provider: 'cdkvietnam', historyAfterMessageId: '1569729564115206000', envFile: '.env' };
    expect(t.service.registerOrigin({ ...input, customerId: botId })).toEqual({ status: 'NOT_ELIGIBLE' });
    expect(t.service.registerOrigin({ ...input, ticketId: 1484 })).toEqual({ status: 'NOT_ELIGIBLE' });
    expect(t.service.registerOrigin({ ...input, provider: 'dopermind' })).toEqual({ status: 'NOT_ELIGIBLE' });
    t.channel.send.mockRejectedValueOnce(new Error('Synthetic uncertain send'));
    await t.send();
    expect(t.service.registerOrigin(input)).toEqual({ status: 'EXISTS' });
    expect(t.notice()).toMatchObject({ status: 'UNKNOWN', history_after_message_id: null, attempts: 1 });
    await t.send(); expect(t.channel.send).toHaveBeenCalledOnce();
  });
  it('adds origin metadata without resetting an existing legacy unknown-send journal', async () => {
    const t = fixture();
    t.database.exec(`CREATE TABLE supplier_autobuy_ticket_notices(order_code TEXT PRIMARY KEY,channel_id TEXT NOT NULL,
      message_id TEXT,status TEXT,attempts INTEGER,attempted_at TEXT,updated_at TEXT NOT NULL,last_error TEXT);
      INSERT INTO supplier_autobuy_ticket_notices VALUES('${code}','${channelId}',NULL,'UNKNOWN',2,
        '2026-11-14T01:00:00Z','2026-11-14T01:00:01Z','SEND_UNCERTAIN');`);
    const receipt = t.newMessage(t.buildCard({ order: { orderCode: code, productName: 'Legacy order' }, customerId }));
    expect(t.service.registerOrigin({ guildId, customerId, orderCode: code, channelId, ticketId: 1483,
      provider: 'cdkvietnam', historyAfterMessageId: receipt.id, envFile: '.env' })).toEqual({ status: 'EXISTS' });
    expect(t.notice()).toMatchObject({ status: 'UNKNOWN', attempts: 2, history_after_message_id: null,
      attempted_at: '2026-11-14T01:00:00Z', updated_at: '2026-11-14T01:00:01Z', last_error: 'SEND_UNCERTAIN' });
    expect(await t.send()).toMatchObject({ status: 'SENT', recovered: true, messageId: receipt.id });
    expect(t.notice().attempts).toBe(2); expect(t.channel.send).not.toHaveBeenCalled();
  });
  it('retries a known send failure automatically, coalesces maintenance and stops on invalidation', async () => {
    vi.useFakeTimers(); const t = fixture();
    const events = new EventEmitter(); t.client.once = events.once.bind(events); t.client.off = events.off.bind(events);
    t.client.isReady = vi.fn(() => true);
    t.channel.send.mockRejectedValueOnce(Object.assign(new Error('Synthetic rejected request'), { status: 403 }));
    await t.send();
    expect(t.service.startMaintenance(t.client, { guildId, envFile: '.env', intervalMs: 1000 })).toEqual({ status: 'RUNNING', workerRunning: true });
    t.service.startMaintenance(t.client, { guildId, envFile: '.env', intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.notice().status).toBe('SENT'); expect(t.channel.send).toHaveBeenCalledTimes(2);
    expect(t.service.getHealth()).toMatchObject({ scanned: 1, sent: 1, failed: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.channel.send).toHaveBeenCalledTimes(2); expect(t.service.getHealth().scanned).toBe(0);
    events.emit('invalidated'); expect(vi.getTimerCount()).toBe(0);
  });
  it('pauses during a transient disconnect and resumes without another ClientReady callback', async () => {
    vi.useFakeTimers(); const t = fixture(); let ready = true; t.client.isReady = () => ready;
    t.service.startMaintenance(t.client, { guildId, envFile: '.env', intervalMs: 1000 }); ready = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.channel.send).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(1);
    ready = true; await vi.advanceTimersByTimeAsync(1000);
    expect(t.channel.send).toHaveBeenCalledOnce();
    t.service.stopMaintenance(t.client); expect(vi.getTimerCount()).toBe(0);
  });
  it('replaces a definitively deleted receipt and invalidates its old public message context', async () => {
    const t = fixture(); const first = await t.send(); t.messages.delete(first.messageId);
    const second = await t.send();
    expect(second).toMatchObject({ status: 'SENT' }); expect(second.messageId).not.toBe(first.messageId);
    expect(t.service.getContext({ guildId, customerId, channelId, messageId: first.messageId, orderCode: code })).toBeNull();
    expect(t.service.getContext({ guildId, customerId, channelId, messageId: second.messageId, orderCode: code })).toMatchObject({ provider: 'cdkvietnam' });
  });
  it('accepts only the exact persisted order/customer controls during reconciliation', async () => {
    const t = fixture();
    const wrong = t.buildCard({ order: { orderCode: `${code}0`, productName: 'Other order' }, customerId });
    t.newMessage(wrong);
    const result = await t.send();
    expect(result).toMatchObject({ status: 'SENT', recovered: false }); expect(t.channel.send).toHaveBeenCalledOnce();
  });
  it('authorizes only exact SENT public cards or owned ephemeral order replies, and stops when the ticket closes', async () => {
    const t = fixture(); const result = await t.send();
    const input = { guildId, customerId, channelId, messageId: result.messageId, orderCode: code };
    expect(t.service.getContext(input)).toMatchObject({ guildId, customerId, channelId, orderCode: code, ticketId: 1483,
      provider: 'cdkvietnam', ticketSource: 'DISCORD_AUTOBUY', expectedTopic: t.channel.topic, categoryId });
    expect(t.service.getContext({ ...input, messageId: '1569729564115206999' })).toBeNull();
    expect(t.service.getContext({ ...input, customerId: botId })).toBeNull();
    expect(t.service.getContext({ ...input, ephemeral: true, messageId: '1569729564115206999' })).toMatchObject({ orderCode: code });
    expect(t.service.getContext({ ...input, ephemeral: true, orderCode: 'CN_572017' })).toBeNull();
    t.database.prepare("UPDATE tickets SET status='CLOSED'").run();
    expect(t.service.getContext(input)).toBeNull(); expect(await t.send()).toEqual({ status: 'NOT_ELIGIBLE' });
  });
  it.each(['topic', 'privacy', 'category', 'bot_access'])('refuses an unverified private channel (%s)', async field => {
    const t = fixture();
    if (field === 'topic') t.channel.topic = 'Unrelated ticket';
    if (field === 'privacy') t.channel.permissionOverwrites.cache.delete(guildId);
    if (field === 'category') t.channel.parentId = channelId;
    if (field === 'bot_access') t.channel.permissionsFor = () => new PermissionsBitField([]);
    expect(await t.send()).toEqual({ status: 'CHANNEL_UNVERIFIED' });
    expect(t.channel.send).not.toHaveBeenCalled(); expect(t.readCustomerOrder).not.toHaveBeenCalled();
  });
  it('does not send if the ticket closes while its order card is being built', async () => {
    const t = fixture(); const read = t.readCustomerOrder.getMockImplementation();
    t.readCustomerOrder.mockImplementationOnce(async input => {
      const order = await read(input);
      t.database.prepare("UPDATE tickets SET status='CLOSED'").run();
      return order;
    });
    expect(await t.send()).toEqual({ status: 'NOT_ELIGIBLE' });
    expect(t.channel.send).not.toHaveBeenCalled(); expect(t.notice().attempts).toBe(0);
    expect(t.database.prepare('SELECT payment_status,total_amount FROM orders').get()).toEqual({ payment_status: 'UNPAID', total_amount: 344000 });
  });
  it('does not send an old card after the persisted customer binding changes during rendering', async () => {
    const t = fixture(); const read = t.readCustomerOrder.getMockImplementation();
    t.readCustomerOrder.mockImplementationOnce(async input => {
      const order = await read(input);
      t.database.prepare('UPDATE orders SET customer_id=?').run(botId);
      t.database.prepare('UPDATE tickets SET customer_id=?').run(botId);
      t.database.prepare('UPDATE supplier_autobuy_intents SET customer_id=?').run(botId);
      t.channel.topic = `Cenar AutoBuy · customer:${botId} · ticket:1483`;
      t.channel.permissionOverwrites.cache.set(botId, { allow: new PermissionsBitField(['ViewChannel']) });
      return order;
    });
    expect(await t.send()).toEqual({ status: 'REVIEW' });
    expect(t.channel.send).not.toHaveBeenCalled(); expect(t.notice().attempts).toBe(0);
  });
  it('refreshes channel privacy before sending instead of trusting the earlier cached channel', async () => {
    const t = fixture();
    const publicChannel = { ...t.channel, permissionOverwrites: { cache: new Collection() } };
    t.guild.channels.fetch.mockResolvedValueOnce(t.channel).mockResolvedValueOnce(publicChannel);
    expect(await t.send()).toEqual({ status: 'CHANNEL_UNVERIFIED' });
    expect(t.guild.channels.fetch).toHaveBeenLastCalledWith(channelId, { force: true });
    expect(t.channel.send).not.toHaveBeenCalled(); expect(t.notice().attempts).toBe(0);
  });
  it('rechecks ticket eligibility after the final channel refresh is awaited', async () => {
    const t = fixture();
    t.guild.channels.fetch.mockResolvedValueOnce(t.channel).mockImplementationOnce(async () => {
      t.database.prepare("UPDATE tickets SET status='CLOSED'").run(); return t.channel;
    });
    expect(await t.send()).toEqual({ status: 'NOT_ELIGIBLE' });
    expect(t.channel.send).not.toHaveBeenCalled(); expect(t.notice().attempts).toBe(0);
  });
  it.each([['ticket_type', 'WARRANTY'], ['support_source', 'WEBSITE_AI'], ['support_source', 'DISCORD_SUPPORT']])('excludes unrelated ticket %s=%s', async (field, value) => {
    const t = fixture(); t.database.prepare(`UPDATE tickets SET ${field}=?`).run(value);
    expect(await t.send()).toEqual({ status: 'NOT_ELIGIBLE' }); expect(t.channel.send).not.toHaveBeenCalled();
  });
  it('supports CDK and Dopermind orders in the same reused legacy ORDER ticket', async () => {
    const t = fixture();
    t.database.prepare("UPDATE tickets SET support_source='DISCORD_ORDER'").run(); t.channel.topic = 'Existing Cenar order ticket';
    t.database.exec(`INSERT INTO orders SELECT 'CN_572017',guild_id,customer_id,ticket_id,ticket_channel_id,fulfillment_mode,status,payment_status,total_amount,created_at FROM orders WHERE order_code='${code}';
      INSERT INTO supplier_autobuy_intents VALUES('CN_572017','${guildId}','${customerId}','dopermind','desc_synthetic');`);
    const repaired = await t.service.repair(t.client, { guildId, envFile: '.env' });
    expect(repaired).toMatchObject({ status: 'READY', scanned: 2, sent: 2, recovered: 0 });
    for (const receipt of repaired.repaired) {
      const context = t.service.getContext({ guildId, customerId, channelId, messageId: receipt.messageId, orderCode: receipt.orderCode });
      expect(context).toMatchObject({ ticketSource: 'DISCORD_ORDER', expectedTopic: null, ticketId: 1483 });
      expect(context.provider).toBe(receipt.orderCode === code ? 'cdkvietnam' : 'dopermind');
    }
    expect(t.channel.send).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(t.service.getHealth())).not.toMatch(/CN_|113831|156972|private|password|balance|cost/);
    expect(t.service.getHealth()).toMatchObject({ scanned: 2, sent: 2, failed: 0, pending: 0 });
  });
  it('keeps Store2, ambiguous environment and cross-customer order linkage closed', async () => {
    const t = fixture();
    expect(await t.service.send({ client: t.client, guildId: '1070676180103086132', envFile: '.env', orderCode: code })).toEqual({ status: 'DISABLED_OTHER_STORE' });
    vi.stubEnv('ENV_FILE', '.env.store2'); expect(await t.send()).toEqual({ status: 'DISABLED_OTHER_STORE' });
    vi.stubEnv('ENV_FILE', '.env'); t.database.prepare('UPDATE supplier_autobuy_intents SET customer_id=?').run(botId);
    expect(await t.send()).toEqual({ status: 'NOT_ELIGIBLE' }); expect(t.channel.send).not.toHaveBeenCalled();
  });
  it('rejects other-store/env calls before sharing a live flight or mutating existing notices', async () => {
    const t = fixture(); let release;
    const pause = new Promise(resolve => { release = resolve; });
    t.channel.send.mockImplementationOnce(async payload => { await pause; return t.newMessage(payload); });
    const pending = t.send();
    await vi.waitFor(() => expect(t.channel.send).toHaveBeenCalledOnce());
    const before = t.notice();
    expect(await t.service.send({ client: t.client, guildId, envFile: '.env.store2', orderCode: code })).toEqual({ status: 'DISABLED_OTHER_STORE' });
    expect(t.notice()).toEqual(before);
    release(); expect(await pending).toMatchObject({ status: 'SENT' });
  });
});
