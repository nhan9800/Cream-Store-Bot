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
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';
import { isManager } from '../utils/permissions.js';
import { accentFor } from '../utils/uiKit.js';
import { getGuildConfig } from './guildConfigService.js';
import {
  getYoutubeMembership,
  getYoutubeMembershipsDueForReminder,
  markYoutubeCyclePaid,
  markYoutubeReminderSent,
  resolveYoutubeReminderStage,
  snoozeYoutubeReminder,
} from './youtubeRenewalService.js';

const STAGE_META = {
  DUE_7D: { title: 'YOUTUBE SẮP ĐẾN KỲ THANH TOÁN NGUỒN', tone: 'info', badge: 'CHUẨN BỊ THANH TOÁN' },
  DUE_3D: { title: 'NHẮC THANH TOÁN NGUỒN YOUTUBE', tone: 'warning', badge: 'CÒN DƯỚI 3 NGÀY' },
  DUE_1D: { title: 'YOUTUBE CẦN THANH TOÁN NGUỒN GẤP', tone: 'danger', badge: 'CÒN DƯỚI 24 GIỜ' },
  OVERDUE: { title: 'KỲ YOUTUBE ĐÃ QUÁ HẠN', tone: 'danger', badge: 'XỬ LÝ NGAY' },
  FULLY_PAID: { title: 'YOUTUBE ĐÃ THANH TOÁN ĐỦ NGUỒN', tone: 'success', badge: 'HOÀN TẤT NGHĨA VỤ NGUỒN' },
};

