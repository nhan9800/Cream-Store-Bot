import { Collection, PermissionsBitField } from 'discord.js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config.js', () => ({ config: {
  guildId: '1282637033340403754', clientId: '666666666666666666', accentColorSuccess: 0x41b899,
  storeName: 'Cenar Store', storeFooter: 'Cenar Store', storeIconUrl: null, paymentImageUrl: null,
} }));
// Staff-panel refresh is an independent optional task, outside these two
// customer sends. Keep the actual receipt builders and sender unmodified.
vi.mock('../src/services/notificationService.js', () => ({ updateOrderLogMessage: vi.fn(async () => {}) }));
vi.mock('../src/database/db.js', async () => {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE guild_settings(guild_id TEXT PRIMARY KEY,custom_emojis TEXT,updated_at TEXT,
      ticket_category_id TEXT,order_log_channel_id TEXT,feedback_channel_id TEXT);
    CREATE TABLE orders(order_code TEXT PRIMARY KEY,guild_id TEXT,customer_id TEXT,ticket_id INTEGER,ticket_channel_id TEXT,
      fulfillment_mode TEXT,status TEXT,payment_status TEXT,payment_provider TEXT,total_amount INTEGER,amount_paid INTEGER,quantity INTEGER,
      product_name TEXT,created_at TEXT,paid_at TEXT,order_log_channel_id TEXT,order_log_message_id TEXT,paid_transaction_content TEXT,
      paid_transaction_id TEXT,payos_order_code INTEGER,payment_link_id TEXT);
    CREATE TABLE tickets(id INTEGER PRIMARY KEY,guild_id TEXT,customer_id TEXT,channel_id TEXT,status TEXT,ticket_type TEXT,support_source TEXT);
    CREATE TABLE supplier_autobuy_intents(order_code TEXT PRIMARY KEY,guild_id TEXT,customer_id TEXT,provider TEXT,product_key TEXT,request_id TEXT,
      sale_amount INTEGER,quantity INTEGER,product_name TEXT,status TEXT,quote_id TEXT,request_hash TEXT,encrypted_payload TEXT);
    CREATE TABLE staff_logs(id INTEGER PRIMARY KEY,guild_id TEXT,actor_id TEXT,target_id TEXT,action TEXT,detail TEXT,
      related_order_code TEXT,related_ticket_code TEXT,created_at TEXT);`);
  return { db, nowIso: () => new Date().toISOString() };
});

import { db } from '../src/database/db.js';
import { CORE_UI_EMOJI_ASSETS } from '../src/config/coreEmojiPack2026.js';
import { resetAllEmojis } from '../src/services/emojiService.js';
import { createEmojiResolver } from '../src/utils/emojiHelper.js';
import { normalizeMessagePresentation } from '../src/utils/discordEmojiBoundary.js';
import { createSupplierPaymentNoticeService } from '../src/services/supplierAutobuyPaymentNoticeService.js';

const guildId = '1282637033340403754', customerId = '111111111111111111', botId = '666666666666666666';
const channelId = '333333333333333333', categoryId = '444444444444444444', code = 'CN_123456';
const dmId = '888888888888888888', otherId = '222222222222222222';
const paidAt = '2026-11-01T00:00:00.000Z', originalClient = global.discordClient;
const noMentions = { parse: [], users: [], roles: [], repliedUser: false };
let inventory;

beforeEach(() => {
  vi.stubEnv('ENV_FILE', '.env');
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('External network forbidden'); }));
  for (const table of ['guild_settings', 'orders', 'tickets', 'supplier_autobuy_intents', 'staff_logs']) db.prepare(`DELETE FROM ${table}`).run();
  for (const table of ['supplier_autobuy_payment_notices', 'supplier_autobuy_payment_notice_boundary']) db.exec(`DROP TABLE IF EXISTS ${table}`);
  resetAllEmojis(guildId);
  inventory = new Collection(CORE_UI_EMOJI_ASSETS.map((asset, index) => {
    const emoji = { id: String(1560000000000000000n + BigInt(index)), name: asset.name, animated: false };
    return [emoji.id, emoji];
  }));
  global.discordClient = { application: { emojis: { cache: inventory } },
    guilds: { cache: new Collection([[guildId, { id: guildId, emojis: { cache: new Collection() } }]]) } };
});
afterEach(() => { global.discordClient = originalClient; vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(() => db.close());

async function publish(productName, reviewedProductName = productName) {
  db.prepare(`INSERT INTO orders VALUES(?,?,?,?,?,'SUPPLIER','PROCESSING','PAID','PAYOS',72000,72000,1,?,?,?,?,?,?,?,123456,'synthetic-link')`)
    .run(code, guildId, customerId, 1483, channelId, productName, '2026-11-01T00:00:00Z', paidAt,
      categoryId, null, 'private-bank-description', 'synthetic-tx');
  db.prepare("INSERT INTO tickets VALUES(1483,?,?,?,'OPEN','ORDER','DISCORD_AUTOBUY')").run(guildId, customerId, channelId);
  db.prepare("INSERT INTO supplier_autobuy_intents VALUES(?,?,?,'dopermind','desc_synthetic','cenar-synthetic-request',72000,1,?,'PENDING','synthetic-quote','synthetic-hash',NULL)")
    .run(code, guildId, customerId, reviewedProductName);
  const payloads = {};
  const send = kind => vi.fn(async payload => {
    // Exercise the same final normalization and builder serialization as the
    // Discord REST boundary, rather than inspecting unvalidated builder data.
    payloads[kind] = JSON.parse(JSON.stringify(normalizeMessagePresentation(payload, guildId)));
    return { id: kind === 'ticket' ? '777777777777777777' : '999999999999999999', channelId: kind === 'ticket' ? channelId : dmId };
  });
  const channel = { id: channelId, guildId, type: 0, parentId: categoryId, isTextBased: () => true,
    topic: `Cenar AutoBuy · customer:${customerId} · ticket:1483`,
    permissionOverwrites: { cache: new Collection([[guildId, { deny: new PermissionsBitField(['ViewChannel']) }],
      [customerId, { allow: new PermissionsBitField(['ViewChannel']) }]]) },
    permissionsFor: () => new PermissionsBitField(['ViewChannel', 'SendMessages', 'ReadMessageHistory']), send: send('ticket') };
  const dm = { id: dmId, type: 1, recipientId: customerId, send: send('dm') };
  const client = { user: { id: botId }, isReady: () => true };
  const guild = { id: guildId, client, channels: { fetch: vi.fn(async () => channel) } };
  client.guilds = { fetch: vi.fn(async () => guild) };
  client.users = { fetch: vi.fn(async () => ({ id: customerId, createDM: async () => dm })) };
  const service = createSupplierPaymentNoticeService({ database: db,
    settings: () => ({ ticket_category_id: categoryId }), fulfill: vi.fn(async () => ({})), syncRoles: vi.fn(async () => ({})) });
  const result = service.start({ client, order: db.prepare('SELECT * FROM orders').get(), freshReceipt: true });
  expect(result?.then).toBeUndefined();
  await vi.waitFor(() => expect(service.get(code).status).toBe('SENT'));
  expect(channel.send).toHaveBeenCalledOnce(); expect(dm.send).toHaveBeenCalledOnce();
  return payloads;
}

function presentation(payload) {
  const strings = [], ids = [];
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.emoji?.id) ids.push(value.emoji.id);
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string' && ['content', 'description', 'title', 'text', 'name', 'value'].includes(key)) {
        strings.push(item); ids.push(...[...item.matchAll(/<a?:\w+:(\d+)>/g)].map(match => match[1]));
      } else if (Array.isArray(item)) item.forEach(visit);
      else if (item && typeof item === 'object') visit(item);
    }
  };
  visit(payload);
  return { text: strings.join('\n'), ids };
}

describe('actual supplier payment notice presentation', () => {
  it('uses distinct verified custom artwork on both final cards and makes merchant decoration and mentions inert', async () => {
    const duplicate = createEmojiResolver(guildId)('payment_success');
    const payloads = await publish(`Rocket 🚀 ${duplicate} ${duplicate} <@${otherId}> <@&${otherId}> @everyone **sale** क्‍ष`);
    for (const [kind, payload] of Object.entries(payloads)) {
      const shown = presentation(payload);
      expect(shown.ids.length, kind).toBeGreaterThan(0);
      expect(new Set(shown.ids).size, kind).toBe(shown.ids.length);
      expect(shown.ids.every(id => inventory.has(id)), kind).toBe(true);
      expect(shown.text, kind).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(shown.text, kind).not.toMatch(new RegExp(`<@!?${otherId}>|<@&${otherId}>|@everyone`));
      expect(shown.text, kind).toContain('Rocket'); expect(shown.text, kind).toContain('क्‍ष');
      expect(payload.allowedMentions, kind).toEqual(noMentions);
      expect(payload.enforceNonce, kind).toBe(true);
    }
  });

  it('shows the canonical paid_at on a delayed receipt and preserves immutable order data', async () => {
    const payloads = await publish('Synthetic subscription');
    const canonicalTime = `<t:${Date.parse(paidAt) / 1000}:R>`;
    for (const [kind, payload] of Object.entries(payloads)) expect(presentation(payload).text, kind).toContain(canonicalTime);
    expect(db.prepare('SELECT product_name,paid_at,total_amount,amount_paid FROM orders').get()).toEqual({
      product_name: 'Synthetic subscription', paid_at: paidAt, total_amount: 72000, amount_paid: 72000 });
    expect(JSON.stringify(payloads)).not.toContain('private-bank-description');
  });

  it('uses the reviewed intent name without escaping the legacy persisted Markdown a second time', async () => {
    const persisted = String.raw`\[AutoBuy\] CDK Claude PRO 1M \(IOS\) - BH Gói`;
    const reviewed = 'CDK Claude PRO 1M (IOS) - BH Gói';
    const payloads = await publish(persisted, reviewed);
    for (const [kind, payload] of Object.entries(payloads)) {
      const text = presentation(payload).text;
      expect(text, kind).toContain(reviewed);
      expect(text, kind).not.toContain(String.raw`\(IOS\)`);
      expect(text, kind).not.toContain('[AutoBuy');
    }
    expect(db.prepare('SELECT product_name FROM orders').get().product_name).toBe(persisted);
    expect(db.prepare('SELECT product_name FROM supplier_autobuy_intents').get().product_name).toBe(reviewed);
  });
});
