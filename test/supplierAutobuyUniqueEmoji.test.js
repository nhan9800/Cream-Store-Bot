import { Collection } from 'discord.js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config.js', () => ({ config: { guildId: '1282637033340403754' } }));
vi.mock('../src/database/db.js', async () => {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE guild_settings (guild_id TEXT PRIMARY KEY,custom_emojis TEXT,updated_at TEXT,
    ticket_category_id TEXT,order_log_channel_id TEXT,feedback_channel_id TEXT)`);
  return { db, nowIso: () => new Date().toISOString() };
});
import { db } from '../src/database/db.js';
import { CORE_UI_EMOJI_ASSETS } from '../src/config/coreEmojiPack2026.js';
import { resetAllEmojis } from '../src/services/emojiService.js';
import { normalizeMessagePresentation } from '../src/utils/discordEmojiBoundary.js';
import { createUniqueCustomEmojiResolver, withUniqueCustomEmoji } from '../src/utils/uniqueCustomEmoji.js';
import { buildSupplierAutobuyPanel, buildSupplierAutobuyReply, buildSupplierCatalogView,
  buildSupplierQuoteView, buildSupplierOrderView, buildSupplierPaymentView,
  buildSupplierOrderListView, buildSupplierNoticeView } from '../src/services/supplierAutobuyPanelService.js';

const guildId = '1282637033340403754', user = '111111111111111111';
const quoteId = 'b9d30c1d-cb9a-4321-95dc-2994ac587ac1';
const previousClient = global.discordClient;
let application;
beforeEach(() => {
  db.prepare('DELETE FROM guild_settings').run(); resetAllEmojis(guildId);
  application = new Collection(CORE_UI_EMOJI_ASSETS.map((asset, index) => {
    const emoji = { id: String(1560000000000000000n + BigInt(index)), name: asset.name, animated: false };
    return [emoji.id, emoji];
  }));
  const spotify = { id: '1535690966911025262', name: 'cenar_spotify', animated: false };
  global.discordClient = { application: { emojis: { cache: application } },
    guilds: { cache: new Collection([[guildId, { id: guildId, emojis: { cache: new Collection([[spotify.id, spotify]]) } }]]) } };
});
afterEach(() => { global.discordClient = previousClient; });
afterAll(() => db.close());

function collect(payload) {
  const ids = [], strings = [], controls = [];
  const visit = value => {
    const node = value?.toJSON?.() || value;
    if (!node || typeof node !== 'object') return;
    if (node.emoji) ids.push(node.emoji.id);
    if (node.content) {
      strings.push(node.content);
      ids.push(...[...node.content.matchAll(/<a?:\w+:(\d+)>/g)].map(match => match[1]));
    }
    if (node.custom_id) controls.push(node.custom_id);
    for (const child of node.components || []) visit(child);
    for (const child of node.options || []) visit(child);
    if (node.accessory) visit(node.accessory);
  };
  for (const component of payload.components || []) visit(component);
  return { ids, strings, controls };
}
function verified(payload) {
  const wire = normalizeMessagePresentation(payload, guildId);
  const result = collect(wire);
  expect(result.ids.length).toBeGreaterThan(0);
  expect(new Set(result.ids).size).toBe(result.ids.length);
  expect(result.ids.every(id => application.has(id))).toBe(true);
  expect(result.strings.join('\n')).not.toMatch(/\p{Extended_Pictographic}/u);
  expect(JSON.stringify(wire.allowedMentions)).toBe(JSON.stringify(payload.allowedMentions));
  return result;
}
const offers = Array.from({ length: 12 }, (_, index) => ({ productKey: `cdkvietnam:${index + 1}`,
  name: index % 2 ? `ChatGPT Plus biến thể ${index + 1}` : `Claude Pro biến thể ${index + 1}`,
  priceVnd: 100000 + index * 1000, available: true, category: index % 3 ? 'AI' : 'Công cụ',
  termLabel: '1 tháng', warrantyLabel: 'BH Gói' }));
const quote = { quoteId, productKey: 'cdkvietnam:1', productName: 'ChatGPT Plus', quantity: 1,
  totalPriceVnd: 100000, termLabel: '1 tháng', warrantyLabel: 'BH Gói', accountForm: 'Tài khoản cấp sẵn',
  expiresAt: '2099-11-13T12:00:00Z' };
const order = { orderCode: 'CN_123456', productName: 'ChatGPT Plus', totalPriceVnd: 100000,
  status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' };

describe('unique sourced custom artwork for AutoBuy', () => {
  it('gives every product, price, dropdown option and control its own live icon', () => {
    const payload = buildSupplierCatalogView({ customerId: user, catalog: { offers } });
    const result = verified(payload);
    expect(result.ids.length).toBeGreaterThanOrEqual(30);
    expect(result.controls).toContain(`supplier-autobuy:select:${user}`);
    expect(JSON.stringify(payload)).toContain('cdkvietnam:1');
    expect(JSON.stringify(payload)).toContain('100.000đ');
    expect(buildSupplierCatalogView({ customerId: user, catalog: { offers } })).toEqual(payload);
  });
  it('keeps public, quote, order, QR and navigation artwork distinct through the final boundary', async () => {
    const snapshot = { status: 'CONNECTED', provider: 'cdkvietnam', purchasesEnabled: true };
    const payloads = [
      buildSupplierAutobuyPanel({ snapshot, supportChannelId: '1514607020098191393' }),
      buildSupplierAutobuyReply({ snapshot, action: 'status', customerId: user }),
      buildSupplierQuoteView({ quote, customerId: user, manager: true }),
      buildSupplierOrderView({ order, customerId: user }),
      await buildSupplierPaymentView({ order, customerId: user, payment: { method: 'PAYOS',
        checkoutUrl: 'https://pay.payos.vn/web/owned-invoice', qrCode: '00020101021238570010A0000007270127000697043601131234567890123',
        expiresAt: '2099-11-13T12:00:00Z' } }),
      buildSupplierOrderListView({ orders: [order], customerId: user }),
      buildSupplierNoticeView({ title: 'Thông tin đơn', text: 'Kiểm tra đơn trước khi thanh toán lại.', customerId: user }),
    ];
    payloads.forEach(verified);
    expect(collect(payloads[2]).controls).toContain(`supplier-autobuy:confirm:${user}:${quoteId}`);
    expect(payloads[4].files).toHaveLength(1);
  });
  it('reserves canonical IDs before selecting another icon for colliding legacy aliases', () => {
    const E = createUniqueCustomEmojiResolver(guildId, { seed: 'spotify' });
    const first = E('brand_spotify'), second = E('music_wave');
    const payload = { components: [{ type: 10, content: `${first} ${second}` }] };
    const ids = collect(normalizeMessagePresentation(payload, guildId)).ids;
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
  it('renders the marked persisted Claude name once without exposing the stored Markdown escape layer', async () => {
    const stored = { order_code: 'CN_123456', provider: 'cdkvietnam',
      product_name: String.raw`\[AutoBuy\] CDK Claude PRO 1M \(IOS\) - BH Gói`,
      total_amount: 100000, status: 'PENDING_PAYMENT', payment_status: 'UNPAID' };
    for (const payload of [buildSupplierOrderView({ order: stored, customerId: user }),
      await buildSupplierPaymentView({ order: stored, customerId: user }),
      buildSupplierOrderListView({ orders: [stored], customerId: user })]) {
      const { strings } = verified(payload), text = strings.join('\n');
      expect(text).toContain('**Sản phẩm:** CDK Claude PRO 1M (IOS) - BH Gói');
      expect(text.match(/CDK Claude PRO 1M/g)).toHaveLength(1);
      expect(text).not.toContain('[AutoBuy]');
      expect(text).not.toContain(String.raw`\(`);
      expect(text).not.toContain(String.raw`\[`);
      expect(text).toContain('100.000đ');
    }
  });
  it('preserves meaningful source backslashes and Unicode while escaping active Markdown only once', () => {
    const name = String.raw`C:\Kho\bản_gốc [Gói 1] (IOS) - #1! हिन्दी क्‍ष 漢字 é`;
    const payload = buildSupplierOrderView({ order: { ...order, productName: name }, customerId: user });
    const text = verified(payload).strings.join('\n');
    expect(text).toContain(String.raw`C:\\Kho\\bản\_gốc [Gói 1] (IOS) - #1! हिन्दी क्‍ष 漢字 é`);
    const persisted = { ...order, productName: undefined,
      product_name: String.raw`\[AutoBuy\] C:\\Kho\\bản\_gốc \[Gói 1\] \(IOS\) - #1! हिन्दी क्‍ष 漢字 é` };
    // A literal unescaped # is not in the storage encoder's canonical format;
    // unknown or malformed snapshots must not have backslashes guessed away.
    const malformed = verified(buildSupplierOrderView({ order: persisted, customerId: user })).strings.join('\n');
    expect(malformed).toContain('AutoBuy');
    const canonical = { ...persisted, product_name: persisted.product_name.replace('#1', String.raw`\#1`) };
    expect(verified(buildSupplierOrderView({ order: canonical, customerId: user })).strings.join('\n'))
      .toContain(String.raw`C:\\Kho\\bản\_gốc [Gói 1] (IOS) - #1! हिन्दी क्‍ष 漢字 é`);
    // Intent names are raw even when they intentionally resemble the marker.
    expect(verified(buildSupplierOrderView({ order: { ...order, productName: String.raw`\[AutoBuy\] literal` }, customerId: user }))
      .strings.join('\n')).toContain(String.raw`\\[AutoBuy\\] literal`);
  });
  it('keeps source mentions, links, native emoji and custom markup inert across product surfaces', async () => {
    const source = '<:source_brand:1535690966911025262> 🇻🇳 👍🏽 1️⃣ 👨‍👩‍👧‍👦 Việt Nam **sale** `gói` ||ẩn|| <@111111111111111111> @everyone [mở](https://evil.invalid/x)';
    const item = { ...order, productName: source };
    const payloads = [buildSupplierCatalogView({ customerId: user, catalog: { offers: [{ ...offers[0], name: source }] } }),
      buildSupplierQuoteView({ quote: { ...quote, productName: source }, customerId: user }),
      buildSupplierOrderView({ order: item, customerId: user }),
      await buildSupplierPaymentView({ order: item, customerId: user, payment: { method: 'PAYOS', checkoutUrl: 'https://pay.payos.vn/web/owned-invoice' } }),
      buildSupplierOrderListView({ orders: [item], customerId: user })];
    for (const payload of payloads) {
      const text = verified(payload).strings.join('\n'), serialized = JSON.stringify(payload);
      expect(text).toContain('Việt Nam');
      expect(serialized).not.toMatch(/source_brand|1535690966911025262|🇻|🏽|\u20e3|\u200d|@everyone|<@|https:\/\/evil/);
      expect(text).toContain('＠everyone');
      expect(text).toContain('\\*\\*sale\\*\\*');
      expect(text).toContain('\\`gói\\`');
      expect(text).toContain('\\|\\|ẩn\\|\\|');
      if (text.includes('evil')) expect(text).toContain('https:\u200b//evil');
    }
  });
  it('keeps ticket order/payment/notice controls scoped to one order with distinct final icons', async () => {
    const owned = { ...order, provider: 'dopermind' };
    for (const payload of [buildSupplierOrderView({ order: owned, customerId: user, ticketContext: true }),
      await buildSupplierPaymentView({ order: owned, customerId: user, ticketContext: true,
        payment: { method: 'PAYOS', checkoutUrl: 'https://pay.payos.vn/web/owned-invoice' } }),
      buildSupplierNoticeView({ title: 'Thông tin đơn', text: 'Vui lòng kiểm tra đơn.', customerId: user, ticketContext: true, order: owned })]) {
      const result = verified(payload);
      expect(result.controls.some(id => /:(?:page|orders):/.test(id))).toBe(false);
      expect(result.controls.every(id => id.includes(`:${user}:CN_123456`))).toBe(true);
    }
    expect(collect(buildSupplierOrderView({ order: owned, customerId: user })).controls)
      .toContain(`supplier-autobuy:orders:${user}`);
  });
  it('does not treat escaped source delimiters as credential spans that bypass artwork allocation', () => {
    const token = createUniqueCustomEmojiResolver(guildId)('icon_doc');
    const payload = withUniqueCustomEmoji({ components: [{ type: 10,
      content: `## ${token} Tiêu đề\n\\\` ${token} 🛒 \\\` \\|\\| ${token} 👍🏽 \\|\\|` }], allowedMentions: { parse: [] } }, { guildId });
    expect(verified(payload).ids).toHaveLength(3);
    expect(() => withUniqueCustomEmoji({ components: [{ type: 10, content: 'https://' }] }, { guildId })).not.toThrow();
  });
  it('keeps selectors valid when supplier names or categories contain only decorative emoji', () => {
    const payload = buildSupplierCatalogView({ customerId: user, catalog: { offers: [
      { ...offers[0], name: '👨‍👩‍👧‍👦', category: '🛒' },
      { ...offers[1], name: '<:source_brand:1535690966911025262>', category: 'AI' },
    ] } });
    verified(payload);
    const menus = payload.components.filter(node => node.type === 1).flatMap(node => node.components).filter(node => node.type === 3);
    expect(menus.every(menu => menu.options.every(option => option.label.trim().length > 0))).toBe(true);
    expect(menus.flatMap(menu => menu.options).filter(option => option.value.startsWith('cdkvietnam:'))
      .every(option => option.label === 'Sản phẩm AutoBuy')).toBe(true);
  });
  it('preserves protocol fields, links, files and authored literal spans exactly', () => {
    const attachment = { attachment: Buffer.from('private bytes'), name: 'owned.png' };
    const literal = '`password:<:old:1999999999999999999>` https://example.com/:secret:';
    const payload = { components: [{ type: 10, content: literal }, { type: 1, components: [
      { type: 2, style: 1, label: 'Mở đơn', custom_id: `supplier-autobuy:order:${user}:CN_123456` },
    ] }], files: [attachment], allowedMentions: { parse: [] } };
    const result = withUniqueCustomEmoji(payload, { guildId });
    expect(result.components[0].content).toBe(literal);
    expect(result.components[1].components[0].custom_id).toBe(payload.components[1].components[0].custom_id);
    expect(result.files[0]).toBe(attachment);
  });
  it('keeps controls usable and reports missing artwork instead of introducing Unicode icons', () => {
    application.clear(); global.discordClient.guilds.cache.get(guildId).emojis.cache.clear();
    const payload = buildSupplierCatalogView({ customerId: user, catalog: { offers } });
    const result = collect(payload);
    expect(result.ids).toEqual([]);
    expect(result.strings.join('\n')).toContain('Bộ emoji custom đang đồng bộ');
    expect(result.controls).toContain(`supplier-autobuy:select:${user}`);
    expect(JSON.stringify(payload)).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
