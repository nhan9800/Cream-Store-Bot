import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Events,
  ChannelType,
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} from 'discord.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { markInviteCampaignMemberLeft } from '../services/inviteCampaignService.js';

export const name = Events.GuildMemberRemove;
export const once = false;

const SERVER1_ID = '1282637033340403754';
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const GOODBYE_ATTACHMENT_NAME = 'cenar-farewell-portal-v2.png';
const GOODBYE_ASSET = path.resolve(MODULE_DIR, '../../assets/farewell', GOODBYE_ATTACHMENT_NAME);

function companionshipLabel(joinedDays) {
  const safeDays = Math.max(0, Number(joinedDays) || 0);
  return safeDays < 1 ? 'Dưới 1 ngày' : `${safeDays.toLocaleString('vi-VN')} ngày`;
}

export function buildGoodbyeV2({
  guildId,
  userId,
  displayName,
  avatarUrl,
  joinedDays = 0,
  bannerUrl = null,
}) {
  const E = createEmojiResolver(guildId);
  const container = new ContainerBuilder().setAccentColor(
    String(guildId) === SERVER1_ID ? 0x8B5CF6 : 0xF472B6,
  );

  const header = [
    `## ${E('icon_heart_purple')} Tạm biệt, ${displayName}`,
    `> Cảm ơn <@${userId}> đã đồng hành cùng **Cenar Store** trong **${companionshipLabel(joinedDays)}**.`,
    `-# ${E('icon_sparkle')} Cánh cửa Cenar luôn mở — hẹn gặp lại ở một hành trình đẹp hơn.`,
  ].join('\n');

  const section = new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(header));
  if (avatarUrl) section.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl));
  container.addSectionComponents(section);

  if (bannerUrl) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small),
    );
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(bannerUrl),
      ),
    );
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export async function execute(member) {
  try {
    const guild = member.guild;
    const user = member.user;

    // Event invite chỉ công nhận thành viên ở liên tục đủ 48 giờ.
    const inviteLeave = markInviteCampaignMemberLeft(member);
    if (inviteLeave.changed) {
      console.log(`[INVITE-EVENT] ${user.tag} left before the 48-hour validation point.`);
    }

    const goodbyeChannel = guild.channels.cache.find(
      (channel) => channel.type === ChannelType.GuildText && channel.name.includes('tạm-biệt'),
    );
    if (!goodbyeChannel) return;

    const joinedDays = member.joinedAt
      ? Math.floor((Date.now() - member.joinedAt.getTime()) / 86_400_000)
      : 0;
    const avatarUrl = user.displayAvatarURL({ forceStatic: false, size: 256 });
    const displayName = user.globalName || user.username || user.tag;
    const hasLocalBanner = fs.existsSync(GOODBYE_ASSET);
    const payload = buildGoodbyeV2({
      guildId: guild.id,
      userId: user.id,
      displayName,
      avatarUrl,
      joinedDays,
      bannerUrl: hasLocalBanner
        ? `attachment://${GOODBYE_ATTACHMENT_NAME}`
        : null,
    });

    await goodbyeChannel.send({
      ...payload,
      files: hasLocalBanner
        ? [{ attachment: GOODBYE_ASSET, name: GOODBYE_ATTACHMENT_NAME }]
        : [],
    }).catch((error) => console.error('[GOODBYE] Thất bại:', error.message));
  } catch (error) {
    console.error('[GOODBYE] Lỗi xử lý guildMemberRemove:', error);
  }
}
