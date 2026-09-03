import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import { config } from '../config.js';
import { getGuildConfig } from './guildConfigService.js';
import {
  claimAdminRenewal,
  getAdminRenewalCandidates,
  getSubscriptionById,
  getSubscriptionProgress,
  isSubscriptionRenewalDue,
  markAdminReminderSent,
  markDisconnected,
  markRenewed,
  reserveAdminReminderDispatch,
  snoozeAdminRenewal,
} from './subscriptionService.js';
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
import { accentFor } from '../utils/uiKit.js';
import { isManager } from '../utils/permissions.js';
import { emitAutomationLog } from './automationLogService.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SERVICE_META = {
  nitro: { label: 'Discord Nitro', emoji: 'brand_nitro' },
  spotify_family: { label: 'Spotify Family', emoji: 'brand_spotify' },
  youtube: { label: 'YouTube Premium', emoji: 'brand_youtube' },
  netflix: { label: 'Netflix', emoji: 'brand_netflix' },
};

const STAGE_META = {
  UPCOMING_7D: {
    title: 'KẾ HOẠCH GIA HẠN SẮP TỚI',
    badge: 'CẦN CHUẨN BỊ',
    accent: 'info',
    emoji: 'icon_calendar',
    summary: 'Gói dịch vụ đã đi vào cửa sổ chuẩn bị. Admin kiểm tra nguồn và thông tin tài khoản trước ngày xử lý.',
  },
  UPCOMING_3D: {
    title: 'NHẮC ADMIN · CÒN DƯỚI 3 NGÀY',
    badge: 'ƯU TIÊN',
    accent: 'warning',
    emoji: 'cenar_announce',
    summary: 'Cần xác nhận nguồn gia hạn và chủ động liên hệ khách nếu thiếu thông tin.',
  },
  URGENT_1D: {
    title: 'GIA HẠN KHẨN · CÒN DƯỚI 24 GIỜ',
    badge: 'KHẨN CẤP',
    accent: 'danger',
    emoji: 'status_warn',
    summary: 'Gói sắp đến hạn. Admin cần nhận xử lý ngay để tránh gián đoạn dịch vụ của khách.',
  },
  DUE_NOW: {
    title: 'ĐÃ ĐẾN KỲ GIA HẠN',
    badge: 'XỬ LÝ NGAY',
    accent: 'danger',
    emoji: 'cenar_cooldown',
    summary: 'Ngày gia hạn đã đến. Vui lòng hoàn tất hoặc tạm hoãn có chủ đích trong bảng điều khiển bên dưới.',
  },
  OVERDUE: {
    title: 'CẢNH BÁO QUÁ HẠN GIA HẠN',
    badge: 'QUÁ HẠN',
    accent: 'danger',
    emoji: 'status_cross',
    summary: 'Gói đã quá hạn và có nguy cơ gián đoạn. Hệ thống chỉ giữ một thông báo xử lý cho kỳ hiện tại để tránh spam.',
  },
};

function clean(value, max = 300) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function unix(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? Math.floor(date.getTime() / 1000) : null;
}

function portalUrl() {
  try {
    return new URL('/admin/subscriptions', config.storeWebsiteUrl).toString();
  } catch {
    return 'https://cenarstore.xyz/admin/subscriptions';
  }
}

function presentationGuildId(guildId) {
  return guildId === 'WEB' ? STORE_ONE_GUILD_ID : guildId;
}

export function getSubscriptionAdminDueAt(sub) {
  return sub?.renewal_mode === 'auto_cycle' && sub?.next_renewal_at
    ? sub.next_renewal_at
    : sub?.expiry_at;
}

export function resolveAdminReminderStage(sub, now = new Date()) {
  const dueAt = new Date(getSubscriptionAdminDueAt(sub));
  if (!Number.isFinite(dueAt.getTime())) return null;
  const diff = dueAt.getTime() - new Date(now).getTime();
  if (diff <= -DAY_MS) return 'OVERDUE';
  if (diff <= 0) return 'DUE_NOW';
  if (diff <= DAY_MS) return 'URGENT_1D';
  if (diff <= 3 * DAY_MS) return 'UPCOMING_3D';
  return 'UPCOMING_7D';
}

