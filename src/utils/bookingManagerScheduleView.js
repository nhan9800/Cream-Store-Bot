import { escapeMarkdown } from 'discord.js';
import { addBookingTicketSection, bookingTicketCard, bookingTicketPayload } from './bookingTicketUi.js';
import { formatCurrency } from './formatters.js';

const vietnamOffset = 7 * 3_600_000;
const day = 24 * 3_600_000;
const dateLabel = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' });
const timeLabel = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Ho_Chi_Minh',
});
const states = {
  AVAILABLE: 'Đang nhận đặt', HELD: 'Đang giữ chỗ', BOOKED: 'Đã đặt', CLOSED: 'Đã đóng nhận mới',
  PAST: 'Đã qua giờ', HOST_HIDDEN: 'Hồ sơ host chưa công khai', PAYMENT_OFF: 'Đang chờ bật PayOS',
  TOO_SOON: 'Sắp đến giờ, đã ngừng nhận', OCCUPIED: 'Host trùng lịch',
};

export function bookingManagerSlotRange(startOfDay, at = Date.now()) {
  const today = Math.floor((at + vietnamOffset) / day) * day - vietnamOffset;
  const fromAt = startOfDay ?? today;
  return { fromAt, untilAt: fromAt + (startOfDay == null ? 7 : 1) * day };
}

function displaySlot(slot) {
  let status = states[slot.state];
  if (slot.state === 'HELD') status += ` đến ${timeLabel.format(slot.holdUntil)}`;
  if (slot.sessionStatus === 'ACTIVE') status = 'Đang diễn ra';
  if (slot.sessionStatus === 'COMPLETED') status = 'Đã hoàn thành';
  if (slot.closedAt !== null && slot.state !== 'CLOSED') status += ' · Đã đóng nhận mới';
  const host = slot.hostName ? escapeMarkdown(slot.hostName) : 'Hồ sơ host chưa công khai';
  const rate = slot.hourlyPrice ? `${formatCurrency(slot.hourlyPrice)}/giờ · Tổng ${formatCurrency(slot.amount)}` : 'Miễn phí';
  return `**#${slot.id} · ${host}**\n${timeLabel.format(slot.startsAt)} · ${dateLabel.format(slot.startsAt)} · ${slot.durationMinutes} phút · ${slot.service === 'game' ? 'Game' : 'Voice'}\n${rate} · **${status}**`;
}

export function bookingManagerScheduleView({ slots, page, pageCount, total, fromAt, untilAt }, emoji) {
  const start = dateLabel.format(fromAt);
  const end = dateLabel.format(untilAt - 1);
  const period = start === end ? start : `${start} – ${end}`;
  const card = bookingTicketCard({ section: 'VẬN HÀNH RIÊNG', title: 'Lịch ca của host', emoji,
    subtitle: `${period} · Giờ Việt Nam\n**${total} ca** · Trang ${page}/${pageCount}` });
  addBookingTicketSection(card, slots.length ? slots.map(displaySlot).join('\n\n') : 'Chưa có ca trong phạm vi đã chọn.');
  const instructions = slots.length
    ? 'Dùng `/cenar-booking dong-ca` với mã ca để ngừng nhận đặt mới.'
    : 'Dùng `/cenar-booking mo-ca` sau khi xác nhận thời gian với host.';
  addBookingTicketSection(card, pageCount > 1 ? [instructions, 'Dùng tham số `trang` để xem tiếp.'].join('\n') : instructions);
  return bookingTicketPayload(card);
}
