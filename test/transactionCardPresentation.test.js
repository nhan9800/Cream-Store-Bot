import { afterEach, describe, expect, it, vi } from 'vitest';
import { ButtonStyle, MessageFlags } from 'discord.js';

const { emojiForSlot } = vi.hoisted(() => {
  const ids = new Map();
  return {
    emojiForSlot: (slot) => {
      if (!ids.has(slot)) ids.set(slot, String(1559000000000000000n + BigInt(ids.size)));
      return `<:test_${slot}:${ids.get(slot)}>`;
    },
  };
});

vi.mock('../src/services/emojiService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getEmoji: vi.fn((_guildId, slot) => emojiForSlot(slot)),
}));

const { config } = await import('../src/config.js');
const {
  buildOrderCreatedV2,
  buildPaymentQrV2,
  buildPaymentSuccessDmEmbed,
  buildPaymentSuccessEmbed,
  buildQueuePositionV2,
} = await import('../src/utils/embeds.js');

const order = Object.freeze({
  guild_id: '1282637033340403754',
  customer_id: '123456789012345678',
  order_code: 'CN_388645',
  payment_code: 'CN388645',
  product_name: 'Nitro Boost Login 2 Tháng',
  quantity: 1,
  duration_months: 2,
  total_amount: 115000,
  amount_paid: 115000,
  status: 'PENDING_PAYMENT',
  created_at: '2026-11-08T16:20:00.000Z',
  payment_expired_at: '2026-11-08T17:20:00.000Z',
  payment_confirmed_at: '2026-11-08T16:26:00.000Z',
});
const previousPaymentImage = config.paymentImageUrl;
afterEach(() => { config.paymentImageUrl = previousPaymentImage; });

function cardContent(payload) {
  const container = payload.container || payload.components[0];
  return container.toJSON().components
    .filter((component) => component.type === 10)
    .map((component) => component.content)
    .join('\n');
}

