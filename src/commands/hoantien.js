import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { assertStaffCapability } from '../utils/permissions.js';
import { db } from '../database/db.js';
import { getOrderByCode, OrderPaymentError, updatePaidOrderRefund } from '../services/orderService.js';
import { PaidOrderRefundError } from '../services/paidOrderRefundService.js';
import { updateOrderLogMessage } from '../services/notificationService.js';
import { emitStaffLog } from '../services/staffLogService.js';
import {
  getActiveRefund, getRefundSummary, getRevenueSummary, MAX_REFUND_FEE_PERCENT, MAX_REFUND_OTHER_ITEMS, previewOrderRefund, REFUND_REASONS, RefundLedgerError,
} from '../services/refundLedgerService.js';
import { getRefundCase, refundReview } from '../services/geminiRefundService.js';
import { openStandardRefundCase } from '../services/refundCaseService.js';
import { buildRefundPayout } from '../services/refundPresentation.js';
import { publishStandardRefundCase } from '../services/refundTicketNoticeService.js';
import { caseStatusCard, ledgerCard, noticeCard, quoteCard, statsCard } from '../services/refundManagerCards.js';
import { formatCurrency } from '../utils/formatters.js';

const reasonChoices = Object.entries(REFUND_REASONS)
  .map(([value, reason]) => ({ name: `${reason.label} (${reason.defaultFeePercent}%)`.slice(0, 100), value }));

const orderOption = (option) => option.setName('ma_don').setDescription('Mã đơn hàng, ví dụ CN_123456').setRequired(true);
const reasonOption = (required) => (option) => option.setName('ly_do').setDescription('Lý do hoàn tiền (quyết định % phí mặc định)')
  .setRequired(required).addChoices(...reasonChoices);
const feeOption = (option) => option.setName('phi_phan_tram')
  .setDescription(`Phí hoàn tiền tự chỉnh, 0–${MAX_REFUND_FEE_PERCENT}%. Bỏ trống = mặc định theo lý do`)
  .setMinValue(0).setMaxValue(MAX_REFUND_FEE_PERCENT);
const otherOption = (option) => option.setName('khau_tru_khac').setDescription('Khấu trừ khác không tên (VND)').setMinValue(0);
const COST_SLOTS = Array.from({ length: MAX_REFUND_OTHER_ITEMS }, (_, i) => i + 1);
// Up to three named extra costs, e.g. "Phí chuyển khoản liên ngân hàng" · 5.000đ. The customer sees each line.
const withCosts = (sub) => {
  for (const n of COST_SLOTS) {
    sub.addStringOption((option) => option.setName(`chi_phi_${n}_ten`).setDescription(`Tên chi phí khác ${n} (khách sẽ thấy)`).setMaxLength(60))
      .addIntegerOption((option) => option.setName(`chi_phi_${n}_tien`).setDescription(`Số tiền chi phí khác ${n} (VND)`).setMinValue(1));
  }
  return sub;
};
const readCosts = (options) => COST_SLOTS.map((n) => ({ label: options.getString(`chi_phi_${n}_ten`)?.trim() || null,
  amount: options.getInteger(`chi_phi_${n}_tien`) })).filter((item) => item.label || item.amount);

