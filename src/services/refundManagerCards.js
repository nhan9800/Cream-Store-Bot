// Components V2 cards for /hoantien (manager-only, ephemeral). Same visual language as the
// customer refund cards: accent containers, distinct custom emoji per card, native separators.
import { ContainerBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from 'discord.js';
import { formatCurrency as money } from '../utils/formatters.js';
import { REFUND_REASONS } from './refundLedgerService.js';
import { otherLines, refundDecorations } from './refundPresentation.js';

const T = (content) => new TextDisplayBuilder().setContent(content);
const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const vnTime = (iso) => (iso ? `<t:${Math.floor(Date.parse(iso) / 1000)}:f>` : '—');
const reasonLabel = (code) => REFUND_REASONS[code]?.label ?? code;
const COLORS = { quote: 0x8796cb, done: 0x79d4bd, warn: 0xe8b977, stats: 0x5f6d87 };
const wrap = (...containers) => ({ flags: MessageFlags.IsComponentsV2, components: containers, allowedMentions: { parse: [] } });

function breakdown(q, d) {
  return [
    `${d.paid} **Khách đã thanh toán** · ${money(q.paid)}`,
    q.usageDeduction ? `${d.usage} **Trừ thời gian đã dùng** (${q.usedDays}/${q.totalDays} ngày) · −${money(q.usageDeduction)}` : `${d.usage} **Thời gian đã dùng** · không trừ`,
    `${d.fee} **Phí hoàn ${q.feePercent}%** · −${money(q.feeAmount)}`,
    ...otherLines(q, d),
    `## ${d.total} Hoàn cho khách: ${money(q.refund)}`,
    `-# Shop giữ lại ${money(q.retained)} · tính vào doanh thu`,
  ].join('\n');
}

export function quoteCard({ guildId, order, quote, opened = null, reoffer = null }) {
  const d = refundDecorations(guildId, ['brand', 'receipt', 'calendar', 'paid', 'usage', 'fee', 'other', 'total', 'reason', 'submit', 'info', 'change']);
  const head = new ContainerBuilder().setAccentColor(opened ? COLORS.done : COLORS.quote)
    .addTextDisplayComponents(T(`# ${d.brand} ${reoffer ? 'ĐÃ CHÀO LẠI MỨC HOÀN' : opened ? 'ĐÃ MỞ HỒ SƠ HOÀN TIỀN' : 'BẢNG TÍNH HOÀN TIỀN'}`),
      T(`${d.receipt} **${order.order_code}** · ${order.product_name}\n-# Khách <@${order.customer_id}> · thời gian dùng tính đến ${quote.cutoff ? vnTime(quote.cutoff) : 'chưa giao hàng'}`))
    .addSeparatorComponents(sep())
    .addTextDisplayComponents(T(breakdown(quote, d)))
    .addSeparatorComponents(sep());
  if (reoffer) head.addTextDisplayComponents(T(`### ${d.change} Đã hủy bảng tính ${reoffer.previousRevision}\nMức cũ còn hoàn ${money(reoffer.previousRefund)}${reoffer.wasAccepted ? ' (khách đã xác nhận STK, thông tin đó đã được xóa)' : ''}.\n**Lý do gửi khách:** ${reoffer.note}`)).addSeparatorComponents(sep());
  head.addTextDisplayComponents(T(`### ${d.reason} ${reasonLabel(quote.reasonCode)}\n${REFUND_REASONS[quote.reasonCode]?.explanation ?? ''}`));
  const next = new ContainerBuilder().setAccentColor(COLORS.stats).addTextDisplayComponents(T(opened
    ? `### ${d.submit} Bước tiếp theo\n${opened.message}${opened.url ? `\n[Mở thẻ hồ sơ trong ticket](${opened.url})` : ''}\nKhách bấm **Xác nhận & nhập tài khoản**, xem trước rồi xác nhận. Sau đó dùng \`/hoantien qr ma_don:${order.order_code}\` để quét chuyển.`
    : `### ${d.info} Chưa gửi gì cho khách\nĐồng ý số liệu thì gửi hồ sơ: \`/hoantien mo-ho-so ma_don:${order.order_code} ly_do:${quote.reasonCode} phi_phan_tram:${quote.feePercent}\``));
  return wrap(head, next);
}

export function ledgerCard({ guildId, order, row, title = 'ĐÃ GHI VÀO SỔ HOÀN TIỀN', caseRow = null }) {
  const d = refundDecorations(guildId, ['confirm', 'receipt', 'paid', 'usage', 'fee', 'other', 'total', 'reason', 'clock', 'reference', 'owner', 'shield', 'ledger']);
  const lines = [
    `${d.paid} **Khách đã thanh toán** · ${money(row.paid_amount)}`,
    row.usage_deduction ? `${d.usage} **Trừ thời gian đã dùng**${row.used_days != null ? ` (${row.used_days}/${row.total_days} ngày)` : ''} · −${money(row.usage_deduction)}` : null,
    row.fee_amount ? `${d.fee} **Phí hoàn${row.fee_percent != null ? ` ${row.fee_percent}%` : ''}** · −${money(row.fee_amount)}` : null,
    row.other_deduction ? `${d.other} **${row.other_deduction > 0 ? 'Khấu trừ khác' : 'Shop hỗ trợ thêm'}** · ${row.other_deduction > 0 ? '−' : '+'}${money(Math.abs(row.other_deduction))}` : null,
    `## ${d.total} Đã hoàn: ${money(row.refund_amount)}`,
    `-# Shop giữ lại ${money(row.retained_amount)} · tính vào doanh thu ngày hoàn`,
  ].filter(Boolean).join('\n');
  const meta = [
    `${d.reason} **Lý do:** ${reasonLabel(row.reason_code)}${row.reason_note ? ` · ${row.reason_note}` : ''}`,
    `${d.clock} **Ngày hoàn:** ${vnTime(row.refunded_at)}`,
    `${d.reference} **Mã giao dịch:** ${row.transfer_reference ? `\`${row.transfer_reference}\`` : 'chưa ghi'}`,
    `${d.owner} **Người ghi nhận:** ${row.actor_id ? `<@${row.actor_id}>` : 'không rõ'} · nguồn ${row.source}`,
    row.needs_review ? `${d.shield} **Cần đối soát:** dữ liệu cũ thiếu số tiền thực hoàn, đang tạm tính hoàn toàn bộ.` : null,
  ].filter(Boolean).join('\n');
  const card = new ContainerBuilder().setAccentColor(row.needs_review ? COLORS.warn : COLORS.done)
    .addTextDisplayComponents(T(`# ${d.confirm} ${title}`),
      T(`${d.receipt} **${order.order_code}** · ${order.product_name} · khách <@${order.customer_id}>`))
    .addSeparatorComponents(sep()).addTextDisplayComponents(T(lines))
    .addSeparatorComponents(sep()).addTextDisplayComponents(T(meta));
  if (caseRow) card.addTextDisplayComponents(T(`-# ${d.ledger} Hồ sơ khách: ${caseRow.stage} · bảng tính ${caseRow.quote_revision}`));
  return wrap(card);
}

