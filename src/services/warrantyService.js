import { ChannelType, PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getGuildConfig } from './guildConfigService.js';
import { getOrderByCode, setOrderStatus } from './orderService.js';
import { createTicket, getOpenWarrantyTicket, getTicketByChannelId } from './ticketService.js';
import { updateOrderLogMessage } from './notificationService.js';
import { buildTicketControlComponents, buildTicketWelcomeV2 } from '../utils/embeds.js';
import { buildWarrantyChannelName } from '../utils/formatters.js';
import { TICKET_MEMBER_PERMISSIONS } from '../utils/permissions.js';
import { getCenarHub } from './cenarHub.js';
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';
import { T, subtext } from '../utils/embedHelpers.js';
import { accentFor, brandName } from '../utils/uiKit.js';
import { config } from '../config.js';
import { formatProductDisplayName } from './emojiService.js';
import { isInternationalGuild } from '../utils/locale.js';
import { formatInternationalPrice, translateProductName } from '../utils/internationalCatalog.js';
import { db } from '../database/db.js';

/**
 * Dữ liệu form bảo hành từ modal
 * @typedef {{ productType: string, accountInfo: string, password: string, purchaseDate: string, dateExpired: string }} WarrantyFormData
 */

function meaningful(value) {
  const text = String(value ?? '').trim();
  return text && !['n/a', 'na', 'không có', 'chưa có', 'null', 'undefined'].includes(text.toLowerCase())
    ? text
    : null;
}

