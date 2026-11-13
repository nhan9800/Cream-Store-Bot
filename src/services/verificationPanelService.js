import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  escapeMarkdown,
} from 'discord.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { accentFor, brandName } from '../utils/uiKit.js';
import { isInternationalGuild } from '../utils/locale.js';
import { stripPresentationEmoji, withUniqueCustomEmoji } from '../utils/uniqueCustomEmoji.js';

const NO_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false };
const safeText = value => escapeMarkdown(stripPresentationEmoji(value)
  .replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
  .replace(/@/g, '＠').replace(/</g, '‹').replace(/>/g, '›')
  .replace(/(https?):\/\//gi, '$1:\u200b//').replace(/\s+/g, ' ').trim().slice(0, 100), { maskedLink: true });
const presentation = (payload, guildId, seed) => withUniqueCustomEmoji({ ...payload,
  allowedMentions: { ...NO_MENTIONS } }, { guildId, seed: `verification:${seed}` });

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
    return presentation({
      components: [container, new ActionRowBuilder().addComponents(verificationButton(E, 'oauth:verify:button', 'Verify with Discord'))],
      flags: MessageFlags.IsComponentsV2,
    }, guildId, 'public');
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      title(E('verify_shield'), `${safeText(storeName).toUpperCase()} ID • XÁC MINH & KHÔI PHỤC`),
      `-# ${E('brand_discord')} Một lần ủy quyền, mở khóa cộng đồng và bảo vệ liên kết khách hàng của bạn.`,
    ].join('\n')),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      title(E('icon_lock'), 'XÁC MINH AN TOÀN', 2),
      `> ${E('verify_shield')} Xác nhận danh tính Discord trước khi mở quyền truy cập cộng đồng.`,
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
      `-# ${E('icon_sparkle')} Bấm nút bên dưới, kiểm tra đúng ứng dụng ${safeText(storeName)} rồi xác nhận.`,
    ].join('\n')),
  );

  return presentation({
    components: [
      container,
      new ActionRowBuilder().addComponents(verificationButton(E)),
    ],
    flags: MessageFlags.IsComponentsV2,
  }, guildId, 'public');
}

export function buildVerificationPromptV2({ guildId, username, loginUrl, hasRole = false, recoveryActive = false }) {
  const E = createEmojiResolver(guildId);
  const international = isInternationalGuild(guildId);
  const complete = hasRole && recoveryActive;
  const name = safeText(username) || (international ? 'Member' : 'Thành viên');
  const container = new ContainerBuilder().setAccentColor(complete ? accentFor('success') : accentFor('primary'));
  const heading = international
    ? complete ? 'VERIFIED · CONSENT RECORDED' : hasRole ? 'COMMUNITY ACCESS · RECOVERY CONSENT NEEDED'
      : recoveryActive ? 'CONSENT RECORDED · VERIFICATION ROLE MISSING' : 'STEP 1/2 • DISCORD CONSENT REQUIRED'
    : complete ? 'ĐÃ XÁC MINH · ĐÃ LƯU ĐỒNG Ý' : hasRole ? 'ĐÃ CÓ QUYỀN · CHỜ ĐỒNG Ý RECOVERY'
      : recoveryActive ? 'ĐÃ LƯU ĐỒNG Ý · CHƯA CÓ VAI TRÒ' : 'BƯỚC 1/2 • CHỜ XÁC NHẬN OAUTH';
  const lines = international ? [
    title(E(complete ? 'status_check' : 'verify_shield'), heading, 2),
    hasRole ? `**${name}** currently has the verification role.`
      : `Hi **${name}**. Your account **does not currently have the verification role**.`,
    `> ${E('recovery_backup')} ${recoveryActive ? 'Recovery consent has been recorded.' : 'Required recovery consent has not been recorded.'}`,
    recoveryActive ? `> ${E('status_info')} Stored consent cannot confirm whether you later revoked access in Discord.` : null,
    !complete ? `> ${E('icon_lock')} Continue with Discord using the account you want to verify. Only a validated callback can grant the role.` : null,
    complete ? `-# ${E('icon_key')} Update consent only if you revoked the app in Discord.` : null,
    `-# ${E('icon_sparkle')} Open one consent page and finish it. Repeated clicks do not remove a Discord restriction.`,
  ] : [
    title(E(complete ? 'status_check' : 'verify_shield'), heading, 2),
    hasRole ? `**${name}** hiện đã có vai trò xác minh.`
      : `Chào **${name}**, tài khoản hiện **chưa có vai trò xác minh**.`,
    `> ${E('recovery_backup')} ${recoveryActive ? 'Đồng ý OAuth recovery đã được ghi nhận.' : 'Chưa ghi nhận đầy đủ đồng ý OAuth recovery.'}`,
    recoveryActive ? `> ${E('status_info')} Dữ liệu đã lưu không xác nhận được bạn đã thu hồi quyền trong Discord hay chưa.` : null,
    !complete ? `> ${E('icon_lock')} Tiếp tục với Discord bằng tài khoản cần xác minh. Vai trò chỉ được cấp sau khi callback được xác nhận thành công.` : null,
    complete ? `-# ${E('icon_key')} Chỉ cập nhật ủy quyền nếu bạn đã thu hồi ứng dụng trong Discord.` : null,
    `-# ${E('icon_sparkle')} Chỉ mở một trang ủy quyền và hoàn tất. Bấm liên tục không gỡ được hạn chế từ Discord.`,
  ];

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.filter(Boolean).join('\n')));
  const components = [container];
  if (loginUrl) {
    const linkButton = new ButtonBuilder()
      .setLabel(complete ? (international ? 'Update consent if revoked' : 'Cập nhật ủy quyền nếu đã thu hồi')
        : international ? 'Continue with Discord' : 'Xác Minh Với Discord')
      .setStyle(ButtonStyle.Link)
      .setURL(loginUrl);
    const emoji = E.component('verify_shield') || E.component('status_check');
    if (emoji) linkButton.setEmoji(emoji);
    components.push(new ActionRowBuilder().addComponents(linkButton));
  }

  return presentation({
    components,
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  }, guildId, 'prompt');
}