export function shouldSendAdminReminder(sub, stage, now = new Date()) {
  if (!stage) return false;
  const dueAt = getSubscriptionAdminDueAt(sub);
  const dueMs = new Date(dueAt || 0).getTime();
  const completedMs = new Date(sub?.admin_last_completed_for_at || 0).getTime();
  if (Number.isFinite(dueMs) && Number.isFinite(completedMs) && dueMs === completedMs) return false;

  const reminderForMs = new Date(sub?.admin_reminder_for_at || 0).getTime();
  if (
    sub?.admin_reminder_sent_at
    && Number.isFinite(dueMs)
    && Number.isFinite(reminderForMs)
    && dueMs === reminderForMs
  ) return false;

  const previous = String(sub?.admin_reminder_stage || '');
  // Dữ liệu cũ chưa có admin_reminder_for_at vẫn được xem là đã gửi cho kỳ
  // hiện tại. Một kỳ chỉ có một panel; không nâng cấp 7d -> 3d -> 1d bằng
  // những tin nhắn mới nữa.
  return !previous;
}

function adminTargets(guild, settings) {
  const roleIds = [...new Set([
    settings?.manager_role_id,
    ...config.ownerRoleIds,
  ].filter(Boolean).map(String))]
    .filter((id) => guild.roles.cache.has(id));
  const userIds = [...new Set([
    guild.ownerId,
    ...config.adminDiscordIds,
  ].filter(Boolean).map(String))];
  const mentionText = [
    ...roleIds.map((id) => `<@&${id}>`),
    ...userIds.map((id) => `<@${id}>`),
  ].join(' ');
  return { roleIds, userIds, mentionText };
}

function progressText(sub) {
  const progress = getSubscriptionProgress(sub);
  return `Đã cấp **${progress.fulfilledMonths}/${progress.totalMonths} tháng** · còn ${progress.remainingMonths} tháng`;
}

function buildActionRow(sub, E) {
  const progress = getSubscriptionProgress(sub);
  const isDisconnect = progress.nextAction === 'DISCONNECT';
  const claim = withButtonEmoji(
    new ButtonBuilder()
      .setCustomId(`sub:admin:claim:${sub.id}`)
      .setLabel(sub.admin_claimed_by_id ? 'Đã Có Admin Nhận' : 'Nhận Xử Lý')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(Boolean(sub.admin_claimed_by_id)),
    E.component('cenar_admin'),
    E.component('ticket_claim'),
  );
  const completed = withButtonEmoji(
    new ButtonBuilder()
      .setCustomId(`sub:admin:${isDisconnect ? 'disconnect' : 'renew'}:${sub.id}:${Number(sub.times_renewed || 0)}:${unix(progress.nextActionAt) || 0}`)
      .setLabel(isDisconnect ? 'Xác Nhận Đã Ngắt Gói' : 'Xác Nhận Đã Gia Hạn')
      .setStyle(isDisconnect ? ButtonStyle.Danger : ButtonStyle.Success),
    E.component(isDisconnect ? 'status_cross' : 'status_check'),
  );
  const snooze = withButtonEmoji(
    new ButtonBuilder()
      .setCustomId(`sub:admin:snooze:${sub.id}`)
      .setLabel(`Nhắc Lại Sau ${config.subscriptionAdminSnoozeHours}h`)
      .setStyle(ButtonStyle.Secondary),
    E.component('cenar_cooldown'),
    E.component('icon_clock'),
  );
  const portal = withButtonEmoji(
    new ButtonBuilder()
      .setLabel('Mở Trung Tâm Gia Hạn')
      .setStyle(ButtonStyle.Link)
      .setURL(portalUrl()),
    E.component('icon_settings'),
    E.component('cenar_admin'),
  );
  return new ActionRowBuilder().addComponents(claim, completed, snooze, portal);
}

