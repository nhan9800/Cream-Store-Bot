import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { MessageFlags } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ panel: {} }));
vi.mock('../src/config.js', () => ({ config: { guildId: '1282637033340403754' } }));
vi.mock('../src/database/db.js', () => ({ db: { prepare: () => { throw new Error('Use only the injected synthetic database'); } } }));
vi.mock('../src/utils/emojiHelper.js', () => ({
  createEmojiResolver: () => {
    const E = name => `<:${name}:1382729296724099132>`;
    E.component = name => ({ id: '1382729296724099132', name });
    return E;
  },
  withButtonEmoji: (button, emoji) => button.setEmoji({ name: emoji.match(/^<:(\w+):/)?.[1] || 'test', id: '1382729296724099132' }),
}));
vi.mock('../src/services/supplierAutobuyRuntime.js', () => ({ supplierAutobuyRuntime: {
  getHealth: () => ({ status: 'CONNECTED', provider: 'cdkvietnam', purchasesEnabled: true }),
} }));
vi.mock('../src/services/supplierAutobuyPanelService.js', async original => ({
  ...await original(), getSupplierAutobuyPanelHealth: () => state.panel,
}));

import { createSupplierAutobuyInteractionHandler } from '../src/events/supplierAutobuyHandlers.js';
import { createSupplierAutobuyCatalog } from '../src/services/supplierAutobuyCatalogService.js';
import { createSupplierAutobuyOrderService } from '../src/services/supplierAutobuyOrderService.js';
import { createCdkVietnamClient } from '../src/services/cdkVietnamClient.js';

const guildId = '1282637033340403754', customerId = '111111111111111111';
const botId = '1382729296724099132', channelId = '1569729564115206214', messageId = '1569729568695255211';
const ticketChannelId = '1569729564115206215', logId = '1514607026247045121';
const policy = JSON.parse(readFileSync(new URL('../src/data/cdkVietnamAutobuyPricingPolicy.json', import.meta.url), 'utf8'));
const id = (action, value) => `supplier-autobuy:${action}:${customerId}${value ? `:${value}` : ''}`;
const nodes = payload => {
  const result = [], visit = item => { result.push(item); item.components?.forEach(visit); };
  JSON.parse(JSON.stringify(payload)).components.forEach(visit);
  return result;
};
const open = [];

function interaction(customId, patch = {}) {
  const publicEntry = customId === 'supplier-autobuy:catalog';
  return {
    customId, guildId, channelId, user: { id: customerId }, client: { user: { id: botId } },
    message: { id: publicEntry ? messageId : '1569999999999999999', author: { id: botId },
      flags: publicEntry ? 0 : MessageFlags.Ephemeral, interactionMetadata: { user: { id: customerId } } },
    isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false,
    deferReply: vi.fn().mockResolvedValue(undefined), reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue({ id: '1569999999999999998' }), showModal: vi.fn().mockResolvedValue(undefined),
    ...patch,
  };
}

