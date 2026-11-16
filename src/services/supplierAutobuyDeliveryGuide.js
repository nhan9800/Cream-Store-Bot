import { escapeMarkdown } from 'discord.js';
import { stripPresentationEmoji } from '../utils/uniqueCustomEmoji.js';

// Only presentation metadata belongs here. Supplier goods remain byte-identical
// in the private attachment and must never enter a heading, journal or log.
const plain = (value, limit) => stripPresentationEmoji(typeof value === 'string' ? value : '')
  .replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
  .replace(/https?:\/\/\S+/gi, '[liên kết trong hướng dẫn nguồn]')
  .replace(/@/g, '＠').replace(/</g, '‹').replace(/>/g, '›').replace(/\s+/g, ' ').trim().slice(0, limit);
const display = (value, limit) => escapeMarkdown(plain(value, limit)).slice(0, limit).replace(/\\+$/, '');
const code = value => /^CN_\d{6,20}$/.test(value || '') ? value : 'Xem trên thẻ đơn';
const custom = value => /^<a?:[A-Za-z0-9_]+:\d{17,20}>$/.test(value || '') ? value + ' ' : '';

/** No current catalog lookup: guide describes the terms saved with this order. */
export function supplierDeliveryGuideSections(delivery = {}, E = () => '') {
  const icon = slot => custom(E(slot));
  const name = plain(delivery.productName, 110);
  const form = plain(delivery.accountForm, 170);
  const isClaudeCdk = delivery.productKey === 'cdkvietnam:6'
    || /claude/i.test(name) && /cdk|ios/i.test(name + ' ' + form);
  const isCdk = /cdk/i.test(name + ' ' + form);
  const isAccount = !isCdk && /(?:cấp|tài khoản|account)/i.test(form);
  const preparation = isClaudeCdk
    ? 'Kiểm tra KYC, tuổi tài khoản và Team/Organization theo điều khoản đã xác nhận trước khi nạp. Chưa rõ điều kiện thì hỏi shop trước.'
    : isCdk ? 'Kiểm tra đúng tài khoản nhận gói và hình thức iOS/Android/Pay Thẻ ghi trên đơn. Dùng hướng dẫn nguồn kèm mã nếu có; chưa rõ thì hỏi shop trước.'
      : isAccount ? 'Đăng nhập bằng thông tin nguồn bàn giao. Kiểm tra gói và điều kiện quản lý tài khoản trước khi thay đổi thông tin.'
        : 'Đối chiếu đúng sản phẩm, tài khoản nhận gói và điều kiện sử dụng. Đọc hướng dẫn nguồn kèm hàng nếu có trước khi thao tác.';
  return {
    title: `${icon('icon_gift')}CENAR AUTOBUY · HÀNG CỦA BẠN`,
    summary: [
      `${icon('order_id')}**Mã đơn:** \`${code(delivery.orderCode)}\``,
      `${icon('order_product')}**Sản phẩm:** ${display(name || 'Gói AutoBuy', 110)}`,
      delivery.termLabel ? `${icon('icon_duration')}**Thời hạn:** ${display(delivery.termLabel, 80)}` : null,
      delivery.warrantyLabel ? `${icon('panel_warranty')}**Bảo hành:** ${display(delivery.warrantyLabel, 170)}` : null,
      form ? `${icon('icon_key')}**Hình thức:** ${display(form, 170)}` : null,
    ].filter(Boolean).join('\n'),
    steps: `${icon('icon_book')}**BẮT ĐẦU SỬ DỤNG**\n`
      + '1. **Lưu file riêng tư:** mỗi mục giữ nguyên mã/tài khoản, kèm hướng dẫn nguồn nếu có.\n'
      + `2. **Chuẩn bị:** ${preparation}\n`
      + '3. **Kiểm tra kết quả:** xem gói và thời hạn trong ứng dụng sau khi làm xong. Nhận mã chưa đồng nghĩa đã kích hoạt thành công.',
    support: `${icon('cenar_support')}**Cần hỗ trợ?** File chỉ có mã mà chưa có bước kích hoạt: mở ticket để shop hướng dẫn đúng loại. Khi có lỗi, giữ mã đơn và gửi ảnh đã che mã/mật khẩu trong ticket riêng; không thử nạp lặp hoặc đăng hàng công khai.\n`
      + '-# Xem lại hàng: Đơn của tôi → Nhận hàng riêng. Bảo hành theo điều kiện đã xác nhận của đơn.',
  };
}

export function buildSupplierDeliveryGuide(delivery, E) {
  const sections = supplierDeliveryGuideSections(delivery, E);
  return `## ${sections.title}\n${sections.summary}\n\n${sections.steps}\n\n${sections.support}`;
}
