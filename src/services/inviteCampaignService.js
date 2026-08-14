import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import { config } from '../config.js';
import { db, nowIso } from '../database/db.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { getGuildConfig } from './guildConfigService.js';

export const INVITE_DECOR_CAMPAIGN = Object.freeze({
  eventKey: 'store1-decor-invite-2026-08',
  guildId: '1282637033340403754',
  name: 'Mời 5 bạn · Nhận Decor Discord',
  endsAt: '2026-08-31T16:59:59.999Z',
  requiredValidInvites: 5,
  minStayHours: 48,
  minAccountAgeDays: 30,
  rewardName: '01 Decor / Hiệu ứng hồ sơ Discord',
  rewardValue: 66_000,
  announcementChannelId: '1515008584549797979',
  logChannelName: '🎟・log-event-invite',
});

const TERMINAL_REJECTED_STATUSES = [
  'REJECTED_BOT',
  'REJECTED_SELF',
  'REJECTED_CLONE',
  'REJECTED_REJOIN',
  'REJECTED_INVITER_LEFT',
];

function toUnix(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function addHoursIso(value, hours) {
  return new Date(Date.parse(value) + Number(hours) * 3_600_000).toISOString();
}

function compactText(value, max = 60, fallback = 'Tài khoản Discord') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

function safeDisplay(value, max = 60) {
  return compactText(value, max)
    .replace(/([\\`*_~|>])/g, '\\$1')
    .replaceAll('<', '‹')
    .replaceAll('@', '＠');
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('vi-VN')}đ`;
}

export function ensureInviteDecorCampaign(guildId = INVITE_DECOR_CAMPAIGN.guildId, { startsAt = nowIso() } = {}) {
  if (String(guildId) !== String(INVITE_DECOR_CAMPAIGN.guildId)) return null;
  const startMs = Date.parse(startsAt);
  const endMs = Date.parse(INVITE_DECOR_CAMPAIGN.endsAt);
  const safeStartsAt = Number.isFinite(startMs) && startMs < endMs ? new Date(startMs).toISOString() : nowIso();
  const timestamp = nowIso();
  db.prepare(`
    INSERT INTO invite_campaigns (
      event_key, guild_id, name, starts_at, ends_at,
      required_valid_invites, min_stay_hours, min_account_age_days,
      reward_name, reward_value, announcement_channel_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
    ON CONFLICT(event_key) DO UPDATE SET
      name = excluded.name,
      ends_at = excluded.ends_at,
      required_valid_invites = excluded.required_valid_invites,
      min_stay_hours = excluded.min_stay_hours,
      min_account_age_days = excluded.min_account_age_days,
      reward_name = excluded.reward_name,
      reward_value = excluded.reward_value,
      announcement_channel_id = COALESCE(invite_campaigns.announcement_channel_id, excluded.announcement_channel_id),
      updated_at = excluded.updated_at
  `).run(
    INVITE_DECOR_CAMPAIGN.eventKey,
    guildId,
    INVITE_DECOR_CAMPAIGN.name,
    safeStartsAt,
    INVITE_DECOR_CAMPAIGN.endsAt,
    INVITE_DECOR_CAMPAIGN.requiredValidInvites,
    INVITE_DECOR_CAMPAIGN.minStayHours,
    INVITE_DECOR_CAMPAIGN.minAccountAgeDays,
    INVITE_DECOR_CAMPAIGN.rewardName,
    INVITE_DECOR_CAMPAIGN.rewardValue,
    INVITE_DECOR_CAMPAIGN.announcementChannelId,
    timestamp,
    timestamp,
  );
  return db.prepare('SELECT * FROM invite_campaigns WHERE event_key = ?').get(INVITE_DECOR_CAMPAIGN.eventKey);
}

export function classifyInviteCampaignJoin({
  invitedId,
  inviterId,
  isBot = false,
  accountAgeDays = 0,
  minAccountAgeDays = INVITE_DECOR_CAMPAIGN.minAccountAgeDays,
  priorInviteRecord = null,
  inviterPresent = true,
}) {
  if (isBot) return { status: 'REJECTED_BOT', reason: 'Tài khoản bot không được tính.' };
  if (!inviterId) return { status: 'UNATTRIBUTED', reason: 'Không xác định được link mời đã sử dụng.' };
  if (String(invitedId) === String(inviterId)) return { status: 'REJECTED_SELF', reason: 'Không chấp nhận tự mời chính mình.' };
  if (priorInviteRecord) return { status: 'REJECTED_REJOIN', reason: 'Tài khoản đã từng tham gia Store 1 trước event.' };
  if (!inviterPresent) return { status: 'REJECTED_INVITER_LEFT', reason: 'Người mời không còn trong Store 1.' };
  if (Number(accountAgeDays) < Number(minAccountAgeDays)) {
    return {
      status: 'REJECTED_CLONE',
      reason: `Tài khoản Discord chưa đủ ${minAccountAgeDays} ngày tuổi.`,
    };
  }
  return { status: 'PENDING', reason: null };
}

export async function registerInviteCampaignJoin({ member, inviterId = null, inviteCode = null, priorInviteRecord = null }) {
  if (!member || String(member.guild?.id) !== String(INVITE_DECOR_CAMPAIGN.guildId)) return null;
  const campaign = ensureInviteDecorCampaign(member.guild.id);
  if (!campaign) return null;
  const joinedAt = new Date(member.joinedTimestamp || Date.now()).toISOString();
  const joinedMs = Date.parse(joinedAt);
  if (joinedMs < Date.parse(campaign.starts_at) || joinedMs > Date.parse(campaign.ends_at)) return null;

  const existing = db.prepare(`
    SELECT * FROM invite_campaign_entries
    WHERE event_key = ? AND guild_id = ? AND invited_id = ?
  `).get(campaign.event_key, member.guild.id, member.id);
  if (existing) return existing;

  const accountCreatedAt = new Date(member.user.createdTimestamp || Date.now()).toISOString();
  const accountAgeDays = Math.max(0, Math.floor((joinedMs - Date.parse(accountCreatedAt)) / 86_400_000));
  const inviterMember = inviterId
    ? (member.guild.members.cache.get(String(inviterId))
      || await member.guild.members.fetch(String(inviterId)).catch(() => null))
    : null;
  const classification = classifyInviteCampaignJoin({
    invitedId: member.id,
    inviterId,
    isBot: member.user.bot,
    accountAgeDays,
    minAccountAgeDays: campaign.min_account_age_days,
    priorInviteRecord,
    inviterPresent: !inviterId || Boolean(inviterMember),
  });
  const qualifiesAt = classification.status === 'PENDING'
    ? addHoursIso(joinedAt, campaign.min_stay_hours)
    : null;
  const riskFlags = [
    accountAgeDays < 90 ? 'ACCOUNT_UNDER_90_DAYS' : null,
    member.user.avatar ? null : 'DEFAULT_AVATAR',
  ].filter(Boolean);
  const timestamp = nowIso();
  db.prepare(`
    INSERT INTO invite_campaign_entries (
      event_key, guild_id, inviter_id, invited_id, invite_code, status,
      disqualify_reason, account_created_at, account_age_days, joined_at,
      qualifies_at, risk_flags, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    campaign.event_key,
    member.guild.id,
    inviterId ? String(inviterId) : null,
    member.id,
    inviteCode ? String(inviteCode) : null,
    classification.status,
    classification.reason,
    accountCreatedAt,
    accountAgeDays,
    joinedAt,
    qualifiesAt,
    JSON.stringify(riskFlags),
    timestamp,
    timestamp,
  );
  return db.prepare(`
    SELECT * FROM invite_campaign_entries
    WHERE event_key = ? AND guild_id = ? AND invited_id = ?
  `).get(campaign.event_key, member.guild.id, member.id);
}

export function markInviteCampaignMemberLeft(member) {
  if (!member || String(member.guild?.id) !== String(INVITE_DECOR_CAMPAIGN.guildId)) return { changed: 0 };
  const timestamp = nowIso();
  const result = db.prepare(`
    UPDATE invite_campaign_entries
    SET status = 'LEFT', disqualify_reason = 'Rời Store 1 trước khi đủ 48 giờ.',
        left_at = ?, updated_at = ?
    WHERE event_key = ? AND guild_id = ? AND invited_id = ? AND status = 'PENDING'
  `).run(timestamp, timestamp, INVITE_DECOR_CAMPAIGN.eventKey, member.guild.id, member.id);
  return { changed: result.changes };
}

function deriveCampaignPhase(campaign, stats, nowMs = Date.now()) {
  if (nowMs < Date.parse(campaign.starts_at)) return 'UPCOMING';
  if (nowMs <= Date.parse(campaign.ends_at)) return 'ACTIVE';
  if (stats.pending > 0) return 'VERIFYING';
  return 'ENDED';
}

export function getInviteCampaignStats(guildId, inviterId, nowMs = Date.now()) {
  const campaign = ensureInviteDecorCampaign(guildId);
  if (!campaign) return null;
  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'VALID' THEN 1 ELSE 0 END) AS valid_count,
      SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN status = 'LEFT' THEN 1 ELSE 0 END) AS left_count,
      SUM(CASE WHEN status LIKE 'REJECTED_%' THEN 1 ELSE 0 END) AS rejected_count
    FROM invite_campaign_entries
    WHERE event_key = ? AND guild_id = ? AND inviter_id = ?
  `).get(campaign.event_key, guildId, inviterId) || {};
  const nextPending = db.prepare(`
    SELECT qualifies_at FROM invite_campaign_entries
    WHERE event_key = ? AND guild_id = ? AND inviter_id = ? AND status = 'PENDING'
    ORDER BY datetime(qualifies_at) ASC LIMIT 1
  `).get(campaign.event_key, guildId, inviterId);
  const reward = db.prepare(`
    SELECT * FROM invite_campaign_rewards
    WHERE event_key = ? AND guild_id = ? AND inviter_id = ?
  `).get(campaign.event_key, guildId, inviterId) || null;
  const stats = {
    campaign,
    valid: Number(counts.valid_count || 0),
    pending: Number(counts.pending_count || 0),
    left: Number(counts.left_count || 0),
    rejected: Number(counts.rejected_count || 0),
    nextPendingAt: nextPending?.qualifies_at || null,
    reward,
  };
  stats.remaining = Math.max(0, Number(campaign.required_valid_invites) - stats.valid);
  stats.phase = deriveCampaignPhase(campaign, stats, nowMs);
  return stats;
}

export function buildInviteCheckPayload(stats, { userId, username = null } = {}) {
  if (!stats?.campaign) return { content: 'Event invite hiện chưa sẵn sàng.' };
  const { campaign } = stats;
  const E = createEmojiResolver(campaign.guild_id);
  const required = Number(campaign.required_valid_invites);
  const filled = Math.min(required, stats.valid);
  const progress = `${'▰'.repeat(filled)}${'▱'.repeat(Math.max(0, required - filled))}`;
  const endUnix = toUnix(campaign.ends_at);
  const nextUnix = toUnix(stats.nextPendingAt);
  const userLabel = username ? `**${safeDisplay(username, 32)}**` : `<@${userId}>`;
  const phaseLabel = {
    ACTIVE: `${E('status_check')} Đang diễn ra`,
    UPCOMING: `${E('icon_clock')} Sắp diễn ra`,
    VERIFYING: `${E('icon_clock')} Đã đóng lượt mới · đang xác minh 48 giờ`,
    ENDED: `${E('status_cross')} Đã kết thúc`,
  }[stats.phase] || stats.phase;

  const container = new ContainerBuilder().setAccentColor(stats.reward ? 0x22C55E : 0xA855F7);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# <:cenar_sale_gift:1534852792295100436> INVITE CHECK · DECOR 66K`,
    `> ${userLabel} · ${phaseLabel}`,
  ].join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${E('icon_trophy')} TIẾN ĐỘ ${stats.valid}/${required}`,
    `\`${progress}\``,
    `${E('status_check')} **Hợp lệ:** ${stats.valid}  ·  ${E('icon_clock')} **Chờ 48 giờ:** ${stats.pending}`,
    `${E('status_cross')} **Rời sớm:** ${stats.left}  ·  **Clone/không hợp lệ:** ${stats.rejected}`,
    stats.reward
      ? `> ${E('icon_gift')} **Bạn đã đủ điều kiện nhận ${campaign.reward_name}!** Admin đã được thông báo.`
      : `> Cần thêm **${stats.remaining}** lượt mời hợp lệ để nhận **${campaign.reward_name}** trị giá **${formatMoney(campaign.reward_value)}**.`,
    nextUnix ? `-# Lượt chờ gần nhất được xác minh <t:${nextUnix}:R>.` : null,
  ].filter(Boolean).join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `${E('icon_clock')} Người được mời phải ở liên tục **${campaign.min_stay_hours} giờ**.`,
    `${E('status_cross')} Tài khoản dưới **${campaign.min_account_age_days} ngày**, bot, tự mời, rejoin hoặc rời sớm đều không được tính.`,
    `${E('icon_calendar')} Hạn nhận lượt mời mới: ${endUnix ? `<t:${endUnix}:F> · <t:${endUnix}:R>` : campaign.ends_at}`,
    `-# Chỉ tính lượt phát sinh trong event này · mỗi tài khoản chỉ thuộc một người mời.`,
  ].join('\n')));

  const components = [container];
  if (campaign.announcement_message_id && campaign.announcement_channel_id) {
    const button = new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Xem thể lệ event')
      .setURL(`https://discord.com/channels/${campaign.guild_id}/${campaign.announcement_channel_id}/${campaign.announcement_message_id}`);
    const emoji = E.component('icon_gift');
    if (emoji) button.setEmoji(emoji);
    components.push(new ActionRowBuilder().addComponents(button));
  }
  return { components, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

export function buildInviteCampaignAnnouncementPayload(campaign) {
  const E = createEmojiResolver(campaign.guild_id);
  const endUnix = toUnix(campaign.ends_at);
  const container = new ContainerBuilder().setAccentColor(0xEC4899);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    '# <:cenar_sale_gift:1534852792295100436> EVENT MỜI BẠN · NHẬN DECOR 66K',
    '> Mời bạn bè thật vào **Cenar Store 1** và nhận ngay một hiệu ứng hồ sơ Discord cực xịn.',
  ].join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${E('icon_trophy')} PHẦN THƯỞNG`,
    `${E('icon_gift')} **${campaign.reward_name}** · trị giá **${formatMoney(campaign.reward_value)}**`,
    `${E('icon_group')} Chỉ cần **${campaign.required_valid_invites} người mời hợp lệ** trong thời gian event.`,
    '',
    `## ${E('icon_clock')} CÁCH TÍNH HỢP LỆ`,
    `> ${E('status_check')} Người được mời dùng link của bạn và ở liên tục trong server đủ **${campaign.min_stay_hours} giờ**.`,
    `> ${E('status_check')} Tài khoản Discord phải có tuổi đời từ **${campaign.min_account_age_days} ngày**.`,
    `> ${E('status_cross')} Bot, clone mới tạo, tự mời, tài khoản từng vào server/rejoin hoặc rời trước 48 giờ sẽ bị loại.`,
    `> ${E('status_cross')} Mỗi tài khoản chỉ được ghi nhận cho **một** người mời.`,
  ].join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${E('icon_calendar')} THỜI GIAN & KIỂM TRA`,
    `${E('icon_clock')} Nhận lượt mời mới đến ${endUnix ? `<t:${endUnix}:F>` : campaign.ends_at} (${endUnix ? `<t:${endUnix}:R>` : ''}).`,
    `${E('icon_search')} Dùng lệnh **\`/invcheck\`** để xem lượt hợp lệ, đang chờ và bị loại.`,
    `-# Người tham gia cuối tháng vẫn được hệ thống hoàn tất kiểm tra 48 giờ sau khi event đóng lượt mới.`,
  ].join('\n')));
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

