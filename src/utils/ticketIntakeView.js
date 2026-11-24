import { escapeMarkdown } from 'discord.js';
import { storefrontEmoji as icon } from './storefrontEmoji.js';

function field(key, label, value) {
  return [`**${icon(key)} ${label}**`, ...escapeMarkdown(value).split('\n').map(line => `> ${line}`)].join('\n');
}

export function buildPurchaseIntake(data) {
  return [
    `### ${icon('created')} Yêu cầu mua hàng của khách`,
    field('clipboard', 'Sản phẩm khách muốn mua', data.product),
    field('expiry', 'Thời hạn gói', data.duration),
    field('receipt', 'Phương thức thanh toán mong muốn', data.payment),
    `-# ${icon('reminder')} Shop sẽ xác nhận gói, giá và cách thanh toán ngay trong ticket này.`,
  ].join('\n\n');
}
