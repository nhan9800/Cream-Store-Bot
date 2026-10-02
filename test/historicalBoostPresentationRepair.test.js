import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/database/db.js', () => ({ db: null, nowIso: () => '2026-10-02T00:00:00.000Z' }));
vi.mock('../src/services/emojiService.js', () => ({
  resolveVerifiedCustomEmoji: () => '', sanitizeCustomEmojiText: (_guildId, text) => text,
  getCanonicalEmojiSlot: (name) => ['cr_shop', 'verifybadge', 'Dotyellow', 'tickgreen'].includes(name) ? 'known_slot' : null,
}));

import {
  auditHistoricalBoostPresentation,
  getHistoricalBoostPresentationRepairStatus,
  runHistoricalBoostPresentationRepairPass,
} from '../src/services/historicalBoostPresentationRepairService.js';

const GUILD = '1282637033340403754';
const OTHER_GUILD = '1070676180103086132';
const CHANNEL = '1524232964928438455';
const BOT = '210000000000000001';
const CUSTOMER = '210000000000000002';
const SERVER = '210000000000000003';
let database;

function normalizer(_guildId, text, { legacySlots = {} } = {}) {
  return String(text || '').replace(/<a?:([a-zA-Z0-9_]+):(\d+)>|:([a-zA-Z0-9_]+):/g, (_match, name, id, bareName) => {
    const slot = legacySlots[id] || legacySlots[name || bareName];
    return slot ? `<:fresh_${slot}:210000000000000010>` : '';
  });
}

