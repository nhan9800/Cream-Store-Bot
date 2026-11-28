import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder,
  MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from 'discord.js';
import QRCode from 'qrcode';
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';
import { formatCurrency as money } from '../utils/formatters.js';
import { buildVerifiedRefundVietQR } from '../utils/refundVietQR.js';
import { readRefundBank, refundReview } from './geminiRefundService.js';
import { REFUND_REASONS } from './refundLedgerService.js';

const T = content => new TextDisplayBuilder().setContent(content);
const separator = (large = false) => new SeparatorBuilder().setDivider(true)
  .setSpacing(large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);
const percent = q => (q.feeBps / 100).toLocaleString('vi-VN');
const stamp = value => `<t:${Math.floor(Date.parse(value) / 1000)}:f>`;
const days = ms => (ms / 86400000).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
const isStandard = q => q?.kind === 'STANDARD';
const groupAccount = account => account.replace(/(.{4})(?=.)/g, '$1 ');

// Each card uses distinct custom artwork; a slot is skipped when it resolves to an ID already used.
const SLOTS = {
  brand: ['payment_refund', 'guide_refund', 'icon_announce'], receipt: ['order_id', 'cenar_ui27_receipt'],
  product: ['order_product', 'cenar_ui27_product'], calendar: ['icon_calendar', 'cenar_ui27_calendar'],
  paid: ['payment_money', 'cenar_ui27_money'], usage: ['icon_chart', 'cenar_ui27_chart'], fee: ['icon_price', 'cenar_ui27_price'],
  other: ['cenar_ui27_clipboard', 'icon_clipboard'], total: ['status_check', 'cenar_ui27_check'], change: ['panel_edit', 'cenar_ui27_edit'],
  info: ['status_info', 'cenar_ui27_info'], private: ['icon_block', 'cenar_ui27_lock'], submit: ['ticket_open', 'cenar_ui27_ticket_open'],
  contact: ['cenar_support', 'cenar_ui27_support'], bank: ['cenar_ui27_bank', 'payment_vietqr'], owner: ['ticket_user', 'cenar_ui27_user'],
  account: ['payment_payos', 'cenar_ui27_wallet'], qr: ['payment_qr', 'cenar_ui27_scan'], reason: ['guide_warning', 'cenar_ui27_tip'],
  confirm: ['cenar_ui27_approve', 'cenar_ui27_verified'], edit: ['cenar_ui27_restore', 'payment_regenerate'], shield: ['verify_shield', 'cenar_ui27_shield'],
  clock: ['icon_clock', 'cenar_ui27_clock'], ledger: ['cenar_ui27_history', 'icon_history'], reference: ['payment_reference', 'cenar_ui27_reference'],
};
export function refundDecorations(guildId, keys = Object.keys(SLOTS)) {
  const E = createEmojiResolver(guildId), used = new Set(), out = {};
  for (const key of keys) out[key] = (SLOTS[key] || []).map(slot => E(slot)).find(value => {
    const id = value.match(/:(\d+)>$/)?.[1];
    if (!id || used.has(id)) return false;
    used.add(id); return true;
  }) || '';
  return out;
}
const OFFER_KEYS = ['brand', 'receipt', 'calendar', 'paid', 'usage', 'fee', 'other', 'total', 'change', 'info', 'private', 'submit', 'contact', 'reason'];

/** Named extra costs are listed under one header line, so the card keeps one emoji per line. */
export function otherLines(q, d = {}) {
  if (!(q.otherDeduction > 0)) return [];
  const items = q.otherItems || [];
  if (!items.length) return [`${d.other || ''} **Khấu trừ khác** · −${money(q.otherDeduction)}`];
  const listed = items.reduce((sum, item) => sum + item.amount, 0);
  return [
    `${d.other || ''} **Chi phí khác** · −${money(q.otherDeduction)}`,
    ...items.map(item => `- ${item.label} · −${money(item.amount)}`),
    ...(listed > q.otherDeduction ? [`-# Tổng chi phí khác được giới hạn ở ${money(q.otherDeduction)} để số hoàn không âm.`] : []),
  ];
}