function expectCustomOnly(payload) {
  const content = cardContent(payload);
  expect(content).not.toMatch(/[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u);
  const ids = [...content.matchAll(/<a?:[a-zA-Z0-9_]+:(\d+)>/g)].map((match) => match[1]);
  expect(ids.length).toBeGreaterThan(3);
  // Each field and heading has its own meaning instead of reusing one badge.
  expect(new Set(ids).size).toBe(ids.length);
  expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
  expect(content.length).toBeLessThan(4000);
  return content;
}

function expectTimestamp(content, value) {
  expect(content).toContain(`<t:${Math.floor(new Date(value).getTime() / 1000)}:R>`);
}

describe('transaction card presentation contracts', () => {
  it('keeps order identity, price, duration, status, tracking and cancellation intact', () => {
    const payload = buildOrderCreatedV2(order, '1514607026247045121');
    const content = expectCustomOnly(payload);
    expect(content).toContain('<@123456789012345678>');
    expect(content).toContain('CN_388645');
    expect(content).toContain('x1 Nitro Boost Login 2 Tháng');
    expect(content).toContain('2 tháng');
    expect(content).toContain('115.000 VND');
    expect(content).toContain('CHỜ THANH TOÁN');
    expect(content).toContain('<#1514607026247045121>');
    expectTimestamp(content, order.created_at);
    expect(payload.actionRow.toJSON().components).toMatchObject([{
      custom_id: 'order:cancel:CN_388645', style: ButtonStyle.Danger,
      emoji: { name: 'test_order_cancel' },
    }]);
  });

  it('keeps free-order instructions and authoritative product text without guessing a catalog label', () => {
    const content = cardContent(buildOrderCreatedV2({
      ...order, total_amount: 0, product_name: 'nichu2m', status: 'PROCESSING',
    }, '1514607026247045121'));
    expect(content).toContain('x1 nichu2m');
    expect(content).toContain('Miễn phí');
    expect(content).toContain('ĐANG XỬ LÝ');
    expect(content).not.toContain('115.000');
    expect(content).not.toContain('Chọn **phương thức thanh toán**');
  });

  it('shows one queue group and preserves both customer and staff controls', () => {
    const payload = buildQueuePositionV2(order, 5, 8);
    const content = expectCustomOnly(payload);
    expect(content).toContain('**5 / 8**');
    expect(content).toContain('CN_388645');
    expect(content.match(/nitro boost login 2 thang/g)).toHaveLength(1);
    expect(payload.actionRow.toJSON().components).toMatchObject([
      { custom_id: 'queue:view:CN_388645', style: ButtonStyle.Primary, emoji: { name: 'test_queue_view' } },
      { custom_id: 'order:claim:CN_388645', style: ButtonStyle.Secondary, emoji: { name: 'test_ticket_claim' } },
    ]);
  });

  it('keeps QR media, checkout URL, reference, expiry and invoice controls unchanged', () => {
    const checkoutUrl = 'https://pay.payos.vn/web/example-link?reference=CN388645';
    const payload = buildPaymentQrV2({ order, hasImage: true, attachmentName: 'invoice-CN388645.png', checkoutUrl });
    const content = expectCustomOnly(payload);
    expect(content).toContain('<@123456789012345678>');
    expect(content).toContain('CN_388645');
    expect(content).toContain('`CN388645`');
    expect(content).toContain('x1 Nitro Boost Login 2 Tháng');
    expect(content).toContain('115.000 VND');
    expectTimestamp(content, order.payment_expired_at);
    expect(payload.container.toJSON().components.find((item) => item.type === 12).items).toMatchObject([
      { media: { url: 'attachment://invoice-CN388645.png' } },
    ]);
    expect(payload.actionRow.toJSON().components).toMatchObject([
      { url: checkoutUrl, style: ButtonStyle.Link, emoji: { name: 'test_payment_checkout' } },
      { custom_id: 'payment:regen:CN_388645', emoji: { name: 'test_payment_regenerate' } },
      { custom_id: 'queue:view:CN_388645', emoji: { name: 'test_queue_view' } },
    ]);
  });

  it('does not create media or a checkout link when the caller did not supply them', () => {
    const payload = buildPaymentQrV2({ order });
    expect(payload.container.toJSON().components.some((item) => item.type === 12)).toBe(false);
    expect(payload.actionRow.toJSON().components.map((item) => item.custom_id)).toEqual([
      'payment:regen:CN_388645', 'queue:view:CN_388645',
    ]);
  });

  it('keeps confirmed amount overrides, transaction reference, receipt media and customer mentions', () => {
    config.paymentImageUrl = 'https://cdn.example.com/receipt-banner.png';
    const payload = buildPaymentSuccessEmbed(order, '115.000 VND (đã đối soát)', 'FT26313-CN388645');
    const content = expectCustomOnly(payload);
    expect(content).toContain('**115.000 VND (đã đối soát)**');
    expect(content).toContain('`FT26313-CN388645`');
    expect(content).toContain('`CN_388645`');
    expect(content).toContain('x1 Nitro Boost Login 2 Tháng');
    expectTimestamp(content, order.payment_confirmed_at);
    expect(payload.allowedMentions).toEqual({ users: [order.customer_id] });
    expect(payload.components[0].toJSON().components.find((item) => item.type === 12).items).toMatchObject([
      { media: { url: config.paymentImageUrl } },
    ]);
  });

  it('preserves international payment text and omits absent transaction references', () => {
    const internationalOrder = { ...order, guild_id: '1070676180103086132' };
    const qr = buildPaymentQrV2({ order: internationalOrder });
    expect(expectCustomOnly(qr)).toContain('SECURE BANK CHECKOUT');
    expect(cardContent(qr)).toContain('provider confirms payment');
    const receipt = buildPaymentSuccessEmbed(internationalOrder);
    const content = expectCustomOnly(receipt);
    expect(content).toContain('PAYMENT CONFIRMED');
    expect(content).toContain('Received:');
    expect(content).not.toContain('Transaction:');
    expect(receipt.allowedMentions).toEqual({ users: [order.customer_id] });
  });

  it('keeps the DM receipt amount and confirmation time aligned with the public receipt', () => {
    const description = buildPaymentSuccessDmEmbed(order).toJSON().description;
    expect(description).toContain('115.000 VND');
    expect(description).toContain('CN_388645');
    expect(description).toContain('x1 Nitro Boost Login 2 Tháng');
    expect(description).toContain(emojiForSlot('payment_received'));
    expectTimestamp(description, order.payment_confirmed_at);
  });
});
