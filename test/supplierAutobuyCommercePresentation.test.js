import { describe, expect, it, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import QRCode from 'qrcode';
// Layout/payment fixtures use symbolic artwork; real inventory and the final
// REST boundary are covered by supplierAutobuyUniqueEmoji.test.js.
vi.mock('../src/utils/uniqueCustomEmoji.js', async importOriginal => ({
  ...await importOriginal(), withUniqueCustomEmoji: payload => JSON.parse(JSON.stringify(payload)),
}));
vi.mock('../src/database/db.js', () => ({ db: { prepare: () => { throw new Error('No database in presentation test'); } } }));
vi.mock('../src/utils/emojiHelper.js', () => ({
  createEmojiResolver: () => { const E = name => '<:' + name + ':1382729296724099132>'; E.component = name => ({ id: '1382729296724099132', name }); return E; },
  withButtonEmoji: (button, emoji) => button.setEmoji({ name: emoji.match(/^<:(\w+):/)?.[1] || 'test', id: '1382729296724099132' }),
}));
import { buildSupplierCatalogView, buildSupplierQuoteView, buildSupplierOrderView, buildSupplierPaymentView, buildSupplierOrderListView, buildSupplierAutobuyPanel, buildSupplierAutobuyReply, hasSupplierPrepayDisclosure } from '../src/services/supplierAutobuyPanelService.js';
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
  it('keeps CDK provider identities in offers and encodes only product arguments in controls', () => {
    const key = 'cdkvietnam:6';
    const catalog = buildSupplierCatalogView({ customerId: user, catalog: { offers: [offer(6, { productKey: key })] } });
    expect(nodes(catalog).find(node => node.custom_id === 'supplier-autobuy:select:' + user).options[0].value).toBe(key);
    const card = buildSupplierQuoteView({ quote: { ...quote, productKey: key }, customerId: user, manager: true });
    expect(ids(card)).toContain(`supplier-autobuy:qty:${user}:cdkvietnam%3A6`);
    expect(ids(card)).toContain(`supplier-autobuy:editprice:${user}:cdkvietnam%3A6`);
    expect(ids(card).every(id => id.length <= 100)).toBe(true);
    for (const invalid of ['other:6', 'cdkvietnam:0', 'cdkvietnam:01', 'cdkvietnam:9007199254740992']) {
      expect(() => buildSupplierQuoteView({ quote: { ...quote, productKey: invalid }, customerId: user })).toThrow('INVALID_QUOTE');
    }
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
  it('keeps the selected category stable when a new group sorts before it', () => {
    const original = [offer(1, { category: 'AI', name: 'AI package' }),
      ...Array.from({ length: 10 }, (_, index) => offer(100 + index, { category: 'Z Creative', name: `Z package ${index}` }))];
    const initial = buildSupplierCatalogView({ customerId: user, catalog: { offers: original } });
    const selected = nodes(initial).find(node => node.custom_id === 'supplier-autobuy:category:' + user)
      .options.find(option => option.label === 'Z Creative').value;
    const refreshed = buildSupplierCatalogView({ customerId: user, category: /^\d+$/.test(selected) ? Number(selected) : selected,
      catalog: { offers: [...original, offer(200, { category: 'Business', name: 'Business package' })] } });
    expect(nodes(refreshed).find(node => node.custom_id === 'supplier-autobuy:select:' + user).options
      .every(option => option.label.startsWith('Z package'))).toBe(true);
  });
  it('shows an explicit category reset when a selected group disappears', () => {
    const original = [offer(1, { category: 'AI' }), offer(2, { category: 'Z Creative' })];
    const initial = buildSupplierCatalogView({ customerId: user, catalog: { offers: original } });
    const selected = nodes(initial).find(node => node.custom_id === 'supplier-autobuy:category:' + user)
      .options.find(option => option.label === 'Z Creative').value;
    const refreshed = buildSupplierCatalogView({ customerId: user, category: /^\d+$/.test(selected) ? Number(selected) : selected,
      catalog: { offers: [original[0], offer(200, { category: 'Business', name: 'Business package' })] } });
    expect(nodes(refreshed).some(node => node.custom_id === 'supplier-autobuy:select:' + user)).toBe(false);
    expect(ids(refreshed)).toContain(`supplier-autobuy:page:${user}:0:0`);
    expect(JSON.stringify(refreshed.components)).toContain('Nhóm vừa chọn');
  });
  it('retains a selected category even after it moves outside the first twenty-four menu groups', () => {
    const original = [offer(1, { category: 'AI' }), offer(2, { category: 'Z Creative', name: 'Selected creative package' })];
    const initial = buildSupplierCatalogView({ customerId: user, catalog: { offers: original } });
    const selected = nodes(initial).find(node => node.custom_id === 'supplier-autobuy:category:' + user)
      .options.find(option => option.label === 'Z Creative').value;
    const payload = buildSupplierCatalogView({ customerId: user, category: selected,
      catalog: { offers: [...original, ...Array.from({ length: 30 }, (_, index) => offer(100 + index, { category: 'Category ' + index }))] } });
    const menu = nodes(payload).find(node => node.custom_id === 'supplier-autobuy:category:' + user);
    expect(menu.options).toHaveLength(25);
    expect(menu.options.find(option => option.value === selected)).toMatchObject({ label: 'Z Creative', default: true });
    expect(nodes(payload).find(node => node.custom_id === 'supplier-autobuy:select:' + user).options)
      .toEqual([expect.objectContaining({ label: 'Selected creative package' })]);
    expect(ids(payload).every(id => id.length <= 100)).toBe(true);
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
  it('discloses prepaid waiting before creating an order and before either payment choice', () => {
    const pending = { orderCode: 'CN_123456', totalAmount: 55000, paymentStatus: 'UNPAID', status: 'PENDING_PAYMENT' };
    const confirmation = buildSupplierQuoteView({ quote, customerId: user });
    const payment = buildSupplierOrderView({ order: pending, customerId: user });
    for (const payload of [confirmation, payment]) {
      const text = JSON.stringify(payload.components[0]);
      expect(text).toContain('Thanh toán trước');
      expect(text).toContain('chờ shop bổ sung nguồn');
      expect(text).toContain('chỉ tiếp tục nếu bạn đồng ý chờ');
      expect(text).toContain('Hệ thống tự mua và giao khi nguồn sẵn sàng');
      expect(text).not.toMatch(/giao ngay|đảm bảo giao|số dư nguồn|providerBalance/);
      expect(nodes({ components: [payload.components[0]] }).some(node => node.custom_id)).toBe(false);
    }
    expect(ids(confirmation)).toContain('supplier-autobuy:confirm:' + user + ':' + quoteId);
    expect(ids(payment)).toContain('supplier-autobuy:pay:' + user + ':CN_123456:payos');
    expect(ids(payment)).toContain('supplier-autobuy:pay:' + user + ':CN_123456:wallet');
    expect(hasSupplierPrepayDisclosure({ components: confirmation.components })).toBe(true);
    expect(hasSupplierPrepayDisclosure({ components: asJson(payment).components })).toBe(true);
    expect(hasSupplierPrepayDisclosure({ components: [] })).toBe(false);
    expect(hasSupplierPrepayDisclosure({ components: [{ type: 10, content: '\\*\\*Thanh toán trước:\\*\\*' }] })).toBe(false);
    expect(hasSupplierPrepayDisclosure({ components: [{ toJSON() { throw new Error('unreadable'); } }] })).toBe(false);
  });
  it('labels paid orders waiting for shop funds honestly and keeps repeated-payment controls and stale QR hidden', async () => {
    const order = { orderCode: 'CN_123456', productName: 'CapCut', totalAmount: 55000, paymentStatus: 'PAID', status: 'PROCESSING',
      deliveryStatus: 'WAITING_SUPPLIER_FUNDS', providerBalance: 123456789, payment: { method: 'PAYOS', paid: false, checkoutUrl: 'https://pay.payos.vn/web/stale' } };
    const payload = await buildSupplierPaymentView({ order, customerId: user });
    const text = JSON.stringify(payload.components);
    expect(text).toContain('Đã thanh toán · Chờ shop bổ sung nguồn');
    expect(text).toContain('Hệ thống tự mua và giao khi shop bổ sung nguồn');
    expect(text).toContain('không cần thanh toán lại hoặc tạo đơn mới');
    expect(text).not.toMatch(/123456789|providerBalance|payos.vn|giao ngay/);
    expect(payload.files).toBeUndefined();
    expect(ids(payload).some(id => id.includes(':pay:'))).toBe(false);
    expect(ids(payload)).toContain('supplier-autobuy:order:' + user + ':CN_123456');
    expect(JSON.stringify(buildSupplierOrderListView({ orders: [order], customerId: user }).components)).toContain('Đã thanh toán · Chờ shop bổ sung nguồn');
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
  it('renders the exact PayOS QR material into a local PNG attachment with private native gallery, total and expiry', async () => {
    const qrCode = '00020101021238570010A00000072701270006970422011301234567890125204599953037045405550005802VN6304BEEF';
    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    const order = { orderCode: 'CN_123456', productName: 'CapCut', totalAmount: 55000, paymentStatus: 'UNPAID', status: 'PENDING_PAYMENT',
      payment: { method: 'PAYOS', paid: false, checkoutUrl: 'https://pay.payos.vn/web/safe', qrCode, expiresAt } };
    const payload = await buildSupplierPaymentView({ order, customerId: user });
    const expected = await QRCode.toBuffer(qrCode, { type: 'png', width: 720, margin: 2,
      errorCorrectionLevel: 'M', color: { dark: '#111827', light: '#FFFFFFFF' } });
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].name).toBe('payos-CN_123456.png');
    expect(payload.files[0].attachment).toEqual(expected);
    expect(payload.files[0].attachment.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(payload.files[0].attachment.readUInt32BE(16)).toBe(720);
    expect(payload.files[0].attachment.readUInt32BE(20)).toBe(720);
    expect(nodes(payload).find(node => node.type === 12).items[0].media.url).toBe('attachment://payos-CN_123456.png');
    const content = JSON.stringify(payload.components);
    expect(content).toContain('55.000đ');
    expect(content).toContain('Hạn thanh toán');
    expect(content).toContain(`<t:${Math.floor(Date.parse(expiresAt) / 1000)}:R>`);
    expect(content).not.toContain(qrCode);
    expect(payload.flags & MessageFlags.Ephemeral).toBeTruthy();
    expect(payload.allowedMentions.parse).toEqual([]);
  });
  it('uses only the safe PayOS link as local QR fallback and never requests an external QR image', async () => {
    const order = { orderCode: 'CN_123456', totalAmount: 55000, paymentStatus: 'UNPAID', status: 'PENDING_PAYMENT' };
    const external = 'https://private-data.attacker.invalid/qr?token=private';
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('External request forbidden'));
    try {
      const fallback = await buildSupplierPaymentView({ order, customerId: user,
        payment: { method: 'PAYOS', qrCode: external, checkoutUrl: 'https://pay.payos.vn/web/safe' } });
      expect(fallback.files[0].attachment).toEqual(await QRCode.toBuffer('https://pay.payos.vn/web/safe', {
        type: 'png', width: 720, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#111827', light: '#FFFFFFFF' },
      }));
      for (const checkoutUrl of [external, 'https://user:private@pay.payos.vn/web/x', 'https://pay.payos.vn:8443/x', 'http://pay.payos.vn/x']) {
        const denied = await buildSupplierPaymentView({ order, customerId: user,
          payment: { method: 'PAYOS', qrCode: '00020100000000000000000000000000' + external, checkoutUrl } });
        expect(denied.files).toBeUndefined();
        expect(nodes(denied).some(node => node.type === 12 || node.url)).toBe(false);
        expect(JSON.stringify(denied.components)).not.toMatch(/attacker|private/);
        expect(JSON.stringify(denied.components)).toContain('Chưa hiển thị được ảnh QR');
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it('never renders stale QR or checkout links after payment, cancellation, refund or expiry', async () => {
    const base = { orderCode: 'CN_123456', totalAmount: 55000, paymentStatus: 'UNPAID', status: 'PENDING_PAYMENT' };
    const payment = { method: 'PAYOS', paid: false, checkoutUrl: 'https://pay.payos.vn/web/safe' };
    for (const patch of [{ paymentStatus: 'PAID' }, { status: 'CANCELLED' }, { status: 'REFUNDED' }, { status: 'COMPLETED' }]) {
      const view = await buildSupplierPaymentView({ order: { ...base, ...patch }, customerId: user, payment });
      expect(view.files).toBeUndefined();
      expect(nodes(view).some(node => node.type === 12 || node.url)).toBe(false);
      expect(ids(view).some(id => id.includes(':pay:'))).toBe(false);
    }
    const expired = await buildSupplierPaymentView({ order: base, customerId: user, payment: { ...payment, expiresAt: '2020-01-01T00:00:00Z' } });
    expect(expired.files).toBeUndefined();
    expect(nodes(expired).some(node => node.type === 12 || node.url)).toBe(false);
    expect(ids(expired).some(id => id.includes(':pay:'))).toBe(false);
    expect(JSON.stringify(expired.components)).toContain('Hóa đơn đã hết hạn');
  });
  it('keeps the original safe invoice link usable if local QR rendering fails', async () => {
    const render = vi.spyOn(QRCode, 'toBuffer').mockRejectedValue(new Error('private-render-error'));
    try {
      const payload = await buildSupplierPaymentView({ customerId: user,
        order: { orderCode: 'CN_123456', totalAmount: 55000, paymentStatus: 'UNPAID', status: 'PENDING_PAYMENT' },
        payment: { method: 'PAYOS', paid: false, checkoutUrl: 'https://pay.payos.vn/web/existing' } });
      expect(payload.files).toBeUndefined();
      expect(nodes(payload).some(node => node.type === 12)).toBe(false);
      expect(nodes(payload).some(node => node.url === 'https://pay.payos.vn/web/existing')).toBe(true);
      expect(JSON.stringify(payload.components)).toContain('Chưa hiển thị được ảnh QR');
      expect(JSON.stringify(payload.components)).not.toContain('private-render-error');
    } finally { render.mockRestore(); }
  });
  it('discards a QR attachment when the invoice expires while the local PNG is rendering', async () => {
    let now = Date.UTC(2026, 10, 14);
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const render = vi.spyOn(QRCode, 'toBuffer').mockImplementation(async () => {
      now += 1000; return Buffer.from('89504e470d0a1a0a', 'hex');
    });
    try {
      const payload = await buildSupplierPaymentView({ customerId: user,
        order: { orderCode: 'CN_123456', totalAmount: 55000, paymentStatus: 'UNPAID', status: 'PENDING_PAYMENT' },
        payment: { method: 'PAYOS', expiresAt: new Date(now + 100).toISOString(), checkoutUrl: 'https://pay.payos.vn/web/expiring' } });
      expect(payload.files).toBeUndefined();
      expect(nodes(payload).some(node => node.type === 12 || node.url)).toBe(false);
      expect(ids(payload).some(id => id.includes(':pay:'))).toBe(false);
      expect(JSON.stringify(payload.components)).toContain('Hóa đơn đã hết hạn');
    } finally { render.mockRestore(); clock.mockRestore(); }
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
    expect(JSON.stringify(payload)).toContain('Nhận thanh toán trước');
    expect(JSON.stringify(payload)).toContain('Đơn có thể chờ shop bổ sung nguồn');
    expect(JSON.stringify(payload)).not.toContain('chưa nhận thanh toán');
    expect(payload.flags & MessageFlags.SuppressNotifications).toBeTruthy();
    const status = buildSupplierAutobuyReply({ snapshot: { status: 'CONNECTED', purchasesEnabled: true }, action: 'status', customerId: user });
    expect(JSON.stringify(status)).toContain('Nhận thanh toán trước');
    expect(JSON.stringify(status)).toContain('hệ thống tự mua và giao riêng khi nguồn sẵn sàng');
    expect(JSON.stringify(status)).toContain('status_check');
  });
  it('rejects missing customer scope and malformed order identities', () => {
    expect(() => buildSupplierCatalogView({ customerId: 'anonymous' })).toThrow();
    expect(() => buildSupplierQuoteView({ quote, customerId: '' })).toThrow();
    expect(() => buildSupplierOrderView({ customerId: user, order: { orderCode: '@everyone' } })).toThrow();
  });
});
