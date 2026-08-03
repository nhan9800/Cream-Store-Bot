import { ChannelType, PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getGuildConfig } from './guildConfigService.js';
import { getOrderByCode, setOrderStatus } from './orderService.js';
import { createTicket, getOpenWarrantyTicket, getTicketByChannelId } from './ticketService.js';
import { updateOrderLogMessage } from './notificationService.js';
import { buildTicketControlComponents, buildTicketWelcomeV2 } from '../utils/embeds.js';
import { buildWarrantyChannelName } from '../utils/formatters.js';
import { TICKET_MEMBER_PERMISSIONS } from '../utils/permissions.js';
import { getCenarHub } from './cenarHub.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { getEmojiMap } from './emojiService.js';
import { T, fmt, h2, subtext, vnd } from '../utils/embedHelpers.js';
import { accentFor, brandName } from '../utils/uiKit.js';
import { config } from '../config.js';

/**
 * Dữ liệu form bảo hành từ modal
 * @typedef {{ productType: string, accountInfo: string, password: string, purchaseDate: string, dateExpired: string }} WarrantyFormData
 */

/**
 * Build thông báo V2 gửi vào kênh bảo hành khi ticket vừa được tạo
 */
export function buildWarrantyTicketOpenedV2({ order, ticket, channel, formData, guildId }) {
  const em = getEmojiMap(guildId);
  const E = (slot) => em[slot] || '';

  const container = new ContainerBuilder().setAccentColor(accentFor('warning'));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `## ${E('panel_warranty')} Yêu Cầu Bảo Hành`,
      `> ${E('icon_heart_purple')} Ticket bảo hành của bạn đã được tạo. Đội ngũ hỗ trợ sẽ xử lý trong thời gian sớm nhất.`,
    ].join('\n'))
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `${E('order_id')} **Mã Đơn** — \`${order.order_code}\``,
      `${E('order_product')} **Sản Phẩm** — ${order.product_name || 'N/A'}`,
      `${E('ticket_user')} **Khách Hàng** — <@${order.customer_id}>`,
      `${E('ticket_open')} **Kênh Ticket** — ${channel}`,
    ].join('\n'))
  );

  if (formData) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );

    const fields = [
      formData.productType  && `${E('icon_tag')} **Loại Sản Phẩm** — ${formData.productType}`,
      formData.accountInfo  && `${E('icon_key')} **Tài Khoản** — \`${formData.accountInfo}\``,
      formData.password     && `${E('icon_unlock')} **Mật Khẩu** — \`${formData.password}\``,
      formData.purchaseDate && `${E('icon_calendar')} **Ngày Mua** — ${formData.purchaseDate}`,
      formData.dateExpired  && `${E('icon_expire')} **Ngày Mất / Hết Hạn** — ${formData.dateExpired}`,
    ].filter(Boolean);

    if (fields.length) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          `### ${E('icon_edit')} Thông Tin Bảo Hành`,
          ...fields,
        ].join('\n'))
      );
    }
  }

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `${E('order_processing')} **Trạng Thái** — Đang Xử Lý`,
      subtext(`${E('status_warn')} Vui lòng không tag staff. Hệ thống đã ghi nhận — staff sẽ tự động check và hỗ trợ bạn.`),
    ].join('\n'))
  );

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/**
 * Build log bảo hành gửi vào kênh log admin
 */
export function buildWarrantyLogV2({ order, ticket, channel, formData, actorId, guildId }) {
  const em = getEmojiMap(guildId);
  const E = (slot) => em[slot] || '';

  const container = new ContainerBuilder().setAccentColor(accentFor('warning'));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `## ${E('panel_warranty')} Log Bảo Hành Mới`,
      `> ${E('status_warn')} Khách hàng vừa mở yêu cầu bảo hành — cần xem xét và xử lý.`,
    ].join('\n'))
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `${E('ticket_user')} **Khách Hàng** — <@${order.customer_id}>`,
      `${E('order_id')} **Mã Đơn** — \`${order.order_code}\``,
      `${E('order_product')} **Sản Phẩm** — ${order.product_name || 'N/A'}`,
      `${E('payment_money')} **Giá Trị** — \`${order.total_amount ? order.total_amount.toLocaleString('vi-VN') + 'đ' : 'N/A'}\``,
      `${E('ticket_open')} **Kênh Bảo Hành** — ${channel}`,
      `${E('ticket_staff')} **Mở Bởi** — <@${actorId}>`,
      `${E('icon_clock')} **Thời Gian** — ${T.rel(new Date().toISOString())}`,
    ].join('\n'))
  );

  if (formData) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );

    const fields = [
      formData.productType  && `${E('icon_tag')} **Loại SP** — ${formData.productType}`,
      formData.accountInfo  && `${E('icon_key')} **Tài Khoản** — \`${formData.accountInfo}\``,
      formData.password     && `${E('icon_unlock')} **Mật Khẩu** — \`${formData.password}\``,
      formData.purchaseDate && `${E('icon_calendar')} **Ngày Mua** — ${formData.purchaseDate}`,
      formData.dateExpired  && `${E('icon_expire')} **Ngày Mất/Hết Hạn** — ${formData.dateExpired}`,
    ].filter(Boolean);

    if (fields.length) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          `### ${E('icon_clipboard')} Form Khách Điền`,
          ...fields,
        ].join('\n'))
      );
    }
  }

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      subtext(`${E('icon_heart_purple')} ${brandName()} · Mã ticket: \`${ticket.ticket_code}\``)
    )
  );

  const btnApprove = new ButtonBuilder()
    .setCustomId(`ytb:approve:${ticket.id}`)
    .setLabel('Duyệt Bảo Hành')
    .setStyle(ButtonStyle.Success);
  const approveEmoji = E('status_check')?.match(/^<a?:[^:]+:(\d+)>$/)?.[1];
  if (approveEmoji) btnApprove.setEmoji(approveEmoji);

  const btnReject = new ButtonBuilder()
    .setCustomId(`ytb:reject:${ticket.id}`)
    .setLabel('Từ Chối Bảo Hành')
    .setStyle(ButtonStyle.Danger);
  const rejectEmoji = E('status_cross')?.match(/^<a?:[^:]+:(\d+)>$/)?.[1];
  if (rejectEmoji) btnReject.setEmoji(rejectEmoji);

  const row = new ActionRowBuilder().addComponents(btnApprove, btnReject);

  return { components: [container, row], flags: MessageFlags.IsComponentsV2 };
}

