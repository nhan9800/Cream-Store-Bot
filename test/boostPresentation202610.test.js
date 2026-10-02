import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MessageFlags } from 'discord.js';

vi.hoisted(() => Object.assign(process.env, {
  ENV_FILE: '.env.boost-presentation-not-present',
  DATABASE_PATH: `./data/test-boost-presentation-${process.pid}-${Date.now()}.sqlite`,
}));
vi.mock('../src/utils/emojiHelper.js', () => {
  const emoji = (slot) => `<:cenar_ui26_${slot}:1554444444444444444>`;
  emoji.component = (slot) => ({ id: '1554444444444444444', name: `cenar_ui26_${slot}` });
  return { createEmojiResolver: () => emoji, withButtonEmoji: (button, icon) => icon ? button.setEmoji(icon) : button };
});

import { db, initDatabase } from '../src/database/db.js';
import {
  buildBoostLogPayload, buildBoostOrderDetailEmbed, buildBoostOrderDetailPayload,
  buildBoostLiveStatusPayload, buildBoostPanelPayload, createBoostPaymentPayload,
} from '../src/services/boostServerService.js';
import { buildHistoricalBoostLogPayload } from '../src/services/boostPresentationService.js';

beforeAll(() => initDatabase());
afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${process.env.DATABASE_PATH}${suffix}`, { force: true });
});

const order = Object.freeze({
  order_code: 'BST_000001', guild_id: '1282637033340403754', customer_id: '1555555555555555555',
  package: '14x Boost Server · 3 Tháng', amount: 320000, status: 'PENDING', payment_status: 'UNPAID',
  server_id: '1666666666666666666', server_name: 'Máy chủ của khách', server_link: 'https://discord.gg/example',
  created_at: '2026-10-02T12:00:00Z', updated_at: '2026-10-02T12:30:00Z',
  note: 'staff-only-payment-reference', customer_status_note: 'Đơn đang chờ thanh toán.',
  access_key_encrypted: 'never-expose-ciphertext', payment_checkout_url: 'https://pay.payos.vn/example-test-link',
  payment_qr_code: 'test-payOS-QR-data',
});

function components(payload) {
  const collect = (items) => items.flatMap((item) => [item, ...collect(item.components || [])]);
  return collect(payload.components.map((item) => item.toJSON?.() || item));
}
const text = (payload) => components(payload).filter((item) => item.type === 10).map((item) => item.content).join('\n');
const ids = (payload) => components(payload).filter((item) => item.custom_id).map((item) => item.custom_id);

describe('Boost readable Components V2 presentation', () => {
  it('separates payment from service status without claiming an unpaid order is active', () => {
    const unpaid = buildBoostOrderDetailPayload(order);
    expect(text(unpaid)).toContain('Chờ thanh toán');
    expect(text(unpaid)).not.toContain('Đang Boost Live');
    const paid = buildBoostOrderDetailPayload({ ...order, payment_status: 'PAID' });
    expect(text(paid)).toContain('Đã thanh toán · đang xử lý');
    expect(text(paid)).not.toContain('Đang Boost Live');
    expect(ids(paid)).not.toContain('boost:activate:BST_000001');
    expect(ids(paid)).not.toContain('boost:cancel:BST_000001');
    expect(ids(buildBoostOrderDetailPayload({ ...order, payment_status: 'PAID' }, true))).toContain('boost:activate:BST_000001');
  });

  it('keeps financial values, server links and customer privacy in the grouped cards', () => {
    const customer = buildBoostOrderDetailPayload(order);
    const rendered = text(customer);
    expect(rendered).toContain('BST_000001');
    expect(rendered).toContain('320.000đ');
    expect(rendered).toContain('14x Boost Server · 3 Tháng');
    expect(rendered).toContain('https://discord.gg/example');
    expect(rendered).toContain('Đơn đang chờ thanh toán.');
    expect(rendered).not.toMatch(/staff-only-payment-reference|never-expose-ciphertext/);
    expect(text(buildBoostOrderDetailPayload(order, true))).toContain('staff-only-payment-reference');
    expect(customer.allowedMentions).toMatchObject({ parse: [], users: [], roles: [] });
  });

  it('preserves active live refresh and warranty actions while keeping staff management separate', () => {
    const active = { ...order, status: 'ACTIVE', payment_status: 'PAID', boost_expires_at: '2027-01-02T12:00:00Z' };
    expect(ids(buildBoostLiveStatusPayload(active, order.guild_id))).toEqual([
      'boost:live:BST_000001', 'boost:warranty_req:BST_000001',
    ]);
    expect(ids(buildBoostLiveStatusPayload(active, order.guild_id, { isStaff: true }))).toContain('boost:manage:BST_000001');
    expect(text(buildBoostLiveStatusPayload(active, order.guild_id))).not.toContain('Đã được PayOS xác nhận');
  });

  it('never offers a new QR or old PayOS link for cancelled/refunded orders, while staff can still inspect and refresh', async () => {
    for (const status of ['CANCELLED', 'REFUNDED']) {
      for (const payment_checkout_url of [order.payment_checkout_url, null]) {
        const closed = { ...order, status, payment_checkout_url };
        const customer = buildBoostOrderDetailPayload(closed);
        const staff = buildBoostOrderDetailPayload(closed, true);
        for (const payload of [customer, staff]) {
          expect(ids(payload)).not.toContain('boost:payment:BST_000001');
          expect(components(payload).some((item) => item.url === order.payment_checkout_url)).toBe(false);
        }
        await expect(createBoostPaymentPayload(closed, order.guild_id)).rejects.toThrow('không thể tạo thanh toán');
        expect(buildBoostOrderDetailEmbed(closed).toJSON().fields.some((field) => field.value.includes(order.payment_checkout_url))).toBe(false);
        expect(ids(staff)).toEqual(['boost:manage:BST_000001']);
        expect(ids(buildBoostLiveStatusPayload(closed, order.guild_id, { isStaff: true }))).toEqual([
          'boost:live:BST_000001', 'boost:manage:BST_000001',
        ]);
      }
    }
  });

  it.each(['PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'WARRANTY'])('keeps %s logs and controls within Discord budgets', (status) => {
    const payload = buildBoostLogPayload({ ...order, status, payment_status: 'PAID' }, order.guild_id, 'Cập nhật gốc', '1777777777777777777');
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(text(payload)).toContain('[BOOST LOG] Cập nhật gốc');
    expect(text(payload)).toContain('320.000đ');
    expect(text(payload)).not.toContain('never-expose-ciphertext');
    expect(text(payload).length).toBeLessThanOrEqual(4000);
    expect(components(payload).length).toBeLessThanOrEqual(40);
    expect(ids(payload)).toContain('boost:manage:BST_000001');
    if (status === 'PENDING') expect(ids(payload)).toContain('boost:activate:BST_000001');
    if (['ACTIVE', 'WARRANTY'].includes(status)) expect(ids(payload)).toContain('boost:complete:BST_000001');
    if (['CANCELLED', 'COMPLETED'].includes(status)) expect(ids(payload)).toEqual(['boost:manage:BST_000001']);
  });

  it('renders the existing cached invoice QR and URL without creating or changing payment data', async () => {
    const before = { ...order };
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('A cached invoice must not call PayOS'); });
    try {
      const payload = await createBoostPaymentPayload(order, order.guild_id);
      expect(order).toEqual(before);
      expect(spy).not.toHaveBeenCalled();
      expect(text(payload)).toContain('320.000đ');
      expect(payload.files[0].name).toBe('boost-payos-BST_000001.png');
      expect(payload.files[0].attachment.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
      expect(components(payload).some((item) => item.url === order.payment_checkout_url)).toBe(true);
    } finally { spy.mockRestore(); }
  });

  it('keeps the official public panel prices and its four existing entry actions', () => {
    const panel = buildBoostPanelPayload(order.guild_id);
    expect(text(panel)).toContain('120.000đ');
    expect(text(panel)).toContain('320.000đ');
    expect(ids(panel)).toEqual(['boost:buy', 'boost:key', 'boost:check', 'boost:warranty']);
    expect(buildBoostOrderDetailEmbed(order).toJSON().fields.find((field) => /Thanh toán/.test(field.name)).value).toContain('Chờ thanh toán');
  });

  it('shows complete live-list rows and a truthful count instead of overflowing Discord with long server names', () => {
    const activeOrders = Array.from({ length: 25 }, (_, index) => ({
      ...order, status: 'ACTIVE', server_name: `Server ${index} ${'x'.repeat(95)}`, boost_expires_at: '2027-01-02T12:00:00Z',
    }));
    const panel = buildBoostPanelPayload(order.guild_id, { activeOrders });
    expect(text(panel)).toContain('25 đơn đang theo dõi');
    expect(text(panel).length).toBeLessThanOrEqual(4000);
    expect(components(panel).length).toBeLessThanOrEqual(40);
  });
});

describe('historical boost event recomposition', () => {
  it('preserves original status, action, amounts, actor, time, color and disabled button IDs', () => {
    const fields = [
      { name: 'Mã đơn', value: '`BST_000001`' }, { name: 'Trạng thái', value: 'Chờ xử lý' },
      { name: 'Thanh toán', value: 'Chờ thanh toán' }, { name: 'Khách', value: '<@1555555555555555555>' },
      { name: 'Số tiền', value: '320.000đ' }, { name: 'Ghi chú', value: 'Lịch sử gốc, giữ nguyên\nhai dòng.' },
    ];
    const original = { title: '[BOOST LOG] Đơn mới tạo', fields, color: 0xFEE75C,
      footer: { text: 'Cenar Store · Boost Server' }, timestamp: '2026-10-01T12:00:00.000Z' };
    const actionRows = [{ type: 1, components: [{ type: 2, custom_id: 'boost:manage:BST_000001', label: 'Cập Nhật Live', style: 2, disabled: true }] }];
    const payload = buildHistoricalBoostLogPayload(original, { components: actionRows });
    expect(payload).not.toBeNull();
    for (const field of fields) expect(text(payload)).toContain(field.value);
    expect(text(payload)).toContain(original.title);
    expect(text(payload)).toContain('<t:1790856000:F>');
    expect(payload.components[0].toJSON().accent_color).toBe(original.color);
    expect(payload.components.at(-1)).toEqual(actionRows[0]);
    expect(original).toEqual({ title: '[BOOST LOG] Đơn mới tạo', fields, color: 0xFEE75C,
      footer: { text: 'Cenar Store · Boost Server' }, timestamp: '2026-10-01T12:00:00.000Z' });
  });

  it('returns unsupported or oversized snapshots for conservative emoji-only repair', () => {
    expect(buildHistoricalBoostLogPayload({ title: 'log', image: { url: 'https://example.com/original.png' } })).toBeNull();
    expect(buildHistoricalBoostLogPayload({ title: 'log', fields: [{ name: 'note', value: 'x'.repeat(5000) }] })).toBeNull();
  });
});