export function refundQuoteLines(q, d = {}) {
  const feeLabel = isStandard(q)
    ? `Phí xử lý hoàn tiền ${percent(q)}%${REFUND_REASONS[q.reasonCode] ? ` · ${REFUND_REASONS[q.reasonCode].label}` : ''}`
    : `Khấu trừ chi phí bổ sung ${percent(q)}% giá mua gốc`;
  return [
    `${d.paid || ''} **Tiền mua đã nhận** · ${money(q.paid)}`,
    `${d.usage || ''} **Trừ thời gian đã sử dụng** · −${money(q.usageDeduction)}`,
    `${d.fee || ''} **${feeLabel}** · −${money(q.fee)}`,
    ...otherLines(q, d),
    '', `### ${d.total || ''} Số còn hoàn: ${money(q.refund)}`,
    `-# Tiền gốc − phần đã dùng − ${isStandard(q) ? 'phí xử lý' : 'khoản bổ sung'}. Các khoản trừ làm tròn xuống 1đ.`,
  ];
}

function timeSection(q, d) {
  if (!q.start) return `### ${d.calendar} Thời gian sử dụng\nĐơn chưa được giao nên **không trừ thời gian sử dụng**.`;
  const stop = isStandard(q) ? 'ngày bạn yêu cầu hoàn' : 'mở bảo hành';
  return `### ${d.calendar} Thời gian đối soát\n**Bắt đầu:** ${stamp(q.start)}\n**Hết hạn:** ${stamp(q.end)}\n**Dừng tính sử dụng:** ${stamp(q.cutoff)} · ${stop}\n**Đã dùng:** ${days(q.usedMs)} / ${days(q.totalMs)} ngày${q.downtimeMs > 1500 ? `\n**Đã loại trừ thời gian chờ bảo hành:** ${days(q.downtimeMs)} ngày` : ''}`;
}

export function buildRefundOffer(row, { mentionCustomer = false } = {}) {
  const d = refundDecorations(row.guild_id, OFFER_KEYS), review = refundReview(row), q = review.quote;
  const proposal = Boolean(row.pendingQuote), ready = row.stage === 'READY_TO_PAY' && !proposal;
  const product = isStandard(q) ? (row.productName || 'Đơn hàng') : `Gemini${row.durationMonths ? ` ${row.durationMonths} tháng` : ''}`;
  const title = new ContainerBuilder().setAccentColor(0x8796cb)
    .addTextDisplayComponents(T(`# ${d.brand} HỒ SƠ HOÀN TIỀN`),
      T(`${d.receipt} **${row.order_code}** · ${product}${mentionCustomer ? `\n<@${row.customer_id}>` : ''}`))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(T(timeSection(q, d)));
  const amount = new ContainerBuilder().setAccentColor(proposal ? 0xe8b977 : 0x79d4bd);
  if (q.reoffer && !proposal) amount.addTextDisplayComponents(T(`### ${d.change} Shop đã điều chỉnh bảng tính
Bảng tính ${q.reoffer.previousRevision} (còn hoàn ${money(q.reoffer.previousRefund)})${q.reoffer.wasAccepted ? ' bạn đã xác nhận' : ''} **đã được hủy**. Shop chưa chuyển khoản theo mức đó.
**Lý do điều chỉnh:** ${q.reoffer.note}
Bảng tính mới: **còn hoàn ${money(q.refund)}**. Thông tin tài khoản bạn gửi trước đó đã được xóa, vui lòng đọc lại và xác nhận lại.`)).addSeparatorComponents(separator());
  if (proposal) amount.addTextDisplayComponents(T(`### ${d.change} Phương án mới shop đề xuất\nBảng trước: **${percent(row.quote)}% · còn hoàn ${money(row.quote.refund)}**${row.accepted_at ? ' · đã được bạn xác nhận' : ''}.\nĐề xuất mới: **${percent(q)}% · còn hoàn ${money(q.refund)}**.\n${row.accepted_at ? 'Phương án đã xác nhận trước đó vẫn được giữ cho đến khi bạn đồng ý thay đổi.' : 'Vui lòng đọc các khoản thay đổi trước khi quyết định.'}`)).addSeparatorComponents(separator());
  amount.addTextDisplayComponents(T(refundQuoteLines(q, d).join('\n')));
  if (isStandard(q) && REFUND_REASONS[q.reasonCode]) {
    amount.addSeparatorComponents(separator()).addTextDisplayComponents(T(`### ${d.reason} Vì sao có phí xử lý\n${REFUND_REASONS[q.reasonCode].explanation}`));
  }
  const instructions = new ContainerBuilder().setAccentColor(0x5f6d87)
    .addTextDisplayComponents(T(`### ${d.info} ${ready ? 'Chờ shop chuyển hoàn' : proposal ? 'Bạn quyết định có đồng ý phương án mới' : 'Chờ xác nhận & thông tin nhận hoàn'}\n${ready ? 'Thông tin nhận tiền của bạn đã được lưu. Shop sẽ đối chiếu người nhận trước khi chuyển.' : 'Nếu đồng ý bảng tính, bấm nút bên dưới để nhập tài khoản. Bạn sẽ được **xem trước ngân hàng, số tài khoản, tên và số tiền** trước khi gửi cho shop. Cần trao đổi lại khoản khấu trừ, hãy nhắn shop trong ticket.'}\n\n${d.private} Chỉ nhập ngân hàng, số tài khoản và tên chủ tài khoản trong biểu mẫu riêng tư. Không cung cấp mật khẩu, số thẻ hoặc OTP.\n**Hồ sơ này chưa phải xác nhận đã chuyển tiền.**`));
  const buttons = [];
  if (row.active && !ready) buttons.push(withButtonEmoji(new ButtonBuilder()
    .setCustomId(`refund:bank:${row.id}:${review.revision}`).setLabel(proposal ? 'Xem & xác nhận phương án mới' : 'Xác nhận & nhập tài khoản')
    .setStyle(ButtonStyle.Secondary), d.submit));
  if (row.ticket_notice_channel_id) buttons.push(withButtonEmoji(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Trao đổi lại với shop')
    .setURL(`https://discord.com/channels/${row.guild_id}/${row.ticket_notice_channel_id}`), d.contact));
  if (buttons.length) instructions.addActionRowComponents(new ActionRowBuilder().addComponents(...buttons));
  instructions.addTextDisplayComponents(T(`-# Cenar Store · Bảng tính ${review.revision} · Thông tin nhận tiền được mã hóa`));
  return { flags: MessageFlags.IsComponentsV2, components: [title, amount, instructions],
    allowedMentions: mentionCustomer ? { users: [row.customer_id], parse: [] } : { parse: [] } };
}