function eventLogPermissionOverwrites(guild, guildConfig) {
  const overwrites = new Map();
  overwrites.set(guild.roles.everyone.id, { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] });
  overwrites.set(guild.client.user.id, {
    id: guild.client.user.id,
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.EmbedLinks,
    ],
  });
  for (const roleId of [guildConfig?.manager_role_id, ...config.ownerRoleIds].filter(Boolean)) {
    if (!guild.roles.cache.has(String(roleId))) continue;
    overwrites.set(String(roleId), {
      id: String(roleId),
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
      ],
    });
  }
  return [...overwrites.values()];
}

async function ensureInviteAdminLogChannel(guild, campaign) {
  const guildConfig = getGuildConfig(guild.id);
  await guild.channels.fetch().catch(() => null);
  await guild.roles.fetch().catch(() => null);
  let channel = campaign.admin_log_channel_id
    ? await guild.channels.fetch(campaign.admin_log_channel_id).catch(() => null)
    : null;
  if (!channel?.isTextBased()) {
    channel = guild.channels.cache.find((candidate) => (
      candidate.type === ChannelType.GuildText && candidate.name === INVITE_DECOR_CAMPAIGN.logChannelName
    )) || null;
  }
  const category = guildConfig?.admin_order_category_id
    ? await guild.channels.fetch(guildConfig.admin_order_category_id).catch(() => null)
    : null;
  const overwrites = eventLogPermissionOverwrites(guild, guildConfig);
  if (!channel) {
    channel = await guild.channels.create({
      name: INVITE_DECOR_CAMPAIGN.logChannelName,
      type: ChannelType.GuildText,
      parent: category?.type === ChannelType.GuildCategory ? category.id : undefined,
      topic: 'Log riêng event mời 5 bạn nhận Decor 66K · xác minh 48 giờ · chống clone/rejoin',
      permissionOverwrites: overwrites,
      reason: 'Cenar Store 1 · Event invite Decor tháng 8/2026',
    });
  } else {
    for (const overwrite of overwrites) {
      await channel.permissionOverwrites.edit(overwrite.id, {
        ViewChannel: overwrite.deny ? false : true,
        SendMessages: overwrite.allow ? true : undefined,
        ReadMessageHistory: overwrite.allow ? true : undefined,
      }).catch(() => null);
    }
  }
  if (campaign.admin_log_channel_id !== channel.id) {
    db.prepare('UPDATE invite_campaigns SET admin_log_channel_id = ?, updated_at = ? WHERE event_key = ?')
      .run(channel.id, nowIso(), campaign.event_key);
  }
  return channel;
}

