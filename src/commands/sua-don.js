import { createEmojiResolver } from '../utils/emojiHelper.js';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import {
  getOrderByCodeRaw,
  updateOrderFieldsRaw,
  insertStaffLogRaw,
} from '../services/v11DbHelpers.js';
import {
  refreshCompletedTicketMessage,
  updateOrderLogMessage,
} from '../services/notificationService.js';
import { scheduleAdminOrderCenterRefresh } from '../services/adminOrderCenterService.js';
import { syncOrderFeedbackMessages } from '../services/feedbackService.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { assertStaffCapability } from '../utils/permissions.js';

export const data = new SlashCommandBuilder()
  .setName('sua-don')
  .setDescription('Sửa thông tin đơn hàng, gồm thời hạn theo tháng, ngày hoặc vĩnh viễn.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((o) => o.setName('ma_don').setDescription('Mã đơn hàng').setRequired(true))
  .addStringOption((o) => o.setName('san_pham').setDescription('Tên sản phẩm mới').setRequired(false))
  .addIntegerOption((o) => o.setName('so_luong').setDescription('Số lượng mới').setRequired(false).setMinValue(1))
  .addIntegerOption((o) => o.setName('so_thang').setDescription('Số tháng mới').setRequired(false).setMinValue(1).setMaxValue(36))
  .addIntegerOption((o) => o.setName('so_ngay').setDescription('Số ngày mới, ví dụ 7').setRequired(false).setMinValue(1).setMaxValue(3650))
  .addStringOption((o) => o
    .setName('thoi_han')
    .setDescription('Chọn Vĩnh viễn để xóa ngày hết hạn hiện tại của đơn')
    .setRequired(false)
    .addChoices({ name: 'Vĩnh viễn', value: 'permanent' }))
  .addIntegerOption((o) => o.setName('gia_tien').setDescription('Giá mới').setRequired(false).setMinValue(0))
  .addBooleanOption((o) => o.setName('dong_bo').setDescription('Đồng bộ lại thẻ/feedback, không cần đổi dữ liệu đơn').setRequired(false));

export async function execute(interaction) {
  const E = createEmojiResolver(interaction?.guildId);
  await interaction.deferReply({ flags: 64 });

  try {
    const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
    if (!assertStaffCapability(member, getGuildConfig(interaction.guildId), 'MANAGE')) {
      await interaction.editReply(`${E('status_warn')} Chỉ manager mới được sửa hoặc đồng bộ đơn.`);
      return;
    }
    const orderCode = interaction.options.getString('ma_don', true).trim().toUpperCase();
    const before = getOrderByCodeRaw(orderCode);
    if (!before || before.guild_id !== interaction.guildId) {
      await interaction.editReply(`${E('status_warn')} Không tìm thấy mã đơn.`);
      return;
    }

    const payload = {};
    const productName = interaction.options.getString('san_pham');
    const quantity = interaction.options.getInteger('so_luong');
    const months = interaction.options.getInteger('so_thang');
    const days = interaction.options.getInteger('so_ngay');
    const isPermanent = interaction.options.getString('thoi_han') === 'permanent';
    const amount = interaction.options.getInteger('gia_tien');

    const selectedDurationCount = [months !== null, days !== null, isPermanent].filter(Boolean).length;
    if (selectedDurationCount > 1) {
      await interaction.editReply(`${E('status_warn')} Chỉ chọn một loại thời hạn: **số tháng**, **số ngày** hoặc **Vĩnh viễn**.`);
      return;
    }

    if (amount !== null && Number(amount) !== Number(before.total_amount ?? 0) && before.payment_status !== 'PAID' && (before.payment_link_id || before.payment_checkout_url || before.payment_qr_code)) {
      await interaction.editReply(`${E('status_warn')} Đơn này đã tạo link/QR PayOS. Hãy giữ nguyên giá hoặc tạo lại flow thanh toán mới để tránh lệch số tiền.`);
      return;
    }

    if (productName !== null) payload.product_name = productName;
    if (quantity !== null) payload.quantity = quantity;
    if (months !== null) {
      payload.duration_months = months;
      payload.duration_days = null;
    }
    if (days !== null) {
      payload.duration_months = 0;
      payload.duration_days = days;
    }
    if (isPermanent) {
      payload.duration_months = 0;
      payload.duration_days = null;
      payload.expiry_at = null;
    }
    if (amount !== null) payload.total_amount = amount;

    const hasChanges = Object.keys(payload).length > 0;
    if (!hasChanges && !interaction.options.getBoolean('dong_bo')) {
      await interaction.editReply(`${E('status_warn')} Bạn chưa nhập trường nào để sửa.`);
      return;
    }

    const after = hasChanges ? updateOrderFieldsRaw(orderCode, payload) : before;
    const syncIssues = [];
    try {
      await updateOrderLogMessage(interaction.guild, after);
    } catch (error) {
      console.error(`[ORDER/EDIT] Không thể đồng bộ log đơn ${orderCode}:`, error);
      syncIssues.push('log đơn');
    }

    const completionSync = await refreshCompletedTicketMessage({
      guild: interaction.guild,
      order: after,
    });
    if (!completionSync.synced && completionSync.status !== 'not_completed') syncIssues.push('thẻ hoàn thành');
    if (completionSync.dm_synced === false) syncIssues.push('DM cập nhật');
    const feedbackSync = await syncOrderFeedbackMessages({ guild: interaction.guild, order: after });
    if (!feedbackSync.synced) syncIssues.push('bài feedback');
    scheduleAdminOrderCenterRefresh(after.guild_id, 250);

    insertStaffLogRaw({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      action: hasChanges ? 'ORDER_EDITED' : 'ORDER_PRESENTATION_SYNC',
      orderCode,
      targetCustomerId: after.customer_id,
      beforeJson: JSON.stringify({
        product_name: before.product_name,
        quantity: before.quantity,
        total_amount: before.total_amount,
        duration_months: before.duration_months,
        duration_days: before.duration_days,
        expiry_at: before.expiry_at,
      }),
      afterJson: JSON.stringify({
        product_name: after.product_name,
        quantity: after.quantity,
        total_amount: after.total_amount,
        duration_months: after.duration_months,
        duration_days: after.duration_days,
        expiry_at: after.expiry_at,
      }),
    });

    const expiryText = after.expiry_at
      ? `\n🗓️ Hạn mới: <t:${Math.floor(new Date(after.expiry_at).getTime() / 1000)}:F>`
      : Number(after.duration_months) === 0 && !Number(after.duration_days)
        ? '\n♾️ Thời hạn mới: **Vĩnh viễn**'
        : '';
    const completionText = completionSync.synced
      ? completionSync.status === 'dm_updated'
        ? `\n${E('status_check')} Thẻ ticket cũ không thể cập nhật; đã đồng bộ thông tin đơn qua **DM riêng của khách**.`
        : completionSync.status === 'created'
          ? `\n${E('status_check')} Đã phục hồi **thẻ hoàn thành** trong ticket.`
          : `\n${E('status_check')} Đã đồng bộ **thẻ hoàn thành** trong ticket.`
      : ['missing', 'channel_missing', 'missing_staff'].includes(completionSync.status)
        ? '\n⚠️ Dữ liệu đã lưu nhưng không tìm thấy thẻ hoàn thành cũ để sửa.'
        : '';
    const issueText = syncIssues.length
      ? `\n⚠️ Chưa đồng bộ được: **${syncIssues.join(', ')}**. Dữ liệu đơn vẫn đã được lưu.`
      : '';
    const feedbackText = feedbackSync.count > 0 ? `\n${E('status_check')} Đã đồng bộ **bài feedback**, giữ nguyên số sao và nhận xét.` : '';
    const retryText = syncIssues.length ? `\nThử lại bằng \`/sua-don ma_don:${after.order_code} dong_bo:true\`; nếu vẫn lỗi, kiểm tra quyền bot và DM của khách.` : '';
    await interaction.editReply(`${E('status_check')} Đã ${hasChanges ? 'cập nhật' : 'đồng bộ'} đơn \`${after.order_code}\`.${expiryText}${completionText}${feedbackText}${issueText}${retryText}`);
  } catch (error) {
    console.error('[ORDER/EDIT] Lỗi:', error);
    await interaction.editReply(`${E('status_cross')} Không thể sửa đơn: ${error.message ?? 'Lỗi không xác định'}`);
  }
}
