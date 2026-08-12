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
import { config } from '../config.js';
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';
import { accentFor } from '../utils/uiKit.js';
import { logAbuseEvent } from '../utils/antiScam.js';
import { emitAutomationLog } from './automationLogService.js';

function clean(value, max = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function confidenceLabel(value) {
  return `${Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)}%`;
}

export function buildScamPublicNoticeV2({ guildId, userId, timeoutApplied, quarantineMinutes }) {
  const E = createEmojiResolver(guildId);
  const container = new ContainerBuilder().setAccentColor(accentFor('danger'));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${E('verify_shield')} CENAR SECURITY ĐÃ CHẶN NỘI DUNG NGUY HIỂM`,
    `> ${E('status_cross')} Hình ảnh có dấu hiệu lừa đảo/phishing đã được tự động xóa trước khi lan truyền thêm.`,
    '',
    `${E('ticket_user')} <@${userId}> được xem là **tài khoản có khả năng đã bị xâm nhập**, không mặc định coi là người lừa đảo.`,
    timeoutApplied
      ? `${E('cenar_cooldown')} Bot đã cách ly quyền nhắn tin trong **${quarantineMinutes} phút** để chủ tài khoản có thời gian bảo mật lại Discord.`
      : `${E('status_warn')} Bot không thể áp dụng cách ly tự động; bộ phận quản trị đã nhận log để kiểm tra ngay.`,
    `${E('cenar_support')} Chủ tài khoản vui lòng đổi mật khẩu, đăng xuất thiết bị lạ, thu hồi ứng dụng không rõ nguồn và bật 2FA.`,
    `-# ${E('icon_clock')} Không ban thành viên · Không công khai nội dung ảnh độc hại`,
  ].join('\n')));
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [], users: [String(userId)] },
  };
}

