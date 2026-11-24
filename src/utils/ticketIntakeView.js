import { escapeMarkdown } from 'discord.js';
import { storefrontEmoji as icon } from './storefrontEmoji.js';

function field(key, label, value) {
  return [`**${icon(key)} ${label}**`, ...escapeMarkdown(value).split('\n').map(line => `> ${line}`)].join('\n');
}

export function buildPurchaseIntake(data) {
  return [
    `### ${icon('ticket_open')} Yêu cầu mua hàng của khách`,
    field('product', 'Sản phẩm khách muốn mua', data.product),
    field('calendar', 'Thời hạn gói', data.duration),
    field('payos', 'Phương thức thanh toán mong muốn', data.payment),
    `-# ${icon('details')} Shop sẽ xác nhận gói, giá và cách thanh toán ngay trong ticket này.`,
  ].join('\n\n');
}
