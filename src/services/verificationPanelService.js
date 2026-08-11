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
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { accentFor, brandName } from '../utils/uiKit.js';
import { isInternationalGuild } from '../utils/locale.js';

function title(icon, text, level = 1) {
  return `${'#'.repeat(level)} ${[icon, text].filter(Boolean).join(' ')}`;
}

function verificationButton(E, customId = 'oauth:verify:button', label = 'Xác Minh & Bật Khôi Phục') {
  const button = new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(ButtonStyle.Success);
  const emoji = E.component('verify_shield') || E.component('status_check');
  if (emoji) button.setEmoji(emoji);
  return button;
}

export function buildVerificationPanelV2(guildId, storeName = brandName()) {
  const E = createEmojiResolver(guildId);
  const international = isInternationalGuild(guildId);
  const container = new ContainerBuilder().setAccentColor(accentFor('primary'));

  if (international) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      title(E('verify_shield'), 'CENAR GLOBAL ID • VERIFY & RECOVER'),
      `-# ${E('brand_discord')} One consent flow unlocks the community and protects your customer identity link.`,
    ].join('\n')));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      title(E('icon_lock'), 'SECURE VERIFICATION', 2),
      `> ${E('verify_shield')} Reduce bots, spam and raid activity before community access is granted.`,
      `> ${E('icon_unlock')} Unlock pricing, global chat and the private order ticket flow.`,
      `> ${E('status_check')} We never request or store your Discord password.`,
      '',
      title(E('recovery_backup'), 'CONSENT-BASED RECOVERY', 2),
      `> ${E('recovery_backup')} Your Discord link and eligible role snapshot are stored encrypted.`,
      `> ${E('recovery_restore')} Scheduled snapshots protect channels, roles, permissions and custom emojis.`,
      `> ${E('icon_group')} If a recovery server is required, only members who approved OAuth can be restored through Discord's API.`,
    ].join('\n')));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `${E('icon_key')} **Permissions:** \`identify\` + \`guilds.join\``,
      `${E('status_info')} Access can be revoked at any time from Discord Authorized Apps.`,
      `-# ${E('icon_sparkle')} The verification role is granted only after the signed Discord callback succeeds.`,
    ].join('\n')));
    return {
      components: [container, new ActionRowBuilder().addComponents(verificationButton(E, 'oauth:verify:button', 'Verify with Discord'))],
      flags: MessageFlags.IsComponentsV2,
    };
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      title(E('verify_shield'), `${storeName.toUpperCase()} ID • XÁC MINH & KHÔI PHỤC`),
      `-# ${E('brand_discord')} Một lần ủy quyền, mở khóa cộng đồng và bảo vệ liên kết khách hàng của bạn.`,
    ].join('\n')),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      title(E('icon_lock'), 'XÁC MINH AN TOÀN', 2),
      `> ${E('verify_shield')} Chặn tài khoản ảo, spam và raid trước khi mở quyền truy cập.`,
      `> ${E('icon_unlock')} Mở bảng giá, phòng cộng đồng và luồng ticket mua hàng.`,
      `> ${E('status_check')} Không yêu cầu và không lưu mật khẩu Discord.`,
    ].join('\n')),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      title(E('recovery_backup'), 'RECOVERY BACKUP', 2),
      `> ${E('recovery_backup')} Sao lưu mã hóa liên kết Discord, vai trò và hồ sơ khách hàng trong hệ thống.`,
      `> ${E('recovery_restore')} Snapshot định kỳ lưu vai trò, kênh, quyền và custom emoji của server.`,
      `> ${E('icon_group')} Khi có server dự phòng, thành viên đã đồng ý OAuth có thể được khôi phục bằng API Discord.`,
    ].join('\n')),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `${E('icon_key')} **Quyền sử dụng:** \`identify\` + \`guilds.join\``,
      `${E('status_info')} Chỉ tài khoản tự bấm đồng ý mới có thể khôi phục; bạn có thể thu hồi quyền trong Discord bất cứ lúc nào.`,
      `-# ${E('icon_sparkle')} Bấm nút bên dưới, kiểm tra đúng ứng dụng ${storeName} rồi xác nhận.`,
    ].join('\n')),
  );

  return {
    components: [
      container,
      new ActionRowBuilder().addComponents(verificationButton(E)),
    ],
    flags: MessageFlags.IsComponentsV2,
  };
}

