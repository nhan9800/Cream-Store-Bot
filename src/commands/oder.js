import { createEmojiResolver } from '../utils/emojiHelper.js';
import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { emitStaffLog } from '../services/staffLogService.js';
import { getTicketByChannelId } from '../services/ticketService.js';
import { createOrder, getQueuePosition, saveOrderLogMessage } from '../services/orderService.js';
import { ensureRateLimit } from '../services/abuseService.js';
import {
  buildOrderCreatedV2,
  buildQueuePositionV2,
  buildPaymentMethodSelector,
} from '../utils/embeds.js';
import { buildOrderLogContent, parseMoneyInput } from '../utils/formatters.js';
import { config } from '../config.js';
import { getCenarHub } from '../services/cenarHub.js';

export const data = new SlashCommandBuilder()
  .setName('oder')
  .setDescription('Tạo đơn hàng và liên kết trực tiếp với ticket hiện tại.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addUserOption((option) => option.setName('khach_hang').setDescription('Khách hàng của đơn này').setRequired(true))
  .addStringOption((option) => option.setName('san_pham').setDescription('Tên sản phẩm').setRequired(true).setMaxLength(100))
  .addIntegerOption((option) => option.setName('so_luong').setDescription('Số lượng sản phẩm').setRequired(true).setMinValue(1).setMaxValue(999))
  .addStringOption((option) => option.setName('gia_tien').setDescription('Số tiền cần thanh toán, ví dụ 55000 hoặc 55k').setRequired(false))
  .addIntegerOption((option) => option.setName('so_thang').setDescription('Thời hạn theo tháng (không nhập nếu dùng số ngày)').setRequired(false).setMinValue(1).setMaxValue(36))
  .addIntegerOption((option) => option.setName('so_ngay').setDescription('Thời hạn theo ngày, ví dụ 7 ngày').setRequired(false).setMinValue(1).setMaxValue(3650))
  .addChannelOption((option) => option.setName('ticket').setDescription('Ticket cần gắn với đơn. Bỏ trống nếu đang đứng trong ticket.').addChannelTypes(ChannelType.GuildText).setRequired(false))
  .addStringOption((option) => option.setName('ghi_chu').setDescription('Ghi chú nội bộ cho đơn').setRequired(false).setMaxLength(250));

export async function execute(interaction) {
  const E = createEmojiResolver(interaction?.guildId);
  await interaction.deferReply({ flags: 64 });
  try {
    const guildConfig = getGuildConfig(interaction.guildId);
    if (!guildConfig) {
      await interaction.editReply(`${E('status_warn')} Chưa setup hệ thống. Hãy chạy \`/setup-ticket\` trước.`);
      return;
    }

    ensureRateLimit({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      action: 'CREATE_ORDER',
      limit: config.orderCreateBurstLimit,
      windowSeconds: config.orderCreateBurstWindowSeconds,
      message: `${E('status_warn')} Bạn tạo đơn quá nhanh. Vui lòng chờ thêm rồi thử lại.`,
    });

    const customer = interaction.options.getUser('khach_hang', true);
    const productName = interaction.options.getString('san_pham', true);
    const quantity = interaction.options.getInteger('so_luong', true);
    const note = interaction.options.getString('ghi_chu');
    const amount = parseMoneyInput(interaction.options.getString('gia_tien')) ?? 0;
    const selectedDurationMonths = interaction.options.getInteger('so_thang');
    const durationDays = interaction.options.getInteger('so_ngay');
    if (selectedDurationMonths !== null && durationDays !== null) {
      await interaction.editReply(`${E('status_warn')} Chỉ chọn **số tháng** hoặc **số ngày**, không nhập cả hai.`);
      return;
    }
    const durationMonths = durationDays === null
      ? (selectedDurationMonths ?? config.defaultOrderDurationMonths)
      : 0;
    const ticketChannel = interaction.options.getChannel('ticket') ?? interaction.channel;

    const ticket = getTicketByChannelId(ticketChannel.id);
    const allowedTicketTypes = ['ORDER', 'SUPPORT', 'COMPLAINT', 'WARRANTY'];
    if (!ticket || ticket.status !== 'OPEN' || !allowedTicketTypes.includes(ticket.ticket_type)) {
      await interaction.editReply(`${E('status_warn')} Ticket này không được phép tạo đơn. Chỉ ticket mua hàng / hỗ trợ / khiếu nại / bảo hành mới được lên đơn.`);
      return;
    }
    if (ticket.customer_id !== customer.id) {
      await interaction.editReply(`${E('status_warn')} Khách hàng bạn chọn không trùng với chủ sở hữu của ticket này nên bot từ chối để tránh xung đột dữ liệu.`);
      return;
    }

    // ── Tạo đơn (ghi DB) — nếu bước NÀY lỗi thì mới là "lỗi tạo đơn" thực sự ──
    let order;
    try {
      order = createOrder({
        guildId: interaction.guildId,
        ticketId: ticket.id,
        ticketChannelId: ticket.channel_id,
        customerId: customer.id,
        productName,
        quantity,
        note,
        totalAmount: amount,
        durationMonths,
        durationDays,
        orderLogChannelId: guildConfig.order_log_channel_id,
        createdById: interaction.user.id,
      });
    } catch (createError) {
      console.error('[ORDER] Lỗi ghi đơn vào DB:', createError);
      await interaction.editReply(`${E('status_cross')} Không ghi được đơn vào hệ thống: ${createError.message ?? 'Lỗi không xác định'}`);
      return;
    }

    // Tới đây đơn ĐÃ nằm trong DB. Mọi bước dưới chỉ là phụ trợ (best-effort) —
    // dù lỗi gì cũng KHÔNG được giấu mã đơn, để staff luôn /hoanthanh được.
    const warnings = [];

    let queue = null;
    try {
      queue = getQueuePosition(order);
    } catch (e) {
      console.error('[ORDER] Lỗi tính vị trí hàng đợi:', e.message);
    }

    try {
      const orderLogChannel = await interaction.guild.channels.fetch(guildConfig.order_log_channel_id).catch(() => null);
      if (orderLogChannel?.isTextBased()) {
        const logMessage = await orderLogChannel.send({ content: buildOrderLogContent(order) });
        saveOrderLogMessage(order.order_code, logMessage.id);
      } else {
        warnings.push('không ghi được log đơn (kiểm tra lại `/setup-ticket`)');
      }
    } catch (e) {
      console.error('[ORDER] Lỗi gửi log đơn:', e.message);
      warnings.push('không ghi được log đơn');
    }

    const hub = getCenarHub();
    if (hub) {
      hub.createOrder({
        order_code: order.order_code,
        discord_customer_id: customer.id,
        guild_id: interaction.guildId,
        product_name: productName,
        quantity: quantity,
        total_amount: amount,
        ticket_channel_id: ticketChannel.id,
        service_type: 'other',
        duration_months: durationMonths,
        duration_days: durationDays,
        payment_provider: amount > 0 ? 'PAYOS' : 'FREE',
      }).catch(e => console.error('[HUB] Lỗi tạo đơn trên web:', e.message));
    }

    // Gửi Order Created V2 + Queue V2 trong cùng 1 message
    try {
      const { container: orderContainer, actionRow: orderActionRow, flags: orderFlags } = buildOrderCreatedV2(order, guildConfig.order_log_channel_id);
      const components = [orderContainer, orderActionRow];
      if (queue) {
        const { container: queueContainer, actionRow: queueActionRow } = buildQueuePositionV2(order, queue.position, queue.total);
        components.push(queueContainer, queueActionRow);
      }
      await ticketChannel.send({
        components,
        flags: orderFlags,
        allowedMentions: { users: [customer.id] },
      });
    } catch (e) {
      console.error('[ORDER] Lỗi gửi thông báo đơn vào ticket:', e.message);
      warnings.push('không gửi được thông báo đơn vào ticket');
    }

    // Nếu có tiền → tạo luôn QR PayOS (Bỏ bảng chọn phương thức)
    if (order.total_amount > 0) {
      try {
        const { sendOrRefreshPaymentQr } = await import('../services/paymentService.js');
        await sendOrRefreshPaymentQr({ guild: interaction.guild, orderCode: order.order_code });
      } catch (err) {
        console.error('[ORDER] Lỗi tạo QR PayOS:', err);
        ticketChannel.send(`${E('status_warn')} Lỗi tạo mã QR thanh toán: ${err.message}`).catch(() => null);
        warnings.push('chưa tạo được mã QR thanh toán');
      }
    }

    await emitStaffLog(interaction.client, {
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      targetId: customer.id,
      action: 'ORDER_CREATE',
      detail: `${productName} x${quantity}`,
      relatedOrderCode: order.order_code,
      relatedTicketCode: ticket.ticket_code,
    }).catch((e) => console.error('[ORDER] Lỗi ghi staff log:', e.message));

    const baseMsg = `${E('status_check')} Đã tạo đơn \`${order.order_code}\` thành công.`;
    const warnMsg = warnings.length ? `\n${E('status_warn')} Lưu ý: ${warnings.join('; ')}. Mã đơn vẫn dùng được với \`/hoanthanh\`, \`/giaohang\`.` : '';
    await interaction.editReply(baseMsg + warnMsg).catch(() => null);
  } catch (error) {
    console.error('[ORDER] Lỗi:', error);
    const message = `${E('status_cross')} Có lỗi khi tạo đơn hàng: ${error.message ?? 'Lỗi không xác định'}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message).catch(() => null);
    } else {
      await interaction.reply({ content: message, flags: 64 }).catch(() => null);
    }
  }
}
