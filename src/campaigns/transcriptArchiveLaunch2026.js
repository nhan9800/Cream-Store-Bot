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
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';
import { normalizeV2Text } from '../utils/uiKit.js';

export const TRANSCRIPT_ARCHIVE_LAUNCH = Object.freeze({
  guildId: '1282637033340403754',
  announcementChannelId: '1514598369597587546',
  supportChannelId: '1514607020098191393',
  marker: 'CENAR-SECURE-TRANSCRIPT-LAUNCH-2026-09',
  storeUrl: 'https://cenarstore.xyz',
  privacyUrl: 'https://cenarstore.xyz/privacy',
});

const divider = () => new SeparatorBuilder()
  .setDivider(true)
  .setSpacing(SeparatorSpacingSize.Small);

function panel(content, accentColor) {
  return new ContainerBuilder()
    .setAccentColor(accentColor)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(normalizeV2Text(content)),
    );
}

export function buildTranscriptArchiveLaunchSections(
  guildId = TRANSCRIPT_ARCHIVE_LAUNCH.guildId,
  E = createEmojiResolver(guildId),
) {
  const introduction = [
    `# ${E('transcript_web')} CENAR SECURE TRANSCRIPT · XEM LẠI TICKET TRÊN WEBSITE`,
    `> ${E('cenar_announce')} Cenar Store chính thức nâng cấp hệ thống lưu nội dung ticket. Từ nay, khi một ticket được đóng, khách hàng sẽ nhận **liên kết riêng tư** để xem lại toàn bộ cuộc trao đổi ngay trên website.`,
    '',
    `${E('status_check')} Không cần tải file HTML/TXT và không cần thực hiện thêm thao tác nào — Cenar Bot sẽ tự tạo bản lưu và gửi link trực tiếp qua DM.`,
  ].join('\n');

  const experience = [
    `## ${E('icon_sparkle')} TRẢI NGHIỆM MỚI · RÕ RÀNG VÀ DỄ SỬ DỤNG`,
    `${E('icon_search')} **Tìm kiếm nhanh** theo nội dung hoặc người gửi trong ticket.`,
    `${E('icon_doc')} Xem lại **tin nhắn, phản hồi, embed, custom emoji, hình ảnh, video và tệp đính kèm**.`,
    `${E('transcript_web')} Giao diện tối ưu cho **điện thoại lẫn máy tính**, đồng bộ phong cách Cenar Store.`,
    `${E('icon_link')} Có thể **sao chép liên kết** hoặc **in/lưu PDF** khi cần đối soát.`,
  ].join('\n');

  const protection = [
    `## ${E('verify_shield')} LƯU TRỮ AN TOÀN · CÓ KHẢ NĂNG PHỤC HỒI`,
    `${E('recovery_backup')} Dữ liệu được nén bằng **GZIP** để giảm đáng kể dung lượng nhưng vẫn giữ đầy đủ nội dung cần thiết.`,
    `${E('warranty_shield')} Mỗi bản lưu có mã kiểm tra toàn vẹn; hệ thống có thể phát hiện file lỗi và phục hồi từ bản sao dự phòng trên Discord.`,
    `${E('status_check')} Các liên kết transcript cũ vẫn tiếp tục hoạt động. Ticket đóng sau bản cập nhật này sẽ tự động dùng giao diện mới.`,
  ].join('\n');

  const privacy = [
    `## ${E('brand_locket')} LƯU Ý QUYỀN RIÊNG TƯ`,
    `${E('verify_shield')} Transcript không được công cụ tìm kiếm lập chỉ mục và không được lưu cache công khai.`,
    `${E('icon_key')} **Liên kết chính là chìa khóa truy cập.** Chỉ chia sẻ với người bạn tin tưởng và không đăng vào kênh công khai.`,
    `${E('cenar_support')} Nếu không mở được link hoặc cần hỗ trợ đối soát, vui lòng liên hệ tại <#${TRANSCRIPT_ARCHIVE_LAUNCH.supportChannelId}>.`,
    '',
    `${E('icon_heart_purple')} Cảm ơn mọi người đã đồng hành. Bản nâng cấp này giúp Cenar hỗ trợ minh bạch hơn, lưu trữ lâu hơn và giảm rủi ro thất lạc lịch sử ticket.`,
    `-# ${TRANSCRIPT_ARCHIVE_LAUNCH.marker}`,
  ].join('\n');

  return { introduction, experience, protection, privacy };
}

export function buildTranscriptArchiveLaunchMessage({
  guildId = TRANSCRIPT_ARCHIVE_LAUNCH.guildId,
  E = createEmojiResolver(guildId),
} = {}) {
  const sections = buildTranscriptArchiveLaunchSections(guildId, E);
  const supportUrl = `https://discord.com/channels/${guildId}/${TRANSCRIPT_ARCHIVE_LAUNCH.supportChannelId}`;

  const websiteButton = withButtonEmoji(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Mở Cenar Store')
      .setURL(TRANSCRIPT_ARCHIVE_LAUNCH.storeUrl),
    E.component?.('icon_store'),
  );
  const privacyButton = withButtonEmoji(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Chính Sách Bảo Mật')
      .setURL(TRANSCRIPT_ARCHIVE_LAUNCH.privacyUrl),
    E.component?.('verify_shield'),
    E.component?.('warranty_shield'),
  );
  const supportButton = withButtonEmoji(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Kênh Hỗ Trợ')
      .setURL(supportUrl),
    E.component?.('cenar_support'),
    E.component?.('ticket_open'),
  );

  const protectionPanel = panel(sections.protection, 0x5865f2)
    .addSeparatorComponents(divider());

  return {
    components: [
      panel(sections.introduction, 0xff8778),
      panel(sections.experience, 0x76e0b6),
      protectionPanel,
      panel(sections.privacy, 0xf59e0b),
      new ActionRowBuilder().addComponents(websiteButton, privacyButton, supportButton),
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      parse: [],
      roles: [],
      users: [],
      repliedUser: false,
    },
  };
}

export function isTranscriptArchiveLaunchAnnouncement(message, botId) {
  return message?.author?.id === botId
    && JSON.stringify(message.toJSON?.() || message)
      .includes(TRANSCRIPT_ARCHIVE_LAUNCH.marker);
}
