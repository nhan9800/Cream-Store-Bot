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
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';
import { publishPriceBoard } from './autoSetupPriceBoardService.js';

const SNOWFLAKE_RE = /^\d{17,20}$/;
const ANNOUNCEMENT_IMAGE_TTL_MS = 10 * 60 * 1000;
const IMAGE_EXT_RE = /\.(?:png|jpe?g|webp|gif)$/i;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const announcementDraftImages = new Map();

function announcementDraftKey(interaction) {
  return [interaction?.guildId, interaction?.channelId, interaction?.user?.id].map(String).join(':');
}

function safeImageName(name, id = Date.now()) {
  const raw = String(name || 'announcement-image.png').trim();
  const extension = raw.match(IMAGE_EXT_RE)?.[0]?.toLowerCase() || '.png';
  const stem = raw.slice(0, raw.length - extension.length)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'announcement-image';
  return `${stem}-${String(id).slice(-8)}${extension}`;
}

export function normalizeAnnouncementImage(attachment) {
  if (!attachment) return null;

  const url = String(attachment.url || '').trim();
  const contentType = String(attachment.contentType || '').split(';')[0].trim().toLowerCase();
  const name = String(attachment.name || '').trim();
  const sourceName = String(attachment.sourceName || name).trim();
  const supported = contentType ? ALLOWED_IMAGE_TYPES.has(contentType) : IMAGE_EXT_RE.test(sourceName);

  if (!url.startsWith('https://') || !supported) {
    throw new Error('Ảnh thông báo phải là file PNG, JPG, WEBP hoặc GIF hợp lệ.');
  }

  return {
    id: String(attachment.id || Date.now()),
    url,
    name: safeImageName(sourceName, attachment.id),
    sourceName,
    contentType: contentType || null,
    size: Number(attachment.size || 0),
  };
}

export function setAnnouncementDraftImage(interaction, attachment) {
  const image = normalizeAnnouncementImage(attachment);
  const key = announcementDraftKey(interaction);
  announcementDraftImages.set(key, image);
  const timer = setTimeout(() => {
    if (announcementDraftImages.get(key) === image) announcementDraftImages.delete(key);
  }, ANNOUNCEMENT_IMAGE_TTL_MS);
  timer.unref?.();
  return image;
}

export function clearAnnouncementDraftImage(interaction) {
  announcementDraftImages.delete(announcementDraftKey(interaction));
}

export function consumeAnnouncementDraftImage(interaction) {
  const key = announcementDraftKey(interaction);
  const image = announcementDraftImages.get(key) || null;
  announcementDraftImages.delete(key);
  return image;
}

export function isPriceRelatedAnnouncement(content) {
  const normalized = String(content || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\btham\s+gia\b/g, ' ');

  return /\b(?:gia|pricing|price|khuyen\s*mai)\b/.test(normalized)
    || /\b\d{1,3}(?:[.,]\d{3})*\s*(?:k|nghin|vnd|d)\b/.test(normalized);
}

async function refreshPricingAnnouncementBoard(guild, content, announcementMessageId) {
  if (!isPriceRelatedAnnouncement(content)) return null;

  try {
    return await publishPriceBoard(guild, {
      force: true,
      keepMessageIds: announcementMessageId ? [announcementMessageId] : [],
    });
  } catch (error) {
    console.error('[ANNOUNCEMENT] Đã đăng thông báo nhưng không thể làm mới bảng giá:', {
      guildId: guild.id,
      message: error?.message,
      stack: error?.stack,
    });
    return { guildId: guild.id, status: 'error', error: error.message };
  }
}

function normalizeRoleIds(roleIds) {
  return [...new Set((roleIds || []).map(String).filter((id) => SNOWFLAKE_RE.test(id)))];
}

