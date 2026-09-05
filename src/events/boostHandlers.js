// ═══════════════════════════════════════════════════════════════════
// boostHandlers.js — Nhóm xử lý Discord Boost Server (tách từ interactionCreate.js).
// Nằm CÙNG thư mục src/events/ để mọi đường dẫn '../services', '../utils' giữ nguyên.
// State/helper dùng chung import từ ./shared.js — KHÔNG khai báo lại.
// ═══════════════════════════════════════════════════════════════════

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} from 'discord.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { getCustomerFlag } from '../services/blacklistService.js';
import { isStaffMember } from '../utils/permissions.js';
import { safeReply } from './shared.js';

export async function handleBoostBuy(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  const flag = getCustomerFlag(interaction.guildId, interaction.user.id);
  if (Number(flag.is_blacklisted) === 1) {
    await safeReply(interaction, { content: `${E('status_cross')} Bạn đang bị chặn.`, ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId('boost:buy:modal')
    .setTitle('🚀 Đặt Mua Boost Server');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('server_link')
        .setLabel('Link mời server của bạn')
        .setPlaceholder('VD: https://discord.gg/abc123')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(200)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('server_id')
        .setLabel('ID Server (chuột phải vào server → Copy ID)')
        .setPlaceholder('VD: 1234567890123456789')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(25)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('server_name')
        .setLabel('Tên Server (tuỳ chọn)')
        .setPlaceholder('VD: Cenar Store')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(100)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('package')
        .setLabel('Gói muốn mua (1 hoặc 3)')
        .setPlaceholder('1 = Gói 1 Tháng (120k) | 3 = Gói 3 Tháng (290k)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(1)
    ),
  );

  await interaction.showModal(modal).catch(console.error);
}

export async function handleBoostBuyModal(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  await interaction.deferReply({ ephemeral: true });

  const serverLink = interaction.fields.getTextInputValue('server_link')?.trim();
  const serverId   = interaction.fields.getTextInputValue('server_id')?.trim();
  const serverName = interaction.fields.getTextInputValue('server_name')?.trim() || null;
  const pkgRaw     = interaction.fields.getTextInputValue('package')?.trim();

  if (!serverLink || !/discord\.gg\//i.test(serverLink)) {
    await interaction.editReply(`${E('status_cross')} Link mời không hợp lệ. Vui lòng nhập link dạng \`https://discord.gg/...\``);
    return;
  }

  if (!serverId || !/^\d{17,20}$/.test(serverId)) {
    await interaction.editReply(`${E('status_cross')} ID Server không hợp lệ. ID phải là dãy số 17–20 chữ số.`);
    return;
  }

  const { BOOST_PACKAGES, createBoostOrder, sendBoostPaymentDM, sendBoostLog, refreshBoostPanel } = await import('../services/boostServerService.js');
  const pkg = pkgRaw === '3' ? BOOST_PACKAGES[1] : BOOST_PACKAGES[0];

  const order = createBoostOrder({
    guildId: interaction.guildId,
    customerId: interaction.user.id,
    customerTag: interaction.user.tag,
    serverLink,
    serverId,
    serverName,
    pkg: pkg.label,
    durationMonths: pkg.months,
    amount: pkg.price,
  });

  // DM khách link PayOS
  try {
    const dmChannel = await interaction.user.createDM();
    await sendBoostPaymentDM(dmChannel, order, interaction.guildId);
  } catch (dmErr) {
    console.warn('[BOOST BUY] Không thể DM khách:', dmErr.message);
  }

  // Log về kênh admin
  await sendBoostLog(interaction.client, interaction.guildId, order, 'Đơn mới tạo', interaction.user.id).catch(() => null);

  // Cập nhật panel
  refreshBoostPanel(interaction.client, interaction.guildId).catch(() => null);

  await interaction.editReply(
    `${E('status_check')} Đơn boost **${order.order_code}** đã được tạo!\n` +
    `Bot vừa gửi link thanh toán **PayOS** qua DM cho bạn.\n` +
    `> Nếu không nhận được DM, hãy kiểm tra bạn đã bật tin nhắn từ thành viên server.`
  );
}

export async function handleBoostCheck(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  const { getBoostOrdersByCustomer, buildBoostOrderDetailEmbed, buildBoostOrderActionRows } = await import('../services/boostServerService.js');

  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const isStaff = isStaffMember(member, guildConfig);

  let orders;
  if (isStaff) {
    // Staff xem modal nhập mã đơn
    const modal = new ModalBuilder()
      .setCustomId('boost:check:modal_staff')
      .setTitle('🔍 Kiểm Tra Đơn Boost');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('order_code')
          .setLabel('Mã đơn (BST_XXXXXX) — để trống: xem tất cả')
          .setPlaceholder('VD: BST_123456')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(20)
      )
    );
    await interaction.showModal(modal);
    return;
  }

  // Khách xem đơn của mình
  orders = getBoostOrdersByCustomer(interaction.guildId, interaction.user.id);

  if (!orders.length) {
    await safeReply(interaction, {
      content: `${E('status_info')} Bạn chưa có đơn boost nào. Bấm **Mua Boost Server** để đặt đơn!`,
      ephemeral: true,
    });
    return;
  }

  const order = orders[0];
  const embed = buildBoostOrderDetailEmbed(order);
  const rows = buildBoostOrderActionRows(order, false);

  await safeReply(interaction, {
    content: orders.length > 1 ? `${E('status_info')} Bạn có **${orders.length}** đơn. Hiển thị đơn mới nhất:` : null,
    embeds: [embed],
    components: rows,
    ephemeral: true,
  });
}