function parseWarrantyDate(value) {
  if (!meaningful(value)) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const text = String(value).trim();
  const viDate = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (viDate) {
    const [, day, month, year, hour = '0', minute = '0'] = viDate;
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(' ', 'T')}Z`
    : text;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addMonths(date, months) {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() + Math.max(1, Number(months) || 1));
  return result;
}

function displayWarrantyDate(value) {
  const parsed = parseWarrantyDate(value);
  if (!parsed) return meaningful(value) || 'Chưa xác định';
  const unix = Math.floor(parsed.getTime() / 1000);
  return `<t:${unix}:D> · <t:${unix}:R>`;
}

export function buildWarrantyReviewActions(ticketId, guildId, { state = 'pending' } = {}) {
  const E = createEmojiResolver(guildId);
  if (state === 'approved') {
    return new ActionRowBuilder().addComponents(withButtonEmoji(
      new ButtonBuilder()
        .setCustomId(`warranty:reviewed:${ticketId}`)
        .setLabel(isInternationalGuild(guildId) ? 'Warranty Approved' : 'Đã Duyệt Bảo Hành')
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),
      E.component('status_check'),
    ));
  }

  if (state === 'rejected') {
    return new ActionRowBuilder().addComponents(withButtonEmoji(
      new ButtonBuilder()
        .setCustomId(`warranty:reviewed:${ticketId}`)
        .setLabel(isInternationalGuild(guildId) ? 'Warranty Rejected' : 'Đã Từ Chối Bảo Hành')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(true),
      E.component('status_cross'),
    ));
  }

  return new ActionRowBuilder().addComponents(
    withButtonEmoji(
      new ButtonBuilder()
        .setCustomId(`ytb:approve:${ticketId}`)
        .setLabel(isInternationalGuild(guildId) ? 'Approve Warranty' : 'Duyệt Bảo Hành')
        .setStyle(ButtonStyle.Success),
      E.component('status_check'),
    ),
    withButtonEmoji(
      new ButtonBuilder()
        .setCustomId(`ytb:reject:${ticketId}`)
        .setLabel(isInternationalGuild(guildId) ? 'Reject Warranty' : 'Từ Chối Bảo Hành')
        .setStyle(ButtonStyle.Danger),
      E.component('status_cross'),
    ),
  );
}

export function resolveWarrantyTimeline(order = {}, formData = {}) {
  const purchaseSource = meaningful(formData.purchaseDate)
    || order.paid_at
    || order.created_at;
  const expiryBase = parseWarrantyDate(
    order.delivered_at || order.completed_at || order.paid_at || order.created_at,
  );
  const computedExpiry = expiryBase
    ? addMonths(expiryBase, order.duration_months || config.defaultOrderDurationMonths || 1)
    : null;
  const expirySource = meaningful(formData.dateExpired)
    || order.expiry_at
    || computedExpiry;

  return {
    purchaseDate: displayWarrantyDate(purchaseSource),
    dateExpired: displayWarrantyDate(expirySource),
    purchaseSource,
    expirySource,
  };
}

export function normalizeWarrantyFormData(order, formData = {}) {
  const timeline = resolveWarrantyTimeline(order, formData || {});
  return {
    productType: meaningful(formData?.productType) || order.product_name || 'Sản phẩm Cenar',
    accountInfo: meaningful(formData?.accountInfo),
    password: meaningful(formData?.password),
    purchaseDate: timeline.purchaseDate,
    dateExpired: timeline.dateExpired,
  };
}

/**
 * Build thông báo V2 gửi vào kênh bảo hành khi ticket vừa được tạo
 */
export function buildWarrantyTicketOpenedV2({ order, ticket, channel, formData, guildId }) {
  const E = createEmojiResolver(guildId);
  const international = isInternationalGuild(guildId);
  const productDisplay = international ? translateProductName(order.product_name) : (formatProductDisplayName(guildId, order.product_name, E) || 'Chưa xác định');

  const container = new ContainerBuilder().setAccentColor(accentFor('warning'));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `## ${E('warranty_shield')} ${international ? 'WARRANTY CASE' : 'Hồ Sơ Bảo Hành'}`,
      `> ${E('status_check')} ${international ? 'Your request was received and placed in the private support queue.' : 'Yêu cầu đã được tiếp nhận và đưa vào hàng chờ hỗ trợ riêng tư.'}`,
    ].join('\n'))
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `### ${E('icon_clipboard')} ${international ? 'ORDER RECORD' : 'Hồ Sơ Đơn Hàng'}`,
      `${E('order_id')} **${international ? 'Order' : 'Mã đơn'}** — \`${order.order_code}\``,
      `${E('order_product')} **${international ? 'Product' : 'Sản phẩm'}** — ${productDisplay}`,
      `${E('ticket_user')} **${international ? 'Customer' : 'Khách hàng'}** — <@${order.customer_id}>`,
      `${E('ticket_open')} **${international ? 'Support channel' : 'Kênh xử lý'}** — ${channel}`,
    ].join('\n'))
  );

  if (formData) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );

    const fields = [
      formData.productType  && `${E('icon_tag')} **${international ? 'Product type' : 'Loại Sản Phẩm'}** — ${formData.productType}`,
      formData.accountInfo  && `${E('icon_key')} **${international ? 'Account' : 'Tài Khoản'}** — \`${formData.accountInfo}\``,
      formData.password     && `${E('icon_unlock')} **${international ? 'Password' : 'Mật Khẩu'}** — \`${formData.password}\``,
      formData.purchaseDate && `${E('warranty_purchase')} **${international ? 'Purchase date' : 'Ngày mua'}** — ${formData.purchaseDate}`,
      formData.dateExpired  && `${E('warranty_expiry')} **${international ? 'Expiry date' : 'Ngày hết hạn'}** — ${formData.dateExpired}`,
    ].filter(Boolean);

    if (fields.length) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          `### ${E('warranty_shield')} ${international ? 'VERIFICATION DETAILS' : 'Thông Tin Xác Minh'}`,
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
      `${E('order_processing')} **${international ? 'Status' : 'Trạng thái'}** — ${international ? 'Awaiting staff review' : 'Đang chờ đội ngũ kiểm tra'}`,
      subtext(`${E('status_warn')} ${international ? 'You do not need to mention staff; the warranty team has received the case.' : 'Không cần tag staff; hệ thống đã chuyển đầy đủ thông tin đến bộ phận bảo hành.'}`),
    ].join('\n'))
  );

  return {
    components: [container, buildWarrantyReviewActions(ticket.id, guildId)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

/**
 * Build log bảo hành gửi vào kênh log admin
 */
export function buildWarrantyLogV2({ order, ticket, channel, formData, actorId, guildId }) {
  const E = createEmojiResolver(guildId);
  const international = isInternationalGuild(guildId);
  const productDisplay = international ? translateProductName(order.product_name) : (formatProductDisplayName(guildId, order.product_name, E) || 'N/A');

  const container = new ContainerBuilder().setAccentColor(accentFor('warning'));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `## ${E('warranty_shield')} ${international ? 'NEW WARRANTY CASE' : 'Hồ Sơ Bảo Hành Mới'}`,
      `> ${E('status_warn')} ${international ? 'A customer opened a warranty request that requires staff review.' : 'Khách hàng vừa mở yêu cầu bảo hành — cần xem xét và xử lý.'}`,
    ].join('\n'))
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `${E('ticket_user')} **${international ? 'Customer' : 'Khách Hàng'}** — <@${order.customer_id}>`,
      `${E('order_id')} **${international ? 'Order' : 'Mã Đơn'}** — \`${order.order_code}\``,
      `${E('order_product')} **${international ? 'Product' : 'Sản Phẩm'}** — ${productDisplay}`,
      `${E('payment_money')} **${international ? 'Value' : 'Giá Trị'}** — \`${order.total_amount ? (international ? formatInternationalPrice(order.total_amount, { includeSource: true }) : order.total_amount.toLocaleString('vi-VN') + 'đ') : 'N/A'}\``,
      `${E('ticket_open')} **${international ? 'Warranty channel' : 'Kênh Bảo Hành'}** — ${channel}`,
      `${E('ticket_staff')} **${international ? 'Opened by' : 'Mở Bởi'}** — <@${actorId}>`,
      `${E('icon_clock')} **${international ? 'Time' : 'Thời Gian'}** — ${T.rel(new Date().toISOString())}`,
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
      formData.purchaseDate && `${E('warranty_purchase')} **Ngày Mua** — ${formData.purchaseDate}`,
      formData.dateExpired  && `${E('warranty_expiry')} **Ngày Hết Hạn** — ${formData.dateExpired}`,
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

  const row = buildWarrantyReviewActions(ticket.id, guildId);

  return { components: [container, row], flags: MessageFlags.IsComponentsV2 };
}

