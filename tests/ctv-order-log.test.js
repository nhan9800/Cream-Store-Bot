import { describe, expect, test } from 'vitest';
import {
  buildCtvOrderLogPayload,
  ctvOrderLogNeedsSync,
  getCtvOrderDisplayState,
} from '../src/services/ctvOrderLogService.js';

const baseOrder = {
  order_code: 'CN_349871',
  guild_id: '1282637033340403754',
  customer_id: '1273801433145147555',
  product_name: 'ChatGPT 1 tháng',
  total_amount: 180000,
  duration_months: 1,
  duration_days: null,
  ticket_channel_id: '1540220650348609536',
};

describe('CTV order log synchronization', () => {
  test('shows paid and processing independently after payment confirmation', () => {
    const order = { ...baseOrder, payment_status: 'PAID', status: 'PROCESSING' };
    const state = getCtvOrderDisplayState(order);
    const payload = buildCtvOrderLogPayload(order, new Date('2026-08-21T08:45:51Z'));
    const rendered = JSON.stringify(payload);

    expect(state).toMatchObject({
      paymentLabel: 'ĐÃ THANH TOÁN',
      orderLabel: 'ĐANG XỬ LÝ',
      paid: true,
    });
    expect(rendered).toContain('Đơn CTV · Đã thanh toán');
    expect(rendered).toContain('**Thanh toán:** ĐÃ THANH TOÁN `PAID`');
    expect(rendered).toContain('**Xử lý:** ĐANG XỬ LÝ `PROCESSING`');
    expect(rendered).not.toContain('**Trạng thái:** PENDING_PAYMENT');
    expect(ctvOrderLogNeedsSync({ components: payload.components }, order)).toBe(false);
    expect(ctvOrderLogNeedsSync({
      content: '**Trạng thái:** PENDING_PAYMENT',
      components: [],
    }, order)).toBe(true);
  });

  test('keeps a genuinely unpaid order in the waiting state', () => {
    const state = getCtvOrderDisplayState({
      ...baseOrder,
      payment_status: 'UNPAID',
      status: 'PENDING_PAYMENT',
    });

    expect(state).toMatchObject({
      paymentLabel: 'CHƯA THANH TOÁN',
      orderLabel: 'CHỜ THANH TOÁN',
      paid: false,
    });
  });
});