export async function handleBoostWarrantyPanel(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  const { getBoostOrdersByCustomer } = await import('../services/boostServerService.js');

  const orders = getBoostOrdersByCustomer(interaction.guildId, interaction.user.id)
    .filter(o => o.status === 'ACTIVE');

  if (!orders.length) {
    await safeReply(interaction, {
      content: `${E('status_warn')} Bạn chưa có đơn boost đang hoạt động nào để báo bảo hành.`,
      ephemeral: true,
    });
    return;
  }

  const order = orders[0];

  const modal = new ModalBuilder()
    .setCustomId(`boost:warranty:modal:${order.order_code}`)
    .setTitle(`Bảo Hành Boost — ${order.order_code}`);

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Mô tả vấn đề gặp phải')
        .setPlaceholder('VD: Server bị mất boost sau 5 ngày...')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500)
    )
  );

  await interaction.showModal(modal).catch(console.error);
}

export async function handleBoostCancelButton(interaction, code) {
  const E = createEmojiResolver(interaction.guildId);
  const { getBoostOrderByCode } = await import('../services/boostServerService.js');

  const order = getBoostOrderByCode(code);
  if (!order) {
    await safeReply(interaction, { content: `${E('status_cross')} Không tìm thấy đơn \`${code}\`.`, ephemeral: true });
    return;
  }

  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const isStaff = isStaffMember(member, guildConfig);

  if (order.customer_id !== interaction.user.id && !isStaff) {
    await safeReply(interaction, { content: `${E('status_cross')} Bạn không có quyền huỷ đơn này.`, ephemeral: true });
    return;
  }

  if (!['PENDING', 'ACTIVE'].includes(order.status)) {
    await safeReply(interaction, { content: `${E('status_warn')} Đơn \`${code}\` không thể huỷ (trạng thái: ${order.status}).`, ephemeral: true });
    return;
  }

  // Hiện modal nhập lý do
  const modal = new ModalBuilder()
    .setCustomId(`boost:cancel:modal:${code}`)
    .setTitle(`Huỷ Đơn ${code}`);

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Lý do huỷ đơn')
        .setPlaceholder('VD: Đổi ý, không cần nữa...')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(200)
    )
  );

  await interaction.showModal(modal).catch(console.error);
}