/**
 * Build thông báo ephemeral gửi cho khách sau khi mở bảo hành thành công
 */
export function buildWarrantyCustomerConfirmV2({ order, channel, guildId }) {
  const E = createEmojiResolver(guildId);
  const international = isInternationalGuild(guildId);
  const productDisplay = international ? translateProductName(order.product_name) : (formatProductDisplayName(guildId, order.product_name, E) || 'N/A');

  const container = new ContainerBuilder().setAccentColor(accentFor('warning'));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `## ${E('warranty_shield')} ${international ? 'WARRANTY REQUEST RECEIVED' : 'Yêu Cầu Bảo Hành Đã Ghi Nhận'}`,
      `> ${E('icon_sparkle')} ${international ? 'Your purchase is now in the warranty review queue. Support will respond in this case channel.' : 'Sản phẩm của bạn đang được đưa vào hàng đợi bảo hành. Đội ngũ hỗ trợ sẽ liên hệ sớm nhất có thể.'}`,
    ].join('\n'))
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `${E('order_id')} **${international ? 'Order' : 'Đơn Hàng'}** — \`${order.order_code}\``,
      `${E('order_product')} **${international ? 'Product' : 'Sản Phẩm'}** — ${productDisplay}`,
      `${E('ticket_open')} **${international ? 'Support channel' : 'Kênh Hỗ Trợ'}** — ${channel}`,
      '',
      subtext(`${E('icon_clock')} ${international ? 'Response time depends on product verification and supplier status. Thank you for your patience.' : 'Thời gian xử lý thường từ 5–30 phút. Cảm ơn bạn đã kiên nhẫn chờ đợi.'}`),
    ].join('\n'))
  );

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

