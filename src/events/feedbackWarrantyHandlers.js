import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { config } from '../config.js';
import { emitStaffLog } from '../services/staffLogService.js';
import { getOrderByCode } from '../services/orderService.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { publishFeedback } from '../services/feedbackService.js';
import { isManager } from '../utils/permissions.js';
import { openWarrantyTicket, buildWarrantyCustomerConfirmV2 } from '../services/warrantyService.js';
import { updateOrderLogMessage } from '../services/notificationService.js';
import { buildQuickFeedbackAckV2 } from '../utils/embeds.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { safeReply, buildFeedbackModal, FEEDBACK_TEXT_INPUT_ID } from './shared.js';

export async function handleFeedbackButton(interaction, orderCode, starsRaw) {
  const E = createEmojiResolver(interaction.guildId);
  const stars = Number.parseInt(starsRaw, 10);
  const order = getOrderByCode(orderCode);

  if (!order) {
    await safeReply(interaction, { content: `${E('status_warn')} Không tìm thấy đơn hàng để feedback.`, ephemeral: true });
    return;
  }

  // Chủ đơn tự đánh giá; admin/manager được đánh giá hộ khách
  // (đề phòng trường hợp khách không biết đánh giá ở đâu).
  const isOwner = order.customer_id === interaction.user.id;
  const guildConfig = getGuildConfig(interaction.guildId);
  const onBehalf = !isOwner && isManager(interaction.member, guildConfig);

  if (!isOwner && !onBehalf) {
    await safeReply(interaction, { content: `${E('status_warn')} Bạn không phải chủ đơn hàng này.`, ephemeral: true });
    return;
  }

  if (order.guild_id && order.guild_id !== interaction.guildId) {
    await safeReply(interaction, { content: `${E('status_warn')} Đơn này không thuộc server hiện tại.`, ephemeral: true });
    return;
  }

  if (order.status !== 'COMPLETED') {
    await safeReply(interaction, { content: `${E('status_warn')} Chỉ có thể feedback cho đơn đã hoàn thành.`, ephemeral: true });
    return;
  }

  if (order.feedback_submitted_at) {
    await safeReply(interaction, { content: `${E('status_info')} Đơn này đã feedback rồi.`, ephemeral: true });
    return;
  }

  await interaction.showModal(buildFeedbackModal(orderCode, stars, { onBehalf }));
}


