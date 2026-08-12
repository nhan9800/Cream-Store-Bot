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
  getTotalRenewalsNeeded,
  markAdminReminderSent,
  markRenewed,
  snoozeAdminRenewal,
} from './subscriptionService.js';
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
import { accentFor } from '../utils/uiKit.js';
import { isManager } from '../utils/permissions.js';
import { emitAutomationLog } from './automationLogService.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const STAGE_ORDER = {
  UPCOMING_7D: 1,
  UPCOMING_3D: 2,
  URGENT_1D: 3,
  DUE_NOW: 4,
  OVERDUE: 5,
};

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
    summary: 'Gói đã quá hạn và có nguy cơ gián đoạn. Hệ thống sẽ nhắc lại tối đa một lần mỗi 24 giờ cho tới khi được xử lý.',
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
  const previous = String(sub?.admin_reminder_stage || '');
  if (!previous) return true;
  if ((STAGE_ORDER[stage] || 0) > (STAGE_ORDER[previous] || 0)) return true;
  if (stage !== 'OVERDUE' || previous !== 'OVERDUE') return false;
  const lastSent = new Date(sub.admin_reminder_sent_at || 0);
  return !Number.isFinite(lastSent.getTime()) || new Date(now).getTime() - lastSent.getTime() >= DAY_MS;
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
  if (sub.renewal_mode !== 'auto_cycle') {
    return `Gói mua lẻ · đã gia hạn ${Number(sub.times_renewed || 0)} lần`;
  }
  const required = Math.max(1, getTotalRenewalsNeeded(sub) + 1);
  return `${Number(sub.times_renewed || 0)}/${required} kỳ đã hoàn tất · chu kỳ ${Number(sub.renewal_cycle_months || 0)} tháng`;
}

function buildActionRow(sub, E) {
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
      .setCustomId(`sub:admin:renew:${sub.id}`)
      .setLabel('Xác Nhận Đã Gia Hạn')
      .setStyle(ButtonStyle.Success),
    E.component('status_check'),
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
    `# ${E(meta.emoji)} ${meta.title}`,
    `> ${E('status_info')} **Mức ưu tiên:** ${meta.badge} · ${meta.summary}`,
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
    dueTs ? `${E('icon_clock')} **Kỳ cần xử lý** — <t:${dueTs}:F> · <t:${dueTs}:R>` : null,
    expiryTs ? `${E('warranty_expiry')} **Hết hạn toàn gói** — <t:${expiryTs}:F>` : null,
    sub.note ? `${E('icon_edit')} **Ghi chú** — ${clean(sub.note, 240)}` : null,
  ].filter(Boolean).join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `### ${E('cenar_admin')} BÀN GIAO XỬ LÝ`,
    `${E('ticket_claim')} **Phụ trách** — ${claim}`,
    `${E('icon_search')} **Checklist** — Kiểm tra nguồn · đăng nhập · xác nhận thời hạn mới · bấm **Xác Nhận Đã Gia Hạn**.`,
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
  const isComplete = action === 'renewed';
  const title = isComplete ? 'ĐÃ XÁC NHẬN GIA HẠN' : action === 'snoozed' ? 'ĐÃ TẠM HOÃN NHẮC VIỆC' : 'ADMIN ĐÃ NHẬN XỬ LÝ';
  const tone = isComplete ? 'success' : action === 'snoozed' ? 'warning' : 'info';
  const container = new ContainerBuilder().setAccentColor(accentFor(tone));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E(isComplete ? 'status_check' : action === 'snoozed' ? 'cenar_cooldown' : 'ticket_claim')} ${title}`,
    `> ${E('cenar_admin')} **Admin:** <@${adminId}>`,
    `${E('icon_id')} **Subscription:** #${sub.id} · \`${clean(sub.gmail_email, 120)}\``,
    isComplete
      ? `${E('icon_calendar')} **Hạn mới:** <t:${unix(sub.next_renewal_at || sub.expiry_at)}:F>`
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
    E.component(isComplete ? 'status_check' : 'cenar_cooldown'),
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
    try {
      const message = await channel.send(buildAdminRenewalReminderV2(sub, { stage, ...targets }));
      markAdminReminderSent(sub.id, { stage, messageId: message.id, channelId: channel.id });
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

async function updateInteraction(interaction, payload) {
  const { flags: _flags, ...updatePayload } = payload;
  await interaction.update(updatePayload);
}

async function sendRenewedCustomerDm(interaction, sub) {
  if (!sub.customer_id) return false;
  const user = await interaction.client.users.fetch(sub.customer_id).catch(() => null);
  if (!user) return false;
  const E = createEmojiResolver(presentationGuildId(sub.guild_id));
  const dueTs = unix(sub.next_renewal_at || sub.expiry_at);
  const container = new ContainerBuilder().setAccentColor(accentFor('success'));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('status_check')} GIA HẠN DỊCH VỤ THÀNH CÔNG`,
    `> ${E('cenar_verified')} Cenar Store đã hoàn tất kỳ gia hạn cho dịch vụ của bạn.`,
    `${E(SERVICE_META[sub.service_type]?.emoji || 'order_product')} **Dịch vụ** — ${SERVICE_META[sub.service_type]?.label || clean(sub.service_type)}`,
    sub.related_order_code ? `${E('icon_clipboard')} **Đơn gốc** — \`${sub.related_order_code}\`` : null,
    dueTs ? `${E('icon_calendar')} **Mốc tiếp theo** — <t:${dueTs}:F>` : null,
    `${E('cenar_support')} Vui lòng kiểm tra tài khoản. Nếu có vấn đề, hãy mở ticket để được hỗ trợ ngay.`,
    `-# ${E('verify_shield')} Cenar Store · Gia hạn được xác nhận bởi bộ phận quản trị`,
  ].filter(Boolean).join('\n')));
  return user.send({ components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } })
    .then(() => true)
    .catch(() => false);
}

export async function handleAdminRenewalButton(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('sub:admin:')) return false;
  const [, , action, rawId] = interaction.customId.split(':');
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
    const renewed = markRenewed(id);
    await updateInteraction(interaction, buildActionResultV2(renewed, { action: 'renewed', adminId: interaction.user.id }));
    const dmSent = await sendRenewedCustomerDm(interaction, renewed);
    await emitAutomationLog(interaction.client, {
      guildId: interaction.guildId,
      customerId: renewed.customer_id,
      action: 'SUBSCRIPTION_RENEWED',
      title: 'GIA HẠN DỊCH VỤ HOÀN TẤT',
      summary: `Subscription #${id} đã được xác nhận gia hạn; DM khách hàng: ${dmSent ? 'đã gửi' : 'không gửi được'}.`,
      reference: renewed.related_order_code || String(id),
      status: 'success',
    });
    return true;
  }

  await interaction.reply({ content: `${E('status_warn')} Nút này không còn hiệu lực.`, ephemeral: true });
  return true;
}