async function qrPng(payload) {
  return QRCode.toBuffer(payload, { type: 'png', width: 720, margin: 4, errorCorrectionLevel: 'M' });
}

/** The old ticket card after a re-offer: no buttons, points the customer to the new card. */
export function buildRefundOfferReplaced(row, { previousRevision, previousRefund, url = null }) {
  const d = refundDecorations(row.guild_id, ['change', 'receipt']);
  const card = new ContainerBuilder().setAccentColor(0x5f6d87)
    .addTextDisplayComponents(T(`### ${d.change} Bảng tính ${previousRevision} đã được thay thế`),
      T(`${d.receipt} **${row.order_code}** · mức cũ còn hoàn ${money(previousRefund)} không còn hiệu lực.${url ? `
[Xem bảng tính mới](${url})` : ' Xem bảng tính mới bên dưới.'}`))
    .addTextDisplayComponents(T('-# Cenar Store · Nút trên bảng cũ đã tắt'));
  return { flags: MessageFlags.IsComponentsV2, components: [card], allowedMentions: { parse: [] } };
}

/** Customer-only preview of exactly what the shop will transfer, shown before anything is saved. */
export async function buildRefundPreview({ row, draft, quote, revision }) {
  const d = refundDecorations(row.guild_id, ['brand', 'bank', 'account', 'owner', 'paid', 'qr', 'shield', 'confirm', 'edit', 'clock', 'receipt']);
  const payload = buildVerifiedRefundVietQR({ bankBin: draft.bankBin, account: draft.account, amount: quote.refund, orderCode: row.order_code });
  const card = new ContainerBuilder().setAccentColor(0xe8b977)
    .addTextDisplayComponents(T(`# ${d.brand} XEM TRƯỚC THÔNG TIN NHẬN HOÀN`),
      T(`${d.receipt} **${row.order_code}** · Kiểm tra từng dòng trước khi gửi cho shop`))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(T([
      `${d.bank} **Ngân hàng:** ${draft.bankName} · ${draft.bankFullName}`,
      `${d.account} **Số tài khoản:** \`${groupAccount(draft.account)}\``,
      `${d.owner} **Tên chủ tài khoản:** ${draft.name}`,
      '', `## ${d.paid} Số tiền nhận hoàn: ${money(quote.refund)}`,
    ].join('\n')))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(T(`### ${d.qr} Mã QR shop sẽ quét\nMã chứa đúng ngân hàng, số tài khoản và số tiền ở trên. Khi quét, ứng dụng ngân hàng của shop sẽ tự hiện tên chủ tài khoản để đối chiếu với tên bạn khai.`))
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder()
      .setURL('attachment://refund-preview.png').setDescription(`Xem trước QR hoàn ${money(quote.refund)} cho ${row.order_code}`)))
    .addTextDisplayComponents(T(`${d.shield} Sai ngân hàng hoặc số tài khoản có thể làm tiền chuyển nhầm người. Nếu có dòng nào sai, bấm **Sửa lại**.\n${d.clock} Phiên xem trước giữ 30 phút. Bấm **Xác nhận** cũng là đồng ý bảng tính ${revision}.`))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      withButtonEmoji(new ButtonBuilder().setCustomId(`refund:confirm:${row.id}:${revision}`)
        .setLabel(`Đúng thông tin · nhận ${money(quote.refund)}`).setStyle(ButtonStyle.Success), d.confirm),
      withButtonEmoji(new ButtonBuilder().setCustomId(`refund:bank:${row.id}:${revision}`)
        .setLabel('Sửa lại').setStyle(ButtonStyle.Secondary), d.edit)))
    .addTextDisplayComponents(T('-# Chỉ bạn nhìn thấy bản xem trước này · Thông tin được mã hóa khi lưu'));
  return { flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [card],
    files: [new AttachmentBuilder(await qrPng(payload), { name: 'refund-preview.png' })], allowedMentions: { parse: [] } };
}

