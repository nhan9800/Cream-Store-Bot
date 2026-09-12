import {
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';

export const GIVEAWAY_PROOF = Object.freeze({
  guildId: '1282637033340403754',
  memberRoleId: '1282638730812854345',
  eventChannelId: '1531206050383134842',
  channelName: '📸・gửi-req-giveaway',
  panelMarker: 'CENAR-GIVEAWAY-PROOF-2026-09',
  inviteUrl: 'https://discord.gg/cenarstore',
  requiredBio: 'Nicho, Decao, Netflix, Spotify... giá rẻ tại: https://discord.gg/cenarstore',
  reactionEmojiName: 'cenar_daily_gift',
});

function messageComponentText(message) {
  try {
    return JSON.stringify((message?.components || []).map((component) => (
      typeof component?.toJSON === 'function' ? component.toJSON() : component
    )));
  } catch {
    return '';
  }
}

export function isGiveawayProofChannel(channel) {
  return Boolean(channel)
    && String(channel.guildId || channel.guild?.id || '') === GIVEAWAY_PROOF.guildId
    && channel.name === GIVEAWAY_PROOF.channelName;
}

export function isImageProofMessage(message) {
  if (!isGiveawayProofChannel(message?.channel)) return false;
  return [...(message.attachments?.values?.() || [])].some((attachment) => {
    const contentType = String(attachment?.contentType || '').toLowerCase();
    const name = String(attachment?.name || '').toLowerCase();
    return contentType.startsWith('image/') || /\.(?:png|jpe?g|webp|gif)$/i.test(name);
  });
}

export async function handleGiveawayProofMessage(message) {
  if (!isGiveawayProofChannel(message?.channel)) return false;
  if (!isImageProofMessage(message)) return true;

  const customEmoji = message.guild?.emojis?.cache?.find?.(
    (emoji) => emoji.name === GIVEAWAY_PROOF.reactionEmojiName,
  );
  const E = createEmojiResolver(message.guildId);
  const fallback = E('status_check', '✅');
  const fallbackMatch = String(fallback).match(/:(\d+)>$/);
  const reaction = customEmoji?.id || fallbackMatch?.[1] || '✅';
  await message.react(reaction).catch((error) => {
    console.warn(`[GIVEAWAY-PROOF] Không thể reaction tin ${message.id}:`, error.message);
  });
  return true;
}

export function buildGiveawayProofPanel(guildId = GIVEAWAY_PROOF.guildId) {
  const E = createEmojiResolver(guildId);
  const container = new ContainerBuilder().setAccentColor(0x34D399);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('icon_art')} GỬI REQ GIVEAWAY · DECOR 66K`,
    '> Đây là kênh nhận ảnh xác nhận yêu cầu tham gia. Bot sẽ reaction khi ảnh đã vào hàng chờ kiểm tra.',
    `-# ${GIVEAWAY_PROOF.panelMarker}`,
  ].join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${E('status_check')} ẢNH CẦN THỂ HIỆN`,
    `${E('icon_link')} Bio có link shop, ví dụ:`,
    `> \`${GIVEAWAY_PROOF.requiredBio}\``,
    `${E('icon_clock')} Giữ nguyên link shop và bio này **trong suốt thời gian giveaway**.`,
    `${E('icon_art')} Gửi **01 ảnh chụp đầy đủ hồ sơ + phần bio** trong mỗi tin nhắn.`,
  ].join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `${E('status_info')} Reaction của bot chỉ xác nhận đã nhận ảnh; quyền tham gia hợp lệ được staff đối soát cuối kỳ.`,
    `${E('status_warn')} Che các thông tin riêng tư không liên quan; tuyệt đối không đăng mật khẩu, OTP hoặc mã khôi phục.`,
  ].join('\n')));
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

async function ensureProofPanel(channel, botUserId) {
  const recent = await channel.messages.fetch({ limit: 100 });
  const existing = [...recent.values()].find((message) => (
    message.author?.id === botUserId
    && messageComponentText(message).includes(GIVEAWAY_PROOF.panelMarker)
  ));
  const payload = buildGiveawayProofPanel(channel.guildId);
  const message = existing ? await existing.edit(payload) : await channel.send(payload);
  if (!message.pinned) await message.pin('Ghim hướng dẫn gửi req giveaway').catch(() => null);
  return message;
}

export async function ensureGiveawayProofChannel(guild) {
  if (!guild || guild.id !== GIVEAWAY_PROOF.guildId) {
    throw new Error('Giveaway proof channel chỉ áp dụng cho Cenar Store 1.');
  }
  await Promise.all([guild.channels.fetch(), guild.roles.fetch()]);
  const memberRole = guild.roles.cache.get(GIVEAWAY_PROOF.memberRoleId);
  if (!memberRole) throw new Error(`Không tìm thấy role Cenar Member ${GIVEAWAY_PROOF.memberRoleId}.`);
  const eventChannel = await guild.channels.fetch(GIVEAWAY_PROOF.eventChannelId).catch(() => null);
  if (!eventChannel?.isTextBased?.()) throw new Error('Không tìm thấy kênh sự kiện để đặt kênh req cạnh bên.');

  let channel = guild.channels.cache.find((candidate) => (
    candidate.type === ChannelType.GuildText && candidate.name === GIVEAWAY_PROOF.channelName
  )) || null;
  if (!channel) {
    channel = await guild.channels.create({
      name: GIVEAWAY_PROOF.channelName,
      type: ChannelType.GuildText,
      parent: eventChannel.parentId || undefined,
      topic: 'Gửi ảnh profile/bio có link Cenar Store để xác nhận req giveaway hiệu ứng hồ sơ Discord 66K.',
      rateLimitPerUser: 15,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.SendMessages],
        },
        {
          id: memberRole.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
          ],
        },
        {
          id: guild.client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.AddReactions,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
          ],
        },
      ],
      reason: 'Cenar Store · kênh nhận req giveaway hiệu ứng hồ sơ Discord 66K',
    });
    if (eventChannel.parentId && typeof channel.setPosition === 'function') {
      await channel.setPosition(eventChannel.position + 1).catch(() => null);
    }
  }
  const panel = await ensureProofPanel(channel, guild.client.user.id);
  return { channel, panel };
}