async function ensureInviteCampaignAnnouncement(guild, campaign) {
  const channel = await guild.channels.fetch(campaign.announcement_channel_id || INVITE_DECOR_CAMPAIGN.announcementChannelId).catch(() => null);
  if (!channel?.isTextBased()) return null;
  let message = campaign.announcement_message_id
    ? await channel.messages.fetch(campaign.announcement_message_id).catch(() => null)
    : null;
  const payload = buildInviteCampaignAnnouncementPayload(campaign);
  if (message) {
    await message.edit(payload);
  } else {
    message = await channel.send(payload);
    await message.pin('Ghim thể lệ event mời bạn nhận Decor 66K').catch(() => null);
    db.prepare(`
      UPDATE invite_campaigns
      SET announcement_channel_id = ?, announcement_message_id = ?, updated_at = ?
      WHERE event_key = ?
    `).run(channel.id, message.id, nowIso(), campaign.event_key);
  }
  return message;
}

export async function ensureInviteCampaignDiscordSetup(guild) {
  if (!guild || String(guild.id) !== String(INVITE_DECOR_CAMPAIGN.guildId)) return null;
  let campaign = ensureInviteDecorCampaign(guild.id);
  const logChannel = await ensureInviteAdminLogChannel(guild, campaign);
  campaign = db.prepare('SELECT * FROM invite_campaigns WHERE event_key = ?').get(campaign.event_key);
  const announcementMessage = await ensureInviteCampaignAnnouncement(guild, campaign);
  campaign = db.prepare('SELECT * FROM invite_campaigns WHERE event_key = ?').get(campaign.event_key);
  return { campaign, logChannel, announcementMessage };
}

