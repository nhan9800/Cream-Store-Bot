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

export const YOUTUBE_JOIN_FAM_GUIDE = Object.freeze({
  guildId: '1282637033340403754',
  announcementChannelId: '1524057155022491679',
  marker: 'CENAR-YOUTUBE-JOIN-FAM-GUIDE-2026-08',
  screenshotAttachmentName: 'youtube-join-fam-address.png',
  paymentSettingsUrl: 'https://payments.google.com/gp/w/u/0/home/settings',
  addPaymentMethodUrl: 'https://play.google.com/store/paymentmethods?hl=en_NZ',
  storeUrl: 'https://cenarstore.xyz',
});

/**
 * Nội dung hướng dẫn (markdown Components V2) — tách riêng để test được
 * mà không cần Discord. E là emoji resolver, mọi icon đều là custom emoji.
 */
export function buildYoutubeJoinFamGuideContent(guildId, E = createEmojiResolver(guildId)) {
  const guide = YOUTUBE_JOIN_FAM_GUIDE;
  return [
    `## ${E('guide_youtube')} HƯỚNG DẪN JOIN FAM YOUTUBE`,
    `> ${E('status_info')} Làm đúng **thứ tự 3 bước** dưới đây trước khi nhận lời mời Family.`,
    '',
    `### ${E('guide_wallet')} Bước 1 · Kiểm tra hồ sơ thanh toán của acc`,
    `> ${E('icon_search')} Mở trang cài đặt thanh toán Google: <${guide.paymentSettingsUrl}>`,
    `> ${E('status_cross')} Nếu acc **đã có hồ sơ thanh toán cũ** → **xóa hết** trước khi sang Bước 2.`,
    '',
    `### ${E('guide_card')} Bước 2 · Add hồ sơ thanh toán mới`,
    `> ${E('guide_playstore')} Vào <${guide.addPaymentMethodUrl}> để thêm **Momo / Zalopay / thẻ ngân hàng**.`,
    `> ${E('icon_settings')} Chọn quốc gia **Việt Nam (VN)** và set địa chỉ **chính xác** như sau:`,
    '',
    '```',
    'Dòng địa chỉ 1  : 42 Nguyễn Thiện Thuật',
    'Dòng địa chỉ 2  : Để trống',
    'Thành phố       : Hà Nội',
    'Tỉnh / Khu vực  : Hà Nội',
    'Mã bưu điện     : 10000',
    '```',
    '',
    `> ${E('status_check')} Chỉ sang Bước 3 khi **add hồ sơ thanh toán thành công**.`,
    '',
    `### ${E('guide_family')} Bước 3 · Join Fam như bình thường`,
    `> ${E('status_check')} Nhận lời mời Family trên acc vừa add hồ sơ ở Bước 2.`,
    '',
    `${E('guide_warning')} **Chính sách mới:** không làm đúng hướng dẫn trên → **BỊ HỦY GÓI PREMIUM**, shop không thể can thiệp trước.`,
    `-# Cenar Store · Đọc kỹ trước khi thao tác · ${guide.marker}`,
  ].join('\n');
}

/**
 * Message Components V2 hoàn chỉnh. attachmentName để trống (null) sẽ bỏ qua
 * phần MediaGallery — ảnh minh họa địa chỉ là tùy chọn khi đăng.
 */
export function buildYoutubeJoinFamGuideMessage({
  guildId,
  tagEveryone = true,
  attachmentName = null,
}) {
  const guide = YOUTUBE_JOIN_FAM_GUIDE;
  const E = createEmojiResolver(guildId);

  const container = new ContainerBuilder().setAccentColor(0xff0033);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${tagEveryone ? '@everyone\n' : ''}${buildYoutubeJoinFamGuideContent(guildId, E)}`,
    ),
  );

  if (attachmentName) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    );
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(`attachment://${attachmentName}`)
          .setDescription('Hình ảnh minh họa địa chỉ thanh toán cần set trong Google Play.'),
      ),
    );
  }

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${E('cenar_verified')} **Cenar Store** · Hướng dẫn chi tiết · Hỗ trợ theo thứ tự · Cảm ơn anh/chị đã hợp tác`,
    ),
  );

  const checkButton = withButtonEmoji(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Kiểm Tra Hồ Sơ TT')
      .setURL(guide.paymentSettingsUrl),
    E.component('guide_wallet'),
    E.component('icon_wallet'),
  );
  const addButton = withButtonEmoji(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Add Hồ Sơ Thanh Toán')
      .setURL(guide.addPaymentMethodUrl),
    E.component('guide_playstore'),
    E.component('guide_card'),
  );
  const storeButton = withButtonEmoji(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Mở Cenar Store')
      .setURL(guide.storeUrl),
    E.component('icon_store'),
  );

  return {
    components: [
      container,
      new ActionRowBuilder().addComponents(checkButton, addButton, storeButton),
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

/** Nhận diện tin nhắn hướng dẫn đã đăng trước đó để edit thay vì gửi mới. */
export function isYoutubeJoinFamGuideAnnouncement(message, botId) {
  if (message?.author?.id !== botId) return false;
  try {
    const serialized = JSON.stringify(message.toJSON?.() || message);
    return [
      YOUTUBE_JOIN_FAM_GUIDE.marker,
      'HDAN JOIN FAM YT',
      'HƯỚNG DẪN JOIN FAM YOUTUBE',
    ].some((fingerprint) => serialized.includes(fingerprint));
  } catch {
    return false;
  }
}
