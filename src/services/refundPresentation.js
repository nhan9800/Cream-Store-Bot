import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import QRCode from 'qrcode';
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';
import { formatCurrency as money } from '../utils/formatters.js';
import { buildRefundVietQR } from '../utils/refundVietQR.js';
import { readRefundBank } from './geminiRefundService.js';

export function refundQuoteLines(q) {
  const stamp = value => `<t:${Math.floor(Date.parse(value) / 1000)}:f>`;
  return [
    `**Tiền mua đã nhận:** ${money(q.paid)}`,
    `**Bắt đầu gói:** ${stamp(q.start)}`,
    `**Hết hạn gói:** ${stamp(q.end)}`,
    `**Dừng tính sử dụng:** ${stamp(q.cutoff)} (mở bảo hành)`,
    `**Thời gian tính phí:** ${(q.usedMs / 86400000).toFixed(2)} ngày / ${(q.totalMs / 86400000).toFixed(2)} ngày gói`,
    ...(q.downtimeMs > 1500 ? [`**Thời gian bảo hành đã loại trừ:** ${(q.downtimeMs / 86400000).toFixed(2)} ngày`] : []),
    `**Trừ phần đã sử dụng:** −${money(q.usageDeduction)}`,
    `**Phí xử lý bổ sung 10% giá mua:** −${money(q.fee)}`,
    `### Số còn hoàn: ${money(q.refund)}`,
    '-# Tính theo tiền đã trả × thời gian dùng thực tế / thời hạn gói; các khoản trừ làm tròn xuống 1đ.',
  ];
}

export function buildRefundOffer(row) {
  const E = createEmojiResolver(row.guild_id);
  const ready = row.stage === 'READY_TO_PAY';
  const embed = new EmbedBuilder().setColor(0x80b8ff)
    .setTitle(`HỒ SƠ HOÀN TIỀN · ${row.order_code}`)
    .setDescription([
      `${E('icon_money_wings')} **Gemini · ${ready ? 'Chờ shop chuyển hoàn' : 'Chờ thông tin nhận hoàn'}**`,
      '', ...refundQuoteLines(row.quote), '',
      `${E('status_info')} ${ready ? 'Bot đã lưu thông tin nhận tiền của bạn.' : 'Vui lòng kiểm tra bảng tính trước khi cung cấp tài khoản nhận tiền.'}`,
      '> Nếu chưa đồng ý với mốc sử dụng hoặc khoản khấu trừ, hãy liên hệ shop để kiểm tra lại. Không cần nhập tài khoản lúc này.',
      '-# Chỉ cung cấp tên ngân hàng, số tài khoản và tên chủ tài khoản. Shop không yêu cầu mật khẩu, số thẻ hay OTP.',
      '**Đây là hồ sơ chờ hoàn, chưa phải xác nhận đã chuyển tiền.**',
    ].join('\n')).setFooter({ text: 'Cenar Store · Thông tin nhận hoàn được lưu mã hóa' });
  const components = row.active && !ready ? [new ActionRowBuilder().addComponents(
    withButtonEmoji(new ButtonBuilder().setCustomId(`refund:bank:${row.id}`)
      .setLabel('Xác nhận & nhập tài khoản').setStyle(ButtonStyle.Secondary), E('icon_wallet')),
  )] : [];
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

export async function buildRefundPayout(row) {
  const bank = readRefundBank(row);
  const raw = buildRefundVietQR({ ...bank, amount: row.quote.refund, orderCode: row.order_code });
  const png = await QRCode.toBuffer(raw, { type: 'png', width: 720, margin: 4, errorCorrectionLevel: 'M' });
  const embed = new EmbedBuilder().setColor(0x79d4bd).setTitle(`CHUYỂN HOÀN · ${row.order_code}`)
    .setDescription([...refundQuoteLines(row.quote), '',
      `**Ngân hàng:** ${bank.bankName}`, `**Tài khoản:** \`${bank.account}\``,
      `**Tên khách khai:** ${bank.name}`,
      '**Kiểm tra tên người thụ hưởng trong ứng dụng ngân hàng trước khi chuyển.**',
      'Sau khi chuyển thành công, dùng `/quanly-don` → **Xác nhận đã hoàn tiền bên ngoài bot**, nhập đúng số tiền thực tế.',
    ].join('\n')).setImage('attachment://refund.png');
  return { embeds: [embed], components: [], files: [new AttachmentBuilder(png, { name: 'refund.png' })],
    allowedMentions: { parse: [] } };
}