export function buildAdminRenewalReminderV2(sub, {
  stage = resolveAdminReminderStage(sub),
  mentionText = '',
  roleIds = [],
  userIds = [],
  ping = true,
} = {}) {
  const E = createEmojiResolver(presentationGuildId(sub.guild_id));
  const meta = STAGE_META[stage] || STAGE_META.UPCOMING_7D;
  const service = SERVICE_META[sub.service_type] || { label: clean(sub.service_type || 'Dịch vụ'), emoji: 'order_product' };
  const progress = getSubscriptionProgress(sub);
  const isDisconnect = progress.nextAction === 'DISCONNECT';
  const dueTs = unix(getSubscriptionAdminDueAt(sub));
  const expiryTs = unix(sub.expiry_at);
  const purchaseTs = unix(sub.purchase_date);
  const customer = sub.customer_id
    ? `<@${sub.customer_id}>`
    : clean(sub.customer_discord_name || 'Chưa liên kết Discord');
  const claim = sub.admin_claimed_by_id
    ? `<@${sub.admin_claimed_by_id}> · nhận <t:${unix(sub.admin_claimed_at)}:R>`
    : 'Chưa có admin nhận xử lý';

  const container = new ContainerBuilder().setAccentColor(accentFor(meta.accent));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    ping && mentionText ? mentionText : null,
    `# ${E(meta.emoji)} ${isDisconnect ? 'ĐẾN HẠN NGẮT GÓI DỊCH VỤ' : meta.title}`,
    `> ${E('status_info')} **Mức ưu tiên:** ${meta.badge} · ${isDisconnect ? 'Gói đã được cấp đủ toàn bộ thời hạn. Admin kiểm tra và ngắt gói đúng ngày để tránh cấp thừa.' : meta.summary}`,
  ].filter(Boolean).join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `### ${E(service.emoji)} HỒ SƠ DỊCH VỤ #${sub.id}`,
    `${E('order_product')} **Sản phẩm** — ${service.label}`,
    `${E('payment_money')} **Tài khoản** — \`${clean(sub.gmail_email, 120)}\``,
    `${E('icon_key')} **Mật khẩu** — Đã ẩn an toàn · xem trong trang quản trị`,
    `${E('ticket_user')} **Khách hàng** — ${customer}`,
    sub.related_order_code ? `${E('icon_clipboard')} **Đơn gốc** — \`${clean(sub.related_order_code, 40)}\`` : null,
    `${E('icon_history')} **Tiến độ** — ${progressText(sub)}`,
    purchaseTs ? `${E('warranty_purchase')} **Ngày mua** — <t:${purchaseTs}:D>` : null,
    dueTs ? `${E('icon_clock')} **${isDisconnect ? 'Ngày cần ngắt gói' : `Kỳ ${progress.nextCycleNumber}/${progress.totalMonths} cần cấp`}** — <t:${dueTs}:F> · <t:${dueTs}:R>` : null,
    expiryTs ? `${E('warranty_expiry')} **Hết hạn toàn gói** — <t:${expiryTs}:F>` : null,
    sub.note ? `${E('icon_edit')} **Ghi chú** — ${clean(sub.note, 240)}` : null,
  ].filter(Boolean).join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `### ${E('cenar_admin')} BÀN GIAO XỬ LÝ`,
    `${E('ticket_claim')} **Phụ trách** — ${claim}`,
    `${E('icon_search')} **Checklist** — ${isDisconnect ? 'Kiểm tra đã đủ thời hạn · ngắt quyền/gói trên nguồn · bấm **Xác Nhận Đã Ngắt Gói**.' : 'Kiểm tra nguồn · đăng nhập · cấp thêm đúng 1 tháng · bấm **Xác Nhận Đã Gia Hạn**.'}`,
    `${E('cenar_cooldown')} Nếu chưa thể xử lý, chọn **Nhắc Lại** để hoãn đúng ${config.subscriptionAdminSnoozeHours} giờ; bot sẽ không spam trong thời gian này.`,
    `-# ${E('verify_shield')} Cenar Renewal Control · Không hiển thị mật khẩu trên Discord · Cập nhật tự động với website`,
  ].join('\n')));

  return {
    components: [container, buildActionRow(sub, E)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: ping
      ? { parse: [], roles: roleIds, users: userIds }
      : { parse: [] },
  };
}