/** Shown to the customer after they confirmed the preview. */
export function buildRefundSubmitted(row) {
  const d = refundDecorations(row.guild_id, ['confirm', 'paid', 'clock', 'contact']);
  const card = new ContainerBuilder().setAccentColor(0x79d4bd)
    .addTextDisplayComponents(T(`## ${d.confirm} Đã gửi thông tin nhận hoàn cho shop`),
      T(`${d.paid} Số tiền: **${money(row.quote.refund)}** · đơn **${row.order_code}**\n${d.clock} Shop sẽ đối chiếu tên người nhận rồi chuyển khoản. Kết quả sẽ được báo trong ticket của bạn.\n${d.contact} Cần sửa thông tin? Nhắn shop trong ticket **trước khi** shop chuyển tiền.`))
    .addTextDisplayComponents(T('-# Cenar Store · Thông tin nhận tiền đã được mã hóa'));
  return { flags: MessageFlags.IsComponentsV2, components: [card], allowedMentions: { parse: [] } };
}

export async function buildRefundPayout(row) {
  const bank = readRefundBank(row), d = refundDecorations(row.guild_id, ['qr', 'paid', 'usage', 'fee', 'other', 'total', 'change', 'bank', 'account', 'owner', 'info']);
  const payload = buildVerifiedRefundVietQR({ ...bank, amount: row.quote.refund, orderCode: row.order_code });
  const card = new ContainerBuilder().setAccentColor(0x79d4bd)
    .addTextDisplayComponents(T(`# ${d.qr} CHUYỂN HOÀN · ${row.order_code}`),
      T(`**Theo bảng tính ${row.quote_revision} đã được khách xác nhận · ${percent(row.quote)}%**${row.pendingQuote ? `\n${d.change} Đề xuất ${percent(row.pendingQuote)}% chưa được khách đồng ý. QR này vẫn theo phương án đã xác nhận ở trên.` : ''}`))
    .addSeparatorComponents(separator()).addTextDisplayComponents(T(refundQuoteLines(row.quote, d).join('\n')))
    .addSeparatorComponents(separator()).addTextDisplayComponents(T(`${d.bank} **Ngân hàng:** ${bank.bankName}\n${d.account} **Số tài khoản:** \`${bank.account}\`\n${d.owner} **Tên khách khai:** ${bank.name}\n\n**Kiểm tra tên thụ hưởng trong ứng dụng ngân hàng trước khi chuyển.**`))
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder()
      .setURL('attachment://refund.png').setDescription(`QR hoàn ${money(row.quote.refund)} cho ${row.order_code}, bảng tính ${row.quote_revision}`)))
    .addTextDisplayComponents(T(`${d.info} Chuyển xong, ghi nhận vào sổ: \`/hoantien ghi-nhan ma_don:${row.order_code} so_tien_hoan:${row.quote.refund}\` kèm mã giao dịch ngân hàng.`));
  return { flags: MessageFlags.IsComponentsV2, components: [card], files: [new AttachmentBuilder(await qrPng(payload), { name: 'refund.png' })], allowedMentions: { parse: [] } };
}

/** QR + bank details for the website admin (admin role only). */
export async function buildRefundPayoutData(row) {
  const bank = readRefundBank(row);
  const payload = buildVerifiedRefundVietQR({ ...bank, amount: row.quote.refund, orderCode: row.order_code });
  const png = await qrPng(payload);
  return { orderCode: row.order_code, amount: row.quote.refund, quoteRevision: row.quote_revision,
    bankBin: bank.bankBin, bankName: bank.bankName, account: bank.account, name: bank.name,
    qrDataUrl: `data:image/png;base64,${png.toString('base64')}` };
}