export function caseStatusCard({ guildId, order, caseRow }) {
  const d = refundDecorations(guildId, ['brand', 'receipt', 'paid', 'total', 'clock', 'qr', 'info']);
  const ready = caseRow.stage === 'READY_TO_PAY';
  const card = new ContainerBuilder().setAccentColor(ready ? COLORS.done : COLORS.warn)
    .addTextDisplayComponents(T(`# ${d.brand} HỒ SƠ ĐANG MỞ`),
      T(`${d.receipt} **${order.order_code}** · ${order.product_name} · khách <@${order.customer_id}>`))
    .addSeparatorComponents(sep())
    .addTextDisplayComponents(T([
      `${d.paid} **Đã thanh toán:** ${money(caseRow.quote.paid)}`,
      `## ${d.total} Sẽ hoàn: ${money(caseRow.quote.refund)}`,
      `${d.clock} **Trạng thái:** ${ready ? 'Khách đã xác nhận STK, chờ shop chuyển' : 'Chờ khách xác nhận và nhập tài khoản'} · bảng tính ${caseRow.quote_revision}`,
      ready ? `${d.qr} Quét chuyển: \`/hoantien qr ma_don:${order.order_code}\`` : `${d.info} Chưa có dòng trong sổ hoàn tiền vì shop chưa chuyển khoản.`,
    ].join('\n')));
  return wrap(card);
}

export function statsCard({ guildId, label, revenue, refunds }) {
  const d = refundDecorations(guildId, ['usage', 'paid', 'brand', 'total', 'fee', 'reason', 'shield', 'ledger']);
  const head = new ContainerBuilder().setAccentColor(COLORS.stats)
    .addTextDisplayComponents(T(`# ${d.usage} HOÀN TIỀN & DOANH THU`), T(`-# ${label} · hoàn tiền trừ vào doanh thu của ngày hoàn`))
    .addSeparatorComponents(sep())
    .addTextDisplayComponents(T([
      `${d.paid} **Doanh thu gộp** · ${money(revenue.gross)} · ${revenue.paidOrders} đơn đã thanh toán`,
      `${d.brand} **Đã hoàn cho khách** · −${money(refunds.refunded)} · ${refunds.count} đơn`,
      `## ${d.total} Thực nhận: ${money(revenue.net)}`,
    ].join('\n')))
    .addSeparatorComponents(sep())
    .addTextDisplayComponents(T(`### ${d.fee} Shop giữ lại từ đơn hoàn: ${money(refunds.retained)}\nThời gian đã dùng ${money(refunds.usage)} · phí ${money(refunds.fees)} · khác ${money(refunds.other)}`));
  if (refunds.needsReview) head.addTextDisplayComponents(T(`${d.shield} **${refunds.needsReview} đơn hoàn cũ cần đối soát** số tiền thực hoàn.`));
  const parts = [head];
  if (refunds.byReason.length) {
    parts.push(new ContainerBuilder().setAccentColor(COLORS.quote).addTextDisplayComponents(T([
      `### ${d.reason} Theo lý do`,
      ...refunds.byReason.map((r) => `**${reasonLabel(r.reasonCode)}** · ${r.count} đơn · hoàn ${money(r.refunded)} · giữ ${money(r.retained)}`),
      ...(refunds.byProduct.length ? ['', `### ${d.ledger} Sản phẩm hoàn nhiều nhất`, ...refunds.byProduct.slice(0, 5)
        .map((p) => `**${p.productName || 'Không rõ'}** · ${p.count} đơn · hoàn ${money(p.refunded)}`)] : []),
      '-# Chi tiết từng đơn và xuất CSV: website admin → Hoàn tiền',
    ].join('\n'))));
  }
  return wrap(...parts);
}

export function noticeCard({ guildId, tone = 'warn', title, body }) {
  const d = refundDecorations(guildId, ['info', 'shield']);
  return wrap(new ContainerBuilder().setAccentColor(tone === 'warn' ? COLORS.warn : COLORS.stats)
    .addTextDisplayComponents(T(`### ${tone === 'warn' ? d.shield : d.info} ${title}`), T(body)));
}
