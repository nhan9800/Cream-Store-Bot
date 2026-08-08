import {
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import {
  consumePartnerMentionQuota,
  getPartnerMentionQuota,
  getPartnerSettings,
  rollbackPartnerMentionQuota,
} from '../services/partnerService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { accentFor, stripDiscordUnicode } from '../utils/uiKit.js';

export const data = new SlashCommandBuilder()
  .setName('partner-post')
  .setDescription('Đăng bài vào khu Partner bằng hệ thống mention có hạn mức.')
  .addSubcommand((sub) => sub
    .setName('send')
    .setDescription('Đăng bài truyền thông Partner.')
    .addStringOption((option) => option
      .setName('ping')
      .setDescription('Đối tượng nhận thông báo')
      .setRequired(true)
      .addChoices(
        { name: 'Role Partner · tối đa 2 lần/24h', value: 'partner' },
        { name: 'Everyone · tối đa 1 lần/24h', value: 'everyone' },
      ))
    .addStringOption((option) => option
      .setName('noi_dung')
      .setDescription('Nội dung quảng bá hoặc thông báo')
      .setRequired(true)
      .setMinLength(10)
      .setMaxLength(1800)))
  .addSubcommand((sub) => sub
    .setName('quota')
    .setDescription('Xem số lượt mention còn lại và thời điểm làm mới.'));

function quotaLines(E, quota) {
  return [
    `${E('cenar_partner')} Role Partner còn **${quota.partnerRemaining}/2** lượt`,
    `${E('cenar_announce')} Everyone còn **${quota.everyoneRemaining}/1** lượt`,
    `${E('cenar_cooldown')} Làm mới <t:${Math.floor(quota.resetAt / 1000)}:R>`,
  ];
}

function responsePayload(guildId, tone, title, lines) {
  const E = createEmojiResolver(guildId);
  const icon = tone === 'danger' ? E('status_cross') : tone === 'warning' ? E('cenar_cooldown') : E('cenar_verified');
  const container = new ContainerBuilder().setAccentColor(accentFor(tone));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${icon} ${title}`));
  if (lines?.length) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  }
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}

function broadcastPayload(guildId, authorId, roleId, pingType, content) {
  const E = createEmojiResolver(guildId);
  const ping = pingType === 'everyone' ? '@everyone' : `<@&${roleId}>`;
  const container = new ContainerBuilder().setAccentColor(accentFor('primary'));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('cenar_announce')} Partner Broadcast`,
    `${ping}`,
  ].join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(stripDiscordUnicode(content)));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `-# ${E('cenar_partner_ok')} Đại diện đăng bài: <@${authorId}> · Cenar Partner`,
  ));

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: pingType === 'everyone'
      ? { parse: ['everyone'] }
      : { parse: [], roles: [roleId] },
  };
}

async function sendUsageLog(interaction, settings, pingType, quota, messageUrl) {
  const channel = settings.approve_channel_id
    ? await interaction.guild.channels.fetch(settings.approve_channel_id).catch(() => null)
    : null;
  if (!channel?.isTextBased()) return;
  const E = createEmojiResolver(interaction.guildId);
  const container = new ContainerBuilder().setAccentColor(accentFor('info'));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${E('cenar_announce')} Log Partner Broadcast`,
    `${E('cenar_verified')} Người đăng: <@${interaction.user.id}>`,
    `${E('cenar_partner')} Loại ping: **${pingType === 'everyone' ? 'Everyone' : 'Role Partner'}**`,
    `${E('cenar_cooldown')} Còn lại: Partner ${quota.partnerRemaining}/2 · Everyone ${quota.everyoneRemaining}/1`,
    `${E('cenar_support')} [Mở bài đăng](${messageUrl})`,
  ].join('\n')));
  await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}

export async function execute(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  const settings = getPartnerSettings(interaction.guildId);
  const member = interaction.member;
  const isAdmin = member.permissions?.has(PermissionFlagsBits.ManageGuild);
  const isPartner = Boolean(settings.partner_role_id && member.roles?.cache?.has(settings.partner_role_id));
  if (!isPartner && !isAdmin) {
    return interaction.reply(responsePayload(interaction.guildId, 'danger', 'Không có quyền Partner', [
      `${E('cenar_partner')} Lệnh này chỉ dành cho đại diện đã được cấp role Partner.`,
    ]));
  }

  if (interaction.options.getSubcommand() === 'quota') {
    const quota = getPartnerMentionQuota(interaction.guildId, interaction.user.id);
    return interaction.reply(responsePayload(interaction.guildId, 'info', 'Hạn mức Partner của bạn', quotaLines(E, quota)));
  }

  const channel = settings.partner_channel_id
    ? await interaction.guild.channels.fetch(settings.partner_channel_id).catch(() => null)
    : null;
  if (!channel?.isTextBased()) {
    return interaction.reply(responsePayload(interaction.guildId, 'danger', 'Kênh Partner chưa sẵn sàng', [
      `${E('cenar_support')} Vui lòng báo admin chạy lại thiết lập Partner.`,
    ]));
  }

  const pingType = interaction.options.getString('ping', true);
  const usage = pingType === 'everyone' ? { everyoneMentions: 1 } : { partnerMentions: 1 };
  const quota = isAdmin
    ? { allowed: true, ...getPartnerMentionQuota(interaction.guildId, interaction.user.id) }
    : consumePartnerMentionQuota(interaction.guildId, interaction.user.id, usage);
  if (!quota.allowed) {
    return interaction.reply(responsePayload(interaction.guildId, 'warning', 'Đã hết lượt mention', quotaLines(E, quota)));
  }

  await interaction.reply(responsePayload(interaction.guildId, 'warning', 'Đang đăng bài Partner', [
    `${E('cenar_cooldown')} Bot đang kiểm tra quyền và gửi bài vào <#${channel.id}>.`,
  ]));

  try {
    const post = await channel.send(broadcastPayload(
      interaction.guildId,
      interaction.user.id,
      settings.partner_role_id,
      pingType,
      interaction.options.getString('noi_dung', true),
    ));
    await sendUsageLog(interaction, settings, pingType, quota, post.url).catch(() => null);
    await interaction.editReply(responsePayload(interaction.guildId, 'success', 'Đã đăng bài Partner', [
      `${E('cenar_verified')} [Mở bài đăng](${post.url})`,
      ...quotaLines(E, quota),
    ]));
  } catch (error) {
    if (!isAdmin) rollbackPartnerMentionQuota(interaction.guildId, interaction.user.id, usage);
    await interaction.editReply(responsePayload(interaction.guildId, 'danger', 'Không thể đăng bài Partner', [
      `${E('status_cross')} ${error.message}`,
      `${E('cenar_verified')} Lượt mention chưa bị trừ.`,
    ]));
  }
}