export function buildAnnouncementMessageV2({
  guildId,
  content,
  roleIds = [],
  tagEveryone = false,
  tagHere = false,
  image = null,
}) {
  const E = createEmojiResolver(guildId);
  const safeRoleIds = normalizeRoleIds(roleIds);
  const mentionParts = safeRoleIds.map((id) => `<@&${id}>`);
  if (tagEveryone) mentionParts.push('@everyone');
  if (tagHere) mentionParts.push('@here');

  const announceEmoji = E('cenar_announce') || E('icon_announce');
  const adminEmoji = E('cenar_admin') || E('cenar_staff');
  const header = `${announceEmoji ? `${announceEmoji} ` : ''}THÔNG BÁO TỪ BAN QUẢN TRỊ`;
  const footer = `${adminEmoji ? `${adminEmoji} ` : ''}Trân trọng,\n**Ban Quản Trị Hệ Thống**`;
  const normalizedImage = normalizeAnnouncementImage(image);

  const container = new ContainerBuilder()
    .setAccentColor(0x2b2d31)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${mentionParts.length ? `${mentionParts.join(' ')}\n` : ''}# ${header}`,
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(String(content || '').trim()),
    );

  if (normalizedImage) {
    container
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
      )
      .addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder()
            .setURL(`attachment://${normalizedImage.name}`)
            .setDescription('Hình ảnh đính kèm thông báo từ Ban Quản Trị.'),
        ),
      );
  }

  container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(footer));

  const rulesButton = withButtonEmoji(
    new ButtonBuilder()
      .setCustomId('announce_dummy_1')
      .setLabel('Quy Định Chung')
      .setStyle(ButtonStyle.Primary),
    E.component('partner_rules'),
    E.component('icon_store'),
  );

  const warrantyButton = withButtonEmoji(
    new ButtonBuilder()
      .setCustomId('announce_dummy_2')
      .setLabel('Chính Sách Bảo Hành')
      .setStyle(ButtonStyle.Secondary),
    E.component('warranty_shield'),
    E.component('panel_warranty'),
  );

  return {
    components: [
      container,
      new ActionRowBuilder().addComponents(rulesButton, warrantyButton),
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      parse: tagEveryone || tagHere ? ['everyone'] : [],
      roles: safeRoleIds,
      users: [],
      repliedUser: false,
    },
    ...(normalizedImage ? {
      files: [{ attachment: normalizedImage.url, name: normalizedImage.name }],
    } : {}),
  };
}

export async function publishAnnouncement({ guild, channelId, ...messageOptions }) {
  const normalizedImage = normalizeAnnouncementImage(messageOptions.image);
  const channel = await guild.channels.fetch(channelId).catch((error) => {
    throw new Error(`Không thể tải kênh ${channelId}: ${error.message}`, { cause: error });
  });

  if (!channel || typeof channel.send !== 'function' || !channel.isTextBased?.()) {
    throw new Error('Kênh đã chọn không hỗ trợ gửi tin nhắn.');
  }

  const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
  const permissions = botMember ? channel.permissionsFor(botMember) : null;
  const requiredPermission = channel.isThread?.()
    ? PermissionFlagsBits.SendMessagesInThreads
    : PermissionFlagsBits.SendMessages;

  if (permissions && !permissions.has(PermissionFlagsBits.ViewChannel)) {
    throw new Error('Bot không có quyền Xem Kênh tại kênh đăng thông báo.');
  }
  if (permissions && !permissions.has(requiredPermission)) {
    throw new Error('Bot không có quyền Gửi Tin Nhắn tại kênh đăng thông báo.');
  }
  if (normalizedImage && permissions && !permissions.has(PermissionFlagsBits.AttachFiles)) {
    throw new Error('Bot không có quyền Đính Kèm Tệp tại kênh đăng thông báo.');
  }

  const payload = buildAnnouncementMessageV2({
    guildId: guild.id,
    ...messageOptions,
    image: normalizedImage,
  });
  const message = await channel.send(payload);
  if (!message?.id) throw new Error('Discord không trả về tin nhắn sau khi gửi.');

  const priceBoard = await refreshPricingAnnouncementBoard(
    guild,
    messageOptions.content,
    message.id,
  );

  return {
    channel,
    message,
    pricingRelated: priceBoard !== null,
    priceBoard,
  };
}