function order(code = 'BST_123456', guildId = GUILD) {
  database.prepare('INSERT INTO boost_server_orders VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(code, guildId, CUSTOMER, SERVER, 'COMPLETED', 'PAID', 120000);
}

function historicalMessage({ id = '210000000000001001', code = 'BST_123456', authorId = BOT, embedPatch = {}, content = '', attachments = 0 } = {}) {
  const embed = {
    type: 'rich', color: 0x5865F2,
    title: '<a:tsm_fire:1327553120842158111> [BOOST LOG] Đơn chờ thanh toán',
    fields: [
      { name: '<:cr_shop:1392749981332541501> Mã đơn', value: `\`${code}\``, inline: true },
      { name: '<:verifybadge:1481127479702847646> Khách', value: `<@${CUSTOMER}>`, inline: true },
      { name: '<:cr_carttt:1348626032747614268> Gói', value: '14x Boost Server · 1 Tháng', inline: true },
      { name: '<:cr_pay:1392750857329705000> Thanh toán', value: '<a:Dotyellow:1481134440725090315> Chờ thanh toán', inline: true },
      { name: '<:cr_muahang:1348622828152426528> Server', value: `**Tên server lịch sử**\nID: \`${SERVER}\`\nLink: [**Vào Server**](https://discord.gg/example)`, inline: true },
      { name: '<a:starxoay:1481141954346483845> Trạng thái', value: '<a:Dotyellow:1481134440725090315> Chờ xử lý', inline: true },
      { name: '<:cr_voucher:1392749775794737286> Ghi chú', value: 'Ghi chú nguyên bản\n```json\n{"literal":":verifybadge:"}\n```', inline: false },
    ],
    footer: { text: 'Cenar Store — Boost Server' }, timestamp: '2026-08-05T12:00:00.000Z',
    ...embedPatch,
  };
  const originalComponents = [{ type: 1, components: [{
    type: 2, style: 3, custom_id: `boost:activate:${code}`, label: 'Kích Hoạt Boost Ngay', disabled: true,
    emoji: { id: '1384069022831874169', name: 'tickgreen', animated: true },
  }, { type: 2, style: 2, custom_id: `boost:manage:${code}`, label: 'Cập Nhật Live', disabled: false }] }];
  const message = { id, author: { id: authorId }, content, attachments: { size: attachments },
    embeds: [embed], components: originalComponents, delete: vi.fn() };
  message.edit = vi.fn(async (payload) => {
    if (payload.embeds) message.embeds = payload.embeds;
    if (payload.components) message.components = payload.components.map((item) => item.toJSON ? item.toJSON() : item);
    return message;
  });
  return message;
}

function clientFor(messages, channelGuild = GUILD) {
  const sorted = [...messages].sort((left, right) => BigInt(left.id) > BigInt(right.id) ? -1 : 1);
  const channel = {
    id: CHANNEL, guildId: channelGuild, isTextBased: () => true, isThread: () => false,
    send: vi.fn(), messages: { fetch: vi.fn(async (query) => {
      if (typeof query === 'string') {
        const message = sorted.find((item) => item.id === query);
        if (!message) throw Object.assign(new Error('Unknown message'), { code: 10008 });
        return message;
      }
      const page = sorted.filter((item) => !query.before || BigInt(item.id) < BigInt(query.before)).slice(0, query.limit);
      return new Map(page.map((item) => [item.id, item]));
    }) },
  };
  const guild = { id: GUILD, channels: { fetch: vi.fn(async () => channel) } };
  return { user: { id: BOT }, guilds: { cache: new Map([[GUILD, guild]]) }, channel };
}

const options = (extra = {}) => ({ guildId: GUILD, dbInstance: database,
  configProvider: () => ({ boost_log_channel_id: CHANNEL }), normalizeText: normalizer,
  verifyEmoji: (_guildId, value) => typeof value === 'string' ? value.startsWith('<:fresh_') ? value : ''
    : value?.name?.startsWith('fresh_') ? `<:${value.name}:${value.id}>` : '', ...extra });

function payloadText(payload) {
  return JSON.stringify(payload.components.map((item) => item.toJSON ? item.toJSON() : item));
}

beforeEach(() => {
  database = new Database(':memory:');
  database.exec(`CREATE TABLE boost_server_orders (
    order_code TEXT PRIMARY KEY, guild_id TEXT, customer_id TEXT, server_id TEXT,
    status TEXT, payment_status TEXT, amount INTEGER
  )`);
});
afterEach(() => database.close());

describe('Historical Boost presentation repair', () => {
  it('rebuilds the original event without substituting the current financial/order status', async () => {
    order();
    const message = historicalMessage();
    const originalNote = message.embeds[0].fields[6].value;
    const originalServer = message.embeds[0].fields[4].value;
    const before = database.prepare('SELECT * FROM boost_server_orders').all();
    const client = clientFor([message]);
    const result = await runHistoricalBoostPresentationRepairPass(client, options());
    expect(result).toMatchObject({ status: 'DONE', scanned: 1, matched: 1, updated: 1, failures: 0 });
    const payload = message.edit.mock.calls[0][0];
    expect(payload.flags).toBe(32768);
    const text = payloadText(payload);
    expect(text).toContain('Đơn chờ thanh toán');
    expect(text).toContain('Chờ thanh toán');
    expect(text).toContain('Chờ xử lý');
    expect(text).not.toContain('Đã thanh toán');
    expect(text).toContain('fresh_order_id');
    expect(text).toContain('<t:1785931200:F>');
    expect(text).toContain(originalNote.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n'));
    expect(text).toContain(originalServer.replace(/\n/g, '\\n'));
    const row = message.components.find((item) => item.type === 1);
    expect(row.components.map(({ emoji, ...button }) => button)).toEqual([
      { type: 2, style: 3, custom_id: 'boost:activate:BST_123456', label: 'Kích Hoạt Boost Ngay', disabled: true },
      { type: 2, style: 2, custom_id: 'boost:manage:BST_123456', label: 'Cập Nhật Live', disabled: false },
    ]);
    expect(database.prepare('SELECT * FROM boost_server_orders').all()).toEqual(before);
    expect(message.delete).not.toHaveBeenCalled();
    expect(client.channel.send).not.toHaveBeenCalled();
  });

  it('requires the exact bot author, stored guild, order, customer and server', async () => {
    order();
    order('BST_654321', OTHER_GUILD);
    const wrongCustomer = historicalMessage({ id: '210000000000001004' });
    wrongCustomer.embeds[0].fields[1].value = '<@210000000000000099>';
    const wrongServer = historicalMessage({ id: '210000000000001005' });
    wrongServer.embeds[0].fields[4].value = 'ID: `210000000000000099`';
    const messages = [
      historicalMessage({ id: '210000000000001001', authorId: '210000000000000099' }),
      historicalMessage({ id: '210000000000001002', code: 'BST_999999' }),
      historicalMessage({ id: '210000000000001003', code: 'BST_654321' }),
      wrongCustomer, wrongServer,
      historicalMessage({ id: '210000000000001006', embedPatch: { title: 'Một tin nhắn khác' } }),
    ];
    const result = await runHistoricalBoostPresentationRepairPass(clientFor(messages), options());
    expect(result).toMatchObject({ status: 'DONE', matched: 0, updated: 0, scanned: 6 });
    messages.forEach((message) => expect(message.edit).not.toHaveBeenCalled());
  });

  it('repairs the original lone inline server ID and verifies its dedicated V2 field', async () => {
    order();
    const message = historicalMessage();
    const originalServer = `**Máy chủ lịch sử**\n\`${SERVER}\`\nLink: [Vào Server](https://discord.gg/example)`;
    message.embeds[0].fields[4].value = originalServer;
    // A note containing unrelated identity data must not become the server or
    // customer source when the converted message is verified.
    message.embeds[0].fields[6].value = 'Ghi chú cũ: ID: `210000000000000099` · Khách: <@210000000000000099>';
    const before = database.prepare('SELECT * FROM boost_server_orders').all();
    const client = clientFor([message]);
    expect(await runHistoricalBoostPresentationRepairPass(client, options())).toMatchObject({ matched: 1, updated: 1, failures: 0 });
    expect(payloadText(message.edit.mock.calls[0][0])).toContain(originalServer.replace(/\n/g, '\\n'));
    const audit = await auditHistoricalBoostPresentation(client, options());
    expect(audit).toMatchObject({ status: 'COMPLETE', historyComplete: true, nativeV2Logs: 1,
      matchedLogMessages: 1, staleEmojiReferences: 0, unmatchedReasons: {} });
    expect(database.prepare('SELECT * FROM boost_server_orders').all()).toEqual(before);
  });

  it('rejects ambiguous, wrong or non-inline fallback server IDs without editing them', async () => {
    order();
    const ambiguous = historicalMessage({ id: '210000000000001001' });
    ambiguous.embeds[0].fields[4].value = `\`${SERVER}\`\n\`210000000000000099\``;
    const wrong = historicalMessage({ id: '210000000000001002' });
    wrong.embeds[0].fields[4].value = '`210000000000000099`';
    const bare = historicalMessage({ id: '210000000000001003' });
    bare.embeds[0].fields[4].value = SERVER;
    const client = clientFor([ambiguous, wrong, bare]);
    expect(await runHistoricalBoostPresentationRepairPass(client, options())).toMatchObject({ matched: 0, updated: 0, failures: 0 });
    const audit = await auditHistoricalBoostPresentation(client, options());
    expect(audit.unmatchedReasons).toEqual({ SERVER_ID_AMBIGUOUS: 1, SERVER_MISMATCH: 1, SERVER_ID_MISSING: 1 });
    expect(audit.malformedOrUnknownSkipped).toBe(3);
    [ambiguous, wrong, bare].forEach((message) => expect(message.edit).not.toHaveBeenCalled());
  });

  it('verifies native V2 identity from its server and customer sections, ignoring staff and note IDs', async () => {
    order();
    const message = historicalMessage();
    message.embeds = [];
    message.flags = 32768;
    message.components = [{ type: 17, components: [
      { type: 10, content: '## [BOOST LOG] Đã thanh toán' },
      { type: 10, content: '**Mã đơn: `BST_123456`**' },
      { type: 10, content: `### <:fresh_icon_store:210000000000000010> Máy chủ nhận Boost\nServer ID: \`${SERVER}\`` },
      { type: 10, content: `**Khách hàng:** <@${CUSTOMER}>\n**Xử lý bởi:** <@210000000000000099>` },
      { type: 10, content: '### Ghi chú xử lý\nID: `210000000000000099`\nKhách: <@210000000000000099>' },
    ] }];
    expect(await auditHistoricalBoostPresentation(clientFor([message]), options())).toMatchObject({
      status: 'COMPLETE', nativeV2Logs: 1, matchedLogMessages: 1, unmatchedReasons: {},
    });
    expect(message.edit).not.toHaveBeenCalled();
  });

  it('rescans under V2 while preserving and counting successful V1 journal records', async () => {
    order();
    const old = historicalMessage();
    await runHistoricalBoostPresentationRepairPass(clientFor([old]), options({ revision: 'BOOST-LOG-UI-20261002-V1' }));
    const before = database.prepare("SELECT * FROM boost_log_presentation_repairs WHERE revision = 'BOOST-LOG-UI-20261002-V1'").all();
    const remaining = historicalMessage({ id: '210000000000001002' });
    remaining.embeds[0].fields[4].value = `\`${SERVER}\``;
    const client = clientFor([old, remaining]);
    expect(await runHistoricalBoostPresentationRepairPass(client, options())).toMatchObject({
      revision: 'BOOST-LOG-UI-20261002-V2', status: 'DONE', scanned: 2, matched: 1, updated: 1,
    });
    expect(database.prepare("SELECT * FROM boost_log_presentation_repairs WHERE revision = 'BOOST-LOG-UI-20261002-V1'").all()).toEqual(before);
    expect(await auditHistoricalBoostPresentation(client, options())).toMatchObject({ matchedLogMessages: 2, journalConfirmedRepairs: 2 });
    expect(old.edit).toHaveBeenCalledTimes(1);
  });

  it('never follows a configured log channel into a different guild', async () => {
    order();
    const message = historicalMessage();
    const client = clientFor([message], OTHER_GUILD);
    const result = await runHistoricalBoostPresentationRepairPass(client, options());
    expect(result).toMatchObject({ status: 'RETRYING', matched: 0, scanned: 0, failures: 1 });
    expect(client.channel.messages.fetch).not.toHaveBeenCalled();
    expect(message.edit).not.toHaveBeenCalled();
  });

  it('keeps a mixed embed/content/attachment message intact while repairing its UI icon prefixes', async () => {
    order();
    const message = historicalMessage({ content: 'Nội dung phải giữ', attachments: 1 });
    const otherEmbed = { description: 'Một bản ghi khác', timestamp: '2026-07-01T00:00:00.000Z' };
    message.embeds.push(otherEmbed);
    const valuesBefore = message.embeds[0].fields.map((field) => field.value);
    await runHistoricalBoostPresentationRepairPass(clientFor([message]), options());
    const payload = message.edit.mock.calls[0][0];
    expect(payload.flags).toBeUndefined();
    expect(payload.content).toBeUndefined();
    expect(payload.attachments).toBeUndefined();
    expect(payload.embeds[1]).toEqual(otherEmbed);
    expect(payload.embeds[0].fields[0].name).toContain('fresh_order_id');
    expect(payload.embeds[0].fields[4].value).toBe(valuesBefore[4]);
    expect(payload.embeds[0].fields[6].value).toBe(valuesBefore[6]);
    expect(payload.embeds[0].timestamp).toBe('2026-08-05T12:00:00.000Z');
  });

  it('resumes its persisted cursor and never edits successful messages again after restart', async () => {
    order();
    const messages = [1, 2, 3].map((index) => historicalMessage({ id: `21000000000000100${index}` }));
    const client = clientFor(messages);
    const first = await runHistoricalBoostPresentationRepairPass(client, options({ pageSize: 2, maxPagesPerPass: 1 }));
    expect(first).toMatchObject({ status: 'IN_PROGRESS', scanned: 2, updated: 2 });
    const second = await runHistoricalBoostPresentationRepairPass(client, options({ pageSize: 2, maxPagesPerPass: 1 }));
    expect(second).toMatchObject({ status: 'DONE', scanned: 3, updated: 3 });
    await runHistoricalBoostPresentationRepairPass(client, options());
    messages.forEach((message) => expect(message.edit).toHaveBeenCalledTimes(1));
  });

  it('journals failures safely and retries them without losing the historical event', async () => {
    order();
    const message = historicalMessage();
    const implementation = message.edit.getMockImplementation();
    message.edit.mockRejectedValueOnce(new Error('Private customer data must never enter the journal'));
    message.edit.mockImplementation(implementation);
    const client = clientFor([message]);
    const first = await runHistoricalBoostPresentationRepairPass(client, options());
    expect(first).toMatchObject({ status: 'RETRYING', updated: 0, failures: 1, pendingRetries: 1 });
    const record = database.prepare('SELECT * FROM boost_log_presentation_repair_messages').get();
    expect(record.last_error).toBe('DISCORD_REPAIR_FAILED');
    expect(JSON.stringify(record)).not.toContain('Private customer');
    expect(JSON.stringify(record)).not.toContain('BST_123456');
    const second = await runHistoricalBoostPresentationRepairPass(client, options());
    expect(second).toMatchObject({ status: 'DONE', updated: 1, failures: 0, pendingRetries: 0, failureAttempts: 1 });
    expect(message.edit).toHaveBeenCalledTimes(2);
  });

  it('rejects a lossy V2 conversion and preserves all original embed fields and button IDs', async () => {
    order();
    const message = historicalMessage();
    const result = await runHistoricalBoostPresentationRepairPass(clientFor([message]), options({
      legacyBuilder: () => ({ components: [{ type: 10, content: 'Truncated log without fields' }], flags: 32768 }),
    }));
    expect(result.updated).toBe(1);
    const payload = message.edit.mock.calls[0][0];
    expect(payload.flags).toBeUndefined();
    expect(payload.embeds[0].fields).toHaveLength(7);
    expect(payload.components[0].components[0].custom_id).toBe('boost:activate:BST_123456');
    expect(payload.embeds[0].fields[6].value).toContain('Ghi chú nguyên bản');
  });

  it('reports the scan cap honestly and has a read-only status getter before initialization', async () => {
    const untouched = getHistoricalBoostPresentationRepairStatus({ guildId: GUILD, dbInstance: database });
    expect(untouched.status).toBe('NOT_STARTED');
    expect(database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'boost_log_presentation_%'").get().count).toBe(0);
    order();
    const messages = [1, 2, 3].map((index) => historicalMessage({ id: `21000000000000100${index}` }));
    const result = await runHistoricalBoostPresentationRepairPass(clientFor(messages), options({ maxMessages: 2, pageSize: 1 }));
    expect(result).toMatchObject({ status: 'LIMIT_REACHED', scanned: 2, matched: 2, updated: 2, limitReached: true });
    expect(messages[0].edit).not.toHaveBeenCalled();
  });

  it('verifies the actual repaired V2 history and a focused order using aggregate evidence only', async () => {
    order();
    const message = historicalMessage();
    const client = clientFor([message]);
    await runHistoricalBoostPresentationRepairPass(client, options());
    const editCalls = message.edit.mock.calls.length;
    const journalBefore = database.prepare('SELECT * FROM boost_log_presentation_repair_messages').all();
    const result = await auditHistoricalBoostPresentation(client, options({ focusOrderCode: 'BST_123456' }));
    expect(result).toMatchObject({
      status: 'COMPLETE', historyComplete: true, matchedLogMessages: 1,
      nativeV2Logs: 1, legacyEmbedLogs: 0, staleEmojiReferences: 0, journalConfirmedRepairs: 1,
      focusOrder: { matchedMessages: 1, nativeV2Logs: 1, legacyEmbedLogs: 0, repairedMessages: 1, staleEmojiReferences: 0 },
    });
    expect(JSON.stringify(result)).not.toContain('BST_123456');
    expect(JSON.stringify(result)).not.toContain(CUSTOMER);
    expect(JSON.stringify(result)).not.toContain(SERVER);
    expect(JSON.stringify(result)).not.toContain('Ghi chú');
    expect(message.edit).toHaveBeenCalledTimes(editCalls);
    expect(database.prepare('SELECT * FROM boost_log_presentation_repair_messages').all()).toEqual(journalBefore);
  });

  it('counts stale mention/button and bare legacy tokens while reporting unmatched logs without leaking them', async () => {
    order();
    const message = historicalMessage();
    message.embeds[0].fields[0].name = ':cr_shop: Mã đơn';
    const unknown = historicalMessage({ id: '210000000000001002', code: 'BST_999999' });
    const result = await auditHistoricalBoostPresentation(clientFor([message, unknown]), options());
    expect(result).toMatchObject({ status: 'PARTIAL', historyComplete: true, matchedLogMessages: 1,
      legacyEmbedLogs: 1, nativeV2Logs: 0, malformedOrUnknownSkipped: 1,
      unmatchedReasons: { NO_DB_ORDER: 1 } });
    expect(result.unmatchedStaleEmojiReferencesByReason.NO_DB_ORDER).toBeGreaterThan(0);
    expect(result.staleEmojiReferences).toBeGreaterThan(0);
    expect(message.edit).not.toHaveBeenCalled();
    expect(unknown.edit).not.toHaveBeenCalled();
    expect(database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'boost_log_presentation_%'").get().count).toBe(0);
    expect(JSON.stringify(result)).not.toMatch(/BST_|Tên server|Ghi chú|discord\.gg/);
  });

  it('reports a safe rejection histogram for missing records, guild mismatch and malformed identity', async () => {
    order();
    order('BST_654321', OTHER_GUILD);
    const unknown = historicalMessage({ id: '210000000000001001', code: 'BST_999999' });
    const otherGuild = historicalMessage({ id: '210000000000001002', code: 'BST_654321' });
    const missingCustomer = historicalMessage({ id: '210000000000001003' });
    missingCustomer.embeds[0].fields[1].name = 'Người mua';
    const ambiguousCode = historicalMessage({ id: '210000000000001004' });
    ambiguousCode.embeds[0].fields[6].value = 'Đơn tham chiếu BST_111111';
    const client = clientFor([unknown, otherGuild, missingCustomer, ambiguousCode]);
    const before = database.prepare('SELECT * FROM boost_server_orders').all();
    const audit = await auditHistoricalBoostPresentation(client, options());
    expect(audit.unmatchedReasons).toEqual({ NO_DB_ORDER: 1, ORDER_GUILD_MISMATCH: 1,
      CUSTOMER_FIELD_MISSING: 1, AMBIGUOUS_ORDER_CODE: 1 });
    expect(Object.values(audit.unmatchedReasons).reduce((sum, count) => sum + count, 0)).toBe(audit.malformedOrUnknownSkipped);
    expect(JSON.stringify(audit)).not.toMatch(/BST_|210000000000|Tên server|discord\.gg/);
    expect(database.prepare('SELECT * FROM boost_server_orders').all()).toEqual(before);
    expect(database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'boost_log_presentation_%'").get().count).toBe(0);
    [unknown, otherGuild, missingCustomer, ambiguousCode].forEach((message) => expect(message.edit).not.toHaveBeenCalled());
  });

  it('does not report a clean full history when the audit reaches its cap or cannot read history', async () => {
    order();
    const message = historicalMessage();
    const capped = await auditHistoricalBoostPresentation(clientFor([message]), options({ maxMessages: 1 }));
    expect(capped).toMatchObject({ status: 'INCOMPLETE', historyComplete: false, limitReached: true });
    const denied = clientFor([message]);
    denied.channel.permissionsFor = () => ({ has: () => false });
    const unavailable = await auditHistoricalBoostPresentation(denied, options());
    expect(unavailable).toMatchObject({ status: 'INCOMPLETE', historyComplete: false, failures: 1, errorCode: 'MISSING_ACCESS' });
    expect(denied.channel.messages.fetch).not.toHaveBeenCalled();
    expect(message.edit).not.toHaveBeenCalled();
  });
});
