import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { assertStaffCapability } from '../utils/permissions.js';
import { db } from '../database/db.js';
import { getOrderByCode, OrderPaymentError, updatePaidOrderRefund } from '../services/orderService.js';
import { PaidOrderRefundError } from '../services/paidOrderRefundService.js';
import { updateOrderLogMessage } from '../services/notificationService.js';
import { emitStaffLog } from '../services/staffLogService.js';
import {
  describeRefundBreakdown, getActiveRefund, getRefundSummary, getRevenueSummary, MAX_REFUND_FEE_PERCENT,
  previewOrderRefund, REFUND_REASONS, RefundLedgerError,
} from '../services/refundLedgerService.js';
import { formatCurrency } from '../utils/formatters.js';

const reasonChoices = Object.entries(REFUND_REASONS)
  .map(([value, reason]) => ({ name: `${reason.label} (${reason.defaultFeePercent}%)`.slice(0, 100), value }));

const orderOption = (option) => option.setName('ma_don').setDescription('Mã đơn hàng, ví dụ CN_123456').setRequired(true);
const reasonOption = (option) => option.setName('ly_do').setDescription('Lý do hoàn tiền (quyết định % phí mặc định)').addChoices(...reasonChoices);
const feeOption = (option) => option.setName('phi_phan_tram')
  .setDescription(`Phí hoàn tiền tự chỉnh, 0–${MAX_REFUND_FEE_PERCENT}%. Bỏ trống = mặc định theo lý do`)
  .setMinValue(0).setMaxValue(MAX_REFUND_FEE_PERCENT);

export const data = new SlashCommandBuilder()
  .setName('hoantien')
  .setDescription('Tính, ghi nhận, tra cứu và thống kê hoàn tiền của shop.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) => sub.setName('tinh').setDescription('Tính số tiền hoàn và bảng chiết khấu để gửi khách')
    .addStringOption(orderOption).addStringOption(reasonOption).addNumberOption(feeOption)
    .addIntegerOption((option) => option.setName('khau_tru_khac').setDescription('Khấu trừ khác (VND), cần ghi chú khi gửi khách').setMinValue(0)))
  .addSubcommand((sub) => sub.setName('ghi-nhan').setDescription('Ghi nhận đã chuyển khoản hoàn tiền cho khách (vào sổ doanh thu)')
    .addStringOption(orderOption)
    .addIntegerOption((option) => option.setName('so_tien_hoan').setDescription('Số VND thực tế đã chuyển cho khách').setRequired(true).setMinValue(1))
    .addStringOption(reasonOption).addNumberOption(feeOption)
    .addStringOption((option) => option.setName('ma_giao_dich').setDescription('Mã giao dịch ngân hàng để đối soát').setMaxLength(80))
    .addStringOption((option) => option.setName('ghi_chu').setDescription('Ghi chú nội bộ').setMaxLength(240)))
  .addSubcommand((sub) => sub.setName('tra-cuu').setDescription('Xem lại chi tiết hoàn tiền của một đơn').addStringOption(orderOption))
  .addSubcommand((sub) => sub.setName('thong-ke').setDescription('Thống kê hoàn tiền và doanh thu thực nhận')
    .addStringOption((option) => option.setName('thoi_gian').setDescription('Khoảng thời gian').setRequired(true).addChoices(
      { name: 'Hôm nay', value: 'today' },
      { name: '7 ngày qua', value: 'week' },
      { name: 'Tháng này', value: 'month' },
      { name: 'Tháng trước', value: 'last_month' },
      { name: 'Toàn bộ', value: 'all' },
    )));

// Calendar boundaries in Vietnam time (UTC+7), returned as UTC ISO strings.
export function refundPeriod(key, now = new Date()) {
  const offset = 7 * 3_600_000;
  const local = new Date(now.getTime() + offset);
  const at = (y, m, d) => new Date(Date.UTC(y, m, d) - offset).toISOString();
  const [y, m, d] = [local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()];
  const end = now.toISOString();
  if (key === 'today') return { from: at(y, m, d), to: end, label: 'hôm nay' };
  if (key === 'week') return { from: new Date(now.getTime() - 7 * 86_400_000).toISOString(), to: end, label: '7 ngày qua' };
  if (key === 'month') return { from: at(y, m, 1), to: end, label: 'tháng này' };
  if (key === 'last_month') return { from: at(y, m - 1, 1), to: new Date(Date.parse(at(y, m, 1)) - 1).toISOString(), label: 'tháng trước' };
  return { from: null, to: null, label: 'toàn bộ thời gian' };
}

