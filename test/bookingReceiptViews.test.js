import { MessageFlags } from 'discord.js';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBookingReceiptCard } from '../src/utils/bookingReceiptViews.js';

const now = Date.parse('2026-11-23T12:00:00Z');
const pending = { kind: 'BOOKING', status: 'PENDING', code: 'CN_012345', amount: 125_000, issuedAt: now,
  service: 'voice', startsAt: now + 3_600_000, durationMinutes: 60 };
const payment = { qrPayload: '000201SYNTHETIC-NONPAYABLE-BOOKING-TEST-FIXTURE', expiresAt: now + 900_000,
  checkoutUrl: 'https://pay.payos.vn/web/fixture-booking-invoice', transferCode: 'BK012345' };

function inspect(payload) {
  const card = payload.components[0].toJSON();
  return { text: card.components.flatMap(item => item.content || []).join('\n'),
    buttons: card.components.filter(item => item.type === 1).flatMap(row => row.components),
    image: card.components.find(item => item.type === 12)?.items[0] };
}

describe('Cenar Booking receipt cards', () => {
  beforeEach(() => vi.setSystemTime(now));
  afterEach(() => vi.useRealTimers());

  it.each([
    ['BOOKING', 'Hóa đơn đặt lịch', 'booking'], ['DEPOSIT', 'Biên nhận nạp tiền', 'nap-tien'],
    ['DONATION', 'Biên nhận ủng hộ', 'ung-ho'], ['REFUND', 'Biên nhận hoàn tiền', 'hoan-tien'],
  ])('renders a private, nonpayable %s preview with distinct original artwork', async (kind, title, name) => {
    const payload = await buildBookingReceiptCard({ ...pending, kind, status: 'PAID', preview: true, payment, description: 'private fixture' });
    const view = inspect(payload);
    expect(payload.flags).toBe(MessageFlags.Ephemeral | MessageFlags.IsComponentsV2);
    expect(payload.allowedMentions.parse).toEqual([]);
    expect(view.text).toContain(`BẢN MẪU · ${title}`);
    expect(view.text).not.toMatch(/CN_012345|private fixture|Đã xác nhận|BK012345|fixture-booking/u);
    expect(view.buttons).toEqual([]);
    expect(view.image).toMatchObject({ media: { url: `attachment://cenar-mau-${name}.png` }, description: expect.stringContaining('BẢN MẪU') });
    expect(view.image.description).not.toContain('QR');
    expect(await sharp(payload.files[0].attachment).metadata()).toMatchObject({ format: 'png', width: 840, height: 498 });
  });

  it('renders a crisp canonical PayOS QR at integer pixel sizes alongside native text and link', async () => {
    const payload = await buildBookingReceiptCard({ ...pending, payment, ephemeral: false });
    const view = inspect(payload);
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(view.text).toContain('Chờ thanh toán');
    expect(view.text).toContain('Nội dung chuyển khoản** · `BK012345`');
    expect(view.text).toContain(`Giờ bắt đầu** · <t:${(now + 3_600_000) / 1000}:f>`);
    expect(view.text).toContain('Thời lượng** · 60 phút');
    expect(view.text).toContain('125.000 VND');
    expect(view.buttons).toEqual([expect.objectContaining({ url: payment.checkoutUrl })]);
    expect(view.image.description).toContain('Có mã QR PayOS');
    const { size } = QRCode.create(payment.qrPayload, { errorCorrectionLevel: 'M' }).modules;
    const scale = Math.floor(264 / (size + 8));
    const offset = Math.floor((264 - (size + 8) * scale) / 2) + 4 * scale;
    const { data, info } = await sharp(payload.files[0].attachment).raw().toBuffer({ resolveWithObject: true });
    const rgb = (x, y) => [...data.subarray((info.width * y + x) * info.channels, (info.width * y + x) * info.channels + 3)];
    expect(rgb(499 + offset - 2, 350 + offset)).toEqual([255, 255, 255]);
    expect(rgb(499 + offset, 350 + offset)).toEqual([17, 24, 39]);
  });

  it.each([
    ['BOOKING', 'FREE', 0, 'Miễn phí'], ['BOOKING', 'PAID', 125_000, 'Đã xác nhận giao dịch QR'],
    ['BOOKING', 'NEEDS_REVIEW', 125_000, 'Cần rà soát'], ['DEPOSIT', 'PENDING', 125_000, 'Chờ ghi nhận nạp tiền'],
    ['DONATION', 'PAID', 125_000, 'Đã xác nhận giao dịch'], ['REFUND', 'REFUNDED', 125_000, 'Đã xác nhận hoàn tiền'],
  ])('keeps %s %s readable and suppresses payment details for nonpayable records', async (kind, status, amount, expected) => {
    const view = inspect(await buildBookingReceiptCard({ ...pending, kind, status, amount, payment, paidAt: now }));
    expect(view.text).toContain(expected);
    expect(view.text).not.toContain(payment.transferCode);
    expect(view.buttons).toEqual([]);
    expect(view.image.description).not.toContain('QR PayOS');
  });

  it('labels expired Booking invoices and hides both expired and invalid payment data', async () => {
    const expired = inspect(await buildBookingReceiptCard({ ...pending, payment: { ...payment, expiresAt: now } }));
    expect(expired.text).toContain('Hết hạn thanh toán');
    expect(expired.buttons).toEqual([]);
    expect(expired.image.description).not.toContain('QR');
    const foreign = inspect(await buildBookingReceiptCard({ ...pending, payment: { ...payment,
      qrPayload: 'https://external.invalid/not-an-emv-payload', checkoutUrl: 'https://pay.payos.vn.external.invalid/web/fake' } }));
    expect(foreign.text).toContain('staff kiểm tra');
    expect(foreign.buttons).toEqual([]);
    expect(foreign.image.description).not.toContain('QR');
    const undated = inspect(await buildBookingReceiptCard({ ...pending, payment: { ...payment, expiresAt: null } }));
    expect(undated.buttons).toEqual([]);
    expect(undated.image.description).not.toContain('QR');
  });

  it('rejects invalid live records and shields descriptive text from mentions or image markup', async () => {
    await expect(buildBookingReceiptCard({ ...pending, code: '`unsafe`' })).rejects.toThrow('Dữ liệu hóa đơn không hợp lệ');
    await expect(buildBookingReceiptCard({ ...pending, kind: 'REFUND', status: 'PAID' })).rejects.toThrow('Dữ liệu hóa đơn không hợp lệ');
    const view = inspect(await buildBookingReceiptCard({ ...pending, description: '<@1234> **unexpected** &' }));
    expect(view.text).toContain('‹@1234› \\*\\*unexpected\\*\\* &');
    expect(view.image).toBeDefined();
  });
});
