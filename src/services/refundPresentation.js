import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder,
  MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from 'discord.js';
import QRCode from 'qrcode';
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';
import { formatCurrency as money } from '../utils/formatters.js';
import { buildRefundVietQR } from '../utils/refundVietQR.js';
import { readRefundBank, refundReview } from './geminiRefundService.js';

const T = content => new TextDisplayBuilder().setContent(content);
const separator = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const percent = q => (q.feeBps / 100).toLocaleString('vi-VN');
const stamp = value => `<t:${Math.floor(Date.parse(value) / 1000)}:f>`;
function decorations(guildId) {
  const E = createEmojiResolver(guildId), used = new Set(), out = {};
  const slots = { brand:['icon_announce'], receipt:['order_id'], calendar:['icon_calendar'],
    paid:['payment_money'], usage:['icon_chart'], fee:['icon_price'], total:['status_check'],
    change:['panel_edit'], info:['status_info'], private:['icon_block'], submit:['ticket_open'],
    contact:['cenar_support'], bank:['payment_vietqr'], owner:['ticket_user'], account:['payment_payos'], qr:['payment_qr'] };
  for (const [key,candidates] of Object.entries(slots)) out[key] = candidates.map(slot=>E(slot)).find(value=>{
    const id = value.match(/:(\d+)>$/)?.[1];
    if (!id || used.has(id)) return false;
    used.add(id); return true;
  }) || '';
  return out;
}
export function refundQuoteLines(q, d = {}) {
  return [
    `${d.paid || ''} **Tiền mua đã nhận** · ${money(q.paid)}`,
    `${d.usage || ''} **Trừ thời gian đã sử dụng** · −${money(q.usageDeduction)}`,
    `${d.fee || ''} **Khấu trừ chi phí bổ sung ${percent(q)}% giá mua gốc** · −${money(q.fee)}`,
    '', `### ${d.total || ''} Số còn hoàn: ${money(q.refund)}`,
    '-# Tiền gốc − phần đã dùng − khoản bổ sung. Các khoản trừ làm tròn xuống 1đ.',
  ];
}
export function buildRefundOffer(row, { mentionCustomer = false } = {}) {
  const d = decorations(row.guild_id), review = refundReview(row), q = review.quote;
  const proposal = Boolean(row.pendingQuote), ready = row.stage === 'READY_TO_PAY' && !proposal;
  const title = new ContainerBuilder().setAccentColor(0x8796cb)
    .addTextDisplayComponents(T(`# ${d.brand} HỒ SƠ HOÀN TIỀN`),
      T(`${d.receipt} **${row.order_code}** · Gemini${row.durationMonths ? ` ${row.durationMonths} tháng` : ''}${mentionCustomer ? `\n<@${row.customer_id}>` : ''}`))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(T(`### ${d.calendar} Thời gian đối soát\n**Bắt đầu:** ${stamp(q.start)}\n**Hết hạn:** ${stamp(q.end)}\n**Dừng tính sử dụng:** ${stamp(q.cutoff)} · mở bảo hành\n**Đã dùng:** ${(q.usedMs / 86400000).toFixed(2)} / ${(q.totalMs / 86400000).toFixed(2)} ngày${q.downtimeMs > 1500 ? `\n**Đã loại trừ thời gian chờ bảo hành:** ${(q.downtimeMs / 86400000).toFixed(2)} ngày` : ''}`));
  const amount = new ContainerBuilder().setAccentColor(proposal ? 0xe8b977 : 0x79d4bd);
  if (proposal) amount.addTextDisplayComponents(T(`### ${d.change} Phương án mới shop đề xuất\nBảng trước: **${percent(row.quote)}% · còn hoàn ${money(row.quote.refund)}**${row.accepted_at ? ' · đã được bạn xác nhận' : ''}.\nĐề xuất mới: **${percent(q)}% · còn hoàn ${money(q.refund)}**.\n${row.accepted_at ? 'Phương án đã xác nhận trước đó vẫn được giữ cho đến khi bạn đồng ý thay đổi.' : 'Vui lòng đọc các khoản thay đổi trước khi quyết định.'}`)).addSeparatorComponents(separator());
  amount.addTextDisplayComponents(T(refundQuoteLines(q,d).join('\n')));
  const instructions = new ContainerBuilder().setAccentColor(0x5f6d87)
    .addTextDisplayComponents(T(`### ${d.info} ${ready ? 'Chờ shop chuyển hoàn' : proposal ? 'Bạn quyết định có đồng ý phương án mới' : 'Chờ xác nhận & thông tin nhận hoàn'}\n${ready ? 'Thông tin nhận tiền của bạn đã được lưu. Shop sẽ đối chiếu người nhận trước khi chuyển.' : 'Nếu đồng ý bảng tính, dùng nút bên dưới để xác nhận và nhập tài khoản nhận tiền. Nếu cần trao đổi lại khoản khấu trừ hoặc thời gian sử dụng, hãy liên hệ shop trong ticket.'}\n\n${d.private} Chỉ nhập ngân hàng, số tài khoản và tên chủ tài khoản trong biểu mẫu riêng tư. Không cung cấp mật khẩu, số thẻ hoặc OTP.\n**Hồ sơ này chưa phải xác nhận đã chuyển tiền.**`));
  const buttons = [];
  if (row.active && !ready) buttons.push(withButtonEmoji(new ButtonBuilder()
    .setCustomId(`refund:bank:${row.id}:${review.revision}`).setLabel(proposal ? 'Xem & xác nhận phương án mới' : 'Xác nhận & nhập tài khoản')
    .setStyle(ButtonStyle.Secondary),d.submit));
  if (row.ticket_notice_channel_id) buttons.push(withButtonEmoji(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Trao đổi lại với shop')
    .setURL(`https://discord.com/channels/${row.guild_id}/${row.ticket_notice_channel_id}`),d.contact));
  if (buttons.length) instructions.addActionRowComponents(new ActionRowBuilder().addComponents(...buttons));
  instructions.addTextDisplayComponents(T(`-# Cenar Store · Bảng tính ${review.revision} · Thông tin nhận tiền được mã hóa`));
  return { flags:MessageFlags.IsComponentsV2, components:[title,amount,instructions],
    allowedMentions: mentionCustomer ? {users:[row.customer_id],parse:[]} : {parse:[]} };
}
export async function buildRefundPayout(row) {
  const bank = readRefundBank(row), d = decorations(row.guild_id);
  const raw = buildRefundVietQR({ ...bank, amount:row.quote.refund,orderCode:row.order_code });
  const png = await QRCode.toBuffer(raw,{type:'png',width:720,margin:4,errorCorrectionLevel:'M'});
  const card = new ContainerBuilder().setAccentColor(0x79d4bd)
    .addTextDisplayComponents(T(`# ${d.qr} CHUYỂN HOÀN · ${row.order_code}`),
      T(`**Theo bảng tính ${row.quote_revision} đã được khách xác nhận · ${percent(row.quote)}%**${row.pendingQuote ? `\n${d.change} Đề xuất ${percent(row.pendingQuote)}% chưa được khách đồng ý. QR này vẫn theo phương án đã xác nhận ở trên.` : ''}`))
    .addSeparatorComponents(separator()).addTextDisplayComponents(T(refundQuoteLines(row.quote,d).join('\n')))
    .addSeparatorComponents(separator()).addTextDisplayComponents(T(`${d.bank} **Ngân hàng:** ${bank.bankName}\n${d.account} **Số tài khoản:** \`${bank.account}\`\n${d.owner} **Tên khách khai:** ${bank.name}\n\n**Kiểm tra tên thụ hưởng trong ứng dụng ngân hàng trước khi chuyển.**`))
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder()
      .setURL('attachment://refund.png').setDescription(`QR hoàn ${money(row.quote.refund)} cho ${row.order_code}, bảng tính ${row.quote_revision}`)))
    .addTextDisplayComponents(T(`${d.info} Sau khi chuyển thành công, dùng \`/quanly-don\` → **Xác nhận đã hoàn tiền bên ngoài bot**, nhập đúng số tiền thực tế.`));
  return {flags:MessageFlags.IsComponentsV2,components:[card],files:[new AttachmentBuilder(png,{name:'refund.png'})],allowedMentions:{parse:[]}};
}