export function buildVerificationPromptV2({ guildId, username, loginUrl, hasRole = false, recoveryActive = false }) {
  const E = createEmojiResolver(guildId);
  const international = isInternationalGuild(guildId);
  const active = hasRole && recoveryActive;
  const container = new ContainerBuilder().setAccentColor(active ? accentFor('success') : accentFor('primary'));

  const lines = international
    ? (active
      ? [
          title(E('status_check'), 'ACCOUNT VERIFIED & PROTECTED', 2),
          `**${username}** has community access and an active recovery link.`,
          `> ${E('recovery_backup')} OAuth consent and eligible roles are recorded securely.`,
          `-# ${E('icon_heart_purple')} No further verification is required right now.`,
        ]
      : [
          title(E('verify_shield'), 'STEP 1/2 • DISCORD CONSENT REQUIRED', 2),
          `Hi **${username}**. The bot received your request but **has not granted the verification role yet**.`,
          `> ${E('icon_lock')} Complete the Discord consent page using the same account.`,
          `> ${E('recovery_backup')} Recovery data is encrypted before storage.`,
          `> ${E('status_info')} Access is granted only after the callback is validated successfully.`,
        ])
    : active
    ? [
        title(E('status_check'), 'TÀI KHOẢN ĐÃ ĐƯỢC BẢO VỆ', 2),
        `**${username}** đã có quyền truy cập và recovery backup đang hoạt động.`,
        `> ${E('recovery_backup')} Liên kết OAuth và vai trò đã được ghi nhận.`,
        `> ${E('icon_group')} Hồ sơ khách hàng được đồng bộ theo Discord ID.`,
        `-# ${E('icon_heart_purple')} Bạn không cần xác minh lại ở thời điểm này.`,
      ]
    : [
        title(E('verify_shield'), 'BƯỚC 1/2 • CHỜ XÁC NHẬN OAUTH', 2),
        `Chào **${username}**, yêu cầu đã được bot tiếp nhận nhưng **chưa cấp vai trò xác minh**.`,
        `> ${E('icon_lock')} Discord chỉ chia sẻ danh tính cơ bản và quyền tham gia server dự phòng.`,
        `> ${E('recovery_backup')} Token recovery được mã hóa trước khi lưu vào database backup.`,
        `> ${E('status_info')} Vai trò chỉ được cấp sau khi Discord callback thành công và bot xác nhận đúng tài khoản.`,
        `-# ${E('icon_sparkle')} Bấm nút bên dưới, xem đúng ứng dụng Cenar Store rồi chọn Ủy quyền.`,
      ];

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  const components = [container];
  if (!active && loginUrl) {
    const linkButton = new ButtonBuilder()
      .setLabel(international ? 'Continue with Discord' : 'Xác Minh Với Discord')
      .setStyle(ButtonStyle.Link)
      .setURL(loginUrl);
    const emoji = E.component('verify_shield') || E.component('status_check');
    if (emoji) linkButton.setEmoji(emoji);
    components.push(new ActionRowBuilder().addComponents(linkButton));
  }

  return {
    components,
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  };
}

export function buildVerificationSuccessDmV2({ guildId, guildName, roleName }) {
  const E = createEmojiResolver(guildId);
  const international = isInternationalGuild(guildId);
  const container = new ContainerBuilder().setAccentColor(accentFor('success'));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent((international ? [
      title(E('status_check'), 'VERIFICATION & RECOVERY ACTIVE', 2),
      `Your account is now verified in **${guildName}**.`,
      `> ${E('icon_unlock')} Role granted: **${roleName}**`,
      `> ${E('recovery_backup')} Your consent link is stored encrypted.`,
      `> ${E('recovery_restore')} Eligible roles are recorded for consent-based recovery.`,
      '',
      `${E('status_info')} You can revoke access at any time from Discord Authorized Apps.`,
      `-# ${E('icon_heart_purple')} ${guildName} • Transparent security and consent-based recovery`,
    ] : [
      title(E('status_check'), 'XÁC MINH & RECOVERY ĐÃ HOẠT ĐỘNG', 2),
      `Tài khoản của bạn đã được xác minh tại **${guildName}**.`,
      `> ${E('icon_unlock')} Vai trò đã cấp: **${roleName}**`,
      `> ${E('recovery_backup')} OAuth recovery được mã hóa trong database backup.`,
      `> ${E('recovery_restore')} Vai trò hiện tại đã được ghi nhận cho tình huống khôi phục.`,
      '',
      `${E('status_info')} Bạn có thể thu hồi quyền ứng dụng trong phần **Authorized Apps** của Discord. Khi thu hồi, khả năng tự động tham gia server dự phòng sẽ dừng.`,
      `-# ${E('icon_heart_purple')} ${guildName} • Bảo mật minh bạch, phục hồi có sự đồng ý`,
    ]).join('\n')),
  );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

export function buildVerificationUnavailableV2(guildId) {
  const E = createEmojiResolver(guildId);
  const international = isInternationalGuild(guildId);
  const container = new ContainerBuilder().setAccentColor(accentFor('warning'));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent((international ? [
      title(E('status_warn'), 'RECOVERY SETUP PENDING', 2),
      `> ${E('icon_lock')} The Owner must configure \`CLIENT_SECRET\` and \`ENCRYPTION_KEY\` on the hosting panel.`,
      `> ${E('status_info')} OAuth is disabled until tokens can be encrypted safely.`,
      `> ${E('recovery_restore')} Verification will become available after configuration and restart.`,
      `-# ${E('icon_heart_purple')} Please open one support ticket; repeated clicks are not necessary.`,
    ] : [
      title(E('status_warn'), 'RECOVERY ĐANG CHỜ CẤU HÌNH', 2),
      `> ${E('icon_lock')} Owner cần thêm \`CLIENT_SECRET\` và \`ENCRYPTION_KEY\` trên hosting.`,
      `> ${E('status_info')} Bot đã khóa luồng OAuth để không yêu cầu bạn cấp quyền khi chưa thể lưu token an toàn.`,
      `> ${E('recovery_restore')} Sau khi cấu hình và restart, nút xác minh sẽ hoạt động ngay.`,
      `-# ${E('icon_heart_purple')} Vui lòng báo Owner hoặc mở ticket hỗ trợ; không cần bấm thử nhiều lần.`,
    ]).join('\n')),
  );
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  };
}