function buildActionResultV2(sub, { action, adminId, snoozedUntil = null }) {
  const E = createEmojiResolver(presentationGuildId(sub.guild_id));
  const progress = getSubscriptionProgress(sub);
  const isComplete = action === 'renewed' || action === 'disconnected';
  const needsReview = action === 'renewed' && sub.progress_status === 'NEEDS_REVIEW';
  const title = action === 'disconnected'
    ? 'ĐÃ XÁC NHẬN NGẮT GÓI'
    : action === 'renewed'
      ? needsReview ? 'ĐÃ GHI NHẬN · CẦN ĐỐI SOÁT' : 'ĐÃ XÁC NHẬN GIA HẠN'
      : action === 'snoozed' ? 'ĐÃ TẠM HOÃN NHẮC VIỆC' : 'ADMIN ĐÃ NHẬN XỬ LÝ';
  const tone = action === 'disconnected' ? 'danger' : needsReview ? 'warning' : isComplete ? 'success' : action === 'snoozed' ? 'warning' : 'info';
  const container = new ContainerBuilder().setAccentColor(accentFor(tone));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E(isComplete ? 'status_check' : action === 'snoozed' ? 'cenar_cooldown' : 'ticket_claim')} ${title}`,
    `> ${E('cenar_admin')} **Admin:** <@${adminId}>`,
    `${E('icon_id')} **Subscription:** #${sub.id} · \`${clean(sub.gmail_email, 120)}\``,
    isComplete
      ? action === 'disconnected'
        ? `${E('status_cross')} **Trạng thái:** Đã ngắt gói · hồ sơ hoàn tất`
        : needsReview
          ? `${E('status_warn')} **Đã khóa nhắc tự động:** lịch kỳ tiếp theo vẫn quá gần hoặc đã quá hạn. Vui lòng đối soát số tháng đã cấp trên website; bot sẽ không gửi lại panel sai.`
          : `${E('icon_history')} **Tiến độ:** Đã cấp ${progress.fulfilledMonths}/${progress.totalMonths} tháng · ${progress.nextAction === 'DISCONNECT' ? 'chờ ngắt gói vào ngày hết hạn' : `kỳ tiếp theo <t:${unix(progress.nextActionAt)}:F>`}`
      : action === 'snoozed'
        ? `${E('icon_clock')} Bot sẽ nhắc lại <t:${unix(snoozedUntil)}:R>.`
        : `${E('order_processing')} Hồ sơ đã được khóa người phụ trách; các admin khác vẫn có thể xác nhận hoàn tất.`,
    `-# ${E('verify_shield')} Dữ liệu đã đồng bộ vào trung tâm quản lý gia hạn`,
  ].join('\n')));

  if (action === 'claimed') {
    return {
      components: [container, buildActionRow(sub, E)],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    };
  }
  const disabled = withButtonEmoji(
    new ButtonBuilder().setCustomId(`sub:admin:done:${sub.id}`).setLabel(title).setStyle(ButtonStyle.Secondary).setDisabled(true),
    E.component(action === 'disconnected' ? 'status_cross' : isComplete ? 'status_check' : 'cenar_cooldown'),
  );
  return {
    components: [container, new ActionRowBuilder().addComponents(disabled)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

async function resolveReminderChannel(client, guild, settings) {
  const channelId = settings?.reminder_channel_id || settings?.staff_log_channel_id;
  if (!channelId) return null;
  return guild.channels.cache.get(channelId)
    || await guild.channels.fetch(channelId).catch(() => null)
    || client.channels.cache.get(channelId)
    || await client.channels.fetch(channelId).catch(() => null);
}

export async function runStoreOneAdminRenewalReminders(client) {
  if (String(config.guildId) !== STORE_ONE_GUILD_ID) {
    return { skipped: true, scanned: 0, sent: 0, errors: 0 };
  }
  const guild = client.guilds.cache.get(STORE_ONE_GUILD_ID)
    || await client.guilds.fetch(STORE_ONE_GUILD_ID).catch(() => null);
  if (!guild) return { skipped: false, scanned: 0, sent: 0, errors: 1, reason: 'Store 1 guild unavailable' };
  const settings = getGuildConfig(STORE_ONE_GUILD_ID);
  const channel = await resolveReminderChannel(client, guild, settings);
  if (!channel?.isTextBased()) {
    return { skipped: false, scanned: 0, sent: 0, errors: 1, reason: 'Reminder channel is not configured' };
  }

  const targets = adminTargets(guild, settings);
  const candidates = getAdminRenewalCandidates(
    STORE_ONE_GUILD_ID,
    config.subscriptionAdminReminderDays,
    100,
  );
  let sent = 0;
  let errors = 0;
  for (const sub of candidates) {
    const stage = resolveAdminReminderStage(sub);
    if (!shouldSendAdminReminder(sub, stage)) continue;
    const reservation = reserveAdminReminderDispatch(sub.id, {
      stage,
      channelId: channel.id,
      expectedStage: sub.admin_reminder_stage,
      expectedSentAt: sub.admin_reminder_sent_at,
      expectedTimesRenewed: Number(sub.times_renewed || 0),
      expectedActionAt: getSubscriptionAdminDueAt(sub),
    });
    if (!reservation) continue;
    try {
      const reservedSub = reservation.subscription;
      let message = null;
      if (
        reservedSub.admin_reminder_message_id
        && String(reservedSub.admin_reminder_channel_id || channel.id) === String(channel.id)
      ) {
        message = await channel.messages.fetch(reservedSub.admin_reminder_message_id).catch(() => null);
        if (message?.author?.id === client.user?.id) {
          await message.edit(buildAdminRenewalReminderV2(reservedSub, {
            stage,
            ...targets,
            ping: false,
          }));
        } else {
          message = null;
        }
      }
      if (!message) {
        message = await channel.send(buildAdminRenewalReminderV2(reservedSub, { stage, ...targets }));
      }
      const finalized = markAdminReminderSent(reservedSub.id, {
        stage,
        messageId: message.id,
        channelId: channel.id,
        reservedAt: reservation.sentAt,
        reminderForAt: getSubscriptionAdminDueAt(reservedSub),
      });
      // Admin có thể bấm hoàn tất đúng lúc scheduler đang gửi. Khi CAS cuối
      // không còn hợp lệ, xóa ngay panel vừa gửi/ghi đè để nó không sống lại
      // sau thao tác thành công.
      if (!finalized) {
        if (message.author?.id === client.user?.id) await message.delete().catch(() => null);
        continue;
      }
      sent += 1;
    } catch (error) {
      errors += 1;
      console.error(`[SUB-ADMIN-REMINDER] Subscription ${sub.id}:`, error.message);
    }
  }
  if (sent || errors) {
    console.log(`[SUB-ADMIN-REMINDER] scanned=${candidates.length} sent=${sent} errors=${errors}`);
  }
  return { skipped: false, scanned: candidates.length, sent, errors };
}

/**
 * Xóa đúng các panel bot đã gửi sai cho một hồ sơ vừa được khôi phục. Không
 * đụng tới tin nhắn người dùng hoặc reminder của hồ sơ khác.
 */
export async function cleanupAdminRenewalMessagesForRepair(client, {
  subscriptionId,
  orderCode,
  channelId = null,
  maxMessages = 500,
  keepMessageIds = [],
  matchOrderReference = true,
} = {}) {
  const id = Number(subscriptionId);
  const reference = String(orderCode || '').trim();
  if (!Number.isInteger(id)) return { scanned: 0, deleted: [] };

  const guild = client.guilds.cache.get(STORE_ONE_GUILD_ID)
    || await client.guilds.fetch(STORE_ONE_GUILD_ID).catch(() => null);
  if (!guild) return { scanned: 0, deleted: [], reason: 'guild_unavailable' };
  const settings = getGuildConfig(STORE_ONE_GUILD_ID);
  const targetChannelId = channelId || settings?.reminder_channel_id || settings?.staff_log_channel_id;
  const channel = targetChannelId
    ? guild.channels.cache.get(targetChannelId)
      || await guild.channels.fetch(targetChannelId).catch(() => null)
    : null;
  if (!channel?.isTextBased()) return { scanned: 0, deleted: [], reason: 'channel_unavailable' };

  const safeLimit = Math.min(1_000, Math.max(1, Number(maxMessages) || 500));
  const keep = new Set((keepMessageIds || []).filter(Boolean).map(String));
  const deleted = [];
  let scanned = 0;
  let before;
  while (scanned < safeLimit) {
    const page = await channel.messages.fetch({
      limit: Math.min(100, safeLimit - scanned),
      ...(before ? { before } : {}),
    }).catch(() => null);
    if (!page?.size) break;
    for (const message of page.values()) {
      scanned += 1;
      if (keep.has(String(message.id))) continue;
      if (message.author?.id !== client.user?.id) continue;
      const serialized = JSON.stringify(message.toJSON?.() || message);
      const belongsToRepair = (matchOrderReference && reference && serialized.includes(reference))
        || serialized.includes(`sub:admin:claim:${id}`)
        || serialized.includes(`sub:admin:renew:${id}:`)
        || serialized.includes(`sub:admin:disconnect:${id}:`)
        || serialized.includes(`sub:admin:snooze:${id}`);
      if (!belongsToRepair) continue;
      if (await message.delete().then(() => true).catch(() => false)) deleted.push(message.id);
    }
    before = page.last()?.id;
    if (page.size < 100) break;
  }
  return { scanned, deleted, channelId: channel.id };
}

async function updateInteraction(interaction, payload) {
  const { flags: _flags, ...updatePayload } = payload;
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(updatePayload);
    return;
  }
  await interaction.update(updatePayload);
}

async function sendRenewedCustomerDm(interaction, sub) {
  if (!sub.customer_id) return false;
  const user = await interaction.client.users.fetch(sub.customer_id).catch(() => null);
  if (!user) return false;
  const E = createEmojiResolver(presentationGuildId(sub.guild_id));
  const progress = getSubscriptionProgress(sub);
  const dueTs = unix(sub.next_renewal_at || sub.expiry_at);
  const container = new ContainerBuilder().setAccentColor(accentFor('success'));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('status_check')} GIA HẠN DỊCH VỤ THÀNH CÔNG`,
    `> ${E('cenar_verified')} Cenar Store đã hoàn tất kỳ gia hạn cho dịch vụ của bạn.`,
    `${E(SERVICE_META[sub.service_type]?.emoji || 'order_product')} **Dịch vụ** — ${SERVICE_META[sub.service_type]?.label || clean(sub.service_type)}`,
    sub.related_order_code ? `${E('icon_clipboard')} **Đơn gốc** — \`${sub.related_order_code}\`` : null,
    `${E('icon_history')} **Tiến độ** — Đã cấp **${progress.fulfilledMonths}/${progress.totalMonths} tháng**`,
    dueTs ? `${E('icon_calendar')} **${progress.nextAction === 'DISCONNECT' ? 'Ngày kết thúc gói' : 'Kỳ cấp tiếp theo'}** — <t:${dueTs}:F>` : null,
    `${E('cenar_support')} Vui lòng kiểm tra tài khoản. Nếu có vấn đề, hãy mở ticket để được hỗ trợ ngay.`,
    `-# ${E('verify_shield')} Cenar Store · Gia hạn được xác nhận bởi bộ phận quản trị`,
  ].filter(Boolean).join('\n')));
  return user.send({ components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } })
    .then(() => true)
    .catch(() => false);
}

