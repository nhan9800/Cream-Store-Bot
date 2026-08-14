import {
  Events, ChannelType,
  ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder,
  MediaGalleryBuilder, MediaGalleryItemBuilder,
  SeparatorBuilder, SeparatorSpacingSize, MessageFlags,
} from 'discord.js';
import { config } from '../config.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { markInviteCampaignMemberLeft } from '../services/inviteCampaignService.js';

export const name = Events.GuildMemberRemove;
export const once = false;

const SERVER1_ID = '1282637033340403754';
const GOODBYE_BANNER = 'https://i.pinimg.com/originals/6e/d3/35/6ed335a6e5b40c9e346d09d24cf1668f.gif';

export async function execute(member) {
  try {
    const guild       = member.guild;
    const user        = member.user;
    const memberCount = guild.memberCount;
    const isServer1   = guild.id === SERVER1_ID;
    const brandName   = config.storeName || 'Cenar Store';
    const E           = createEmojiResolver(guild.id);

    // Event invite chỉ công nhận thành viên ở liên tục đủ 48 giờ. Ghi trạng
    // thái LEFT trước mọi early-return của giao diện tạm biệt.
    const inviteLeave = markInviteCampaignMemberLeft(member);
    if (inviteLeave.changed) {
      console.log(`[INVITE-EVENT] ${user.tag} left before the 48-hour validation point.`);
    }

    const goodbyeChannel = guild.channels.cache.find(
      c => c.type === ChannelType.GuildText && c.name.includes('tạm-biệt')
    );
    if (!goodbyeChannel) return;

    const hadVipRole = member.roles?.cache?.some(r =>
      r.name.includes('Ruby') || r.name.includes('Diamond') ||
      r.name.includes('Elite VIP') || r.name.includes('VIP')
    );
    const hadVerifiedRole = member.roles?.cache?.some(r =>
      r.name.includes('Explorer') || r.name.includes('Active Customer') ||
      r.name.includes('Thành Viên') || r.name.includes('VIP') ||
      r.name.includes('Khách Mua Hàng')
    );

    const joinedDaysAgo = member.joinedAt
      ? Math.floor((Date.now() - member.joinedAt.getTime()) / 86400000)
      : 0;

    const roleName = hadVipRole
      ? 'Thành Viên VIP'
      : hadVerifiedRole
        ? 'Thành Viên Đã Xác Minh'
        : 'Thành Viên Mới';

    const lines = [
      `### <a:tsm_fire:1327553120842158111> **TẠM BIỆT THÀNH VIÊN!**`,
      `**${user.tag}** đã rời máy chủ. Hy vọng sẽ được gặp lại bạn vào một ngày gần nhất!`,
      '',
      `<a:Arrow2:1367139234833498113> **Thông tin thành viên:**`,
      `> <a:Dotyellow:1481134440725090315> **Số lượng còn lại:** \`${memberCount.toLocaleString('vi-VN')} thành viên\``,
      `> <a:Dotyellow:1481134440725090315> **Đã gắn bó cùng shop:** \`${joinedDaysAgo} ngày\``,
      `> <a:Dotyellow:1481134440725090315> **Vai trò:** \`${roleName}\``,
      '',
      `---`,
      `-# <:purple_heart_glow:1327541911749263360> *Hẹn gặp lại bạn ở những hành trình tiếp theo!*`
    ].filter(Boolean);

    const container = new ContainerBuilder().setAccentColor(isServer1 ? 0x6366F1 : 0xF472B6);
    const avatar = user.displayAvatarURL({ forceStatic: false, size: 256 });

    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar))
    );

    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(GOODBYE_BANNER))
    );

    await goodbyeChannel.send({ components: [container], flags: MessageFlags.IsComponentsV2 })
      .catch(e => console.error('[GOODBYE] Thất bại:', e.message));

  } catch (error) {
    console.error('[GOODBYE] Lỗi xử lý guildMemberRemove:', error);
  }
}