function safe(value, max = 300) {
  return String(value ?? '').replace(/\s+/g, ' ').replace(/`/g, 'ˋ').trim().slice(0, max) || 'Chưa có';
}

function unix(value) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? Math.floor(parsed.getTime() / 1000) : null;
}

function money(value) {
  return `${Math.max(0, Number(value || 0)).toLocaleString('vi-VN')}đ`;
}

function planLabel(planType) {
  return planType === 'ROTATING_FAMILY' ? 'Đổi Family mỗi tháng' : 'Gia hạn đều · Family ổn định';
}

function dashboardUrl() {
  return new URL('/admin/youtube-renewals', config.storeWebsiteUrl || 'https://cenarstore.xyz').toString();
}

function adminTargets(guild, settings) {
  const roleIds = [...new Set([
    settings?.manager_role_id,
    ...config.ownerRoleIds,
  ].filter(Boolean).map(String))].filter((id) => guild.roles.cache.has(id));
  const userIds = [...new Set([
    guild.ownerId,
    ...config.adminDiscordIds,
  ].filter(Boolean).map(String))];
  return {
    roleIds,
    userIds,
    mentionText: [...roleIds.map((id) => `<@&${id}>`), ...userIds.map((id) => `<@${id}>`)].join(' '),
  };
}

function actionRow(membership, E) {
  const show = withButtonEmoji(
    new ButtonBuilder().setCustomId(`ytrenew:show:${membership.id}`).setLabel('Xem Gmail & Nguồn').setStyle(ButtonStyle.Primary),
    E.component('icon_key'),
  );
  const paid = withButtonEmoji(
    new ButtonBuilder()
      .setCustomId(`ytrenew:paid:${membership.id}`)
      .setLabel('Đã Thanh Toán 1 Kỳ')
      .setStyle(ButtonStyle.Success)
      .setDisabled(membership.remainingCycles <= 0),
    E.component('status_check'),
  );
  const snooze = withButtonEmoji(
    new ButtonBuilder().setCustomId(`ytrenew:snooze:${membership.id}`).setLabel('Nhắc Lại Sau 24h').setStyle(ButtonStyle.Secondary).setDisabled(membership.remainingCycles <= 0),
    E.component('icon_clock'),
  );
  const portal = withButtonEmoji(
    new ButtonBuilder().setLabel('Mở YouTube Center').setStyle(ButtonStyle.Link).setURL(dashboardUrl()),
    E.component('icon_settings'),
  );
  return new ActionRowBuilder().addComponents(show, paid, snooze, portal);
}

export function buildYoutubeRenewalPanel(membership, {
  stage = resolveYoutubeReminderStage(membership),
  mentionText = '',
  roleIds = [],
  userIds = [],
  ping = false,
} = {}) {
  const normalized = membership.history
    ? membership
    : getYoutubeMembership(membership.id, { includeSecrets: false, includeHistory: false });
  const E = createEmojiResolver(normalized.guildId || config.guildId);
  const effectiveStage = normalized.remainingCycles <= 0 ? 'FULLY_PAID' : stage;
  const meta = STAGE_META[effectiveStage] || STAGE_META.DUE_7D;
  const dueTs = unix(normalized.nextSourcePaymentAt);
  const expiryTs = unix(normalized.customerExpiryAt);
  const dueText = normalized.remainingCycles <= 0
    ? `Đã ghi nhận đủ **${normalized.totalCycles}/${normalized.totalCycles} kỳ**`
    : normalized.overdueDays > 0
    ? `Quá hạn **${normalized.overdueDays} ngày**`
    : `Còn **${normalized.daysUntilPayment ?? 0} ngày**`;

  const container = new ContainerBuilder().setAccentColor(accentFor(meta.tone));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    ping && mentionText ? mentionText : null,
    `# ${E('brand_youtube')} ${meta.title}`,
    `> ${E('status_warn')} **${meta.badge}** · ${dueText}`,
  ].filter(Boolean).join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `### ${E('ticket_user')} HỒ SƠ #${normalized.id} · ${safe(normalized.customerName || normalized.customerGmailMasked, 100)}`,
    `${E('icon_id')} **Gmail khách** — \`${safe(normalized.customerGmailMasked, 180)}\``,
    `${E('icon_store')} **Nguồn cần thanh toán** — **${safe(normalized.sourceName, 120)}**`,
    `${E('payment_money')} **Tiền kỳ này** — **${money(normalized.sourceCostPerCycle)}**`,
    `${E('icon_calendar')} **Hạn thanh toán nguồn** — ${dueTs ? `<t:${dueTs}:F> · <t:${dueTs}:R>` : 'Đã thanh toán đủ'}`,
    `${E('icon_history')} **Tiến độ nguồn** — **${normalized.paidCycles}/${normalized.totalCycles} kỳ** · còn ${normalized.remainingCycles} kỳ (${normalized.remainingMonths} tháng)`,
    `${E('order_product')} **Gói khách đã mua** — ${normalized.totalMonths} tháng · ${planLabel(normalized.planType)}`,
    `${E('verify_shield')} **Hạn dịch vụ khách** — <t:${expiryTs}:D> · <t:${expiryTs}:R>`,
    normalized.currentFamilyLabel ? `${E('icon_home')} **Family hiện tại** — ${safe(normalized.currentFamilyLabel, 160)}` : null,
    normalized.relatedOrderCode ? `${E('order_id')} **Mã đơn** — \`${safe(normalized.relatedOrderCode, 80)}\`` : null,
  ].filter(Boolean).join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `### ${E('cenar_admin')} QUY TRÌNH KỲ NÀY`,
    `${E('status_check')} Bank đúng nguồn · xác nhận Gmail vẫn nằm trong Family · ghi nhận kỳ thanh toán ngay sau khi nguồn xử lý.`,
    `${E('cenar_cooldown')} Nếu chưa xử lý được, chọn **Nhắc Lại Sau 24h** để tránh bot gửi lặp.`,
    `-# ${E('verify_shield')} Gmail đầy đủ và tài khoản nhận tiền chỉ hiển thị riêng cho Admin · bot và website dùng chung dữ liệu`,
  ].join('\n')));

  return {
    components: [container, actionRow(normalized, E)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: ping ? { parse: [], roles: roleIds, users: userIds } : { parse: [] },
  };
}

function resultPanel(membership, title, tone, actorId, detail) {
  const E = createEmojiResolver(membership.guildId || config.guildId);
  const container = new ContainerBuilder().setAccentColor(accentFor(tone));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E(tone === 'success' ? 'status_check' : 'cenar_cooldown')} ${title}`,
    `> ${E('cenar_admin')} **Admin:** <@${actorId}>`,
    `${E('icon_id')} **Khách:** \`${safe(membership.customerGmailMasked)}\``,
    `${E('icon_store')} **Nguồn:** ${safe(membership.sourceName)}`,
    detail,
    `-# ${E('verify_shield')} Đã đồng bộ với YouTube Renewal Center trên website`,
  ].join('\n')));
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

async function resolveReminderChannel(client, guild, settings) {
  const channelId = settings?.reminder_channel_id || settings?.staff_log_channel_id;
  if (!channelId) return null;
  return guild.channels.cache.get(channelId)
    || await guild.channels.fetch(channelId).catch(() => null)
    || client.channels.cache.get(channelId)
    || await client.channels.fetch(channelId).catch(() => null);
}

