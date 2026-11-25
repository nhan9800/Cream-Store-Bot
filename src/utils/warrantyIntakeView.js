import {
  ActionRowBuilder, ContainerBuilder, MessageFlags, ModalBuilder, SeparatorBuilder, SeparatorSpacingSize,
  StringSelectMenuBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { storefrontComponentEmoji, storefrontEmoji as icon } from './storefrontEmoji.js';

export const WARRANTY_PICK_ID = 'ticket:intake:pick:warranty';
export const WARRANTY_FORM_PREFIX = 'ticket:intake:form:warranty:';
export const WARRANTY_ORDER_CODE = /^[A-Z0-9_-]{3,32}$/;
export const WARRANTY_QUESTIONS = [
  { id: 'issue', label: 'Bạn đang gặp lỗi gì?', max: 500, paragraph: true,
    placeholder: 'Ví dụ: đăng nhập báo sai mật khẩu, mất gói Premium, bị đăng xuất liên tục' },
  { id: 'since', label: 'Lỗi xuất hiện từ khi nào?', max: 60, optional: true, placeholder: 'Ví dụ: 8 giờ sáng nay' },
  { id: 'tried', label: 'Bạn đã thử cách nào chưa?', max: 300, paragraph: true, optional: true,
    placeholder: 'Ví dụ: đã đăng xuất, đăng nhập lại và đổi thiết bị' },
];

const NUMBERS = ['num1', 'num2', 'num3', 'num4', 'num5', 'num6', 'num7', 'num8', 'num9', 'num10'];
const ACCENT = 0xF59E0B;
const dateFormat = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' });
const text = content => new TextDisplayBuilder().setContent(content);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const clip = (value, max) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

function day(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? dateFormat.format(date) : null;
}

function optionDescription(order) {
  const parts = [order.status === 'WARRANTY_OPEN' ? 'Đang có ticket bảo hành' : 'Đã hoàn thành'];
  const bought = day(order.completed_at || order.created_at);
  const expiry = day(order.expiry_at);
  if (bought) parts.push(`Mua ${bought}`);
  if (expiry) parts.push(`HSD ${expiry}`);
  return clip(parts.join(' · '), 100);
}

function header(lines) {
  return text([`## ${icon('shield')} Bảo hành đơn hàng`, ...lines].join('\n'));
}

function reply(container) {
  return { components: [container.toJSON()], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] } };
}

export function buildWarrantyOrderPicker(orders) {
  if (!orders.length) {
    return reply(new ContainerBuilder().setAccentColor(ACCENT)
      .addTextDisplayComponents(header([`> ${icon('empty')} Bạn chưa có đơn đã hoàn thành nào tại Cenar Store để bảo hành.`]))
      .addSeparatorComponents(divider())
      .addTextDisplayComponents(text(`-# ${icon('support')} Cần kiểm tra đơn khác? Bấm **Hỗ trợ** ở bảng ticket để staff xem giúp bạn.`)));
  }
  const select = new StringSelectMenuBuilder().setCustomId(WARRANTY_PICK_ID)
    .setPlaceholder('Chọn mã đơn cần bảo hành').setMinValues(1).setMaxValues(1)
    .addOptions(orders.slice(0, 25).map((order, index) => ({
      label: clip(`${order.order_code} · ${order.product_name || 'Sản phẩm Cenar'}`, 100),
      description: optionDescription(order),
      value: order.order_code,
      emoji: storefrontComponentEmoji(NUMBERS[index] ?? 'product'),
    })));
  return reply(new ContainerBuilder().setAccentColor(ACCENT)
    .addTextDisplayComponents(header([
      `> ${icon('user')} Chọn đúng đơn đang gặp lỗi. Danh sách chỉ gồm đơn đã hoàn thành của chính bạn.`,
    ]))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text([
      `### ${icon('book')} Ba bước gửi bảo hành`,
      `${icon('search')} **Chọn mã đơn** · Bấm menu bên dưới và chọn đơn cần bảo hành.`,
      `${icon('document')} **Mô tả lỗi** · Điền lỗi bạn gặp, thời điểm bắt đầu và cách đã thử.`,
      `${icon('staff')} **Nhận hỗ trợ** · Bot mở ticket riêng, staff kiểm tra ngay trong đó.`,
    ].join('\n')))
    .addSeparatorComponents(divider())
    .addActionRowComponents(new ActionRowBuilder().addComponents(select))
    .addTextDisplayComponents(text(`-# ${icon('info')} Hiển thị ${Math.min(orders.length, 25)} đơn gần nhất. Không thấy đơn? Bấm **Hỗ trợ** ở bảng ticket.`)));
}

export function buildWarrantyIssueModal(orderCode) {
  return new ModalBuilder().setCustomId(WARRANTY_FORM_PREFIX + orderCode).setTitle(clip(`Bảo hành ${orderCode}`, 45))
    .addComponents(WARRANTY_QUESTIONS.map(({ id, label, max, optional, paragraph, placeholder }) => new ActionRowBuilder()
      .addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setMaxLength(max).setPlaceholder(placeholder)
        .setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(!optional))));
}

/** Follow-up posted into an already open warranty ticket; values must already be Markdown-escaped. */
export function buildWarrantyIssueReport({ issue, since, tried }) {
  return [
    `### ${icon('history')} Khách bổ sung mô tả lỗi`,
    `${icon('warn')} **Lỗi đang gặp** · ${issue}`,
    since && `${icon('clock')} **Bắt đầu từ** · ${since}`,
    tried && `${icon('details')} **Đã thử** · ${tried}`,
  ].filter(Boolean).join('\n');
}

export function warrantyNotice(key, message) {
  return `${icon(key)} ${message}`;
}

export function buildWarrantySubmitted(orderCode, channelId, reused) {
  return [
    `${icon(reused ? 'refresh' : 'check')} **${reused ? 'Đã cập nhật yêu cầu bảo hành' : 'Đã gửi yêu cầu bảo hành'}** · \`${orderCode}\``,
    `${icon('ticket_open')} Ticket riêng của bạn: <#${channelId}>`,
    `-# ${icon('pending')} Staff sẽ phản hồi trong ticket, bạn không cần tag.`,
  ].join('\n');
}
