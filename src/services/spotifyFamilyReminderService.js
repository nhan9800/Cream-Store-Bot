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
import { isManager } from '../utils/permissions.js';
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';
import { accentFor } from '../utils/uiKit.js';
import {
  getSpotifyFamiliesDueForReminder,
  getSpotifyFamily,
  markSpotifyFamilyReminderSent,
  markSpotifyFamilyRenewed,
  resolveFamilyReminderStage,
  snoozeSpotifyFamilyReminder,
} from './spotifyFamilyService.js';

const STAGE_META = {
  DUE_7D: { title: 'SPOTIFY FAMILY SẮP ĐẾN KỲ', tone: 'info', badge: 'CHUẨN BỊ GIA HẠN' },
  DUE_3D: { title: 'NHẮC GIA HẠN SPOTIFY FAMILY', tone: 'warning', badge: 'CÒN DƯỚI 3 NGÀY' },
  DUE_1D: { title: 'SPOTIFY FAMILY CẦN GIA HẠN GẤP', tone: 'danger', badge: 'CÒN DƯỚI 24 GIỜ' },
  OVERDUE: { title: 'SPOTIFY FAMILY ĐÃ QUÁ HẠN', tone: 'danger', badge: 'XỬ LÝ NGAY' },
};

function clean(value, max = 300) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function unix(value) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? Math.floor(parsed.getTime() / 1000) : null;
}

function money(value) {
  return `${Math.max(0, Number(value || 0)).toLocaleString('vi-VN')}đ`;
}

function dashboardUrl() {
  return new URL('/admin/spotify-families', config.storeWebsiteUrl || 'https://cenarstore.xyz').toString();
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

function actionRow(family, E) {
  const reveal = withButtonEmoji(
    new ButtonBuilder().setCustomId(`spotifyfam:show:${family.id}`).setLabel('Xem Thông Tin').setStyle(ButtonStyle.Primary),
    E.component('icon_key'),
  );
  const renew = withButtonEmoji(
    new ButtonBuilder().setCustomId(`spotifyfam:renew:${family.id}`).setLabel('Đã Gia Hạn 1 Tháng').setStyle(ButtonStyle.Success),
    E.component('status_check'),
  );
  const snooze = withButtonEmoji(
    new ButtonBuilder().setCustomId(`spotifyfam:snooze:${family.id}`).setLabel('Nhắc Lại Sau 24h').setStyle(ButtonStyle.Secondary),
    E.component('cenar_cooldown'),
    E.component('icon_clock'),
  );
  const portal = withButtonEmoji(
    new ButtonBuilder().setLabel('Mở Family Center').setStyle(ButtonStyle.Link).setURL(dashboardUrl()),
    E.component('icon_settings'),
  );
  return new ActionRowBuilder().addComponents(reveal, renew, snooze, portal);
}

export function buildSpotifyFamilyPanel(family, {
  stage = resolveFamilyReminderStage({ next_renewal_at: family.nextRenewalAt || family.next_renewal_at }),
  mentionText = '',
  roleIds = [],
  userIds = [],
  ping = false,
} = {}) {
  const normalized = family.members ? family : getSpotifyFamily(family.id, { includeSecrets: false });
  const E = createEmojiResolver(normalized.guildId || family.guild_id || config.guildId);
  const meta = STAGE_META[stage] || STAGE_META.DUE_7D;
  const dueTs = unix(normalized.nextRenewalAt);
  const memberNames = (normalized.members || [])
    .filter((member) => member.status === 'ACTIVE')
    .slice(0, 6)
    .map((member) => `\`${clean(member.spotifyUsername, 40)}\``)
    .join(' · ') || 'Chưa có thành viên';
  const dayText = normalized.overdueDays > 0
    ? `Quá hạn **${normalized.overdueDays} ngày**`
    : `Còn **${normalized.daysRemaining} ngày**`;

  const container = new ContainerBuilder().setAccentColor(accentFor(meta.tone));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    ping && mentionText ? mentionText : null,
    `# ${E('brand_spotify')} ${meta.title}`,
    `> ${E('status_warn')} **${meta.badge}** · ${dayText}`,
  ].filter(Boolean).join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `### ${E('icon_home')} ${clean(normalized.name, 100)} · FAM #${normalized.id}`,
    `${E('payment_money')} **Chi phí kỳ này** — ${money(normalized.renewalCost)}`,
    `${E('icon_calendar')} **Ngày gia hạn** — <t:${dueTs}:F> · <t:${dueTs}:R>`,
    `${E('ticket_user')} **Thành viên** — ${normalized.slotsUsed}/${normalized.totalSlots} slot · còn ${normalized.slotsAvailable} slot`,
    `${E('icon_key')} **Tài khoản owner** — \`${clean(normalized.loginEmail, 160)}\``,
    `${E('payment_card')} **Thẻ nạp** — ${clean(normalized.paymentCardLabel || 'Chưa đặt tên thẻ', 100)} · \`${normalized.paymentCardMasked}\``,
    `${E('icon_history')} **Profile đang dùng** — ${memberNames}`,
    normalized.note ? `${E('icon_edit')} **Ghi chú** — ${clean(normalized.note, 240)}` : null,
  ].filter(Boolean).join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `### ${E('cenar_admin')} CHECKLIST GIA HẠN`,
    `${E('status_check')} Kiểm tra đúng thẻ · nạp đủ số tiền · gia hạn Family · xác nhận các profile vẫn còn trong Fam.`,
    `${E('cenar_cooldown')} Nếu chưa xử lý được, chọn **Nhắc Lại Sau 24h** để bot không gửi lặp.`,
    `-# ${E('verify_shield')} Mật khẩu và số thẻ đầy đủ chỉ hiện riêng cho Admin · website và bot dùng chung dữ liệu`,
  ].join('\n')));

  return {
    components: [container, actionRow(normalized, E)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: ping ? { parse: [], roles: roleIds, users: userIds } : { parse: [] },
  };
}