export function buildVerificationSuccessDmV2({ guildId, guildName, roleName }) {
  guildName = safeText(guildName);
  roleName = safeText(roleName);
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
  return presentation({ components: [container], flags: MessageFlags.IsComponentsV2 }, guildId, 'success');
}

export function buildVerificationUnavailableV2(guildId, { reason = 'configuration' } = {}) {
  const E = createEmojiResolver(guildId);
  const international = isInternationalGuild(guildId);
  const container = new ContainerBuilder().setAccentColor(accentFor('warning'));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent((international ? [
      title(E('status_warn'), 'VERIFICATION TEMPORARILY UNAVAILABLE', 2),
      `> ${E('icon_lock')} ${reason === 'guild' ? 'Open verification from inside the Discord server.'
        : reason === 'member' ? 'The bot could not confirm your membership. Please try again shortly.'
        : reason === 'launch' ? 'The shop is correcting its secure verification link.'
        : reason === 'temporary' ? 'The bot could not check verification status. Please try again shortly.'
        : 'The shop is completing verification setup.'}`,
      `> ${E('status_info')} This action has not granted a role or started OAuth authorization.`,
      `-# ${E('icon_heart_purple')} Please open one support ticket; repeated clicks are not necessary.`,
    ] : [
      title(E('status_warn'), 'XÁC MINH TẠM CHƯA SẴN SÀNG', 2),
      `> ${E('icon_lock')} ${reason === 'guild' ? 'Vui lòng mở xác minh từ trong server Discord.'
        : reason === 'member' ? 'Bot chưa kiểm tra được tư cách thành viên. Vui lòng thử lại sau ít phút.'
        : reason === 'launch' ? 'Shop đang kiểm tra lại đường dẫn xác minh an toàn.'
        : reason === 'temporary' ? 'Bot chưa đọc được trạng thái xác minh. Vui lòng thử lại sau ít phút.'
        : 'Shop đang hoàn tất cấu hình xác minh.'}`,
      `> ${E('status_info')} Thao tác này chưa cấp vai trò và chưa mở phiên ủy quyền OAuth.`,
      `-# ${E('icon_heart_purple')} Vui lòng báo Owner hoặc mở ticket hỗ trợ; không cần bấm thử nhiều lần.`,
    ]).join('\n')),
  );
  return presentation({
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  }, guildId, 'unavailable');
}