export function buildScamRecoveryDmV2({ guildId, quarantineMinutes }) {
  const E = createEmojiResolver(guildId);
  const container = new ContainerBuilder().setAccentColor(accentFor('warning'));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('verify_shield')} CẢNH BÁO KHÔI PHỤC TÀI KHOẢN`,
    `> ${E('status_warn')} Cenar Store vừa chặn một hình ảnh lừa đảo được gửi từ tài khoản Discord của bạn. Đây có thể là dấu hiệu token hoặc phiên đăng nhập đã bị đánh cắp.`,
  ].join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `### ${E('cenar_verified')} THỰC HIỆN NGAY`,
    `${E('icon_key')} **1.** Đổi mật khẩu Discord bằng một mật khẩu hoàn toàn mới.`,
    `${E('icon_settings')} **2.** Đăng xuất mọi thiết bị/phiên đăng nhập mà bạn không nhận ra.`,
    `${E('icon_link')} **3.** Thu hồi các ứng dụng đã cấp quyền nhưng không còn tin tưởng.`,
    `${E('verify_shield')} **4.** Bật xác thực hai lớp bằng ứng dụng Authenticator và lưu mã dự phòng.`,
    `${E('icon_search')} **5.** Quét malware, gỡ extension/trình duyệt lạ và không quét QR hay chạy file do người lạ gửi.`,
    '',
    `${E('cenar_cooldown')} Quyền nhắn tin được cách ly tối đa **${quarantineMinutes} phút** và tự mở lại; bạn **không bị ban khỏi server**. Nếu đã bảo mật xong sớm, hãy liên hệ staff để được gỡ cách ly.`,
    `-# ${E('cenar_support')} Cenar Store không bao giờ yêu cầu token Discord, mã dự phòng hoặc QR đăng nhập của bạn.`,
  ].join('\n')));

  const accountButton = withButtonEmoji(
    new ButtonBuilder()
      .setLabel('Bảo Mật Tài Khoản')
      .setStyle(ButtonStyle.Link)
      .setURL('https://discord.com/settings/account'),
    E.component('icon_key'),
    E.component('verify_shield'),
  );
  const devicesButton = withButtonEmoji(
    new ButtonBuilder()
      .setLabel('Kiểm Tra Thiết Bị')
      .setStyle(ButtonStyle.Link)
      .setURL('https://discord.com/settings/devices'),
    E.component('icon_search'),
    E.component('cenar_verified'),
  );
  const appsButton = withButtonEmoji(
    new ButtonBuilder()
      .setLabel('Ứng Dụng Đã Cấp Quyền')
      .setStyle(ButtonStyle.Link)
      .setURL('https://discord.com/settings/authorized-apps'),
    E.component('icon_settings'),
    E.component('cenar_admin'),
  );

  return {
    components: [container, new ActionRowBuilder().addComponents(accountButton, devicesButton, appsButton)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export async function quarantineDetectedScamMessage(message, detection) {
  const quarantineMinutes = config.antiScamQuarantineMinutes;
  const timeoutMs = quarantineMinutes * 60 * 1000;
  const deleted = await message.delete().then(() => true).catch((error) => {
    console.error('[ANTI-SCAM] Cannot delete detected message:', error.message);
    return false;
  });

  let timeoutApplied = false;
  let timeoutPreserved = false;
  if (message.member?.moderatable) {
    const existingUntil = Number(message.member.communicationDisabledUntilTimestamp || 0);
    if (existingUntil >= Date.now() + timeoutMs) {
      timeoutApplied = true;
      timeoutPreserved = true;
    } else {
      timeoutApplied = await message.member.timeout(
        timeoutMs,
        `Cenar Security: nghi tài khoản bị xâm nhập và phát tán ảnh scam (${confidenceLabel(detection.confidence)})`,
      ).then(() => true).catch((error) => {
        console.error('[ANTI-SCAM] Cannot quarantine member:', error.message);
        return false;
      });
    }
  }

  const dmSent = await message.author.send(buildScamRecoveryDmV2({
    guildId: message.guildId,
    quarantineMinutes,
  })).then(() => true).catch(() => false);

  const notice = await message.channel.send(buildScamPublicNoticeV2({
    guildId: message.guildId,
    userId: message.author.id,
    timeoutApplied,
    quarantineMinutes,
  })).catch(() => null);
  if (notice) setTimeout(() => notice.delete().catch(() => null), 60_000);

  const evidence = (detection.signals || []).map((signal) => clean(signal, 100)).filter(Boolean).join(' · ');
  const fingerprint = clean(detection.sha256, 64).slice(0, 16);
  logAbuseEvent(
    message.guildId,
    message.author.id,
    'SCAM_IMAGE_QUARANTINE',
    [
      `category=${clean(detection.category, 80)}`,
      `confidence=${confidenceLabel(detection.confidence)}`,
      `channel=${message.channel.id}`,
      `message=${message.id}`,
      `fingerprint=${fingerprint}`,
      `deleted=${deleted}`,
      `timeout=${timeoutApplied}`,
      evidence && `signals=${evidence}`,
    ].filter(Boolean).join(' | '),
  );

  await emitAutomationLog(message.client, {
    guildId: message.guildId,
    customerId: message.author.id,
    action: 'SCAM_IMAGE_QUARANTINE',
    title: 'CENAR SECURITY · ĐÃ CÁCH LY ẢNH SCAM',
    summary: 'Ảnh nguy hiểm đã bị xóa. Thành viên được xử lý như một tài khoản có khả năng bị chiếm quyền, không bị ban khỏi server.',
    reference: message.id,
    status: 'danger',
    fields: [
      { label: 'Kênh phát hiện', value: `#${message.channel.name || message.channel.id}`, emoji: 'icon_location' },
      { label: 'Phân loại', value: clean(detection.category || 'OTHER_SCAM', 80), emoji: 'verify_shield' },
      { label: 'Độ tin cậy', value: confidenceLabel(detection.confidence), emoji: 'icon_search' },
      { label: 'Dấu hiệu nhìn thấy', value: evidence || clean(detection.reason || 'Không có chi tiết', 250), emoji: 'status_warn' },
      { label: 'Xử lý', value: timeoutApplied ? `Đã xóa · Cách ly ${quarantineMinutes} phút${timeoutPreserved ? ' (giữ thời hạn dài hơn)' : ''}` : 'Đã xóa · Cần staff kiểm tra quyền timeout', emoji: 'cenar_cooldown' },
      { label: 'Đã gửi hướng dẫn DM', value: dmSent ? 'Có' : 'Không gửi được', emoji: 'cenar_support' },
      { label: 'Dấu vân tay', value: fingerprint || 'N/A', emoji: 'icon_id' },
    ],
  });

  return { deleted, timeoutApplied, dmSent };
}