/**
 * Build thông báo ephemeral gửi cho khách sau khi mở bảo hành thành công
 */
export function buildWarrantyCustomerConfirmV2({ order, channel, guildId }) {
  const em = getEmojiMap(guildId);
  const E = (slot) => em[slot] || '';

  const container = new ContainerBuilder().setAccentColor(accentFor('warning'));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `## ${E('status_check')} Yêu Cầu Bảo Hành Đã Ghi Nhận`,
      `> ${E('icon_sparkle')} Sản phẩm của bạn đang được đưa vào hàng đợi bảo hành. Đội ngũ hỗ trợ sẽ liên hệ sớm nhất có thể.`,
    ].join('\n'))
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `${E('order_id')} **Đơn Hàng** — \`${order.order_code}\``,
      `${E('order_product')} **Sản Phẩm** — ${order.product_name || 'N/A'}`,
      `${E('ticket_open')} **Kênh Hỗ Trợ** — ${channel}`,
      '',
      subtext(`${E('icon_clock')} Thời gian xử lý thường từ 5–30 phút. Cảm ơn bạn đã kiên nhẫn chờ đợi.`),
    ].join('\n'))
  );

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

export async function openWarrantyTicket({ guild, customerId, actorId, orderCode, reason = null, formData = null }) {
  const guildConfig = getGuildConfig(guild.id);
  if (!guildConfig) {
    throw new Error('Server chưa setup hệ thống.');
  }

  const order = getOrderByCode(orderCode);
  if (!order) {
    throw new Error('Không tìm thấy đơn hàng.');
  }

  if (order.customer_id !== customerId) {
    throw new Error('Bạn không phải chủ đơn hàng này.');
  }

  if (!['COMPLETED', 'WARRANTY_OPEN'].includes(order.status)) {
    throw new Error('Chỉ mở bảo hành cho đơn đã hoàn thành.');
  }

  const existing = getOpenWarrantyTicket(guild.id, customerId, orderCode);
  if (existing) {
    const channel = await guild.channels.fetch(existing.channel_id).catch(() => null);
    return { ticket: existing, channel, order, reused: true };
  }

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: customerId,
      allow: TICKET_MEMBER_PERMISSIONS,
    },
    {
      id: guild.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ];

  if (guildConfig.support_role_id) {
    overwrites.push({
      id: guildConfig.support_role_id,
      allow: TICKET_MEMBER_PERMISSIONS,
    });
  }

  const categoryId = guildConfig.warranty_category_id || guildConfig.ticket_category_id;
  const channel = await guild.channels.create({
    name: buildWarrantyChannelName(orderCode),
    type: ChannelType.GuildText,
    parent: categoryId,
    permissionOverwrites: overwrites,
  });

  const ticket = createTicket({
    guildId: guild.id,
    channelId: channel.id,
    customerId,
    openedById: actorId,
    ticketType: 'WARRANTY',
    relatedOrderCode: orderCode,
  });

  // Gửi welcome V2 vào kênh bảo hành (mention khách + admin)
  const E = createEmojiResolver(guild.id);

  // Tag admin/support role
  const mentionParts = [`<@${customerId}>`];
  if (guildConfig.support_role_id) mentionParts.push(`<@&${guildConfig.support_role_id}>`);
  if (guildConfig.manager_role_id) mentionParts.push(`<@&${guildConfig.manager_role_id}>`);

  // Gửi mention ping (plain text để Discord notify)
  await channel.send({
    content: mentionParts.join(' '),
    allowedMentions: { users: [customerId], roles: [guildConfig.support_role_id, guildConfig.manager_role_id].filter(Boolean) },
  }).catch(() => null);

  // Gửi panel thông tin bảo hành V2
  await channel.send(
    buildWarrantyTicketOpenedV2({ order, ticket, channel, formData, guildId: guild.id })
  ).catch(() => null);

  // Gửi controls ticket (đóng ticket v.v.)
  await channel.send({
    components: buildTicketControlComponents(ticket.id, customerId),
  }).catch(() => null);

  const updatedOrder = setOrderStatus(orderCode, 'WARRANTY_OPEN');
  if (updatedOrder) {
    await updateOrderLogMessage(guild, updatedOrder).catch(() => null);
  }

  const hub = getCenarHub();
  if (hub) {
    hub.openWarranty(orderCode).catch(e => console.error('[HUB] Lỗi đồng bộ bảo hành:', e.message));
  }

  // Gửi log vào kênh log bảo hành nếu được cấu hình
  if (guildConfig.warranty_log_channel_id) {
    const logChannel = await guild.channels.fetch(guildConfig.warranty_log_channel_id).catch(() => null);
    if (logChannel?.isTextBased()) {
      await logChannel.send(
        buildWarrantyLogV2({ order: updatedOrder ?? order, ticket, channel, formData, actorId, guildId: guild.id })
      ).catch(() => null);
    }
  }

  return { ticket, channel, order: updatedOrder ?? order, reused: false };
}

export function getOrderTicketFromChannel(channelId) {
  return getTicketByChannelId(channelId);
}