export const data = new SlashCommandBuilder()
  .setName('hoantien')
  .setDescription('Tính, gửi hồ sơ, quét QR, ghi nhận và thống kê hoàn tiền.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) => withCosts(sub.setName('tinh').setDescription('Xem bảng tính hoàn tiền (chưa gửi khách, chưa ghi nhận)')
    .addStringOption(orderOption).addStringOption(reasonOption(false)).addNumberOption(feeOption).addIntegerOption(otherOption)))
  .addSubcommand((sub) => withCosts(sub.setName('mo-ho-so').setDescription('Mở hồ sơ và gửi bảng tính vào ticket để khách nhập STK')
    .addStringOption(orderOption).addStringOption(reasonOption(true)).addNumberOption(feeOption).addIntegerOption(otherOption)
    .addStringOption((option) => option.setName('ghi_chu').setDescription('Ghi chú nội bộ').setMaxLength(200))))
  .addSubcommand((sub) => withCosts(sub.setName('chao-lai').setDescription('Hủy mức hoàn cũ (kể cả khi khách đã nhập STK) và gửi mức mới')
    .addStringOption(orderOption)
    .addStringOption((option) => option.setName('ly_do_dieu_chinh').setDescription('Lý do hủy mức cũ, khách sẽ đọc').setRequired(true).setMinLength(5).setMaxLength(300))
    .addStringOption((option) => option.setName('xac_nhan').setDescription('Shop chưa chuyển tiền theo mức cũ?').setRequired(true)
      .addChoices({ name: 'Đúng, shop CHƯA chuyển tiền theo mức cũ', value: 'NOT_PAID' }))
    .addStringOption(reasonOption(false)).addNumberOption(feeOption).addIntegerOption(otherOption)))
  .addSubcommand((sub) => sub.setName('qr').setDescription('Mở QR chuyển hoàn theo STK khách đã xác nhận (chỉ bạn thấy)')
    .addStringOption(orderOption))
  .addSubcommand((sub) => sub.setName('ghi-nhan').setDescription('Ghi nhận đã chuyển khoản hoàn cho khách (vào sổ doanh thu)')
    .addStringOption(orderOption)
    .addIntegerOption((option) => option.setName('so_tien_hoan').setDescription('Số VND thực tế đã chuyển cho khách').setRequired(true).setMinValue(1))
    .addStringOption(reasonOption(false)).addNumberOption(feeOption)
    .addStringOption((option) => option.setName('ma_giao_dich').setDescription('Mã giao dịch ngân hàng để đối soát').setMaxLength(80))
    .addStringOption((option) => option.setName('ghi_chu').setDescription('Ghi chú nội bộ').setMaxLength(240)))
  .addSubcommand((sub) => sub.setName('tra-cuu').setDescription('Xem lại hồ sơ / sổ hoàn tiền của một đơn').addStringOption(orderOption))
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
  if (key === 'today') return { from: at(y, m, d), to: end, label: 'Hôm nay' };
  if (key === 'week') return { from: new Date(now.getTime() - 7 * 86_400_000).toISOString(), to: end, label: '7 ngày qua' };
  if (key === 'month') return { from: at(y, m, 1), to: end, label: 'Tháng này' };
  if (key === 'last_month') return { from: at(y, m - 1, 1), to: new Date(Date.parse(at(y, m, 1)) - 1).toISOString(), label: 'Tháng trước' };
  return { from: null, to: null, label: 'Toàn bộ thời gian' };
}

