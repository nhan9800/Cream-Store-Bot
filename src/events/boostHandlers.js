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
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';
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

  const { buildBoostPackagePickerPayload } = await import('../services/boostServerService.js');
  await safeReply(interaction, buildBoostPackagePickerPayload(interaction.guildId));
}

export async function handleBoostBuyPackage(interaction, packageKey) {
  const E = createEmojiResolver(interaction.guildId);
  const flag = getCustomerFlag(interaction.guildId, interaction.user.id);
  if (Number(flag.is_blacklisted) === 1) {
    await safeReply(interaction, { content: `${E('status_cross')} Bạn đang bị chặn.`, ephemeral: true });
    return;
  }

  const { getBoostPackage } = await import('../services/boostServerService.js');
  const pkg = getBoostPackage(packageKey);
  if (!pkg) {
    await safeReply(interaction, { content: `${E('status_cross')} Gói Boost Server không hợp lệ.`, ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`boost:buy:modal:${pkg.key}`)
    .setTitle(`Đặt Boost Server ${pkg.months} Tháng`);

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
  );

  await interaction.showModal(modal).catch(console.error);
}

export async function handleBoostBuyModal(interaction, packageKey = null) {
  const E = createEmojiResolver(interaction.guildId);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const serverLink = interaction.fields.getTextInputValue('server_link')?.trim();
  const serverId   = interaction.fields.getTextInputValue('server_id')?.trim();
  const serverName = interaction.fields.getTextInputValue('server_name')?.trim() || null;

  let inviteUrl = null;
  try {
    inviteUrl = new URL(serverLink);
  } catch {}
  const validInvite = inviteUrl
    && inviteUrl.protocol === 'https:'
    && ['discord.gg', 'www.discord.gg', 'discord.com', 'www.discord.com'].includes(inviteUrl.hostname.toLowerCase())
    && (/^\/[A-Za-z0-9-]+\/?$/.test(inviteUrl.pathname) || /^\/invite\/[A-Za-z0-9-]+\/?$/.test(inviteUrl.pathname));
  if (!validInvite) {
    await interaction.editReply(`${E('status_cross')} Link mời không hợp lệ. Vui lòng nhập link dạng \`https://discord.gg/...\``);
    return;
  }

  if (!serverId || !/^\d{17,20}$/.test(serverId)) {
    await interaction.editReply(`${E('status_cross')} ID Server không hợp lệ. ID phải là dãy số 17–20 chữ số.`);
    return;
  }

  const {
    getBoostPackage,
    getBoostOrderByCode,
    createBoostOrder,
    createBoostPaymentPayload,
    sendBoostPaymentDM,
    sendBoostLog,
    refreshBoostPanel,
  } = await import('../services/boostServerService.js');
  const pkg = getBoostPackage(packageKey);
  if (!pkg) {
    await interaction.editReply(`${E('status_cross')} Gói Boost Server không hợp lệ hoặc panel đã quá cũ. Vui lòng bấm mua lại.`);
    return;
  }

  const order = createBoostOrder({
    guildId: interaction.guildId,
    customerId: interaction.user.id,
    customerTag: interaction.user.tag,
    serverLink,
    serverId,
    serverName,
    packageKey: pkg.key,
  });

  let paymentPayload;
  try {
    paymentPayload = await createBoostPaymentPayload(order, interaction.guildId);
    await interaction.editReply(paymentPayload);
  } catch (payError) {
    console.error('[BOOST BUY] Không thể tạo QR PayOS:', payError);
    await interaction.editReply(
      `${E('status_cross')} Đã tạo đơn \`${order.order_code}\` nhưng chưa tạo được QR PayOS: ${payError.message}\n` +
      `${E('status_info')} Vui lòng bấm **Nhập Key / Xem Live** sau hoặc liên hệ staff để tạo lại thanh toán.`
    );
  }

  // Log về kênh admin
  await sendBoostLog(interaction.client, interaction.guildId, order, 'Đơn mới tạo', interaction.user.id).catch(() => null);

  // Cập nhật panel
  refreshBoostPanel(interaction.client, interaction.guildId).catch(() => null);

  if (paymentPayload) {
    try {
      const dmChannel = await interaction.user.createDM();
      await sendBoostPaymentDM(dmChannel, getBoostOrderByCode(order.order_code), interaction.guildId);
    } catch (dmErr) {
      console.warn('[BOOST BUY] QR đã hiển thị nhưng không thể DM khách:', dmErr.message);
    }
  }
}

export async function handleBoostCheck(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  const {
    getBoostOrdersByCustomer,
    buildBoostOrderDetailPayload,
    buildBoostLiveStatusPayload,
    ensureBoostAccessKey,
  } = await import('../services/boostServerService.js');

  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const isStaff = isStaffMember(member, guildConfig);

  let orders;
  if (isStaff) {
    // Staff xem modal nhập mã đơn
    const modal = new ModalBuilder()
      .setCustomId('boost:check:modal_staff')
      .setTitle('Kiểm Tra Đơn Boost');

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
  if (order.payment_status === 'PAID') {
    const accessKey = ensureBoostAccessKey(order.order_code).accessKey;
    const payload = buildBoostLiveStatusPayload(order, interaction.guildId, { accessKey });
    await safeReply(interaction, { ...payload, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    return;
  }
  const payload = buildBoostOrderDetailPayload(order, false, {
    extraText: orders.length > 1 ? `${E('status_info')} Bạn có **${orders.length}** đơn. Đang hiển thị đơn mới nhất.` : null,
  });
  await safeReply(interaction, { ...payload, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

async function resolveBoostStaff(interaction, guildId = interaction.guildId) {
  const guild = interaction.guild ?? interaction.client.guilds.cache.get(guildId);
  const member = guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
  return isStaffMember(member, getGuildConfig(guildId));
}

export async function handleBoostKeyButton(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('boost:key:modal')
    .setTitle('Tra Cứu Boost Server Live');
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId('access_key')
      .setLabel('Key được bot gửi sau khi PayOS xác nhận')
      .setPlaceholder('BST-XXXX-XXXX-XXXX')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(12)
      .setMaxLength(24)
  ));
  await interaction.showModal(modal);
}

export async function handleBoostKeyModal(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const key = interaction.fields.getTextInputValue('access_key')?.trim();
  const { getBoostOrderByAccessKey, ensureBoostAccessKey, buildBoostLiveStatusPayload } = await import('../services/boostServerService.js');
  const order = getBoostOrderByAccessKey(key);
  if (!order || order.guild_id !== interaction.guildId) {
    await interaction.editReply(`${E('status_cross')} Key không hợp lệ hoặc không thuộc server này.`);
    return;
  }

  const isStaff = await resolveBoostStaff(interaction, order.guild_id);
  if (order.customer_id !== interaction.user.id && !isStaff) {
    await interaction.editReply(`${E('status_cross')} Key này không thuộc tài khoản Discord của bạn.`);
    return;
  }

  const accessKey = order.customer_id === interaction.user.id
    ? ensureBoostAccessKey(order.order_code).accessKey
    : null;
  await interaction.editReply(buildBoostLiveStatusPayload(order, order.guild_id, { isStaff, accessKey }));
}

export async function handleBoostLiveRefresh(interaction, code) {
  const { getBoostOrderByCode, ensureBoostAccessKey, buildBoostLiveStatusPayload } = await import('../services/boostServerService.js');
  const order = getBoostOrderByCode(code);
  const E = createEmojiResolver(order?.guild_id ?? interaction.guildId);
  if (!order) {
    await safeReply(interaction, { content: `${E('status_cross')} Không tìm thấy đơn Boost Server.`, ephemeral: true });
    return;
  }
  const isStaff = await resolveBoostStaff(interaction, order.guild_id);
  if (order.customer_id !== interaction.user.id && !isStaff) {
    await safeReply(interaction, { content: `${E('status_cross')} Bạn không có quyền xem trạng thái đơn này.`, ephemeral: true });
    return;
  }
  const accessKey = order.customer_id === interaction.user.id && order.payment_status === 'PAID'
    ? ensureBoostAccessKey(order.order_code).accessKey
    : null;
  const payload = buildBoostLiveStatusPayload(order, order.guild_id, { isStaff, accessKey });
  if (interaction.message && interaction.isButton()) await interaction.update({ ...payload, content: null, embeds: [] });
  else await safeReply(interaction, { ...payload, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

export async function handleBoostPaymentButton(interaction, code) {
  const { getBoostOrderByCode, createBoostPaymentPayload, sendBoostPaymentDM, isBoostPaymentClosed } = await import('../services/boostServerService.js');
  const order = getBoostOrderByCode(code);
  const E = createEmojiResolver(order?.guild_id ?? interaction.guildId);
  if (!order || order.guild_id !== interaction.guildId) {
    await safeReply(interaction, { content: `${E('status_cross')} Không tìm thấy đơn Boost Server.`, ephemeral: true });
    return;
  }
  const isStaff = await resolveBoostStaff(interaction, order.guild_id);
  if (order.customer_id !== interaction.user.id && !isStaff) {
    await safeReply(interaction, { content: `${E('status_cross')} Bạn không có quyền thanh toán đơn này.`, ephemeral: true });
    return;
  }
  if (isBoostPaymentClosed(order)) {
    await safeReply(interaction, { content: `${E('status_info')} Đơn đã huỷ hoặc hoàn tiền. Không thể tạo thanh toán cho đơn này.`, ephemeral: true });
    return;
  }
  if (order.payment_status === 'PAID') {
    await safeReply(interaction, { content: `${E('payment_success')} Đơn đã thanh toán. Không cần tạo QR mới.`, ephemeral: true });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const payload = await createBoostPaymentPayload(order, order.guild_id);
    await interaction.editReply(payload);
    if (order.customer_id === interaction.user.id) {
      const dmChannel = await interaction.user.createDM().catch(() => null);
      if (dmChannel) await sendBoostPaymentDM(dmChannel, getBoostOrderByCode(code), order.guild_id).catch(() => null);
    }
  } catch (error) {
    await interaction.editReply(`${E('status_cross')} Không thể tạo QR PayOS: ${error.message}`);
  }
}

export async function handleBoostManageButton(interaction, code) {
  const E = createEmojiResolver(interaction.guildId);
  const { getBoostOrderByCode } = await import('../services/boostServerService.js');
  const order = getBoostOrderByCode(code);
  if (!order || order.guild_id !== interaction.guildId) {
    await safeReply(interaction, { content: `${E('status_cross')} Không tìm thấy đơn \`${code}\`.`, ephemeral: true });
    return;
  }
  if (!await resolveBoostStaff(interaction, order.guild_id)) {
    await safeReply(interaction, { content: `${E('status_cross')} Chỉ staff mới được cập nhật trạng thái live.`, ephemeral: true });
    return;
  }

  const expiry = order.boost_expires_at
    ? new Date(order.boost_expires_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '';
  const modal = new ModalBuilder()
    .setCustomId(`boost:manage:modal:${order.order_code}`)
    .setTitle(`Cập Nhật Live ${order.order_code}`);
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('status')
        .setLabel('PENDING / ACTIVE / WARRANTY / COMPLETED')
        .setValue(order.status)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('expires_at')
        .setLabel('Ngày hết hạn DD/MM/YYYY (tuỳ chọn)')
        .setValue(expiry)
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(10)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('customer_note')
        .setLabel('Nội dung khách thấy khi tra cứu live')
        .setValue(String(order.customer_status_note || 'Đơn đang được hệ thống xử lý.').slice(0, 500))
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500)
    ),
  );
  await interaction.showModal(modal);
}

function parseBoostDate(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (!match) return undefined;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day, 23, 59, 59);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
  return date.toISOString();
}

export async function handleBoostManageModal(interaction, code) {
  const E = createEmojiResolver(interaction.guildId);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { getBoostOrderByCode, updateBoostLiveStatus, buildBoostLiveStatusPayload, sendBoostLog, refreshBoostPanel } = await import('../services/boostServerService.js');
  const order = getBoostOrderByCode(code);
  if (!order || order.guild_id !== interaction.guildId || !await resolveBoostStaff(interaction, order.guild_id)) {
    await interaction.editReply(`${E('status_cross')} Bạn không có quyền cập nhật đơn này.`);
    return;
  }

  const status = interaction.fields.getTextInputValue('status')?.trim().toUpperCase();
  const customerNote = interaction.fields.getTextInputValue('customer_note')?.trim();
  const expiresRaw = interaction.fields.getTextInputValue('expires_at')?.trim();
  const expiresAt = parseBoostDate(expiresRaw);
  if (expiresRaw && expiresAt === undefined) {
    await interaction.editReply(`${E('status_cross')} Ngày hết hạn không hợp lệ. Hãy dùng định dạng DD/MM/YYYY.`);
    return;
  }

  let updated;
  try {
    updated = updateBoostLiveStatus(code, {
      status,
      boostExpiresAt: expiresAt,
      handledBy: interaction.user.id,
      customerStatusNote: customerNote,
      note: `Cập nhật live bởi ${interaction.user.tag}`,
    });
  } catch (error) {
    await interaction.editReply(`${E('status_cross')} ${error.message}`);
    return;
  }

  await sendBoostLog(interaction.client, order.guild_id, updated, 'Staff cập nhật trạng thái live', interaction.user.id).catch(() => null);
  refreshBoostPanel(interaction.client, order.guild_id).catch(() => null);
  try {
    const customer = await interaction.client.users.fetch(order.customer_id);
    const customerPayload = buildBoostLiveStatusPayload(updated, order.guild_id);
    await customer.send({ components: [customerPayload.components[0]], flags: MessageFlags.IsComponentsV2 });
  } catch {}
  await interaction.editReply(buildBoostLiveStatusPayload(updated, order.guild_id, { isStaff: true }));
}

export async function handleBoostStaffCheckModal(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  if (!await resolveBoostStaff(interaction, interaction.guildId)) {
    await safeReply(interaction, { content: `${E('status_cross')} Chỉ staff mới được tra cứu theo mã đơn.`, ephemeral: true });
    return;
  }
  const codeInput = interaction.fields.getTextInputValue('order_code')?.trim().toUpperCase();
  const { getBoostOrderByCode, getBoostOrdersByGuild, buildBoostLiveStatusPayload } = await import('../services/boostServerService.js');
  const order = codeInput
    ? getBoostOrderByCode(codeInput)
    : getBoostOrdersByGuild(interaction.guildId)[0];
  if (!order || order.guild_id !== interaction.guildId) {
    await safeReply(interaction, { content: `${E('status_cross')} Không tìm thấy đơn Boost Server trong server này.`, ephemeral: true });
    return;
  }
  const payload = buildBoostLiveStatusPayload(order, order.guild_id, { isStaff: true });
  await safeReply(interaction, { ...payload, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
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

  if ((!isStaff && (order.status !== 'PENDING' || order.payment_status === 'PAID'))
      || (isStaff && !['PENDING', 'ACTIVE', 'WARRANTY'].includes(order.status))) {
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

  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const isStaff = isStaffMember(member, guildConfig);

  if (!order || (order.customer_id !== interaction.user.id && !isStaff)
      || (!isStaff && (order.status !== 'PENDING' || order.payment_status === 'PAID'))
      || (isStaff && !['PENDING', 'ACTIVE', 'WARRANTY'].includes(order.status))) {
    await interaction.editReply(`${E('status_cross')} Bạn không có quyền huỷ đơn này.`);
    return;
  }

  const updated = updateBoostOrderStatus(code, 'CANCELLED', {
    handledBy: interaction.user.id,
    note: `Huỷ bởi ${interaction.user.tag}: ${reason}`,
    customerStatusNote: `Đơn đã huỷ. Lý do: ${reason}`,
  });

  // DM khách — Components V2 + emoji custom
  try {
    const customer = await interaction.client.users.fetch(order.customer_id);
    const cancelledByStaff = isStaff && order.customer_id !== interaction.user.id;
    const { buildBoostOrderDetailPayload } = await import('../services/boostServerService.js');
    const dmPayload = buildBoostOrderDetailPayload(updated, false, {
      heading: 'ĐƠN BOOST ĐÃ HUỶ', includeActions: false,
      extraText: `${E('cenar_verified')} **Huỷ bởi:** ${cancelledByStaff ? 'Admin/Staff' : 'Bạn'}\nLiên hệ shop nếu cần hỗ trợ thêm.`,
    });

    // Thanh đánh giá chỉ dùng custom emoji của guild.
      const feedbackRow = new ActionRowBuilder().addComponents(
        ...[1, 2, 3, 4, 5].map(stars => withButtonEmoji(
          new ButtonBuilder()
            .setCustomId(`boost:feedback:start:${code}:${stars}`)
            .setLabel(String(stars))
            .setStyle(stars === 5 ? ButtonStyle.Primary : ButtonStyle.Secondary),
          E.component('icon_star'),
        ))
      );

      await customer.send({
        ...dmPayload, components: [...dmPayload.components, feedbackRow],
      }).catch(() => null);
  } catch {}

  await sendBoostLog(interaction.client, interaction.guildId, updated, 'Đơn bị huỷ', interaction.user.id).catch(() => null);
  refreshBoostPanel(interaction.client, interaction.guildId).catch(() => null);

  await interaction.editReply(
    `${E('status_check')} Đã huỷ đơn \`${code}\`.\n> ${E('status_info')} **Lý do:** ${reason}`
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
  if (!order || order.payment_status !== 'PAID' || !['ACTIVE', 'WARRANTY'].includes(order.status)) {
    await safeReply(interaction, { content: `${E('status_warn')} Không thể hoàn thành đơn \`${code}\` (trạng thái: ${order?.status ?? 'không tìm thấy'}).`, ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const updated = updateBoostOrderStatus(code, 'COMPLETED', {
    handledBy: interaction.user.id,
    note: `Hoàn thành bởi ${interaction.user.tag}`,
    customerStatusNote: 'Chu kỳ 14 Boosts đã hoàn thành. Cảm ơn bạn đã sử dụng dịch vụ.',
  });

  // DM khách thông báo hoàn thành — Components V2 + emoji custom
  try {
    const customer = await interaction.client.users.fetch(order.customer_id);
    const { buildBoostOrderDetailPayload } = await import('../services/boostServerService.js');
    await customer.send(buildBoostOrderDetailPayload(updated, false, {
      heading: 'CHU KỲ BOOST ĐÃ HOÀN THÀNH', includeActions: false,
      extraText: 'Cảm ơn bạn đã sử dụng dịch vụ Cenar Store. Liên hệ shop nếu cần hỗ trợ.',
    })).catch(() => null);
  } catch {}

  await sendBoostLog(interaction.client, interaction.guildId, updated, 'Đơn hoàn thành', interaction.user.id).catch(() => null);
  refreshBoostPanel(interaction.client, interaction.guildId).catch(() => null);

  await interaction.editReply(
    `${E('order_complete')} Đã đánh dấu đơn \`${code}\` là **hoàn thành** và gửi DM cho khách.`
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
  if (!order || order.status !== 'PENDING' || order.payment_status !== 'PAID') {
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

  const expiresAt = parseBoostDate(expiresRaw);
  if (expiresAt === undefined) {
    await interaction.editReply(`${E('status_cross')} Ngày hết hạn không hợp lệ. Hãy dùng định dạng DD/MM/YYYY.`);
    return;
  }

  const order = getBoostOrderByCode(code);
  if (!order || order.status !== 'PENDING' || order.payment_status !== 'PAID') {
    await interaction.editReply(`${E('status_cross')} Đơn không tồn tại, chưa thanh toán hoặc đã được xử lý.`);
    return;
  }

  const updated = updateBoostOrderStatus(code, 'ACTIVE', {
    boostStartedAt: new Date().toISOString(),
    boostExpiresAt: expiresAt,
    handledBy: interaction.user.id,
    note: note ?? `Kích hoạt bởi ${interaction.user.tag}`,
    customerStatusNote: note || '14 Boosts đã được kích hoạt. Trạng thái server đang hoạt động bình thường.',
  });

  // DM khách — Components V2 + emoji custom
  try {
    const customer = await interaction.client.users.fetch(order.customer_id);
    const { buildBoostOrderDetailPayload } = await import('../services/boostServerService.js');
    await customer.send(buildBoostOrderDetailPayload(updated, false, {
      heading: 'BOOST ĐÃ ĐƯỢC KÍCH HOẠT', includeActions: false,
      extraText: 'Bạn có thể xem thời hạn và gửi yêu cầu bảo hành từ panel Boost.',
    })).catch(() => null);
  } catch {}

  await sendBoostLog(interaction.client, interaction.guildId, updated, 'Đã boost — Kích hoạt ACTIVE', interaction.user.id).catch(() => null);
  refreshBoostPanel(interaction.client, interaction.guildId).catch(() => null);

  await interaction.editReply(
    `${E('status_check')} Đã kích hoạt đơn \`${code}\` → **ACTIVE** và DM thông báo cho khách!` +
    (expiresAt ? `\n> ${E('icon_expire')} Hết hạn: **${expiresRaw}**` : '')
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
    customerStatusNote: 'Hệ thống đã tiếp nhận yêu cầu bảo hành và đang kiểm tra lại 14 Boosts.',
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