export async function handleBoostCancelModal(interaction, code) {
  const E = createEmojiResolver(interaction.guildId);
  const { getBoostOrderByCode, updateBoostOrderStatus, sendBoostLog, refreshBoostPanel } = await import('../services/boostServerService.js');

  await interaction.deferReply({ ephemeral: true });

  const reason = interaction.fields.getTextInputValue('reason')?.trim();
  const order = getBoostOrderByCode(code);

  if (!order || !['PENDING', 'ACTIVE'].includes(order.status)) {
    await interaction.editReply(`${E('status_cross')} Không thể huỷ đơn này.`);
    return;
  }

  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const isStaff = isStaffMember(member, guildConfig);

  if (order.customer_id !== interaction.user.id && !isStaff) {
    await interaction.editReply(`${E('status_cross')} Bạn không có quyền huỷ đơn này.`);
    return;
  }

  const updated = updateBoostOrderStatus(code, 'CANCELLED', {
    handledBy: interaction.user.id,
    note: `Huỷ bởi ${interaction.user.tag}: ${reason}`,
  });

  // DM khách — Components V2 + emoji custom
  try {
    const customer = await interaction.client.users.fetch(order.customer_id);
    const cancelledByStaff = isStaff && order.customer_id !== interaction.user.id;
    const { ContainerBuilder, TextDisplayBuilder, MessageFlags: MF } = await import('discord.js');

    const dmLines = [
      `## <a:tick_red51:1384069065626222632> Đơn Boost Đã Bị Huỷ`,
      ``,
      `<:cr_shop:1392749981332541501> **Mã đơn:** \`${code}\``,
      `<:cr_carttt:1348626032747614268> **Gói:** ${order.package}`,
      `<:muiten:1481124261501337601> **Lý do:** ${reason}`,
      cancelledByStaff
        ? `<:verifybadge:1481127479702847646> **Huỷ bởi:** Admin/Staff`
        : `<:verifybadge:1481127479702847646> **Huỷ bởi:** Bạn`,
      ``,
      `-# <:cr_tim:1366636325352116225> Liên hệ shop nếu cần hỗ trợ thêm — Cenar Store`,
    ].join('\n');

    const dmContainer = new ContainerBuilder().setAccentColor(0xED4245);
    dmContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(dmLines));

    // Tạo thanh nút bấm đánh giá từ 1 đến 5 sao
      const feedbackRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`boost:feedback:start:${code}:1`).setLabel('1 ⭐').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`boost:feedback:start:${code}:2`).setLabel('2 ⭐').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`boost:feedback:start:${code}:3`).setLabel('3 ⭐').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`boost:feedback:start:${code}:4`).setLabel('4 ⭐').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`boost:feedback:start:${code}:5`).setLabel('5 ⭐').setStyle(ButtonStyle.Primary)
      );

      await customer.send({
        components: [dmContainer, feedbackRow],
        flags: MF.IsComponentsV2,
      }).catch(() => null);
  } catch {}

  await sendBoostLog(interaction.client, interaction.guildId, updated, 'Đơn bị huỷ', interaction.user.id).catch(() => null);
  refreshBoostPanel(interaction.client, interaction.guildId).catch(() => null);

  await interaction.editReply(
    `<a:tickgreen:1384069022831874169> Đã huỷ đơn \`${code}\`.\n> <:muiten:1481124261501337601> **Lý do:** ${reason}`
  );
}

export async function handleBoostCancelConfirm(interaction, code) {
  // Legacy handler — redirect to modal-based cancel
  await handleBoostCancelButton(interaction, code);
}

export async function handleBoostCompleteButton(interaction, code) {
  const E = createEmojiResolver(interaction.guildId);
  const { getBoostOrderByCode, updateBoostOrderStatus, sendBoostLog, refreshBoostPanel } = await import('../services/boostServerService.js');

  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!isStaffMember(member, guildConfig)) {
    await safeReply(interaction, { content: `${E('status_cross')} Chỉ staff mới có thể đánh dấu đơn hoàn thành.`, ephemeral: true });
    return;
  }

  const order = getBoostOrderByCode(code);
  if (!order || !['PENDING', 'ACTIVE'].includes(order.status)) {
    await safeReply(interaction, { content: `${E('status_warn')} Không thể hoàn thành đơn \`${code}\` (trạng thái: ${order?.status ?? 'không tìm thấy'}).`, ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const updated = updateBoostOrderStatus(code, 'COMPLETED', {
    handledBy: interaction.user.id,
    note: `Hoàn thành bởi ${interaction.user.tag}`,
  });

  // DM khách thông báo hoàn thành — Components V2 + emoji custom
  try {
    const customer = await interaction.client.users.fetch(order.customer_id);
    const { ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags: MF } = await import('discord.js');

    const dmLines = [
      `## <:cr_green:1366636327415713832> Đơn Boost Đã Hoàn Thành! <a:starxoay:1481141954346483845>`,
      ``,
      `> <a:tickgreen:1384069022831874169> Đơn boost \`${code}\` đã được **hoàn thành** thành công!`,
      ``,
      `> <:cr_carttt:1348626032747614268> **Gói:** ${order.package}`,
      `> <:cr_muahang:1348622828152426528> **Server:** ${order.server_name ?? order.server_id}`,
      `> <:cr_shop:1392749981332541501> **Mã đơn:** \`${code}\``,
      ``,
      `<:muiten:1481124261501337601> Nếu cần bảo hành, liên hệ shop ngay nhé!`,
      ``,
      `-# <:cr_tim:1366636325352116225> Cenar Store — Cảm ơn bạn đã tin tưởng <:purple_heart_glow:1327541911749263360>`,
    ].join('\n');

    const dmContainer = new ContainerBuilder().setAccentColor(0x57F287);
    dmContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(dmLines));
    dmContainer.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('https://i.pinimg.com/originals/68/ae/bf/68aebf3739f455687a90e871bdc04a98.gif')
      )
    );

    await customer.send({
      components: [dmContainer],
      flags: MF.IsComponentsV2,
    }).catch(() => null);
  } catch {}

  await sendBoostLog(interaction.client, interaction.guildId, updated, 'Đơn hoàn thành', interaction.user.id).catch(() => null);
  refreshBoostPanel(interaction.client, interaction.guildId).catch(() => null);

  await interaction.editReply(
    `<:cr_green:1366636327415713832> Đã đánh dấu đơn \`${code}\` là **hoàn thành** và gửi DM cho khách.`
  );
}

