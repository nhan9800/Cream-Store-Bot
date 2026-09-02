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

export const NITRO_GMAIL_PHONE_GUIDE = Object.freeze({
  guildId: '1282637033340403754',
  nitroGuideChannelId: '1524057149783937214',
  supportChannelId: '1514607020098191393',
  marker: 'CENAR-NITRO-GMAIL-PHONE-GUIDE-2026-09',
  screenshotAttachmentName: 'nitro-gmail-device-phone-verification.png',
  phoneSettingsUrl: 'https://myaccount.google.com/phone',
  securityCheckupUrl: 'https://myaccount.google.com/security-checkup',
  recoveryHelpUrl: 'https://support.google.com/accounts/answer/7299973?hl=vi',
});

export function buildNitroGmailPhoneGuideSections(
  guildId,
  E = createEmojiResolver(guildId),
) {
  const guide = NITRO_GMAIL_PHONE_GUIDE;

  return {
    introduction: [
      `# ${E('brand_nitro')} GIỮ GMAIL NITRO ỔN ĐỊNH TRONG 2 THÁNG`,
      `> ${E('verify_shield')} Dành cho khách nhận **Gmail do shop cấp** để sử dụng hoặc gia hạn Nitro. Hãy đăng nhập trên **điện thoại chính** và bật xác minh số điện thoại của thiết bị như ảnh bên dưới.`,
      '',
      `${E('recovery_backup')} **Lợi ích:** giúp Google ghi nhận một thiết bị quen thuộc, gửi cảnh báo bảo mật đúng nơi và tăng khả năng khôi phục nếu tài khoản bị yêu cầu xác minh.`,
      `${E('status_info')} Đây là bước **giảm rủi ro**, không phải cam kết Gmail “bất tử” hoặc an toàn tuyệt đối.`,
    ].join('\n'),

    setup: [
      `## ${E('icon_settings')} CÁCH BẬT TRÊN ĐIỆN THOẠI`,
      `**1 · Đăng nhập đúng thời điểm**`,
      `> Sau khi shop giao mail, hãy làm theo thời điểm đăng nhập ghi trong phiếu/hướng dẫn. Nếu được dặn chờ **2–3 ngày**, vui lòng chờ đủ; không đăng xuất rồi đăng nhập liên tục trong những ngày đầu.`,
      '',
      `**2 · Mở mục Số điện thoại**`,
      `> Vào **Cài đặt điện thoại → Google → Quản lý Tài khoản Google → Thông tin cá nhân → Điện thoại**. Tên mục có thể hơi khác tùy dòng máy.`,
      '',
      `**3 · Bật đúng công tắc trong ảnh**`,
      `> Tại **Xác minh số điện thoại thiết bị**, chọn đúng tên điện thoại đang dùng rồi bật công tắc sang trạng thái hoạt động.`,
      '',
      `${E('status_warn')} Mục trong ảnh là **xác minh số điện thoại của thiết bị**; bật mục này **không đồng nghĩa** với việc đã thêm số điện thoại khôi phục. Không tự ý đổi mật khẩu, 2FA, số/email khôi phục hoặc xóa thông tin đang có nếu chưa được shop hướng dẫn.`,
    ].join('\n'),

    maintenance: [
      `## ${E('icon_clock')} DUY TRÌ THIẾT BỊ QUEN THUỘC ĐỦ 2 THÁNG`,
      `${E('status_check')} Giữ Gmail đăng nhập trên **cùng một điện thoại chính đủ 2 tháng**; mở Gmail định kỳ để thiết bị tiếp tục được nhận diện.`,
      `${E('status_check')} Bật khóa màn hình và chỉ xác nhận **“Đúng là tôi”** khi chính bạn vừa thực hiện thao tác.`,
      `${E('status_cross')} Không xóa tài khoản khỏi máy, xóa dữ liệu Google/Gmail, khôi phục cài đặt gốc, nhân bản ứng dụng hoặc đăng nhập dồn dập trên nhiều máy/mạng lạ.`,
      `${E('status_cross')} Không gửi mật khẩu, mã OTP hoặc mã 2FA tại kênh công khai — kể cả khi có người tự nhận là nhân viên shop.`,
      '',
      `## ${E('recovery_restore')} NẾU BỊ YÊU CẦU XÁC MINH / MẤT QUYỀN TRUY CẬP`,
      `**1.** Thử khôi phục bằng **đúng điện thoại**, trình duyệt Chrome và mạng/vị trí bạn vẫn thường dùng.`,
      `**2.** Trả lời chính xác nhất có thể và tránh gửi quá nhiều lần liên tiếp khi thông tin chưa đúng.`,
      `**3.** Mở ticket tại <#${guide.supportChannelId}>, gửi **mã đơn + ảnh lỗi**; tuyệt đối không đăng mật khẩu/OTP công khai.`,
      '',
      `${E('status_info')} Thay đổi thông tin khôi phục có thể cần **tối đa 7 ngày** mới có hiệu lực đầy đủ. Nếu chưa chắc thao tác nào được phép, hãy hỏi shop trước.`,
      `-# Cenar Store · Hướng dẫn bảo mật Gmail Nitro · ${guide.marker}`,
    ].join('\n'),
  };
}

export function buildNitroGmailPhoneGuideMessage({
  guildId,
  attachmentName = NITRO_GMAIL_PHONE_GUIDE.screenshotAttachmentName,
}) {
  const guide = NITRO_GMAIL_PHONE_GUIDE;
  const E = createEmojiResolver(guildId);
  const sections = buildNitroGmailPhoneGuideSections(guildId, E);

  const intro = new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(sections.introduction));

  const setup = new ContainerBuilder()
    .setAccentColor(0x4285f4)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(sections.setup));

  if (attachmentName) {
    setup.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    );
    setup.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(`attachment://${attachmentName}`)
          .setDescription('Ảnh minh họa vị trí mục Điện thoại và công tắc Xác minh số điện thoại thiết bị trên Android.'),
      ),
    );
  }

  const maintenance = new ContainerBuilder()
    .setAccentColor(0x22c55e)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(sections.maintenance));

  const phoneButton = withButtonEmoji(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Mở Mục Số Điện Thoại')
      .setURL(guide.phoneSettingsUrl),
    E.component('icon_settings'),
    E.component('verify_shield'),
  );
  const securityButton = withButtonEmoji(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Kiểm Tra Bảo Mật')
      .setURL(guide.securityCheckupUrl),
    E.component('verify_shield'),
    E.component('status_check'),
  );
  const recoveryButton = withButtonEmoji(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Hướng Dẫn Khôi Phục')
      .setURL(guide.recoveryHelpUrl),
    E.component('recovery_restore'),
    E.component('cenar_support'),
  );

  return {
    components: [
      intro,
      setup,
      maintenance,
      new ActionRowBuilder().addComponents(phoneButton, securityButton, recoveryButton),
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

export function isNitroGmailPhoneGuideMessage(message, botId) {
  if (message?.author?.id !== botId) return false;
  try {
    const serialized = JSON.stringify(message.toJSON?.() || message);
    return [
      NITRO_GMAIL_PHONE_GUIDE.marker,
      'GIỮ GMAIL NITRO ỔN ĐỊNH TRONG 2 THÁNG',
    ].some((fingerprint) => serialized.includes(fingerprint));
  } catch {
    return false;
  }
}