async function sendDisconnectedCustomerDm(interaction, sub) {
  if (!sub.customer_id) return false;
  const user = await interaction.client.users.fetch(sub.customer_id).catch(() => null);
  if (!user) return false;
  const E = createEmojiResolver(presentationGuildId(sub.guild_id));
  const progress = getSubscriptionProgress(sub);
  const container = new ContainerBuilder().setAccentColor(accentFor('info'));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('icon_history')} GÓI DỊCH VỤ ĐÃ KẾT THÚC`,
    `> ${E('cenar_verified')} Cenar Store đã cấp đủ **${progress.fulfilledMonths}/${progress.totalMonths} tháng** theo đơn của bạn và đã ngắt gói đúng hạn.`,
    `${E(SERVICE_META[sub.service_type]?.emoji || 'order_product')} **Dịch vụ** — ${SERVICE_META[sub.service_type]?.label || clean(sub.service_type)}`,
    sub.related_order_code ? `${E('icon_clipboard')} **Đơn gốc** — \`${sub.related_order_code}\`` : null,
    `${E('cenar_support')} Nếu muốn mua tiếp hoặc cần kiểm tra lại, bạn hãy mở ticket để shop hỗ trợ.`,
    `-# ${E('verify_shield')} Cenar Store · Hồ sơ đã hoàn tất`,
  ].filter(Boolean).join('\n')));
  return user.send({ components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } })
    .then(() => true)
    .catch(() => false);
}

