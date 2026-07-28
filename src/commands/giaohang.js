import { createEmojiResolver } from '../utils/emojiHelper.js';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { getOrderByCode, markOrderCompleted, saveDelivery, ensureOrderExpiry } from '../services/orderService.js';
import { sendCompletedTicketFlow, updateOrderLogMessage } from '../services/notificationService.js';
import { applyCustomerRoles } from '../services/roleService.js';
import { emitStaffLog } from '../services/staffLogService.js';
import { assertStaffCapability } from '../utils/permissions.js';
import {
  buildDeliveryClaimComponents,
  buildDeliveryCredentialEmbeds,
  buildDeliveryLogText,
  buildDeliveryLoginComponents,
  buildDeliveryNoticeV2,
  buildPublicOrderLogV2,
} from '../utils/embeds.js';
import { getCenarHub } from '../services/cenarHub.js';

export const data = new SlashCommandBuilder()
  .setName('giaohang')
  .setDescription('Gửi DM giao hàng cho khách. Tự đồng bộ đơn sang hoàn thành nếu đủ điều kiện.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((option) => option.setName('ma_don').setDescription('Mã đơn hàng, ví dụ CN_123456').setRequired(true))
  .addStringOption((option) => option.setName('gmail').setDescription('Gmail giao cho khách, nếu đơn cần tài khoản').setRequired(false))
  .addStringOption((option) => option.setName('mat_khau').setDescription('Mật khẩu Gmail giao cho khách').setRequired(false))
  .addStringOption((option) => option.setName('profile').setDescription('Profile hoặc slot được cấp').setRequired(false))
  .addStringOption((option) => option.setName('pin').setDescription('PIN profile nếu có').setRequired(false))
  .addStringOption((option) => option.setName('link_dang_nhap').setDescription('Link login dịch vụ').setRequired(false))
  .addStringOption((option) => option.setName('luu_y').setDescription('Điều khoản/lưu ý gửi kèm cho khách').setRequired(false).setMaxLength(1800))
  .addBooleanOption((option) => option.setName('gui_truc_tiep').setDescription('Bật để DM thẳng email/mật khẩu').setRequired(false));

export async function execute(interaction) {
  const E = createEmojiResolver(interaction?.guildId);
  await interaction.deferReply({ ephemeral: true });
  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!assertStaffCapability(member, guildConfig, 'SHIP')) {
    await interaction.editReply({ content: `${E('status_warn')} Chỉ shipper/manager mới được dùng lệnh này.`, ephemeral: true });
    return;
  }

  const orderCode = interaction.options.getString('ma_don', true).trim().toUpperCase();
  const credentialEmail = interaction.options.getString('gmail');
  const credentialPassword = interaction.options.getString('mat_khau');
  const credentialProfile = interaction.options.getString('profile');
  const credentialPin = interaction.options.getString('pin');
  const deliveryLoginUrl = interaction.options.getString('link_dang_nhap') ?? config.defaultLoginUrl;
  const claimNotes = interaction.options.getString('luu_y') ?? config.defaultDeliveryTerms;
  const sendDirect = interaction.options.getBoolean('gui_truc_tiep') ?? true;

  let order = getOrderByCode(orderCode);
  if (!order) {
    await interaction.editReply({ content: `${E('status_warn')} Không tìm thấy mã đơn này.`, ephemeral: true });
    return;
  }

  if (interaction.channelId && order.ticket_channel_id && interaction.channelId !== order.ticket_channel_id) {
    await interaction.editReply({ content: `${E('status_warn')} Đơn \`${order.order_code}\` thuộc ticket khác. Hãy dùng lệnh trong <#${order.ticket_channel_id}> để tránh giao sai.`, ephemeral: true });
    return;
  }

  // Bắt buộc nhập Gmail nếu là đơn đăng ký (Netflix, Spotify, Youtube...)
  const subKeywords = ['youtube', 'netflix', 'spotify', 'canva', 'capcut', 'office', 'zoom', 'chatgpt', 'vpn', 'prime', 'hbo'];
  const productNameLower = order.product_name?.toLowerCase() || '';
  const isSubProduct = subKeywords.some(kw => productNameLower.includes(kw));

  if (isSubProduct) {
    if (!credentialEmail || credentialEmail.trim() === '') {
      await interaction.editReply({ 
        content: `${E('status_warn')} Đơn hàng **${order.product_name}** bắt buộc phải nhập \`gmail\` để hệ thống lưu lại và cảnh báo hết hạn sau này. Vui lòng chạy lại lệnh và điền tham số Gmail!`, 
        ephemeral: true 
      });
      return;
    }
  }

  if (order.status !== 'COMPLETED') {
    if (order.total_amount > 0 && !['PAID', 'FREE'].includes(order.payment_status)) {
      await interaction.editReply({ content: `${E('status_warn')} Đơn chưa thanh toán xong nên bot chưa thể tự đồng bộ sang hoàn thành khi giao hàng.`, ephemeral: true });
      return;
    }
    order = markOrderCompleted(order.order_code, interaction.user.id, config.feedbackTimeoutHours) ?? order;
    await updateOrderLogMessage(interaction.guild, order);
    
    // Áp dụng role khách hàng và gửi log công khai (lịch sử mua hàng)
    await applyCustomerRoles(interaction.guild, order.customer_id);
    if (guildConfig?.public_order_log_channel_id) {
      const publicLogChannel = await interaction.guild.channels.fetch(guildConfig.public_order_log_channel_id).catch(() => null);
      if (publicLogChannel?.isTextBased()) {
        await publicLogChannel.send(buildPublicOrderLogV2(order)).catch(() => null);
      }
    }
    
    await emitStaffLog(interaction.client, { guildId: interaction.guildId, actorId: interaction.user.id, targetId: order.customer_id, action: 'ORDER_COMPLETE_AUTO', detail: 'Tự đồng bộ hoàn thành trong /giaohang', relatedOrderCode: order.order_code });
  }

  const customer = await interaction.client.users.fetch(order.customer_id).catch(() => null);
  if (!customer) {
    await interaction.editReply({ content: `${E('status_warn')} Không fetch được tài khoản khách hàng.`, ephemeral: true });
    return;
  }

  const dmChannel = await customer.createDM().catch(() => null);
  if (!dmChannel) {
    await interaction.editReply({ content: `${E('status_warn')} Không mở được DM với khách. Hãy yêu cầu khách bật tin nhắn riêng rồi chạy lại lệnh.`, ephemeral: true });
    return;
  }

  const shouldShowClaimButton = Boolean(credentialEmail && credentialPassword) && !sendDirect;
  let dmMessage = null;
  const persist = (messageId = null) => saveDelivery(order.order_code, interaction.user.id, credentialEmail, credentialPassword, credentialProfile, credentialPin, deliveryLoginUrl, claimNotes, dmChannel.id, messageId);
  const storedOrder = persist(null);

  if (Boolean(credentialEmail && credentialPassword) && sendDirect) {
    dmMessage = await dmChannel.send({ embeds: buildDeliveryCredentialEmbeds(storedOrder), components: buildDeliveryLoginComponents(storedOrder) }).catch(() => null);
    if (!dmMessage) {
      await interaction.editReply({ content: `${E('status_warn')} Không gửi được DM giao hàng cho khách hàng.`, ephemeral: true });
      return;
    }
    persist(dmMessage.id);
  } else {
    const { container, flags } = buildDeliveryNoticeV2(storedOrder);
    dmMessage = await dmChannel.send({
      components: shouldShowClaimButton ? [container, ...buildDeliveryClaimComponents(order.order_code)] : [container],
      flags,
    }).catch(() => null);
    if (!dmMessage) {
      await interaction.editReply({ content: `${E('status_warn')} Không gửi được DM cho khách hàng.`, ephemeral: true });
      return;
    }
    persist(dmMessage.id);
  }
  
  const hub = getCenarHub();
  if (hub) {
    hub.deliverOrder(order.order_code, {
      credential_email: credentialEmail,
      credential_password: credentialPassword,
      staff_id: interaction.user.id
    }).catch(e => console.error('[HUB] Lỗi deliver:', e.message));
  }

  const ticketChannel = await interaction.guild.channels.fetch(order.ticket_channel_id).catch(() => null);
  if (ticketChannel?.isTextBased()) await ticketChannel.send(buildDeliveryLogText(order)).catch(() => null);

  await applyCustomerRoles(interaction.guild, order.customer_id);
  await emitStaffLog(interaction.client, { guildId: interaction.guildId, actorId: interaction.user.id, targetId: order.customer_id, action: 'DELIVERY_SENT', detail: sendDirect ? 'Gửi trực tiếp qua DM' : 'Gửi DM với nút nhận Gmail', relatedOrderCode: order.order_code });

  // Luôn gửi bảng Feedback 5 sao vào ticket sau khi giao hàng (dù trước đó đã hoàn thành hay chưa)
  await sendCompletedTicketFlow({ guild: interaction.guild, order, actorId: interaction.user.id, supportId: interaction.user.id });

  await interaction.editReply({ content: `${E('status_check')} Đã gửi DM giao hàng cho khách của đơn ${order.order_code} và đồng bộ trạng thái hoàn thành.`, ephemeral: true });
}