export async function runYoutubeRenewalReminders(client) {
  const guildId = String(config.guildId || '');
  if (!guildId) return { scanned: 0, sent: 0, errors: 0, skipped: true };
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { scanned: 0, sent: 0, errors: 1, skipped: false };
  const settings = getGuildConfig(guildId);
  const channel = await resolveReminderChannel(client, guild, settings);
  if (!channel?.isTextBased()) return { scanned: 0, sent: 0, errors: 1, skipped: false, reason: 'Reminder channel is not configured' };

  const targets = adminTargets(guild, settings);
  const candidates = getYoutubeMembershipsDueForReminder(guildId, 100);
  let sent = 0;
  let errors = 0;
  for (const candidate of candidates) {
    try {
      const membership = getYoutubeMembership(candidate.id, { includeSecrets: false, includeHistory: false });
      const stage = resolveYoutubeReminderStage(membership);
      const message = await channel.send(buildYoutubeRenewalPanel(membership, { stage, ...targets, ping: true }));
      markYoutubeReminderSent(membership.id, { stage, messageId: message.id, channelId: channel.id });
      sent += 1;
    } catch (error) {
      errors += 1;
      console.error(`[YOUTUBE-RENEWAL-REMINDER] Membership #${candidate.id}:`, error.message);
    }
  }
  return { scanned: candidates.length, sent, errors, skipped: false };
}

export async function handleYoutubeRenewalButton(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('ytrenew:')) return false;
  const [, action, rawId] = interaction.customId.split(':');
  const id = Number(rawId);
  const settings = getGuildConfig(interaction.guildId);
  const member = interaction.member?.roles?.cache
    ? interaction.member
    : await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!Number.isInteger(id) || !isManager(member, settings)) {
    await interaction.reply({ content: 'Chỉ Admin hoặc Manager mới được quản lý gia hạn YouTube.', ephemeral: true });
    return true;
  }
  const existing = getYoutubeMembership(id, { includeSecrets: action === 'show', includeHistory: false });
  if (!existing || ![interaction.guildId, 'WEB'].includes(existing.guildId)) {
    await interaction.reply({ content: 'Không tìm thấy hồ sơ YouTube này.', ephemeral: true });
    return true;
  }

  if (action === 'show') {
    const E = createEmojiResolver(interaction.guildId);
    const container = new ContainerBuilder().setAccentColor(accentFor('info'));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `# ${E('icon_key')} THÔNG TIN THANH TOÁN RIÊNG · HỒ SƠ #${existing.id}`,
      `${E('icon_id')} **Gmail khách:** \`${safe(existing.customerGmail)}\``,
      `${E('ticket_user')} **Tên khách:** ${safe(existing.customerName)}`,
      `${E('icon_store')} **Nguồn:** ${safe(existing.sourceName)} · ${safe(existing.sourceContact)}`,
      `${E('payment_payos')} **Thanh toán:** ${safe(existing.sourcePaymentMethod)} · \`${safe(existing.sourcePaymentAccount)}\``,
      `${E('payment_money')} **Số tiền kỳ:** ${money(existing.sourceCostPerCycle)}`,
      existing.currentFamilyLabel ? `${E('icon_home')} **Family hiện tại:** ${safe(existing.currentFamilyLabel)}` : null,
      `-# ${E('status_warn')} Dữ liệu nhạy cảm chỉ hiện riêng cho bạn. Không gửi lại vào kênh công khai.`,
    ].filter(Boolean).join('\n')));
    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return true;
  }

  if (action === 'paid') {
    const updated = markYoutubeCyclePaid(id, { actorId: interaction.user.id, note: 'Xác nhận nhanh từ nút Discord.' });
    const next = updated.nextSourcePaymentAt
      ? `Kỳ tiếp theo: <t:${unix(updated.nextSourcePaymentAt)}:F> · <t:${unix(updated.nextSourcePaymentAt)}:R>`
      : `Đã thanh toán đủ **${updated.totalCycles}/${updated.totalCycles} kỳ** cho nguồn.`;
    await interaction.update(resultPanel(updated, 'ĐÃ GHI NHẬN THANH TOÁN NGUỒN YOUTUBE', 'success', interaction.user.id, next));
    return true;
  }

  if (action === 'snooze') {
    const snoozed = snoozeYoutubeReminder(id, 24);
    await interaction.update(resultPanel(
      snoozed,
      'ĐÃ TẠM HOÃN NHẮC THANH TOÁN YOUTUBE',
      'warning',
      interaction.user.id,
      `Bot sẽ nhắc lại <t:${unix(snoozed.snoozedUntil)}:R>.`,
    ));
    return true;
  }

  return false;
}
