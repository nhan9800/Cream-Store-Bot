import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';

export const YOUTUBE_FAMILY_POLICY_UPDATE = Object.freeze({
  guildId: '1282637033340403754',
  announcementChannelId: '1514598369597587546',
  marker: 'CENAR-YOUTUBE-FAMILY-HOUSEHOLD-POLICY-2026-08',
  screenshotAttachmentName: 'youtube-family-household-policy.png',
  officialPolicyUrl: 'https://support.google.com/youtube/answer/7507744?hl=vi',
  storeUrl: 'https://cenarstore.xyz',
});

export function buildYoutubeFamilyPolicyContent(
  guildId,
  E = createEmojiResolver(guildId),
) {
  return [
    `## ${E('brand_youtube')} CẬP NHẬT QUAN TRỌNG · YOUTUBE PREMIUM FAMILY`,
    '> Cenar Store đang ghi nhận đợt kiểm tra hộ gia đình ảnh hưởng đến một số gói YouTube Family. Shop đã trực tiếp dùng tài khoản chính để kiểm tra khả năng khôi phục bằng phương án cũ và **kết quả hiện tại là không thể khôi phục ổn định**.',
    '',
    `### ${E('icon_search')} THÔNG TIN ĐÃ ĐƯỢC XÁC MINH`,
    `> ${E('status_warn')} Chính sách chính thức yêu cầu mọi thành viên Family phải **cùng địa chỉ cư trú** với người quản lý nhóm.`,
    `> ${E('icon_clock')} YouTube thực hiện **kiểm tra điện tử mỗi 30 ngày** để xác nhận điều kiện này.`,
    `> ${E('icon_location')} Khi hệ thống không xác nhận được cùng hộ gia đình, quyền Premium có thể bị tạm dừng hoặc gói Family có thể bị ảnh hưởng như ảnh đính kèm.`,
    '',
    `-# Lưu ý minh bạch: YouTube không công bố toàn bộ tín hiệu kỹ thuật. Khác IP/vị trí là một rủi ro đáng chú ý, nhưng không nên hiểu rằng YouTube chỉ kiểm tra duy nhất địa chỉ IP.`,
    '',
    `### ${E('cenar_admin')} PHƯƠNG ÁN XỬ LÝ CỦA SHOP`,
    `> ${E('status_check')} **Đang sử dụng ổn định:** tiếp tục dùng bình thường; tuyệt đối không tự rời Family hoặc đổi nhóm.`,
    `> ${E('warranty_shield')} **Đang gặp lỗi:** shop sẽ phân loại và xử lý bảo hành trong tuần này. Chính sách bảo hành của các đơn đủ điều kiện vẫn được giữ nguyên.`,
    `> ${E('status_loading')} Các đơn thuộc nguồn giá rẻ có thể cần thêm thời gian trong giai đoạn chuyển đổi; mong mọi người kiên nhẫn để shop xử lý đúng thứ tự.`,
    `> ${E('status_cross')} Vui lòng không tag hoặc gửi lặp lại từng đơn. Chỉ cần gửi **một yêu cầu** kèm mã đơn và Gmail đã đăng ký để đội ngũ kiểm tra.`,
    '',
    `### ${E('icon_settings')} ĐỊNH HƯỚNG DỊCH VỤ MỚI`,
    '- Shop sẽ dừng dần phương án YouTube giá rẻ thiếu ổn định và chuyển sang nguồn/trick mới có độ bền cao hơn.',
    '- Giá gia hạn trong tương lai có thể tăng nhẹ để đổi lại tính ổn định, thời gian xử lý và chất lượng bảo hành tốt hơn.',
    '- Khách hàng đã mua gói cũ vẫn được tiếp nhận bảo hành theo điều kiện áp dụng; shop không bỏ mặc đơn hàng.',
    '',
    `### ${E('status_info')} KHI NHẬN CẢNH BÁO TỪ YOUTUBE`,
    '1. **Không tự rời nhóm gia đình.**',
    '2. Chụp lại thông báo lỗi và giữ nguyên trạng thái tài khoản.',
    '3. Liên hệ shop một lần, gửi mã đơn + Gmail để được xếp lịch xử lý.',
    '',
    `${E('icon_heart_purple')} Cảm ơn mọi người đã kiên nhẫn. Cenar Store ưu tiên một phương án bền vững và minh bạch hơn thay vì tiếp tục bán rẻ nhưng trải nghiệm thiếu ổn định.`,
    `-# Đối chiếu tài liệu YouTube Help ngày 29/08/2026 · ${YOUTUBE_FAMILY_POLICY_UPDATE.marker}`,
  ].join('\n');
}

export function buildYoutubeFamilyPolicyMessage({
  guildId,
  tagEveryone = true,
  attachmentName = YOUTUBE_FAMILY_POLICY_UPDATE.screenshotAttachmentName,
}) {
  const E = createEmojiResolver(guildId);
  const container = new ContainerBuilder()
    .setAccentColor(0xff0033)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${tagEveryone ? '@everyone\n' : ''}${buildYoutubeFamilyPolicyContent(guildId, E)}`,
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(`attachment://${attachmentName}`)
          .setDescription('Thông báo YouTube về yêu cầu các thành viên Family cùng hộ gia đình.'),
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${E('cenar_verified')} **Cenar Store** · Thông tin rõ ràng · Bảo hành có trách nhiệm · Hỗ trợ theo thứ tự`,
      ),
    );

  const policyButton = withButtonEmoji(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Chính Sách YouTube')
      .setURL(YOUTUBE_FAMILY_POLICY_UPDATE.officialPolicyUrl),
    E.component('brand_youtube'),
    E.component('icon_doc'),
  );
  const storeButton = withButtonEmoji(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Mở Cenar Store')
      .setURL(YOUTUBE_FAMILY_POLICY_UPDATE.storeUrl),
    E.component('icon_store'),
  );

  return {
    components: [
      container,
      new ActionRowBuilder().addComponents(policyButton, storeButton),
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      parse: tagEveryone ? ['everyone'] : [],
      roles: [],
      users: [],
      repliedUser: false,
    },
  };
}

export function isYoutubeFamilyPolicyAnnouncement(message, botId) {
  return message?.author?.id === botId
    && JSON.stringify(message.toJSON?.() || message)
      .includes(YOUTUBE_FAMILY_POLICY_UPDATE.marker);
}