export function buildWarrantyApprovedCustomerV2({ order, ticket, reviewerId, guildId }) {
  const E = createEmojiResolver(guildId);
  const international = isInternationalGuild(guildId);
  const productDisplay = international
    ? translateProductName(order.product_name)
    : (formatProductDisplayName(guildId, order.product_name, E) || 'Sản phẩm Cenar');
  const container = new ContainerBuilder().setAccentColor(accentFor('success'));

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('warranty_shield')} ${international ? 'WARRANTY COMPLETED' : 'BẢO HÀNH THÀNH CÔNG'}`,
    `> ${E('status_check')} ${international ? `Your warranty request has been completed successfully.` : `Yêu cầu bảo hành của bạn đã được xử lý và xác nhận thành công.`}`,
  ].join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `${E('ticket_user')} **${international ? 'Customer' : 'Khách hàng'}** — <@${ticket.customer_id}>`,
    `${E('order_id')} **${international ? 'Order' : 'Mã đơn'}** — \`${order.order_code}\``,
    `${E('order_product')} **${international ? 'Product' : 'Sản phẩm'}** — ${productDisplay}`,
    `${E('ticket_staff')} **${international ? 'Reviewed by' : 'Nhân viên duyệt'}** — <@${reviewerId}>`,
    `${E('icon_clock')} **${international ? 'Completed at' : 'Hoàn tất lúc'}** — <t:${Math.floor(Date.now() / 1000)}:F>`,
  ].join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `### ${E('cenar_support')} ${international ? 'NEXT STEPS' : 'BƯỚC TIẾP THEO'}`,
    `${E('status_check')} ${international ? 'Check the repaired account or service using the information provided by staff.' : 'Vui lòng kiểm tra lại tài khoản hoặc dịch vụ vừa được bảo hành.'}`,
    `${E('icon_link')} ${international ? 'For invite-based products, check Inbox, Spam and Promotions.' : 'Nếu sản phẩm nhận lời mời qua email, hãy kiểm tra cả Hộp thư đến, Spam và Quảng cáo.'}`,
    `${E('status_warn')} ${international ? 'If anything is still incorrect, reply in the warranty ticket before it is closed.' : 'Nếu vẫn còn vấn đề, hãy phản hồi ngay trong ticket trước khi ticket được đóng.'}`,
    `-# ${E('icon_heart_purple')} ${international ? 'Thank you for choosing Cenar Global.' : 'Cảm ơn bạn đã tin tưởng và sử dụng dịch vụ tại Cenar Store.'}`,
  ].join('\n')));

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export function buildWarrantyReviewedStateV2({ order, ticket, reviewerId, guildId, state = 'approved' }) {
  const E = createEmojiResolver(guildId);
  const international = isInternationalGuild(guildId);
  const approved = state === 'approved';
  const container = new ContainerBuilder().setAccentColor(accentFor(approved ? 'success' : 'danger'));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${E(approved ? 'status_check' : 'status_cross')} ${international
      ? (approved ? 'WARRANTY APPROVED' : 'WARRANTY REJECTED')
      : (approved ? 'ĐÃ DUYỆT BẢO HÀNH' : 'ĐÃ TỪ CHỐI BẢO HÀNH')}`,
    `${E('order_id')} **${international ? 'Order' : 'Mã đơn'}** — \`${order.order_code}\``,
    `${E('ticket_user')} **${international ? 'Customer' : 'Khách hàng'}** — <@${ticket.customer_id}>`,
    `${E('ticket_staff')} **${international ? 'Reviewed by' : 'Xử lý bởi'}** — <@${reviewerId}>`,
    `${E('icon_clock')} <t:${Math.floor(Date.now() / 1000)}:F>`,
  ].join('\n')));
  return {
    components: [container, buildWarrantyReviewActions(ticket.id, guildId, { state })],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export function buildWarrantyStaffReviewV2({ ticket, guildId }) {
  const E = createEmojiResolver(guildId);
  const international = isInternationalGuild(guildId);
  const container = new ContainerBuilder().setAccentColor(accentFor('warning'));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${E('warranty_shield')} ${international ? 'STAFF WARRANTY REVIEW' : 'THAO TÁC DUYỆT BẢO HÀNH'}`,
    `${E('status_warn')} ${international ? 'Only authorized staff may use these controls.' : 'Chỉ nhân viên được phân quyền mới có thể sử dụng các nút bên dưới.'}`,
    `${E('order_id')} **${international ? 'Order' : 'Mã đơn'}** — \`${ticket.related_order_code || 'Chưa xác định'}\``,
    `-# ${E('cenar_support')} ${international ? 'The customer is notified in the ticket and by DM after approval.' : 'Sau khi duyệt, khách hàng sẽ được thông báo tại ticket và qua DM.'}`,
  ].join('\n')));
  return {
    components: [container, buildWarrantyReviewActions(ticket.id, guildId)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export async function refreshOpenWarrantyActionPanels(client) {
  let scanned = 0;
  let published = 0;
  let current = 0;
  let missingChannels = 0;
  for (const guild of client.guilds.cache.values()) {
    const tickets = db.prepare(`
      SELECT * FROM tickets
      WHERE guild_id = ? AND ticket_type = 'WARRANTY' AND status = 'OPEN'
      ORDER BY id DESC
    `).all(guild.id);
    for (const ticket of tickets) {
      scanned += 1;
      const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
      if (!channel?.isTextBased()) {
        missingChannels += 1;
        continue;
      }
      const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
      const marker = `ytb:approve:${ticket.id}`;
      const exists = messages?.some((message) => (
        message.author.id === client.user.id
        && JSON.stringify(message.components.map((component) => component.toJSON())).includes(marker)
      ));
      if (exists) {
        current += 1;
        continue;
      }
      await channel.send(buildWarrantyStaffReviewV2({ ticket, guildId: guild.id }));
      published += 1;
    }
  }
  return { scanned, published, current, missingChannels };
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

  const resolvedFormData = normalizeWarrantyFormData(order, formData || {});

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
    buildWarrantyTicketOpenedV2({ order, ticket, channel, formData: resolvedFormData, guildId: guild.id })
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
        buildWarrantyLogV2({ order: updatedOrder ?? order, ticket, channel, formData: resolvedFormData, actorId, guildId: guild.id })
      ).catch(() => null);
    }
  }

  return { ticket, channel, order: updatedOrder ?? order, reused: false };
}

export function getOrderTicketFromChannel(channelId) {
  return getTicketByChannelId(channelId);
}