export async function handleBoostActivateButton(interaction, code) {
  const E = createEmojiResolver(interaction.guildId);
  const { getBoostOrderByCode } = await import('../services/boostServerService.js');

  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!isStaffMember(member, guildConfig)) {
    await safeReply(interaction, { content: `${E('status_cross')} Chỉ staff mới có thể kích hoạt đơn boost.`, ephemeral: true });
    return;
  }

  const order = getBoostOrderByCode(code);
  if (!order || order.status !== 'PENDING') {
    await safeReply(interaction, { content: `${E('status_warn')} Đơn \`${code}\` không ở trạng thái chờ để kích hoạt.`, ephemeral: true });
    return;
  }

  // Hiện modal nhập thời gian boost
  const modal = new ModalBuilder()
    .setCustomId(`boost:activate:modal:${code}`)
    .setTitle(`Kích Hoạt Boost — ${code}`);

  const now = new Date();
  const expiryDate = new Date(now);
  expiryDate.setMonth(expiryDate.getMonth() + (order.duration_months || 1));
  const defaultExpiry = expiryDate.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('expires_at')
        .setLabel('Ngày hết hạn boost (DD/MM/YYYY)')
        .setPlaceholder(`VD: ${defaultExpiry}`)
        .setValue(defaultExpiry)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(15)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('note')
        .setLabel('Ghi chú (tuỳ chọn)')
        .setPlaceholder('VD: Đã boost 14 Boosts lúc 10:30 ngày 08/07/2026')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(200)
    ),
  );

  await interaction.showModal(modal).catch(console.error);
}