function resultPanel(family, title, tone, actorId, detail) {
  const E = createEmojiResolver(family.guildId || config.guildId);
  const container = new ContainerBuilder().setAccentColor(accentFor(tone));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E(tone === 'success' ? 'status_check' : 'cenar_cooldown')} ${title}`,
    `> ${E('cenar_admin')} **Admin:** <@${actorId}>`,
    `${E('icon_home')} **Family:** #${family.id} · ${clean(family.name, 100)}`,
    detail,
    `-# ${E('verify_shield')} Đã đồng bộ với Spotify Family Center trên website`,
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

export async function runSpotifyFamilyReminders(client) {
  const guildId = String(config.guildId || '');
  if (!guildId) return { scanned: 0, sent: 0, errors: 0, skipped: true };
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { scanned: 0, sent: 0, errors: 1, skipped: false };
  const settings = getGuildConfig(guildId);
  const channel = await resolveReminderChannel(client, guild, settings);
  if (!channel?.isTextBased()) return { scanned: 0, sent: 0, errors: 1, skipped: false, reason: 'Reminder channel is not configured' };

  const targets = adminTargets(guild, settings);
  const candidates = getSpotifyFamiliesDueForReminder(guildId, 100);
  let sent = 0;
  let errors = 0;
  for (const candidate of candidates) {
    try {
      const family = getSpotifyFamily(candidate.id, { includeSecrets: false });
      const stage = resolveFamilyReminderStage({ next_renewal_at: family.nextRenewalAt });
      const message = await channel.send(buildSpotifyFamilyPanel(family, { stage, ...targets, ping: true }));
      markSpotifyFamilyReminderSent(family.id, { stage, messageId: message.id, channelId: channel.id });
      sent += 1;
    } catch (error) {
      errors += 1;
      console.error(`[SPOTIFY-FAMILY-REMINDER] Family #${candidate.id}:`, error.message);
    }
  }
  return { scanned: candidates.length, sent, errors, skipped: false };
}

export async function handleSpotifyFamilyButton(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('spotifyfam:')) return false;
  const [, action, rawId] = interaction.customId.split(':');
  const id = Number(rawId);
  const settings = getGuildConfig(interaction.guildId);
  const member = interaction.member?.roles?.cache
    ? interaction.member
    : await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!Number.isInteger(id) || !isManager(member, settings)) {
    await interaction.reply({ content: 'Chỉ Admin hoặc Manager mới được quản lý Spotify Family.', ephemeral: true });
    return true;
  }
  const existing = getSpotifyFamily(id, { includeSecrets: action === 'show' });
  if (!existing || ![interaction.guildId, 'WEB'].includes(existing.guildId)) {
    await interaction.reply({ content: 'Không tìm thấy Spotify Family này.', ephemeral: true });
    return true;
  }

  if (action === 'show') {
    const E = createEmojiResolver(interaction.guildId);
    const safe = (value) => clean(value, 300).replace(/`/g, 'ˋ') || 'Chưa có';
    const container = new ContainerBuilder().setAccentColor(accentFor('info'));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `# ${E('icon_key')} THÔNG TIN RIÊNG · ${safe(existing.name)}`,
      `${E('payment_money')} **Email owner:** \`${safe(existing.loginEmail)}\``,
      `${E('icon_key')} **Mật khẩu:** \`${safe(existing.loginPassword)}\``,
      `${E('payment_card')} **Thẻ gia hạn:** ${safe(existing.paymentCardLabel)} · \`${safe(existing.paymentCardNumber)}\``,
      `${E('icon_calendar')} **Kỳ tiếp theo:** <t:${unix(existing.nextRenewalAt)}:F>`,
      `-# ${E('status_warn')} Thông tin nhạy cảm chỉ hiển thị riêng cho bạn. Không chụp hoặc chia sẻ ra kênh công khai.`,
    ].join('\n')));
    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return true;
  }

  if (action === 'renew') {
    const renewed = markSpotifyFamilyRenewed(id);
    await interaction.update(resultPanel(
      renewed,
      'ĐÃ XÁC NHẬN GIA HẠN SPOTIFY FAMILY',
      'success',
      interaction.user.id,
      `Kỳ tiếp theo: <t:${unix(renewed.nextRenewalAt)}:F> · <t:${unix(renewed.nextRenewalAt)}:R>`,
    ));
    return true;
  }

  if (action === 'snooze') {
    const snoozed = snoozeSpotifyFamilyReminder(id, 24);
    await interaction.update(resultPanel(
      snoozed,
      'ĐÃ TẠM HOÃN NHẮC HẠN',
      'warning',
      interaction.user.id,
      `Bot sẽ nhắc lại <t:${unix(snoozed.snoozedUntil)}:R>.`,
    ));
    return true;
  }

  return false;
}