// Xử lý khi khách đã chọn sản phẩm từ dropdown bảo hành
export async function handleWarrantyProductSelect(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  const orderCode = interaction.values?.[0];
  if (!orderCode) {
    await safeReply(interaction, { content: `${E('status_warn')} Không nhận được lựa chọn. Vui lòng thử lại.`, ephemeral: true });
    return;
  }

  const order = getOrderByCode(orderCode);
  if (!order || order.customer_id !== interaction.user.id) {
    await safeReply(interaction, { content: `${E('status_warn')} Không tìm thấy đơn hàng hoặc bạn không phải chủ sở hữu.`, ephemeral: true });
    return;
  }

  // Hiện modal nhập thông tin bảo hành đầy đủ
  const modal = new ModalBuilder()
    .setCustomId(`warranty:reason:modal:${orderCode}`)
    .setTitle(`Bảo Hành — ${orderCode}`);

  const productTypeInput = new TextInputBuilder()
    .setCustomId('warranty_product_type')
    .setLabel('Loại sản phẩm cần bảo hành')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('VD: Netflix Profile, Spotify Personal, ChatGPT Plus...')
    .setMaxLength(100);

  const accountInput = new TextInputBuilder()
    .setCustomId('warranty_account_info')
    .setLabel('Email / Tài khoản (đang dùng)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('VD: example@gmail.com hoặc username')
    .setMaxLength(200);

  const passwordInput = new TextInputBuilder()
    .setCustomId('warranty_password')
    .setLabel('Mật khẩu hiện tại')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('Mật khẩu bạn đang dùng để đăng nhập')
    .setMaxLength(200);

  const purchaseDateInput = new TextInputBuilder()
    .setCustomId('warranty_purchase_date')
    .setLabel('Ngày mua hàng')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('DD/MM/YYYY — VD: 01/06/2025')
    .setMaxLength(20);

  const expiredDateInput = new TextInputBuilder()
    .setCustomId('warranty_expired_date')
    .setLabel('Ngày mất / hết hạn / gặp lỗi')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('DD/MM/YYYY — VD: 15/06/2025')
    .setMaxLength(20);

  modal.addComponents(
    new ActionRowBuilder().addComponents(productTypeInput),
    new ActionRowBuilder().addComponents(accountInput),
    new ActionRowBuilder().addComponents(passwordInput),
    new ActionRowBuilder().addComponents(purchaseDateInput),
    new ActionRowBuilder().addComponents(expiredDateInput),
  );
  await interaction.showModal(modal);
}

// Xử lý modal bảo hành đầy đủ → tạo ticket
export async function handleWarrantyReasonModalSubmit(interaction, orderCode) {
  const E = createEmojiResolver(interaction.guildId);

  // Đọc 5 trường từ modal mới (tương thích cả modal cũ 1 trường)
  const getSafeField = (id) => {
    try {
      return interaction.fields.getTextInputValue(id)?.trim() || null;
    } catch {
      return null;
    }
  };

  const productType   = getSafeField('warranty_product_type');
  const accountInfo   = getSafeField('warranty_account_info');
  const password      = getSafeField('warranty_password');
  const purchaseDate  = getSafeField('warranty_purchase_date');
  const dateExpired   = getSafeField('warranty_expired_date');
  // Legacy fallback
  const legacyReason  = getSafeField('warranty_reason');

  const formData = (productType || accountInfo || password || purchaseDate || dateExpired)
    ? { productType, accountInfo, password, purchaseDate, dateExpired }
    : null;

  const result = await openWarrantyTicket({
    guild: interaction.guild,
    customerId: interaction.user.id,
    actorId: interaction.user.id,
    orderCode: orderCode.toUpperCase(),
    reason: legacyReason ?? 'Khách mở ticket bảo hành từ panel.',
    formData,
  });

  await updateOrderLogMessage(interaction.guild, result.order);
  await emitStaffLog(interaction.client, {
    guildId: interaction.guildId,
    actorId: interaction.user.id,
    targetId: interaction.user.id,
    action: 'WARRANTY_OPEN',
    detail: productType ? `Loại SP: ${productType}` : (legacyReason ?? 'Mở bảo hành từ panel'),
    relatedOrderCode: orderCode,
    relatedTicketCode: result.ticket.ticket_code,
  });

  if (result.reused) {
    await interaction.reply({
      content: `${E('status_info')} Đơn **${orderCode}** đã có ticket bảo hành tại ${result.channel}.`,
      ephemeral: true,
    }).catch(() => null);
    return;
  }

  // Gửi xác nhận Components V2 đẹp cho khách
  const { components, flags } = buildWarrantyCustomerConfirmV2({
    order: result.order,
    channel: result.channel,
    guildId: interaction.guildId,
  });
  await interaction.reply({
    components,
    flags: flags | MessageFlags.Ephemeral,
  }).catch(() => null);
}


export async function handleFeedbackModalSubmit(interaction, orderCode, starsRaw) {
  const stars = Number.parseInt(starsRaw, 10);
  const content = interaction.fields.getTextInputValue(FEEDBACK_TEXT_INPUT_ID)?.trim() || 'Không có ý kiến';

  // Xác định admin/manager đang ghi hộ feedback cho khách.
  const order = getOrderByCode(orderCode);
  const guildConfig = getGuildConfig(interaction.guildId);
  const actingOnBehalf = Boolean(
    order
    && order.customer_id !== interaction.user.id
    && isManager(interaction.member, guildConfig),
  );

  // ACK ngay để tránh hết hạn 3 giây của Discord: publishFeedback phải gọi
  // nhiều API liên tiếp (fetch member, fetch kênh, gửi thẻ feedback, ticket...).
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const result = await publishFeedback({
      guild: interaction.guild,
      userId: actingOnBehalf ? order.customer_id : interaction.user.id,
      orderCode,
      stars,
      content,
      actorId: interaction.user.id,
    });

    // Trả kết quả cho user trước; staff log và ticket card chạy sau để không
    // kéo dài thời gian chờ.
    const { container, flags } = buildQuickFeedbackAckV2(result.order, stars, {
      onBehalf: result.onBehalf,
      actorId: interaction.user.id,
    });
    await interaction.editReply({
      components: [container],
      flags: flags | MessageFlags.Ephemeral,
    });

    if (result.onBehalf) {
      emitStaffLog(interaction.client, {
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        targetId: order.customer_id,
        action: 'FEEDBACK_ON_BEHALF',
        detail: `Admin ghi nhận feedback ${stars}/5 sao thay cho khách`,
        relatedOrderCode: order.order_code,
        relatedTicketCode: result.ticket?.ticket_code || null,
      }).catch(() => null);
    }

    const ticket = result.ticket;
    if (ticket) {
      const channel = await interaction.guild.channels.fetch(ticket.channel_id).catch(() => null);
      if (channel?.isTextBased()) {
        const E_ch = createEmojiResolver(interaction.guildId);
        const starEmoji = E_ch('icon_star');
        const starBar = starEmoji ? starEmoji.repeat(Math.max(1, Math.min(5, stars))) : `${stars}/5 sao`;
        const fbContainer = new ContainerBuilder().setAccentColor(0xF3A6D7);
        fbContainer.addTextDisplayComponents(
          new TextDisplayBuilder().setContent([
            `## ${E_ch('payment_success')} Feedback Đã Ghi Nhận!`.trim(),
            `> ${E_ch('order_id')} **Mã đơn:** \`${result.order.order_code}\``.trim(),
            `> ${E_ch('icon_star')} **Đánh giá:** **${stars}/5 sao**`.trim(),
            `> ${starBar}`,
            result.onBehalf
              ? `> -# ${E_ch('ticket_staff')} Admin <@${interaction.user.id}> ghi nhận đánh giá thay cho khách <@${result.order.customer_id}>`.trim()
              : null,
          ].filter(Boolean).join('\n'))
        );
        fbContainer.addSeparatorComponents(
          new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        );
        fbContainer.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `-# ${E_ch('icon_clock')} Ticket sẽ tự đóng sau **${config.autoCloseCompletedTicketMinutes} phút**. Bấm nút bên dưới nếu muốn giữ ticket mở.`.trim()
          )
        );
        const keepOpenBtn = new ButtonBuilder()
          .setCustomId(`ticket:keepopen:${ticket.id}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel('Giữ Ticket Mở');
        const keepOpenBtnEmoji = E_ch.component('icon_lock');
        if (keepOpenBtnEmoji) keepOpenBtn.setEmoji(keepOpenBtnEmoji);
        await channel.send({
          components: [fbContainer, new ActionRowBuilder().addComponents(keepOpenBtn)],
          flags: MessageFlags.IsComponentsV2,
        }).catch(() => null);
      }
    }
  } catch (error) {
    const E_err = createEmojiResolver(interaction.guildId);
    await interaction.editReply({ content: `${E_err('status_warn')} ${error.message}` }).catch(() => null);
  }
}

export async function handleWarrantyButton(interaction, orderCode) {
  const E = createEmojiResolver(interaction.guildId);
  const order = getOrderByCode(orderCode);
  if (!order) {
    await safeReply(interaction, { content: `${E('status_warn')} Không tìm thấy đơn hàng.`, ephemeral: true });
    return;
  }

  if (order.customer_id !== interaction.user.id) {
    await safeReply(interaction, { content: `${E('status_warn')} Chỉ chủ đơn hàng mới có thể mở ticket bảo hành.`, ephemeral: true });
    return;
  }

  // Hiện modal điền thông tin bảo hành đầy đủ
  const modal = new ModalBuilder()
    .setCustomId(`warranty:reason:modal:${orderCode}`)
    .setTitle(`Bảo Hành — ${orderCode}`);

  const productTypeInput = new TextInputBuilder()
    .setCustomId('warranty_product_type')
    .setLabel('Loại sản phẩm cần bảo hành')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('VD: Netflix Profile, Spotify Personal, ChatGPT Plus...')
    .setMaxLength(100);

  const accountInput = new TextInputBuilder()
    .setCustomId('warranty_account_info')
    .setLabel('Email / Tài khoản (đang dùng)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('VD: example@gmail.com hoặc username')
    .setMaxLength(200);

  const passwordInput = new TextInputBuilder()
    .setCustomId('warranty_password')
    .setLabel('Mật khẩu hiện tại')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('Mật khẩu bạn đang dùng để đăng nhập')
    .setMaxLength(200);

  const purchaseDateInput = new TextInputBuilder()
    .setCustomId('warranty_purchase_date')
    .setLabel('Ngày mua hàng')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('DD/MM/YYYY — VD: 01/06/2025')
    .setMaxLength(20);

  const expiredDateInput = new TextInputBuilder()
    .setCustomId('warranty_expired_date')
    .setLabel('Ngày mất / hết hạn / gặp lỗi')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('DD/MM/YYYY — VD: 15/06/2025')
    .setMaxLength(20);

  modal.addComponents(
    new ActionRowBuilder().addComponents(productTypeInput),
    new ActionRowBuilder().addComponents(accountInput),
    new ActionRowBuilder().addComponents(passwordInput),
    new ActionRowBuilder().addComponents(purchaseDateInput),
    new ActionRowBuilder().addComponents(expiredDateInput),
  );
  await interaction.showModal(modal);
}