export async function execute(interaction) {
  const E = createEmojiResolver(interaction?.guildId);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!assertStaffCapability(member, guildConfig, 'MANAGE')) {
    await interaction.editReply(`${E('status_warn')} Chỉ staff/manager mới được dùng lệnh này.`);
    return;
  }
  const guildId = interaction.guildId;
  const reply = (payload) => interaction.editReply(payload);
  const sub = interaction.options.getSubcommand();
  try {
    if (sub === 'thong-ke') {
      const period = refundPeriod(interaction.options.getString('thoi_gian', true));
      const range = { from: period.from, to: period.to, guildId };
      await reply(statsCard({ guildId, label: period.label, revenue: getRevenueSummary(db, range), refunds: getRefundSummary(db, range) }));
      return;
    }

    const orderCode = interaction.options.getString('ma_don', true).trim().toUpperCase();
    const order = getOrderByCode(orderCode);
    if (!order || order.guild_id !== guildId) {
      await reply(noticeCard({ guildId, title: 'Không tìm thấy đơn', body: `Mã \`${orderCode}\` không thuộc máy chủ này.` }));
      return;
    }
    const reasonCode = interaction.options.getString('ly_do');
    const feePercent = interaction.options.getNumber('phi_phan_tram');
    const otherDeduction = interaction.options.getInteger('khau_tru_khac') ?? 0;
    const otherItems = ['tinh', 'mo-ho-so', 'chao-lai'].includes(sub) ? readCosts(interaction.options) : [];

    if (sub === 'tinh') {
      await reply(quoteCard({ guildId, order, quote: previewOrderRefund(db, order, { reasonCode: reasonCode ?? 'OTHER', feePercent, otherDeduction, otherItems }) }));
      return;
    }

    if (sub === 'mo-ho-so' || sub === 'chao-lai') {
      const reoffer = sub === 'chao-lai' ? { note: interaction.options.getString('ly_do_dieu_chinh', true),
        notPaid: interaction.options.getString('xac_nhan', true) === 'NOT_PAID' } : null;
      // A re-offer keeps the previous reason and fee unless the manager changes them.
      const previous = reoffer ? getRefundCase(db, orderCode) : null;
      const prevQuote = previous?.guild_id === guildId ? refundReview(previous).quote : null;
      const prevStandard = prevQuote?.kind === 'STANDARD';
      const useReason = reasonCode ?? (prevStandard ? prevQuote.reasonCode : null) ?? 'OTHER';
      const useFee = feePercent ?? (reasonCode == null && prevStandard ? prevQuote.feeBps / 100 : null);
      const note = reoffer ? `Chào lại: ${reoffer.note}` : interaction.options.getString('ghi_chu')?.trim() || null;
      const row = openStandardRefundCase(db, { orderCode, guildId, actorId: interaction.user.id, reasonCode: useReason, feePercent: useFee,
        otherDeduction, otherItems, note, reoffer });
      const opened = await publishStandardRefundCase(db, { id: row.id, guild: interaction.guild, guildConfig });
      const quote = previewOrderRefund(db, getOrderByCode(orderCode), { reasonCode: useReason, feePercent: useFee, otherDeduction, otherItems });
      await reply(quoteCard({ guildId, order, quote, opened, reoffer: row.quote.reoffer }));
      await Promise.allSettled([
        updateOrderLogMessage(interaction.guild, getOrderByCode(orderCode)),
        emitStaffLog(interaction.client, { guildId, actorId: interaction.user.id, targetId: order.customer_id,
          action: reoffer ? 'ORDER_REFUND_REOFFERED' : 'ORDER_REFUND_CASE_OPENED',
          detail: reoffer
            ? `Chào lại ${formatCurrency(row.quote.reoffer.previousRefund)} → ${formatCurrency(row.quote.refund)} · ${reoffer.note}`.slice(0, 300)
            : `Mở hồ sơ hoàn ${formatCurrency(row.quote.refund)} · ${useReason}`,
          relatedOrderCode: orderCode }),
      ]);
      return;
    }

    if (sub === 'qr') {
      const caseRow = getRefundCase(db, orderCode);
      if (!caseRow || caseRow.guild_id !== guildId) {
        await reply(noticeCard({ guildId, title: 'Chưa có hồ sơ hoàn', body: `Mở hồ sơ trước: \`/hoantien mo-ho-so ma_don:${orderCode}\`.` }));
        return;
      }
      if (caseRow.stage !== 'READY_TO_PAY') {
        await reply(caseStatusCard({ guildId, order, caseRow }));
        return;
      }
      await reply(await buildRefundPayout(caseRow));
      return;
    }

    if (sub === 'tra-cuu') {
      const row = getActiveRefund(db, orderCode);
      const caseRow = getRefundCase(db, orderCode);
      if (row) await reply(ledgerCard({ guildId, order, row, title: 'SỔ HOÀN TIỀN', caseRow }));
      else if (caseRow?.active) await reply(caseStatusCard({ guildId, order, caseRow }));
      else await reply(noticeCard({ guildId, tone: 'info', title: 'Chưa có hoàn tiền', body: `Đơn \`${orderCode}\` chưa có trong sổ hoàn tiền. Trạng thái hiện tại: \`${order.status}\`.` }));
      return;
    }

    if (sub === 'ghi-nhan') {
      if (order.status !== 'REFUND_PENDING' && order.status !== 'REFUNDED') {
        await reply(noticeCard({ guildId, title: 'Đơn chưa ở trạng thái chờ hoàn',
          body: `Mở hồ sơ trước bằng \`/hoantien mo-ho-so ma_don:${orderCode}\` hoặc \`/quanly-don\` → **Ghi nhận yêu cầu hoàn tiền**.` }));
        return;
      }
      const amount = interaction.options.getInteger('so_tien_hoan', true);
      const { updated, changed } = updatePaidOrderRefund({
        orderCode, guildId, actorId: interaction.user.id, action: 'REFUNDED', amount,
        reason: interaction.options.getString('ghi_chu')?.trim() || null, reasonCode, feePercent,
        transferReference: interaction.options.getString('ma_giao_dich')?.trim() || null,
      });
      const row = getActiveRefund(db, orderCode);
      if (!changed) {
        await reply(row ? ledgerCard({ guildId, order, row, title: 'ĐƠN ĐÃ CÓ TRONG SỔ TỪ TRƯỚC' })
          : noticeCard({ guildId, tone: 'info', title: 'Đã ghi nhận từ trước', body: `Đơn \`${orderCode}\` đã hoàn tiền.` }));
        return;
      }
      await reply(ledgerCard({ guildId, order: updated, row }));
      await Promise.allSettled([
        updateOrderLogMessage(interaction.guild, updated),
        emitStaffLog(interaction.client, { guildId, actorId: interaction.user.id, targetId: updated.customer_id, action: 'ORDER_REFUND_RECORDED',
          detail: `Hoàn ${formatCurrency(row.refund_amount)} · giữ lại ${formatCurrency(row.retained_amount)} · ${row.reason_code}`,
          relatedOrderCode: orderCode }),
      ]);
    }
  } catch (error) {
    if (error instanceof RefundLedgerError || error instanceof PaidOrderRefundError || error instanceof OrderPaymentError) {
      await reply(noticeCard({ guildId, title: 'Chưa thực hiện được', body: error.message }));
      return;
    }
    console.error('[HOANTIEN]', error);
    await reply(noticeCard({ guildId, title: 'Có lỗi khi xử lý hoàn tiền', body: 'Không có thay đổi nào được lưu nếu bạn chưa thấy xác nhận. Vui lòng thử lại.' }));
  }
}