export async function handleAdminRenewalButton(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('sub:admin:')) return false;
  const [, , action, rawId, rawRevision, rawDueUnix] = interaction.customId.split(':');
  if (action === 'done') {
    await interaction.deferUpdate().catch(() => null);
    return true;
  }
  const id = Number(rawId);
  const E = createEmojiResolver(interaction.guildId);
  if (interaction.guildId !== STORE_ONE_GUILD_ID || !Number.isInteger(id)) {
    await interaction.reply({ content: `${E('status_cross')} Thao tác gia hạn không hợp lệ.`, ephemeral: true });
    return true;
  }
  const settings = getGuildConfig(interaction.guildId);
  const member = interaction.member?.roles?.cache
    ? interaction.member
    : await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!isManager(member, settings)) {
    await interaction.reply({ content: `${E('status_cross')} Chỉ Admin hoặc Manager mới được xử lý gia hạn.`, ephemeral: true });
    return true;
  }
  const existing = getSubscriptionById(id);
  if (!existing || ![STORE_ONE_GUILD_ID, 'WEB'].includes(existing.guild_id) || existing.status !== 'ACTIVE') {
    await interaction.reply({ content: `${E('status_warn')} Hồ sơ không còn hoạt động hoặc đã được xử lý.`, ephemeral: true });
    return true;
  }

  const isVersionedAction = action === 'renew' || action === 'disconnect';
  const expectedRevision = rawRevision === undefined ? null : Number(rawRevision);
  if (isVersionedAction && rawRevision !== undefined && !Number.isInteger(expectedRevision)) {
    await interaction.reply({
      content: `${E('status_cross')} Nút thao tác không hợp lệ. Vui lòng dùng thông báo gia hạn mới nhất.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  if (isVersionedAction && rawRevision !== undefined && expectedRevision !== Number(existing.times_renewed || 0)) {
    await interaction.reply({
      content: `${E('status_info')} Kỳ này đã được xử lý trước đó. Hệ thống không cộng thêm tháng; vui lòng dùng panel mới nhất.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  const currentMessageId = String(existing.admin_reminder_message_id || '');
  const clickedMessageId = String(interaction.message?.id || '');
  if (isVersionedAction && currentMessageId && currentMessageId !== clickedMessageId) {
    await interaction.reply({
      content: `${E('status_info')} Đây là panel cũ hoặc kỳ này đã được xử lý. Hệ thống không cộng thêm tháng.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  if (isVersionedAction && rawDueUnix !== undefined) {
    const expectedDueUnix = Number(rawDueUnix);
    const currentDueUnix = unix(getSubscriptionAdminDueAt(existing));
    if (!Number.isInteger(expectedDueUnix) || expectedDueUnix <= 0 || expectedDueUnix !== currentDueUnix) {
      await interaction.reply({
        content: `${E('status_info')} Ngày gia hạn trên panel này đã cũ. Hệ thống đã chặn xử lý lặp; vui lòng dùng panel mới nhất.`,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
  }

  if (action === 'claim') {
    if (existing.admin_claimed_by_id && existing.admin_claimed_by_id !== interaction.user.id) {
      await interaction.reply({
        content: `${E('status_info')} Hồ sơ đã được <@${existing.admin_claimed_by_id}> nhận xử lý.`,
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return true;
    }
    const claimed = claimAdminRenewal(id, interaction.user.id);
    await updateInteraction(interaction, buildActionResultV2(claimed, { action: 'claimed', adminId: interaction.user.id }));
    await emitAutomationLog(interaction.client, {
      guildId: interaction.guildId,
      customerId: claimed.customer_id,
      action: 'SUBSCRIPTION_RENEWAL_CLAIMED',
      title: 'ADMIN ĐÃ NHẬN HỒ SƠ GIA HẠN',
      summary: `Subscription #${id} đã được nhận xử lý.`,
      reference: claimed.related_order_code || String(id),
      status: 'info',
    });
    return true;
  }

  if (action === 'snooze') {
    const snoozed = snoozeAdminRenewal(id, config.subscriptionAdminSnoozeHours);
    await updateInteraction(interaction, buildActionResultV2(snoozed, {
      action: 'snoozed',
      adminId: interaction.user.id,
      snoozedUntil: snoozed.admin_snoozed_until,
    }));
    await emitAutomationLog(interaction.client, {
      guildId: interaction.guildId,
      customerId: snoozed.customer_id,
      action: 'SUBSCRIPTION_RENEWAL_SNOOZED',
      title: 'ĐÃ TẠM HOÃN NHẮC GIA HẠN',
      summary: `Subscription #${id} sẽ được nhắc lại sau ${config.subscriptionAdminSnoozeHours} giờ.`,
      reference: snoozed.related_order_code || String(id),
      status: 'warning',
    });
    return true;
  }

  if (action === 'renew') {
    if (getSubscriptionProgress(existing).nextAction === 'DISCONNECT') {
      await interaction.reply({
        content: `${E('status_warn')} Gói này đã được cấp đủ tháng. Hãy dùng nút **Xác Nhận Đã Ngắt Gói** ở thông báo mới.`,
        ephemeral: true,
      });
      return true;
    }
    if (!isSubscriptionRenewalDue(existing, config.subscriptionAdminReminderDays)) {
      await interaction.reply({
        content: `${E('status_warn')} Kỳ tiếp theo chưa vào cửa sổ xử lý. Hệ thống đã chặn cộng tháng sớm hoặc bấm lặp.`,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    await interaction.deferUpdate();
    let renewed;
    try {
      renewed = markRenewed(id, {
        actorId: interaction.user.id,
        source: 'DISCORD_ADMIN_BUTTON',
        expectedTimesRenewed: rawRevision === undefined
          ? Number(existing.times_renewed || 0)
          : expectedRevision,
        expectedActionAt: getSubscriptionAdminDueAt(existing),
        reminderWindowDays: config.subscriptionAdminReminderDays,
      });
    } catch (error) {
      if (error?.code !== 'SUBSCRIPTION_RENEWAL_CONFLICT') throw error;
      await interaction.followUp({
        content: `${E('status_info')} Kỳ này vừa được xử lý bởi một thao tác khác. Hệ thống đã chặn cộng trùng.`,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    const panelUpdated = await updateInteraction(
      interaction,
      buildActionResultV2(renewed, { action: 'renewed', adminId: interaction.user.id }),
    ).then(() => true).catch(() => false);
    if (!panelUpdated) {
      await interaction.followUp({
        content: `${E('status_check')} Đã lưu gia hạn thành công. Panel cũ không cập nhật được nên hệ thống sẽ dọn nó để tránh thao tác lặp.`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => null);
    }
    await cleanupAdminRenewalMessagesForRepair(interaction.client, {
      subscriptionId: id,
      orderCode: renewed.related_order_code,
      channelId: existing.admin_reminder_channel_id || interaction.channelId,
      keepMessageIds: panelUpdated && clickedMessageId ? [clickedMessageId] : [],
      matchOrderReference: false,
    }).catch((error) => console.error(`[SUB-ADMIN-REMINDER] Không dọn được panel trùng của subscription ${id}:`, error.message));
    const dmSent = await sendRenewedCustomerDm(interaction, renewed);
    await emitAutomationLog(interaction.client, {
      guildId: interaction.guildId,
      customerId: renewed.customer_id,
      action: 'SUBSCRIPTION_RENEWED',
      title: 'GIA HẠN DỊCH VỤ HOÀN TẤT',
      summary: `Subscription #${id} đã được xác nhận gia hạn${renewed.progress_status === 'NEEDS_REVIEW' ? ' và khóa nhắc để đối soát lịch' : ''}; DM khách hàng: ${dmSent ? 'đã gửi' : 'không gửi được'}.`,
      reference: renewed.related_order_code || String(id),
      status: 'success',
    });
    return true;
  }

  if (action === 'disconnect') {
    if (getSubscriptionProgress(existing).nextAction !== 'DISCONNECT') {
      await interaction.reply({
        content: `${E('status_warn')} Gói này vẫn còn tháng chưa cấp nên chưa thể xác nhận ngắt.`,
        ephemeral: true,
      });
      return true;
    }
    await interaction.deferUpdate();
    let disconnected;
    try {
      disconnected = markDisconnected(id, {
        actorId: interaction.user.id,
        source: 'DISCORD_ADMIN_BUTTON',
        expectedTimesRenewed: rawRevision === undefined
          ? Number(existing.times_renewed || 0)
          : expectedRevision,
        expectedActionAt: existing.expiry_at,
      });
    } catch (error) {
      if (error?.code !== 'SUBSCRIPTION_RENEWAL_CONFLICT') throw error;
      await interaction.followUp({
        content: `${E('status_info')} Hồ sơ này vừa được xử lý bởi thao tác khác. Hệ thống đã chặn xử lý lặp.`,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    const panelUpdated = await updateInteraction(
      interaction,
      buildActionResultV2(disconnected, { action: 'disconnected', adminId: interaction.user.id }),
    ).then(() => true).catch(() => false);
    if (!panelUpdated) {
      await interaction.followUp({
        content: `${E('status_check')} Đã lưu trạng thái ngắt gói. Panel cũ không cập nhật được nên hệ thống sẽ dọn nó để tránh thao tác lặp.`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => null);
    }
    await cleanupAdminRenewalMessagesForRepair(interaction.client, {
      subscriptionId: id,
      orderCode: disconnected.related_order_code,
      channelId: existing.admin_reminder_channel_id || interaction.channelId,
      keepMessageIds: panelUpdated && clickedMessageId ? [clickedMessageId] : [],
      matchOrderReference: false,
    }).catch((error) => console.error(`[SUB-ADMIN-REMINDER] Không dọn được panel trùng của subscription ${id}:`, error.message));
    const dmSent = await sendDisconnectedCustomerDm(interaction, disconnected);
    await emitAutomationLog(interaction.client, {
      guildId: interaction.guildId,
      customerId: disconnected.customer_id,
      action: 'SUBSCRIPTION_DISCONNECTED',
      title: 'ĐÃ NGẮT GÓI ĐÚNG HẠN',
      summary: `Subscription #${id} đã cấp đủ thời hạn và được xác nhận ngắt gói; DM khách hàng: ${dmSent ? 'đã gửi' : 'không gửi được'}.`,
      reference: disconnected.related_order_code || String(id),
      status: 'info',
    });
    return true;
  }

  await interaction.reply({ content: `${E('status_warn')} Nút này không còn hiệu lực.`, ephemeral: true });
  return true;
}