const vnTime = (iso) => (iso ? new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—');

function ledgerLines(row) {
  const reason = REFUND_REASONS[row.reason_code]?.label ?? row.reason_code;
  return [
    `> **Đã thanh toán:** ${formatCurrency(row.paid_amount)}`,
    row.usage_deduction ? `> **Trừ thời gian đã dùng${row.used_days != null ? ` (${row.used_days}/${row.total_days} ngày)` : ''}:** −${formatCurrency(row.usage_deduction)}` : null,
    row.fee_amount ? `> **Phí hoàn${row.fee_percent != null ? ` ${row.fee_percent}%` : ''}:** −${formatCurrency(row.fee_amount)}` : null,
    row.other_deduction ? `> **${row.other_deduction > 0 ? 'Khấu trừ khác' : 'Shop hỗ trợ thêm'}:** ${row.other_deduction > 0 ? '−' : '+'}${formatCurrency(Math.abs(row.other_deduction))}` : null,
    `> **Đã hoàn cho khách:** ${formatCurrency(row.refund_amount)} · **Shop giữ lại:** ${formatCurrency(row.retained_amount)}`,
    `> **Lý do:** ${reason}${row.reason_note ? ` · ${row.reason_note}` : ''}`,
    `> **Ngày hoàn:** ${vnTime(row.refunded_at)}${row.actor_id ? ` · bởi <@${row.actor_id}>` : ''}`,
    row.transfer_reference ? `> **Mã giao dịch:** \`${row.transfer_reference}\`` : null,
    row.needs_review ? '> ⚠️ Dữ liệu cũ thiếu số tiền hoàn, cần đối soát lại.' : null,
  ].filter(Boolean);
}

export async function execute(interaction) {
  const E = createEmojiResolver(interaction?.guildId);
  await interaction.deferReply({ ephemeral: true });
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!assertStaffCapability(member, getGuildConfig(interaction.guildId), 'MANAGE')) {
    await interaction.editReply(`${E('status_warn')} Chỉ staff/manager mới được dùng lệnh này.`);
    return;
  }
  const sub = interaction.options.getSubcommand();
  try {
    if (sub === 'thong-ke') {
      const period = refundPeriod(interaction.options.getString('thoi_gian', true));
      const range = { from: period.from, to: period.to };
      const revenue = getRevenueSummary(db, { ...range, guildId: interaction.guildId });
      const refunds = getRefundSummary(db, { ...range, guildId: interaction.guildId });
      const reasons = refunds.byReason.map((row) => `> ${REFUND_REASONS[row.reasonCode]?.label ?? row.reasonCode}: ${row.count} đơn · hoàn ${formatCurrency(row.refunded)} · giữ ${formatCurrency(row.retained)}`);
      await interaction.editReply([
        `### ${E('icon_chart')} Hoàn tiền & doanh thu · ${period.label}`,
        `> **Doanh thu gộp:** ${formatCurrency(revenue.gross)} (${revenue.paidOrders} đơn đã thanh toán)`,
        `> **Đã hoàn:** ${formatCurrency(refunds.refunded)} · ${refunds.count} đơn`,
        `> **Doanh thu thực nhận:** **${formatCurrency(revenue.net)}**`,
        `> **Shop giữ lại từ đơn hoàn:** ${formatCurrency(refunds.retained)} (thời gian đã dùng ${formatCurrency(refunds.usage)} · phí ${formatCurrency(refunds.fees)} · khác ${formatCurrency(refunds.other)})`,
        refunds.needsReview ? `> ⚠️ ${refunds.needsReview} đơn hoàn cũ thiếu số tiền, cần đối soát.` : null,
        reasons.length ? '**Theo lý do**' : null,
        ...reasons,
        '-# Đơn hoàn trừ vào doanh thu của ngày hoàn tiền. Chi tiết từng đơn: website admin → Hoàn tiền.',
      ].filter(Boolean).join('\n'));
      return;
    }

    const orderCode = interaction.options.getString('ma_don', true).trim().toUpperCase();
    const order = getOrderByCode(orderCode);
    if (!order || order.guild_id !== interaction.guildId) {
      await interaction.editReply(`${E('status_warn')} Không tìm thấy mã đơn trong máy chủ này.`);
      return;
    }

    if (sub === 'tra-cuu') {
      const row = getActiveRefund(db, orderCode);
      if (!row) {
        await interaction.editReply(`${E('status_info')} Đơn \`${orderCode}\` chưa có hoàn tiền trong sổ (trạng thái hiện tại: \`${order.status}\`).`);
        return;
      }
      await interaction.editReply([`### ${E('payment_money')} Hoàn tiền đơn \`${orderCode}\``,
        `> **Sản phẩm:** ${order.product_name} · khách <@${order.customer_id}>`, ...ledgerLines(row)].join('\n'));
      return;
    }

    const reasonCode = interaction.options.getString('ly_do');
    const feePercent = interaction.options.getNumber('phi_phan_tram');

    if (sub === 'tinh') {
      const quote = previewOrderRefund(db, order, { reasonCode: reasonCode ?? 'OTHER', feePercent,
        otherDeduction: interaction.options.getInteger('khau_tru_khac') ?? 0 });
      const text = describeRefundBreakdown(quote);
      await interaction.editReply([
        `### ${E('payment_money')} Bảng tính hoàn tiền đơn \`${orderCode}\``,
        `-# Chỉ là bảng tính, chưa ghi nhận gì. Thời gian dùng tính đến ${quote.cutoff ? vnTime(quote.cutoff) : 'chưa giao'}.`,
        '**Gửi khách:**',
        '```',
        `Đơn ${orderCode} · ${order.product_name}`,
        ...text.lines.map((line) => line.replaceAll('**', '')),
        `Lý do: ${text.reasonLabel}`,
        text.explanation,
        '```',
        `Ghi nhận sau khi đã chuyển khoản: \`/hoantien ghi-nhan ma_don:${orderCode} so_tien_hoan:${quote.refund}${reasonCode ? ` ly_do:${reasonCode}` : ''}${feePercent != null ? ` phi_phan_tram:${feePercent}` : ''}\``,
      ].join('\n'));
      return;
    }

    if (sub === 'ghi-nhan') {
      if (order.status !== 'REFUND_PENDING' && order.status !== 'REFUNDED') {
        await interaction.editReply(`${E('status_warn')} Đơn cần ở trạng thái **Chờ hoàn tiền** trước. Dùng \`/quanly-don ma_don:${orderCode} hanh_dong:Ghi nhận yêu cầu hoàn tiền\`.`);
        return;
      }
      const amount = interaction.options.getInteger('so_tien_hoan', true);
      const { updated, changed } = updatePaidOrderRefund({
        orderCode, guildId: interaction.guildId, actorId: interaction.user.id, action: 'REFUNDED', amount,
        reason: interaction.options.getString('ghi_chu')?.trim() || null,
        reasonCode, feePercent,
        transferReference: interaction.options.getString('ma_giao_dich')?.trim() || null,
      });
      if (!changed) {
        await interaction.editReply(`${E('status_info')} Đơn \`${orderCode}\` đã ghi nhận hoàn tiền từ trước. Xem: \`/hoantien tra-cuu ma_don:${orderCode}\`.`);
        return;
      }
      const row = getActiveRefund(db, orderCode);
      await interaction.editReply([`${E('status_check')} Đã ghi nhận hoàn tiền đơn \`${orderCode}\` vào sổ doanh thu.`,
        ...ledgerLines(row), '> Nếu ticket vẫn mở, dùng `/close` và xác nhận để lưu transcript rồi đóng.'].join('\n'));
      await Promise.allSettled([
        updateOrderLogMessage(interaction.guild, updated),
        emitStaffLog(interaction.client, { guildId: interaction.guildId, actorId: interaction.user.id,
          targetId: updated.customer_id, action: 'ORDER_REFUND_RECORDED',
          detail: `Hoàn ${formatCurrency(row.refund_amount)} · giữ lại ${formatCurrency(row.retained_amount)} · ${row.reason_code}`,
          relatedOrderCode: orderCode }),
      ]);
    }
  } catch (error) {
    if (error instanceof RefundLedgerError || error instanceof PaidOrderRefundError || error instanceof OrderPaymentError) {
      await interaction.editReply(`${E('status_warn')} ${error.message}`);
      return;
    }
    console.error('[HOANTIEN]', error);
    await interaction.editReply(`${E('status_cross')} Không xử lý được yêu cầu hoàn tiền. Vui lòng thử lại.`);
  }
}