function fixture() {
  const database = new Database(':memory:'); open.push(database);
  database.pragma('foreign_keys=ON');
  database.exec(`CREATE TABLE tickets(id INTEGER PRIMARY KEY,guild_id TEXT,customer_id TEXT,channel_id TEXT,status TEXT);
    CREATE TABLE orders(order_code TEXT PRIMARY KEY,guild_id TEXT,customer_id TEXT,product_name TEXT,product_id INTEGER,
      quantity INTEGER,total_amount INTEGER,amount_paid INTEGER,payment_status TEXT,status TEXT,fulfillment_mode TEXT,created_at TEXT);`);
  database.prepare("INSERT INTO tickets VALUES(1,?,?,?,'OPEN')").run(guildId, customerId, ticketChannelId);
  const reviewed = policy.products.filter(product => product.enabled);
  // Synthetic stock uses the actual reviewed identities/terms, never a live
  // supplier key, balance, customer payment, invoice or purchase endpoint.
  const fetchImpl = vi.fn(async (_url, request) => {
    expect(request.method).toBe('GET');
    return new Response(JSON.stringify({ products: reviewed.map(product => ({
      id: Number(product.productKey.split(':')[1]), name: product.expectedName, description: 'Synthetic test stock',
      currency: 'VND', prices: [{ min_quantity: 1, unit_price: 100000 }], stock: 10, locked: false, delivery: 'automatic',
    })), next_after: null }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const provider = createCdkVietnamClient({ apiKey: 'synthetic-local-test-key', fetchImpl });
  const now = () => Date.parse(policy.checkedAt) + 86400000;
  const catalog = createSupplierAutobuyCatalog({ policy, database, enabled: () => true, now, clientFactory: () => provider });
  const createOrder = vi.fn(input => {
    const code = 'CN_123456';
    database.prepare(`INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(code, input.guildId, input.customerId,
      input.productName, null, input.quantity, input.totalAmount, 0, 'UNPAID', 'PENDING_PAYMENT', 'SUPPLIER', new Date(now()).toISOString());
    return database.prepare('SELECT * FROM orders WHERE order_code=?').get(code);
  });
  const engine = createSupplierAutobuyOrderService({ db: database, getQuote: catalog.getQuote, createOrder,
    markOrderCompleted: vi.fn(), encrypt: value => `enc:v1:${value}`, decrypt: value => value.slice(7),
    providerFactory: () => provider, enabled: () => true, now, id: randomUUID });
  const deps = {
    getCatalog: catalog.getOffers, prepareCheckout: engine.prepareSupplierCheckout,
    confirmCheckout: input => engine.confirmSupplierCheckout({ ...input, ticketId: 1, ticketChannelId, orderLogChannelId: logId }),
    createPayment: vi.fn(), canManage: vi.fn().mockResolvedValue(true),
  };
  return { database, catalog, reviewed, provider, fetchImpl, createOrder, deps,
    handler: createSupplierAutobuyInteractionHandler(deps) };
}

beforeEach(() => {
  vi.stubEnv('ENV_FILE', '.env');
  state.panel = { status: 'READY', channelId, messageId };
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Live network forbidden'); }));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  for (const database of open.splice(0)) database.close();
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

describe('reviewed CDK catalog to private payment selection', () => {
  it('shows every approved CDK offer, persists its quote and creates one payable owned order', async () => {
    const t = fixture();
    const entry = interaction('supplier-autobuy:catalog');
    await t.handler(entry);
    const menu = nodes(entry.editReply.mock.calls[0][0]).find(node => node.custom_id === id('select'));
    expect(menu.options.map(option => option.value).sort()).toEqual(t.reviewed.map(product => product.productKey).sort());
    let firstQuote;
    for (const product of t.reviewed) {
      const select = interaction(id('select'), { isButton: () => false, isStringSelectMenu: () => true, values: [product.productKey] });
      await t.handler(select);
      const confirmation = nodes(select.editReply.mock.calls[0][0]).find(node => node.custom_id?.startsWith(id('confirm')));
      expect(confirmation).toBeDefined();
      const quoteId = confirmation.custom_id.split(':').at(-1);
      expect(t.database.prepare('SELECT product_key,customer_id FROM supplier_autobuy_quotes WHERE quote_id=?').get(quoteId))
        .toEqual({ product_key: product.productKey, customer_id: customerId });
      firstQuote ||= quoteId;
    }
    const confirm = interaction(id('confirm', firstQuote));
    await t.handler(confirm);
    const payload = confirm.editReply.mock.calls[0][0], ids = nodes(payload).map(node => node.custom_id).filter(Boolean);
    expect(ids).toContain(id('pay', 'CN_123456:payos'));
    expect(ids).toContain(id('pay', 'CN_123456:wallet'));
    expect(JSON.stringify(payload)).toContain('Thanh toán trước');
    expect(t.database.prepare('SELECT product_key,status FROM supplier_autobuy_intents').get())
      .toEqual({ product_key: t.reviewed[0].productKey, status: 'PENDING' });
    await t.handler(interaction(id('confirm', firstQuote)));
    expect(t.createOrder).toHaveBeenCalledTimes(1);
    expect(t.deps.createPayment).not.toHaveBeenCalled();
    expect(t.fetchImpl.mock.calls.every(([, request]) => request.method === 'GET')).toBe(true);
  });
});
