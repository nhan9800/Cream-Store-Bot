import { createEmojiResolver } from '../utils/emojiHelper.js';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { db } from '../database/db.js';
import { encrypt } from '../utils/crypto.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { getOrderByCode, markOrderCompleted, saveDelivery } from '../services/orderService.js';
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
import {
  detectDeliverySubscriptionService,
  syncDeliverySubscription,
} from '../services/deliverySubscriptionService.js';

const DELIVERY_SNAPSHOT_FIELDS = ['status', 'payment_status', 'product_id', 'product_name', 'service_type',
  'total_amount', 'quantity', 'duration_months', 'duration_days', 'updated_at'];
const DELIVERED_RECEIPT_FIELDS = [...DELIVERY_SNAPSHOT_FIELDS.filter(key => key !== 'updated_at'),
  'guild_id', 'customer_id', 'ticket_channel_id', 'credential_email', 'credential_password',
  'credential_profile', 'credential_pin', 'delivery_login_url', 'claim_notes',
  'delivered_at', 'delivery_dm_channel_id', 'delivery_dm_message_id'];
function matchesDeliveredReceipt(current, expected) {
  return current && !['CANCELLED', 'REFUNDED', 'FAILED'].includes(current.status)
    && !['CANCELLED', 'REFUNDED'].includes(current.payment_status)
    && DELIVERED_RECEIPT_FIELDS.every(key => current[key] === expected[key]);
}

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
  if (!order || order.guild_id !== interaction.guildId) {
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
  const trackedSubscriptionService = detectDeliverySubscriptionService(order);

  if (isSubProduct) {
    if (!credentialEmail || credentialEmail.trim() === '') {
      await interaction.editReply({
        content: `${E('status_warn')} Đơn hàng **${order.product_name}** bắt buộc phải nhập \`gmail\` để hệ thống lưu lại và cảnh báo hết hạn sau này. Vui lòng chạy lại lệnh và điền tham số Gmail!`,
        ephemeral: true
      });
      return;
    }
  }

  if (trackedSubscriptionService && (!credentialEmail?.trim() || !credentialPassword?.trim())) {
    await interaction.editReply({
      content: `${E('status_warn')} Đơn **${order.product_name}** cần nhập đủ \`gmail\` và \`mat_khau\` để tạo bản ghi gia hạn trên website.`,
      ephemeral: true,
    });
    return;
  }

  if (['CANCELLED', 'REFUNDED', 'FAILED'].includes(order.status)) {
    await interaction.editReply({ content: `${E('status_warn')} Đơn đã dừng xử lý nên không thể giao hàng.`, ephemeral: true });
    return;
  }
  if (order.status !== 'COMPLETED' && order.total_amount > 0 && !['PAID', 'FREE'].includes(order.payment_status)) {
    await interaction.editReply({ content: `${E('status_warn')} Đơn chưa thanh toán xong nên chưa thể giao hàng.`, ephemeral: true });
    return;
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
  // DM setup is remote I/O: payment, ownership or cancellation may have changed.
  const preparedOrder = getOrderByCode(order.order_code);
  if (!preparedOrder || preparedOrder.guild_id !== order.guild_id || preparedOrder.customer_id !== order.customer_id
    || preparedOrder.ticket_channel_id !== order.ticket_channel_id
    || DELIVERY_SNAPSHOT_FIELDS.some(key => preparedOrder[key] !== order[key])
    || ['CANCELLED', 'REFUNDED', 'FAILED'].includes(preparedOrder.status)
    || ['CANCELLED', 'REFUNDED'].includes(preparedOrder.payment_status)
    || (preparedOrder.status !== 'COMPLETED' && preparedOrder.total_amount > 0 && !['PAID', 'FREE'].includes(preparedOrder.payment_status))) {
    await interaction.editReply({ content: `${E('status_warn')} Đơn vừa đổi trạng thái hoặc chủ sở hữu nên bot đã dừng giao hàng. Vui lòng kiểm tra lại.`, ephemeral: true });
    return;
  }
  order = preparedOrder;
  const completedDuringDelivery = order.status !== 'COMPLETED';
  let dmMessage = null;
  const persist = (messageId = null) => saveDelivery(order.order_code, interaction.user.id, credentialEmail, credentialPassword, credentialProfile, credentialPin, deliveryLoginUrl, claimNotes, dmChannel.id, messageId);
  // Build the DM in memory. A rejected send must not record a delivery or expose
  // the credentials on the website before the customer has received anything.
  let storedOrder = { ...order,
    credential_email: credentialEmail != null ? encrypt(credentialEmail) : null,
    credential_password: credentialPassword != null ? encrypt(credentialPassword) : null,
    credential_profile: credentialProfile != null ? encrypt(credentialProfile) : null,
    credential_pin: credentialPin != null ? encrypt(credentialPin) : null,
    delivery_login_url: deliveryLoginUrl, claim_notes: claimNotes };

  if (Boolean(credentialEmail && credentialPassword) && sendDirect) {
    dmMessage = await dmChannel.send({ embeds: buildDeliveryCredentialEmbeds(storedOrder), components: buildDeliveryLoginComponents(storedOrder) }).catch(() => null);
    if (!dmMessage) {
      await interaction.editReply({ content: `${E('status_warn')} Không gửi được DM giao hàng cho khách hàng.`, ephemeral: true });
      return;
    }
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
  }

  // Commit metadata-only positive evidence before any completion guard. The
  // private journal never contains credentials or changes the current contract.
  let finalized;
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS manual_delivery_receipts (
      dm_channel_id TEXT NOT NULL, dm_message_id TEXT NOT NULL, order_code TEXT NOT NULL,
      guild_id TEXT NOT NULL, customer_id TEXT NOT NULL, staff_id TEXT NOT NULL,
      contract_snapshot TEXT NOT NULL, received_at TEXT NOT NULL, outcome TEXT NOT NULL,
      PRIMARY KEY(dm_channel_id,dm_message_id))`);
    const snapshot = Object.fromEntries([...DELIVERY_SNAPSHOT_FIELDS, 'ticket_channel_id'].map(key => [key, order[key]]));
    db.prepare(`INSERT OR IGNORE INTO manual_delivery_receipts
      (dm_channel_id,dm_message_id,order_code,guild_id,customer_id,staff_id,contract_snapshot,received_at,outcome)
      VALUES(?,?,?,?,?,?,?,?,'CONFIRMED')`).run(dmChannel.id, dmMessage.id, order.order_code, order.guild_id,
      order.customer_id, interaction.user.id, JSON.stringify(snapshot), new Date().toISOString());
    // Discord and SQLite cannot commit atomically. Apply delivery only to the
    // unchanged snapshot; conflict evidence remains in the private journal.
    finalized = db.transaction(() => {
      const fresh = getOrderByCode(order.order_code);
      const changed = !fresh || fresh.guild_id !== order.guild_id || fresh.customer_id !== order.customer_id
        || fresh.ticket_channel_id !== order.ticket_channel_id
        || DELIVERY_SNAPSHOT_FIELDS.some(key => fresh[key] !== order[key]);
      db.prepare('UPDATE manual_delivery_receipts SET outcome=? WHERE dm_channel_id=? AND dm_message_id=?')
        .run(changed ? 'REVIEW' : 'APPLIED', dmChannel.id, dmMessage.id);
      if (changed) return { changed: true };
      const saved = persist(dmMessage.id);
      return { changed: false, storedOrder: saved, order: completedDuringDelivery
        ? markOrderCompleted(order.order_code, interaction.user.id, config.feedbackTimeoutHours, saved)
        : saved };
    }).immediate();
  } catch {
    await interaction.editReply({ content: `${E('status_warn')} DM đã gửi nhưng lưu xác nhận giao hàng chưa thành công. Quản trị cần đối soát trước khi giao lại. Mã DM: ${dmMessage.id}.`, ephemeral: true });
    return;
  }
  if (finalized.changed) {
    await interaction.editReply({ content: `${E('status_warn')} DM đã gửi nhưng đơn vừa thay đổi. Bot giữ nguyên trạng thái đơn và dừng hoàn thành/gia hạn; quản trị cần đối soát trước khi giao lại. Mã DM: ${dmMessage.id}.`, ephemeral: true });
    return;
  }
  storedOrder = finalized.storedOrder;
  order = finalized.order;
  if (completedDuringDelivery) {
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

  // Notification calls above can race with reassignment or credential edits.
  // Never rebuild the original customer's DM from a different delivery row.
  storedOrder = getOrderByCode(order.order_code);
  if (!matchesDeliveredReceipt(storedOrder, order)) {
    await interaction.editReply({ content: `${E('status_warn')} DM đã gửi nhưng thông tin đơn/giao hàng vừa thay đổi. Bot dừng sửa DM, đồng bộ gia hạn/Hub và thông báo hoàn thành; quản trị cần đối soát. Mã DM: ${dmMessage.id}.`, ephemeral: true });
    return;
  }
  // Completion starts the service duration; refresh the same receipt with that expiry.
  if (completedDuringDelivery && storedOrder.expiry_at && dmMessage?.edit) {
    const payload = Boolean(credentialEmail && credentialPassword) && sendDirect
      ? { embeds: buildDeliveryCredentialEmbeds(storedOrder), components: buildDeliveryLoginComponents(storedOrder) }
      : (() => {
        const { container, flags } = buildDeliveryNoticeV2(storedOrder);
        return { flags, components: shouldShowClaimButton ? [container, ...buildDeliveryClaimComponents(order.order_code)] : [container] };
      })();
    await dmMessage.edit(payload).catch(() => null);
  }
  if (!matchesDeliveredReceipt(getOrderByCode(order.order_code), order)) {
    await interaction.editReply({ content: `${E('status_warn')} DM đã gửi nhưng thông tin đơn/giao hàng vừa thay đổi. Bot dừng đồng bộ gia hạn/Hub và thông báo hoàn thành; quản trị cần đối soát. Mã DM: ${dmMessage.id}.`, ephemeral: true });
    return;
  }

  let subscriptionRecord = null;
  let subscriptionSyncError = null;
  let subscriptionGuardFailed = false;
  if (trackedSubscriptionService) {
    try {
      subscriptionRecord = db.transaction(() => {
        const current = getOrderByCode(order.order_code);
        if (!matchesDeliveredReceipt(current, order) || !['PAID', 'FREE'].includes(current.payment_status)) {
          subscriptionGuardFailed = true;
          return null;
        }
        return syncDeliverySubscription({
          order: current,
          gmailEmail: credentialEmail,
          gmailPassword: credentialPassword,
          profile: credentialProfile,
          customerDiscordName: customer.tag || customer.username,
        });
      }).immediate();
    } catch (error) {
      subscriptionSyncError = error;
      console.error(`[SUBSCRIPTION-SYNC] ${order.order_code}: ${error.message}`);
    }
  }
  if (subscriptionGuardFailed) {
    await interaction.editReply({ content: `${E('status_warn')} DM đã gửi nhưng đơn vừa dừng xử lý hoặc thay đổi. Bot dừng đồng bộ gia hạn/Hub và thông báo hoàn thành; quản trị cần đối soát. Mã DM: ${dmMessage.id}.`, ephemeral: true });
    return;
  }

  const hub = getCenarHub();
  if (hub) {
    await hub.deliverOrder(order.order_code, {
      credential_email: credentialEmail,
      credential_password: credentialPassword,
      staff_id: interaction.user.id
    }).catch(e => console.error('[HUB] Lỗi deliver:', e.message));
    if (completedDuringDelivery) {
      await hub.completeOrder(order.order_code, {
        staff_id: interaction.user.id,
      }).catch(e => console.error('[HUB] Lỗi complete:', e.message));
    }
  }

  const ticketChannel = await interaction.guild.channels.fetch(order.ticket_channel_id).catch(() => null);
  if (ticketChannel?.isTextBased()) await ticketChannel.send(buildDeliveryLogText(order)).catch(() => null);

  await applyCustomerRoles(interaction.guild, order.customer_id);
  await emitStaffLog(interaction.client, { guildId: interaction.guildId, actorId: interaction.user.id, targetId: order.customer_id, action: 'DELIVERY_SENT', detail: sendDirect ? 'Gửi trực tiếp qua DM' : 'Gửi DM với nút nhận Gmail', relatedOrderCode: order.order_code });

  // Luôn gửi bảng Feedback 5 sao vào ticket sau khi giao hàng (dù trước đó đã hoàn thành hay chưa)
  await sendCompletedTicketFlow({ guild: interaction.guild, order, actorId: interaction.user.id, supportId: interaction.user.id });

  const subscriptionStatus = subscriptionRecord
    ? `\n${E('cenar_verified')} Đã đồng bộ **${trackedSubscriptionService}** lên website · Subscription ID **${subscriptionRecord.id}**.`
    : subscriptionSyncError
      ? `\n${E('status_warn')} DM đã gửi nhưng đồng bộ website lỗi: ${subscriptionSyncError.message}`
      : '';
  await interaction.editReply({
    content: `${E('status_check')} Đã gửi DM giao hàng cho khách của đơn ${order.order_code} và đồng bộ trạng thái hoàn thành.${subscriptionStatus}`,
    ephemeral: true,
  });
}