export async function handleBoostActivateModal(interaction, code) {
  const E = createEmojiResolver(interaction.guildId);
  const { getBoostOrderByCode, updateBoostOrderStatus, sendBoostLog, refreshBoostPanel } = await import('../services/boostServerService.js');

  await interaction.deferReply({ ephemeral: true });

  const expiresRaw = interaction.fields.getTextInputValue('expires_at')?.trim();
  const note = interaction.fields.getTextInputValue('note')?.trim() || null;

  // Parse DD/MM/YYYY
  const match = expiresRaw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  let expiresAt = null;
  if (match) {
    expiresAt = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])).toISOString();
  }

  const order = getBoostOrderByCode(code);
  if (!order) {
    await interaction.editReply(`${E('status_cross')} Không tìm thấy đơn \`${code}\`.`);
    return;
  }

  const updated = updateBoostOrderStatus(code, 'ACTIVE', {
    boostStartedAt: new Date().toISOString(),
    boostExpiresAt: expiresAt,
    handledBy: interaction.user.id,
    note: note ?? `Kích hoạt bởi ${interaction.user.tag}`,
  });

  // DM khách — Components V2 + emoji custom
  try {
    const customer = await interaction.client.users.fetch(order.customer_id);
    const expiryStr = expiresAt
      ? `<t:${Math.floor(new Date(expiresAt).getTime() / 1000)}:F>`
      : 'Theo gói đã đặt';

    const { ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags: MF } = await import('discord.js');

    const dmLines = [
      `## <a:tsm_fire:1327553120842158111> Server Của Bạn Đã Được BOOST! <a:tsm_fire:1327553120842158111>`,
      ``,
      `> <a:tickgreen:1384069022831874169> **Cenar Store** đã boost thành công server của bạn!`,
      ``,
      `> <:cr_carttt:1348626032747614268> **Gói:** ${order.package}`,
      `> <:cr_muahang:1348622828152426528> **Server:** ${order.server_name ?? order.server_id}`,
      `> <a:Dotyellow:1481134440725090315> **Hết hạn:** ${expiryStr}`,
      `> <:cr_shop:1392749981332541501> **Mã đơn:** \`${order.order_code}\``,
      ``,
      `<:muiten:1481124261501337601> Nếu cần bảo hành, liên hệ shop ngay nhé!`,
      ``,
      `-# <:cr_tim:1366636325352116225> Cenar Store — Cảm ơn bạn đã tin tưởng <:purple_heart_glow:1327541911749263360>`,
    ].join('\n');

    const dmContainer = new ContainerBuilder().setAccentColor(0x57F287);
    dmContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(dmLines));
    dmContainer.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('https://i.pinimg.com/originals/68/ae/bf/68aebf3739f455687a90e871bdc04a98.gif')
      )
    );

    await customer.send({
      components: [dmContainer],
      flags: MF.IsComponentsV2,
    }).catch(() => null);
  } catch {}

  await sendBoostLog(interaction.client, interaction.guildId, updated, 'Đã boost — Kích hoạt ACTIVE', interaction.user.id).catch(() => null);
  refreshBoostPanel(interaction.client, interaction.guildId).catch(() => null);

  await interaction.editReply(
    `<a:tickgreen:1384069022831874169> Đã kích hoạt đơn \`${code}\` → **ACTIVE** và DM thông báo cho khách!` +
    (expiresAt ? `\n> <a:Dotyellow:1481134440725090315> Hết hạn: **${expiresRaw}**` : '')
  );
}

export async function handleBoostWarrantyReq(interaction, code) {
  const E = createEmojiResolver(interaction.guildId);
  const { getBoostOrderByCode } = await import('../services/boostServerService.js');

  const order = getBoostOrderByCode(code);
  if (!order || order.customer_id !== interaction.user.id) {
    await safeReply(interaction, { content: `${E('status_cross')} Không tìm thấy đơn hoặc bạn không phải chủ đơn.`, ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`boost:warranty:modal:${code}`)
    .setTitle(`Bảo Hành Boost — ${code}`);

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Mô tả vấn đề gặp phải')
        .setPlaceholder('VD: Server bị mất boost sau 5 ngày, level 3 về level 0...')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500)
    )
  );

  await interaction.showModal(modal).catch(console.error);
}

export async function handleBoostWarrantyModal(interaction, code) {
  const E = createEmojiResolver(interaction.guildId);
  const { getBoostOrderByCode, updateBoostOrderStatus, sendBoostLog } = await import('../services/boostServerService.js');

  await interaction.deferReply({ ephemeral: true });

  const reason = interaction.fields.getTextInputValue('reason')?.trim();
  const order = getBoostOrderByCode(code);

  if (!order || order.customer_id !== interaction.user.id) {
    await interaction.editReply(`${E('status_cross')} Không tìm thấy đơn hoặc bạn không phải chủ đơn.`);
    return;
  }

  const updated = updateBoostOrderStatus(code, 'WARRANTY', {
    note: `Bảo hành: ${reason}`,
  });

  await sendBoostLog(interaction.client, interaction.guildId, updated, `Yêu cầu bảo hành: ${reason}`, interaction.user.id).catch(() => null);

  await interaction.editReply(
    `${E('status_check')} Đã gửi yêu cầu bảo hành cho đơn \`${code}\`!\n` +
    `> Admin sẽ xem xét và xử lý trong thời gian sớm nhất.`
  );
}

// Staff check modal (khi staff dùng boost:check)
// Handled via isModalSubmit boost:check:modal_staff in the main handler

// ═══════════════════════════════════════════════