async function resolveDiscordIdentity(guild, userId) {
  const member = guild.members.cache.get(String(userId))
    || await guild.members.fetch(String(userId)).catch(() => null);
  const user = member?.user
    || guild.client.users.cache.get(String(userId))
    || await guild.client.users.fetch(String(userId)).catch(() => null);
  if (!user) return `**Không lấy được hồ sơ Discord** · ID \`${userId}\``;
  const displayName = safeDisplay(member?.displayName || user.globalName || user.username);
  const username = String(user.username || '').replaceAll('`', "'").slice(0, 32);
  return `**${displayName}**${username ? ` · \`@${username}\`` : ''} · ID \`${userId}\``;
}

function buildWinnerUserPayload(campaign, announcementUrl) {
  const E = createEmojiResolver(campaign.guild_id);
  const container = new ContainerBuilder().setAccentColor(0x22C55E);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('icon_trophy')} CHÚC MỪNG · BẠN ĐÃ ĐỦ ĐIỀU KIỆN!`,
    `> Hệ thống đã xác minh đủ **${campaign.required_valid_invites}/${campaign.required_valid_invites} người mời hợp lệ** và báo cho Admin Cenar Store 1.`,
  ].join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `${E('icon_gift')} **Phần thưởng:** ${campaign.reward_name}`,
    `${E('payment_money')} **Giá trị:** ${formatMoney(campaign.reward_value)}`,
    `${E('status_check')} Admin sẽ đối soát lần cuối và liên hệ để trao Decor.`,
    `-# Nếu cần chủ động nhận thưởng, hãy mở ticket và gửi ảnh lệnh /invcheck của bạn.`,
  ].join('\n')));
  const components = [container];
  if (announcementUrl) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Xem event').setURL(announcementUrl),
    ));
  }
  return { components, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

function buildWinnerAdminPayload({ campaign, inviterIdentity, inviteLabels, roleIds, notificationMethod, announcementUrl }) {
  const E = createEmojiResolver(campaign.guild_id);
  const mentions = roleIds.map((id) => `<@&${id}>`).join(' ');
  const container = new ContainerBuilder().setAccentColor(0x22C55E);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('icon_trophy')} NGƯỜI ĐỦ ĐIỀU KIỆN · EVENT INVITE`,
    mentions || null,
    `> Cần ưu tiên đối soát và trao **${campaign.reward_name}** trị giá **${formatMoney(campaign.reward_value)}**.`,
  ].filter(Boolean).join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `${E('ticket_user')} **Người nhận:** ${inviterIdentity}`,
    `${E('status_check')} **Tiến độ:** ${campaign.required_valid_invites}/${campaign.required_valid_invites} lượt hợp lệ`,
    `${E('icon_announce')} **Đã báo người nhận qua:** ${notificationMethod === 'DM'
      ? 'Tin nhắn riêng (DM)'
      : (notificationMethod === 'PUBLIC' ? 'Thông báo công khai trong kênh event' : 'Chưa gửi được · Admin cần chủ động liên hệ')}`,
    `${E('icon_group')} **Danh sách được tính:**`,
    ...inviteLabels.map((label, index) => `> **${index + 1}.** ${label}`),
  ].join('\n')));
  const components = [container];
  if (announcementUrl) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Mở bài event').setURL(announcementUrl),
    ));
  }
  return {
    components,
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [], roles: roleIds },
  };
}

async function notifyEligibleReward(client, guild, campaign, reward) {
  const announcementUrl = campaign.announcement_message_id
    ? `https://discord.com/channels/${guild.id}/${campaign.announcement_channel_id}/${campaign.announcement_message_id}`
    : null;
  let current = reward;
  let lastError = null;
  if (!current.user_notified_at && Number(current.notification_attempts || 0) < 5) {
    const user = await client.users.fetch(current.inviter_id).catch(() => null);
    let notificationMethod = null;
    if (user) {
      const dm = await user.send(buildWinnerUserPayload(campaign, announcementUrl)).catch((error) => {
        lastError = `DM: ${error.message}`;
        return null;
      });
      if (dm) notificationMethod = 'DM';
    }
    if (!notificationMethod) {
      const channel = await guild.channels.fetch(campaign.announcement_channel_id).catch(() => null);
      if (channel?.isTextBased()) {
        const publicNotice = await channel.send({
          content: `<:cenar_sale_gift:1534852792295100436> <@${current.inviter_id}> bạn đã đủ **${campaign.required_valid_invites}/${campaign.required_valid_invites}** lượt hợp lệ và nhận **${campaign.reward_name}**! Admin đã được thông báo để trao giải.`,
          allowedMentions: { parse: [], users: [current.inviter_id] },
        }).catch((error) => {
          lastError = `${lastError ? `${lastError}; ` : ''}Public: ${error.message}`;
          return null;
        });
        if (publicNotice) notificationMethod = 'PUBLIC';
      }
    }
    const timestamp = nowIso();
    db.prepare(`
      UPDATE invite_campaign_rewards
      SET user_notified_at = CASE WHEN ? IS NOT NULL THEN ? ELSE user_notified_at END,
          notification_method = COALESCE(?, notification_method),
          notification_attempts = notification_attempts + 1,
          last_notification_error = ?, updated_at = ?
      WHERE id = ?
    `).run(notificationMethod, timestamp, notificationMethod, lastError, timestamp, current.id);
    current = db.prepare('SELECT * FROM invite_campaign_rewards WHERE id = ?').get(current.id);
  }

  if (!current.admin_notified_at) {
    const logChannel = await ensureInviteAdminLogChannel(guild, campaign).catch((error) => {
      lastError = `${lastError ? `${lastError}; ` : ''}Admin log: ${error.message}`;
      return null;
    });
    if (logChannel?.isTextBased()) {
      const inviterIdentity = await resolveDiscordIdentity(guild, current.inviter_id);
      const inviteRows = db.prepare(`
        SELECT invited_id FROM invite_campaign_entries
        WHERE event_key = ? AND guild_id = ? AND inviter_id = ? AND status = 'VALID'
        ORDER BY datetime(validated_at) ASC LIMIT ?
      `).all(campaign.event_key, guild.id, current.inviter_id, campaign.required_valid_invites);
      const inviteLabels = await Promise.all(inviteRows.map((row) => resolveDiscordIdentity(guild, row.invited_id)));
      const guildConfig = getGuildConfig(guild.id);
      const roleIds = [...new Set([guildConfig?.manager_role_id, ...config.ownerRoleIds]
        .filter((id) => id && guild.roles.cache.has(String(id)))
        .map(String))];
      const adminMessage = await logChannel.send(buildWinnerAdminPayload({
        campaign,
        inviterIdentity,
        inviteLabels,
        roleIds,
        notificationMethod: current.notification_method,
        announcementUrl,
      })).catch((error) => {
        lastError = `${lastError ? `${lastError}; ` : ''}Admin send: ${error.message}`;
        return null;
      });
      if (adminMessage) {
        const timestamp = nowIso();
        db.prepare(`
          UPDATE invite_campaign_rewards
          SET admin_notified_at = ?, admin_message_id = ?, last_notification_error = ?, updated_at = ?
          WHERE id = ?
        `).run(timestamp, adminMessage.id, lastError, timestamp, current.id);
      }
    }
  }
}

