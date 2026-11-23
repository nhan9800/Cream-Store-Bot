import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, formatEmoji,
  MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder,
} from 'discord.js';
import { formatCurrency } from './formatters.js';

export const bookingTicketAccent = Object.freeze({ indigo: 0x7167db, mint: 0x60cdb2, amber: 0xd7ac70 });

const invoiceStatuses = {
  FREE: 'Miễn phí', PAID: 'Đã đối soát PayOS', PENDING: 'Chờ PayOS xác nhận', NEEDS_REVIEW: 'Quản lý đang đối soát',
};

const invoicePurpose = invoice => invoice.kind === 'EXTENSION' ? 'Gia hạn phiên' : 'Đặt phiên';

export function bookingTicketCard({ section, title, subtitle, accent = bookingTicketAccent.indigo, emoji }) {
  const icon = emoji?.id ? `${formatEmoji(emoji.id, Boolean(emoji.animated))} ` : '';
  return new ContainerBuilder().setAccentColor(accent).addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# CENAR BOOKING · ${section}\n## ${icon}${title}${subtitle ? `\n${subtitle}` : ''}`),
  );
}

export function addBookingTicketSection(container, content) {
  return container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

export function bookingTicketPayload(container) {
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

export function buildBookingPayOSCard({ order, invoice, attachmentName, checkoutUrl, emoji }) {
  const expiry = Date.parse(order.payment_expired_at);
  const hasCheckout = typeof checkoutUrl === 'string' && /^https:\/\//i.test(checkoutUrl);
  const container = bookingTicketCard({ section: 'HÓA ĐƠN RIÊNG', title: formatCurrency(order.total_amount),
    subtitle: `${invoicePurpose(invoice)} · ${invoice.minutes} phút · **Chờ thanh toán**`, emoji });
  addBookingTicketSection(container, [
    `**Mã hóa đơn**\n\`${order.order_code}\``,
    `**Nội dung chuyển khoản**\n\`${order.payment_code ?? order.order_code}\``,
    ...(Number.isFinite(expiry) ? [`**Hết hạn**\n<t:${Math.floor(expiry / 1000)}:f> · <t:${Math.floor(expiry / 1000)}:R>`] : []),
  ].join('\n\n'));
  if (attachmentName) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
      .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder()
        .setURL(`attachment://${attachmentName}`).setDescription('Mã QR thanh toán PayOS của hóa đơn Booking')));
  }
  if (hasCheckout) {
    const button = new ButtonBuilder().setLabel('Mở thanh toán PayOS').setStyle(ButtonStyle.Link).setURL(checkoutUrl);
    if (emoji?.id) button.setEmoji(emoji);
    container.addActionRowComponents(new ActionRowBuilder().addComponents(button));
  }
  addBookingTicketSection(container, attachmentName || hasCheckout
    ? '-# Kiểm tra số tiền và nội dung trước khi chuyển. Bot cập nhật trạng thái sau khi PayOS xác nhận giao dịch.'
    : 'Hóa đơn chưa có mã QR hoặc đường dẫn thanh toán. Nhắn staff trong phiếu để được kiểm tra.');
  return bookingTicketPayload(container);
}

export function buildBookingFreeQuote(invoice, ticketCode, emoji) {
  const container = bookingTicketCard({ section: 'BÁO GIÁ RIÊNG', title: '0 VND',
    subtitle: `${invoicePurpose(invoice)} · ${invoice.minutes} phút · **Miễn phí**`, accent: bookingTicketAccent.mint, emoji });
  addBookingTicketSection(container, `**Mã phiếu** · \`${ticketCode}\`\nBot đăng đường dẫn phòng riêng trong phiếu khi đến giờ.`);
  return bookingTicketPayload(container);
}

export function buildBookingBillReview(invoices, ticketCode, emoji) {
  const container = bookingTicketCard({ section: 'QUẢN LÝ PHIẾU', title: 'Đối chiếu hóa đơn',
    subtitle: `Mã phiếu \`${ticketCode}\` · ${invoices.length} hóa đơn`,
    accent: invoices.some(invoice => invoice.status === 'NEEDS_REVIEW') ? bookingTicketAccent.amber : bookingTicketAccent.indigo, emoji });
  const rows = invoices.slice(-12).map(invoice => {
    const code = invoice.order_code ? ` · \`${invoice.order_code}\`` : '';
    return `**${invoicePurpose(invoice)}** · ${formatCurrency(invoice.amount)}\n${invoiceStatuses[invoice.status] ?? 'Đang kiểm tra'} · ${invoice.minutes} phút${code}`;
  });
  if (rows.length) addBookingTicketSection(container, rows.join('\n\n'));
  else addBookingTicketSection(container, 'Phiếu này chưa có báo giá.');
  return bookingTicketPayload(container);
}

export function buildBookingVoiceNotice({ guildId, roomId, endsAt, ticketId, audience, emoji }) {
  const end = Math.floor(endsAt / 1000);
  const isWarning = audience === 'warning';
  const container = bookingTicketCard({ section: 'PHÒNG VOICE RIÊNG',
    title: isWarning ? 'Phiên sắp kết thúc' : 'Phòng đã sẵn sàng',
    subtitle: `Kết thúc <t:${end}:t> · <t:${end}:R>`,
    accent: isWarning ? bookingTicketAccent.amber : bookingTicketAccent.mint, emoji });
  if (isWarning) {
    addBookingTicketSection(container, 'Bạn có thể gửi thêm thời lượng để staff kiểm tra lịch và báo giá gia hạn.');
    container.addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder()
      .setStyle(ButtonStyle.Secondary).setLabel('Yêu cầu gia hạn').setCustomId(`booking:extension:open:${ticketId}`)));
  } else {
    addBookingTicketSection(container, audience === 'host'
      ? 'Mở phòng để bắt đầu phiên. Bạn cũng có thể tìm lại phòng bằng `/cenar-booking lich`.'
      : 'Mở phòng để bắt đầu phiên cùng host. Host nhận đường dẫn qua tin nhắn riêng và mục **Lịch của bạn**.');
    container.addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder()
      .setStyle(ButtonStyle.Link).setLabel('Vào phòng voice').setURL(`https://discord.com/channels/${guildId}/${roomId}`)));
  }
  return bookingTicketPayload(container);
}
