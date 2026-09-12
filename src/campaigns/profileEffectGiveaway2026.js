import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import { db } from '../database/db.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { GIVEAWAY_PROOF, ensureGiveawayProofChannel } from '../services/giveawayProofService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bannerPath = path.resolve(__dirname, '../../assets/campaigns/daily-color-2026/profile-effect-giveaway-66k.png');

export const PROFILE_EFFECT_GIVEAWAY = Object.freeze({
  guildId: '1282637033340403754',
  channelId: '1531206050383134842',
  memberRoleId: '1282638730812854345',
  marker: 'CENAR-PROFILE-EFFECT-GIVEAWAY-66K-2026-09',
  prize: '01 Hiệu ứng hồ sơ Discord trị giá 66.000đ',
  winnersCount: 1,
  durationMs: 7 * 24 * 60 * 60 * 1000,
  attachmentName: 'cenar-profile-effect-giveaway-66k.png',
});

function asUnix(value) {
  return Math.floor(new Date(value).getTime() / 1000);
}

function messageComponentText(message) {
  try {
    return JSON.stringify((message?.components || []).map((component) => (
      typeof component?.toJSON === 'function' ? component.toJSON() : component
    )));
  } catch {
    return '';
  }
}

export function buildProfileEffectGiveawayPayload({
  guildId = PROFILE_EFFECT_GIVEAWAY.guildId,
  hostUserId,
  proofChannelId,
  endTime,
} = {}) {
  if (!hostUserId || !proofChannelId || !endTime) {
    throw new Error('Thiếu hostUserId, proofChannelId hoặc endTime cho giveaway.');
  }
  const E = createEmojiResolver(guildId);
  const endUnix = asUnix(endTime);
  const container = new ContainerBuilder().setAccentColor(0xF9736B);

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('icon_gift')} GIVEAWAY · HIỆU ỨNG HỒ SƠ DISCORD`,
    '> Quà xịn cho profile nổi bật hơn — hoàn thành req, gửi ảnh xác nhận và nhấn nút tham gia.',
    `-# ${PROFILE_EFFECT_GIVEAWAY.marker}`,
  ].join('\n')));
  container.addMediaGalleryComponents(
    new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL(`attachment://${PROFILE_EFFECT_GIVEAWAY.attachmentName}`),
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${E('icon_trophy')} PHẦN THƯỞNG`,
    `${E('icon_gift')} **${PROFILE_EFFECT_GIVEAWAY.prize}**`,
    `${E('icon_group')} **Số người thắng:** ${PROFILE_EFFECT_GIVEAWAY.winnersCount}`,
    `${E('icon_clock')} **Kết thúc:** <t:${endUnix}:F> · <t:${endUnix}:R>`,
    `${E('icon_crown')} **Tổ chức:** <@${hostUserId}>`,
  ].join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${E('status_check')} YÊU CẦU THAM GIA`,
    `${E('icon_link')} Đặt bio có link shop theo mẫu:`,
    `> \`${GIVEAWAY_PROOF.requiredBio}\``,
    `${E('icon_clock')} Giữ nguyên link shop và bio **trong suốt 07 ngày diễn ra giveaway**.`,
    `${E('icon_art')} Gửi ảnh chụp hồ sơ + bio tại <#${proofChannelId}>.`,
    `${E('icon_sparkle')} Sau đó nhấn **Tham Gia Giveaway** bên dưới.`,
    `-# Staff sẽ đối soát req trước khi công nhận kết quả; reaction bot chỉ xác nhận đã nhận ảnh.`,
  ].join('\n')));

  const button = new ButtonBuilder()
    .setCustomId('giveaway:join')
    .setLabel('Tham Gia Giveaway')
    .setStyle(ButtonStyle.Success);
  const emoji = E.component('icon_gift');
  if (emoji) button.setEmoji(emoji);
  container.addActionRowComponents(new ActionRowBuilder().addComponents(button));

  return {
    components: [container],
    files: [{ attachment: bannerPath, name: PROFILE_EFFECT_GIVEAWAY.attachmentName }],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export async function publishProfileEffectGiveaway(client) {
  if (!fs.existsSync(bannerPath)) throw new Error(`Thiếu banner giveaway: ${bannerPath}`);
  const guild = client.guilds.cache.get(PROFILE_EFFECT_GIVEAWAY.guildId)
    || await client.guilds.fetch(PROFILE_EFFECT_GIVEAWAY.guildId);
  await Promise.all([guild.channels.fetch(), guild.roles.fetch()]);
  const channel = await guild.channels.fetch(PROFILE_EFFECT_GIVEAWAY.channelId);
  if (!channel?.isTextBased?.() || channel.isThread?.() || !channel.messages) {
    throw new Error('Kênh sự kiện không hợp lệ hoặc không thể gửi tin nhắn.');
  }
  const me = guild.members.me || await guild.members.fetchMe();
  const required = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks,
  ];
  if (!channel.permissionsFor(me)?.has(required)) {
    throw new Error('Bot thiếu quyền gửi giveaway hoặc đính kèm banner tại kênh sự kiện.');
  }

  const { channel: proofChannel } = await ensureGiveawayProofChannel(guild);
  const recent = await channel.messages.fetch({ limit: 100 });
  const existing = [...recent.values()].find((message) => (
    message.author?.id === client.user.id
    && messageComponentText(message).includes(PROFILE_EFFECT_GIVEAWAY.marker)
  ));
  if (existing) {
    const row = db.prepare('SELECT status, end_time FROM giveaways WHERE message_id = ?').get(existing.id);
    if (row?.status === 'ACTIVE') {
      return {
        action: 'reused',
        messageId: existing.id,
        url: `https://discord.com/channels/${guild.id}/${channel.id}/${existing.id}`,
        proofChannelId: proofChannel.id,
        endTime: row.end_time,
      };
    }
    if (row) {
      return {
        action: 'completed',
        status: row.status,
        messageId: existing.id,
        url: `https://discord.com/channels/${guild.id}/${channel.id}/${existing.id}`,
        proofChannelId: proofChannel.id,
        endTime: row.end_time,
      };
    }
  }

  const host = await guild.fetchOwner();
  const endTime = new Date(Date.now() + PROFILE_EFFECT_GIVEAWAY.durationMs);
  const payload = buildProfileEffectGiveawayPayload({
    guildId: guild.id,
    hostUserId: host.id,
    proofChannelId: proofChannel.id,
    endTime,
  });
  const message = await channel.send(payload);
  db.prepare(`
    INSERT INTO giveaways (message_id, channel_id, guild_id, host_id, prize, winners_count, end_time, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
  `).run(
    message.id,
    channel.id,
    guild.id,
    host.id,
    PROFILE_EFFECT_GIVEAWAY.prize,
    PROFILE_EFFECT_GIVEAWAY.winnersCount,
    endTime.toISOString(),
  );
  if (!message.pinned) await message.pin('Ghim giveaway hiệu ứng hồ sơ Discord 66K').catch(() => null);
  return {
    action: 'created',
    messageId: message.id,
    url: `https://discord.com/channels/${guild.id}/${channel.id}/${message.id}`,
    proofChannelId: proofChannel.id,
    endTime: endTime.toISOString(),
  };
}
