import { describe, expect, it, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
vi.mock('../src/database/db.js', () => ({ db: { prepare: () => { throw new Error('No database in presentation test'); } } }));
vi.mock('../src/utils/emojiHelper.js', () => ({
  createEmojiResolver: () => { const E = name => '<:' + name + ':1382729296724099132>'; E.component = name => ({ id: '1382729296724099132', name }); return E; },
  withButtonEmoji: (button, emoji) => button.setEmoji({ name: emoji.match(/^<:(\w+):/)?.[1] || 'test', id: '1382729296724099132' }),
}));
import { buildSupplierCatalogView, buildSupplierQuoteView, buildSupplierOrderView, buildSupplierOrderListView, buildSupplierAutobuyPanel, buildSupplierAutobuyReply } from '../src/services/supplierAutobuyPanelService.js';
const user = '111111111111111111';
const quoteId = 'b9d30c1d-cb9a-4321-95dc-2994ac587ac1';
const productKey = 'desc_12345678-abcd-abcd-abcd-123456789012';
const quote = { quoteId, productKey, productName: 'Capcut Pro 30 Ngày', quantity: 1, unitPriceVnd: 55000, totalPriceVnd: 55000, termLabel: '30 ngày', warrantyLabel: 'Bảo hành 30 ngày', accountForm: 'Tài khoản cấp sẵn', expiresAt: '2026-11-10T17:00:00Z' };
const offer = (index, patch = {}) => ({ productKey: 'desc_' + index, name: 'Product ' + index, priceVnd: 55000, available: true, category: index % 2 ? 'AI' : 'Tiện ích', termLabel: '1 tháng', warrantyLabel: 'Bảo hành full', ...patch });
const asJson = payload => JSON.parse(JSON.stringify(payload));
function nodes(payload) { const all = []; const visit = value => { if (!value || typeof value !== 'object') return; all.push(value); if (Array.isArray(value.components)) value.components.forEach(visit); }; asJson(payload).components.forEach(visit); return all; }
function ids(payload) { return nodes(payload).map(node => node.custom_id).filter(Boolean); }

describe('supplier autobuy commerce presentation', () => {
  it('paginates real offers without publishing supplier costs or unavailable rows', () => {
    const offers = Array.from({ length: 20 }, (_, index) => offer(index));
    offers.push(offer(99, { available: false }), offer(98, { priceVnd: 0 }));
    const payload = buildSupplierCatalogView({ customerId: user, catalog: { offers, wallet: 1234567 }, page: 0 });
    const menu = nodes(payload).find(node => node.custom_id === 'supplier-autobuy:select:' + user);
    expect(menu.options).toHaveLength(8);
    expect(ids(payload)).toContain('supplier-autobuy:page:' + user + ':0:1');
    expect(JSON.stringify(payload)).not.toMatch(/1234567|Product 99|Product 98|unitCostVnd/);
    expect(payload.flags & MessageFlags.Ephemeral).toBeTruthy();
    expect(payload.allowedMentions.parse).toEqual([]);
  });
  it('uses bounded category choices and clamps stale page/category indexes', () => {
    const payload = buildSupplierCatalogView({ customerId: user, catalog: { offers: Array.from({ length: 100 }, (_, index) => offer(index, { category: 'Category ' + index })) }, page: 9999, category: 9999 });
    expect(nodes(payload).find(node => node.custom_id === 'supplier-autobuy:category:' + user).options).toHaveLength(25);
    expect(nodes(payload).find(node => node.custom_id === 'supplier-autobuy:select:' + user).options.length).toBeLessThanOrEqual(8);
    expect(nodes(payload).every(node => !node.custom_id || node.custom_id.length <= 100)).toBe(true);
  });
  it('offers category filtering and no empty menu when no sellable offers remain', () => {
    const payload = buildSupplierCatalogView({ customerId: user, catalog: { offers: [offer(1), offer(2)] }, category: 1 });
    const select = nodes(payload).find(node => node.custom_id === 'supplier-autobuy:select:' + user);
    expect(select.options).toHaveLength(1);
    const empty = buildSupplierCatalogView({ customerId: user, catalog: { offers: [offer(0, { available: false })] } });
    expect(nodes(empty).filter(node => node.type === 3)).toHaveLength(0);
    expect(JSON.stringify(empty)).toContain('Chưa có gói');
  });
  it('neutralizes Markdown and mention-like supplier names, while using sourced custom emoji', () => {
    const payload = buildSupplierQuoteView({ quote: { ...quote, productName: '@everyone **unsafe** [link]', accountForm: '@here link' }, customerId: user });
    const text = JSON.stringify(payload);
    expect(text).not.toContain('@everyone');
    expect(text).not.toContain('@here');
    expect(text).toContain('＠everyone');
    expect(text).toContain('icon_duration');
    expect(text).not.toMatch(/💰|🛒|🔑|⚠/);
    expect(ids(payload)).toContain('supplier-autobuy:confirm:' + user + ':' + quoteId);
    expect(ids(payload).some(id => id.includes(':editprice:'))).toBe(false);
    expect(ids(buildSupplierQuoteView({ quote, customerId: user, manager: true })).some(id => id.includes(':editprice:'))).toBe(true);
  });
  it('never renders quoted import costs or unrelated sensitive fields', () => {
    const payload = buildSupplierQuoteView({ quote: { ...quote, unitCostVnd: 665544, balance: 999888, token: 'private-api-secret' }, customerId: user });
    expect(JSON.stringify(payload)).not.toMatch(/665544|999888|private-api-secret/);
    expect(JSON.stringify(payload)).toContain('55.000đ');
    expect(JSON.stringify(payload)).toContain('Bảo hành 30 ngày');
  });
  it('renders all payment controls within one Discord action-row budget and allows only PayOS links', () => {
    const order = { orderCode: 'CN_123456', productName: 'Capcut', totalPriceVnd: 55000, paymentStatus: 'UNPAID', status: 'PENDING_PAYMENT' };
    const payload = buildSupplierOrderView({ order, customerId: user, payment: { checkoutUrl: 'https://pay.payos.vn/web/safe' } });
    expect(nodes(payload).filter(node => node.type === 1).every(node => node.components.length <= 5)).toBe(true);
    expect(nodes(payload).some(node => node.url === 'https://pay.payos.vn/web/safe')).toBe(true);
    expect(ids(payload)).toContain('supplier-autobuy:pay:' + user + ':CN_123456:wallet');
    expect(nodes(buildSupplierOrderView({ order, customerId: user, payment: { checkoutUrl: 'https://attacker.invalid' } })).some(node => node.url)).toBe(false);
    expect(nodes(buildSupplierOrderView({ order, customerId: user, payment: { checkoutUrl: 'https://user:pass@pay.payos.vn/web/id' } })).some(node => node.url)).toBe(false);
  });
  it('hides debit controls for paid/terminal orders but retains private receipt retrieval', () => {
    for (const status of ['COMPLETED', 'REFUNDED', 'CANCELLED']) {
      const payload = buildSupplierOrderView({ order: { orderCode: 'CN_123456', totalPriceVnd: 55000, status }, customerId: user });
      expect(ids(payload).some(id => id.includes(':pay:'))).toBe(false);
    }
    const paid = buildSupplierOrderView({ order: { orderCode: 'CN_123456', paymentStatus: 'PAID', status: 'PROCESSING' }, customerId: user });
    expect(ids(paid).some(id => id.includes(':pay:'))).toBe(false);
    expect(ids(paid)).toContain('supplier-autobuy:delivery:' + user + ':CN_123456');
  });
  it('shows paid unknown/review delivery states and never overrides terminal/refunded status', () => {
    const order = { orderCode: 'CN_123456', paymentStatus: 'PAID', status: 'PROCESSING', deliveryStatus: 'UNKNOWN' };
    expect(JSON.stringify(buildSupplierOrderView({ order, customerId: user }))).toContain('Đang đối soát với nguồn');
    expect(JSON.stringify(buildSupplierOrderView({ order: { ...order, status: 'REFUNDED', deliveryStatus: 'DELIVERED' }, customerId: user }))).toContain('Đã hoàn tiền');
    const many = buildSupplierOrderListView({ orders: Array.from({ length: 10 }, (_, index) => ({ ...order, orderCode: 'CN_' + (123456 + index), productName: '*'.repeat(500) })), customerId: user });
    expect(nodes(many).filter(node => node.type === 10).every(node => node.content.length <= 4000)).toBe(true);
  });
  it('bounds MyOrders and preserves a retrieval entry even while new sales pause', () => {
    const orders = Array.from({ length: 30 }, (_, index) => ({ orderCode: 'CN_' + (123456 + index), productName: 'Gói test', totalAmount: 55000 }));
    const payload = buildSupplierOrderListView({ orders, customerId: user });
    expect(nodes(payload).find(node => node.custom_id?.includes(':orderselect:')).options).toHaveLength(10);
    const status = buildSupplierAutobuyReply({ snapshot: { purchasesEnabled: false }, action: 'status', customerId: user });
    expect(ids(status)).toContain('supplier-autobuy:orders:' + user);
  });
  it('retains exactly two public custom IDs when sales become active', () => {
    const payload = buildSupplierAutobuyPanel({ snapshot: { status: 'CONNECTED', purchasesEnabled: true }, supportChannelId: '1514607020098191393' });
    expect(ids(payload)).toEqual(['supplier-autobuy:catalog', 'supplier-autobuy:status']);
    expect(JSON.stringify(payload)).toContain('Chọn gói');
    expect(JSON.stringify(payload)).not.toContain('chưa nhận thanh toán');
    expect(payload.flags & MessageFlags.SuppressNotifications).toBeTruthy();
  });
  it('rejects missing customer scope and malformed order identities', () => {
    expect(() => buildSupplierCatalogView({ customerId: 'anonymous' })).toThrow();
    expect(() => buildSupplierQuoteView({ quote, customerId: '' })).toThrow();
    expect(() => buildSupplierOrderView({ customerId: user, order: { orderCode: '@everyone' } })).toThrow();
  });
});