export async function processInviteDecorCampaign(client, now = new Date()) {
  const guild = client?.guilds?.cache?.get(INVITE_DECOR_CAMPAIGN.guildId)
    || await client?.guilds?.fetch?.(INVITE_DECOR_CAMPAIGN.guildId).catch(() => null);
  if (!guild) return { validated: 0, left: 0, rewards: 0, skipped: true };
  const campaign = ensureInviteDecorCampaign(guild.id);
  if (!campaign) return { validated: 0, left: 0, rewards: 0, skipped: true };
  const nowValue = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const dueEntries = db.prepare(`
    SELECT * FROM invite_campaign_entries
    WHERE event_key = ? AND guild_id = ? AND status = 'PENDING'
      AND datetime(qualifies_at) <= datetime(?)
    ORDER BY datetime(qualifies_at) ASC LIMIT 100
  `).all(campaign.event_key, guild.id, nowValue);
  let validated = 0;
  let left = 0;
  for (const entry of dueEntries) {
    const member = guild.members.cache.get(entry.invited_id)
      || await guild.members.fetch(entry.invited_id).catch(() => null);
    const timestamp = nowIso();
    if (!member) {
      db.prepare(`
        UPDATE invite_campaign_entries
        SET status = 'LEFT', disqualify_reason = 'Không còn trong Store 1 tại mốc xác minh 48 giờ.',
            left_at = ?, updated_at = ? WHERE id = ? AND status = 'PENDING'
      `).run(timestamp, timestamp, entry.id);
      left += 1;
      continue;
    }
    const recordedJoinMs = Date.parse(entry.joined_at);
    if (member.joinedTimestamp && member.joinedTimestamp - recordedJoinMs > 5 * 60_000) {
      db.prepare(`
        UPDATE invite_campaign_entries
        SET status = 'REJECTED_REJOIN', disqualify_reason = 'Đã rời và tham gia lại trong thời gian chờ.',
            updated_at = ? WHERE id = ? AND status = 'PENDING'
      `).run(timestamp, entry.id);
      continue;
    }
    const result = db.prepare(`
      UPDATE invite_campaign_entries
      SET status = 'VALID', validated_at = ?, updated_at = ?
      WHERE id = ? AND status = 'PENDING'
    `).run(timestamp, timestamp, entry.id);
    validated += result.changes;
  }

  const eligible = db.prepare(`
    SELECT inviter_id, COUNT(*) AS valid_count
    FROM invite_campaign_entries
    WHERE event_key = ? AND guild_id = ? AND status = 'VALID' AND inviter_id IS NOT NULL
    GROUP BY inviter_id
    HAVING COUNT(*) >= ?
  `).all(campaign.event_key, guild.id, campaign.required_valid_invites);
  for (const row of eligible) {
    const timestamp = nowIso();
    db.prepare(`
      INSERT INTO invite_campaign_rewards (
        event_key, guild_id, inviter_id, valid_invites, status, eligible_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'ELIGIBLE', ?, ?, ?)
      ON CONFLICT(event_key, guild_id, inviter_id) DO UPDATE SET
        valid_invites = MAX(invite_campaign_rewards.valid_invites, excluded.valid_invites),
        updated_at = excluded.updated_at
    `).run(campaign.event_key, guild.id, row.inviter_id, Number(row.valid_count), timestamp, timestamp, timestamp);
  }

  const rewards = db.prepare(`
    SELECT * FROM invite_campaign_rewards
    WHERE event_key = ? AND guild_id = ?
      AND (admin_notified_at IS NULL OR (user_notified_at IS NULL AND notification_attempts < 5))
    ORDER BY id ASC LIMIT 20
  `).all(campaign.event_key, guild.id);
  const refreshedCampaign = db.prepare('SELECT * FROM invite_campaigns WHERE event_key = ?').get(campaign.event_key);
  for (const reward of rewards) {
    await notifyEligibleReward(client, guild, refreshedCampaign, reward).catch((error) => {
      console.error(`[INVITE-EVENT] Notify ${reward.inviter_id} failed:`, error.message);
    });
  }

  const pendingCount = db.prepare(`
    SELECT COUNT(*) AS count FROM invite_campaign_entries
    WHERE event_key = ? AND guild_id = ? AND status = 'PENDING'
  `).get(campaign.event_key, guild.id)?.count || 0;
  if (Date.parse(nowValue) > Date.parse(campaign.ends_at) && Number(pendingCount) === 0 && campaign.status !== 'ENDED') {
    db.prepare('UPDATE invite_campaigns SET status = ?, updated_at = ? WHERE event_key = ?')
      .run('ENDED', nowIso(), campaign.event_key);
  }
  return { validated, left, rewards: rewards.length, skipped: false };
}

export const inviteCampaignInternals = {
  TERMINAL_REJECTED_STATUSES,
  addHoursIso,
  deriveCampaignPhase,
  toUnix,
};
