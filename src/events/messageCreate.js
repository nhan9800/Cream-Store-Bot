import { Events, AttachmentBuilder, ContainerBuilder, EmbedBuilder, MessageFlags, TextDisplayBuilder } from 'discord.js';
import { getTicketByChannelId, updateTicketAiStatus, isTicketChannel, touchTicket } from '../services/ticketService.js';
import { processAiMessage } from '../services/aiService.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { moderateMessage } from '../services/aiModerationService.js';
import { isMrBeastScam, incrementLinkWarningCount, logAbuseEvent } from '../utils/antiScam.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../database/db.js';
import { getPartnerSettings } from '../services/partnerService.js';
import { accentFor, stripDiscordUnicode } from '../utils/uiKit.js';
import { config } from '../config.js';
import {
  formatOwnerPingPenalty,
  OWNER_PING_PENALTIES_MS,
  registerOwnerPing,
} from '../services/ownerPingGuardService.js';
import { emitAutomationLog } from '../services/automationLogService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


export const name = Events.MessageCreate;
export const once = false;

// ═══════════════════════════════════════════════
// Message Processing Queue & Cache
// ═══════════════════════════════════════════════
const processingChannels = new Set();
const sentGmailGuides = new Set();

function nextOwnerPingPenaltyLabel(penaltyLevel) {
  const nextIndex = Math.min(Number(penaltyLevel) || 0, OWNER_PING_PENALTIES_MS.length - 1);
  return formatOwnerPingPenalty(OWNER_PING_PENALTIES_MS[nextIndex]);
}

async function enforceProtectedOwnerPing(message, E, isStaff) {
  const protectedOwnerId = String(config.protectedOwnerId || '').trim();
  if (
    !protectedOwnerId
    || isStaff
    || !message.member
    || message.author.id === protectedOwnerId
    || !message.mentions.users.has(protectedOwnerId)
  ) return false;

  const result = registerOwnerPing(message.guildId, message.author.id);
  if (result.action === 'counted') return false;

  if (result.action === 'warning') {
    logAbuseEvent(
      message.guildId,
      message.author.id,
      'OWNER_PING_WARNING',
      `Ping Owner lần ${result.mentionCount} trong cửa sổ 24 giờ.`,
    );

    const warning = new ContainerBuilder().setAccentColor(accentFor('warning'))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `## ${E('cenar_cooldown')} VUI LÒNG KHÔNG SPAM TAG OWNER`,
        `${E('status_warn')} <@${message.author.id}>, bạn đã ping Owner **${result.mentionCount} lần trong 24 giờ**.`,
        '',
        `### ${E('order_processing')} Đơn hàng vẫn đang được tiến hành`,
        `${E('cenar_staff')} Nếu đơn bị chậm, nguồn hàng hoặc nguyên liệu có thể đang gặp vấn đề. Cenar Store thành thật xin lỗi và mong bạn kiên nhẫn chờ xử lý.`,
        `${E('cenar_verified')} Vui lòng tiếp tục theo dõi tại ticket/website; staff sẽ phản hồi ngay khi có cập nhật.`,
        '',
        `${E('status_cross')} **Cảnh báo cuối:** ping thêm một lần sẽ bị timeout **15 phút**. Tái phạm tiếp theo tăng lên **24 giờ**, sau đó **3–28 ngày**.`,
        `-# ${E('icon_clock')} Bộ đếm tự làm mới sau 24 giờ · Cấp phạt giảm sau 30 ngày không vi phạm`,
      ].join('\n')));

    await message.channel.send({
      components: [warning],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    }).catch(() => null);

    await emitAutomationLog(message.client, {
      guildId: message.guildId,
      customerId: message.author.id,
      action: 'OWNER_PING_WARNING',
      title: 'CẢNH BÁO SPAM TAG OWNER',
      summary: `Thành viên đã ping Owner ${result.mentionCount} lần trong 24 giờ.`,
      reference: message.id,
      status: 'warning',
      fields: [
        { label: 'Kênh', value: `#${message.channel.name || message.channel.id}`, emoji: 'cenar_staff' },
        { label: 'Vi phạm kế tiếp', value: 'Timeout 15 phút', emoji: 'cenar_cooldown' },
      ],
    });
    return true;
  }

  const durationLabel = formatOwnerPingPenalty(result.timeoutMs);
  const nextDurationLabel = nextOwnerPingPenaltyLabel(result.penaltyLevel);
  const reason = `Spam tag Owner Cenar Store · cấp phạt ${result.penaltyLevel}`;
  let timeoutApplied = false;
  if (message.member.moderatable) {
    timeoutApplied = await message.member.timeout(result.timeoutMs, reason)
      .then(() => true)
      .catch((error) => {
        console.error('[OWNER-PING-GUARD] Không thể timeout:', error.message);
        return false;
      });
  }

  await message.delete().catch(() => null);
  logAbuseEvent(
    message.guildId,
    message.author.id,
    timeoutApplied ? 'OWNER_PING_TIMEOUT' : 'OWNER_PING_TIMEOUT_FAILED',
    `Cấp ${result.penaltyLevel} · ${durationLabel} · lần ping ${result.mentionCount}.`,
  );

  const penalty = new ContainerBuilder().setAccentColor(accentFor('danger'))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `## ${E('status_cross')} ${timeoutApplied ? 'ĐÃ ÁP DỤNG TIMEOUT' : 'KHÔNG THỂ ÁP DỤNG TIMEOUT'}`,
      `${E('cenar_cooldown')} <@${message.author.id}> · Cấp phạt **${result.penaltyLevel}** · ${timeoutApplied ? `Tạm khóa chat **${durationLabel}**` : 'Đã chuyển log để quản trị viên xử lý'}`,
      '',
      `${E('order_processing')} Đơn hàng của bạn **vẫn đang được tiến hành**. Việc ping liên tục không làm đơn được xử lý nhanh hơn và gây gián đoạn hỗ trợ.`,
      `${E('cenar_staff')} Nếu bị delay, nguyên nhân có thể đến từ nguồn hàng/nguyên liệu. Cenar Store thành thật xin lỗi và mong bạn chờ cập nhật tại ticket.`,
      `${E('status_warn')} Vi phạm tiếp theo trong chu kỳ sẽ tăng lên **${nextDurationLabel}**; mức tối đa là **28 ngày** theo giới hạn Discord.`,
      `-# ${E('icon_clock')} Hệ thống chống spam Owner · Ghi nhận tự động`,
    ].join('\n')));

  await message.channel.send({
    components: [penalty],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  }).catch(() => null);

  await emitAutomationLog(message.client, {
    guildId: message.guildId,
    customerId: message.author.id,
    action: timeoutApplied ? 'OWNER_PING_TIMEOUT' : 'OWNER_PING_TIMEOUT_FAILED',
    title: timeoutApplied ? 'ĐÃ PHẠT SPAM TAG OWNER' : 'CẦN ADMIN XỬ LÝ SPAM TAG OWNER',
    summary: timeoutApplied
      ? `Đã timeout ${durationLabel} do tiếp tục ping Owner sau cảnh báo.`
      : 'Bot không đủ điều kiện timeout thành viên; cần quản trị viên kiểm tra role/quyền.',
    reference: message.id,
    status: timeoutApplied ? 'danger' : 'warning',
    fields: [
      { label: 'Số lần trong 24 giờ', value: String(result.mentionCount), emoji: 'status_warn' },
      { label: 'Cấp phạt', value: String(result.penaltyLevel), emoji: 'cenar_cooldown' },
      { label: 'Thời hạn', value: durationLabel, emoji: 'icon_clock' },
    ],
  });
  return true;
}

async function withChannelLock(channelId, fn) {
  if (processingChannels.has(channelId)) return; // skip nếu đang xử lý
  processingChannels.add(channelId);
  try {
    await fn();
  } finally {
    processingChannels.delete(channelId);
  }
}

export async function execute(message) {
  // Bỏ qua tin nhắn của bot
  if (message.author.bot) return;

  const guildConfig = getGuildConfig(message.guildId);
  if (!guildConfig) return;

  const E = createEmojiResolver(message.guildId);

  const ticket = getTicketByChannelId(message.channel.id);
  if (ticket?.status === 'OPEN') touchTicket(ticket.id);
  const isStaff = message.member?.roles?.cache?.has(guildConfig.support_role_id) || 
                  message.member?.roles?.cache?.has(guildConfig.manager_role_id) || 
                  message.member?.permissions?.has('ManageGuild');

  if (await enforceProtectedOwnerPing(message, E, isStaff)) return;

  const partnerSettings = getPartnerSettings(message.guildId);
  const isPartnerChannel = Boolean(partnerSettings.partner_channel_id === message.channel.id);
  const isPartner = Boolean(partnerSettings.partner_role_id && message.member?.roles?.cache?.has(partnerSettings.partner_role_id));

  // Mention Partner được bot gửi hộ qua /partner-post để hạn mức được kiểm tra
  // trước khi Discord phát notification. Tin gõ trực tiếp bị xóa nhằm tránh
  // bypass quota; link quảng bá hợp lệ vẫn được phép trong kênh này.
  if (isPartnerChannel && isPartner && !isStaff) {
    const directEveryone = /@(everyone|here)\b/i.test(message.content);
    const directPartnerRole = message.mentions.roles.has(partnerSettings.partner_role_id);
    if (directEveryone || directPartnerRole) {
      await message.delete().catch(() => null);
      const warning = new ContainerBuilder().setAccentColor(accentFor('warning'))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
          `## ${E('cenar_cooldown')} Mention trực tiếp đã bị chặn`,
          `${E('cenar_partner')} <@${message.author.id}>, hãy dùng \`/partner-post send\` để bot kiểm tra hạn mức trước khi ping.`,
          `${E('cenar_announce')} Role Partner: 2 lần/24h · Everyone: 1 lần/24h.`,
        ].join('\n')));
      const notice = await message.channel.send({
        components: [warning],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      }).catch(() => null);
      if (notice) setTimeout(() => notice.delete().catch(() => null), 15_000);

      const reviewChannel = partnerSettings.approve_channel_id
        ? await message.guild.channels.fetch(partnerSettings.approve_channel_id).catch(() => null)
        : null;
      if (reviewChannel?.isTextBased()) {
        const log = new ContainerBuilder().setAccentColor(accentFor('warning'))
          .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `## ${E('cenar_announce')} Log chặn mention Partner`,
            `${E('cenar_verified')} Thành viên: <@${message.author.id}> · \`${message.author.id}\``,
            `${E('cenar_cooldown')} Loại: ${directEveryone ? 'Everyone/Here' : 'Role Partner'}`,
            `${E('cenar_support')} Nội dung: ${stripDiscordUnicode(message.content).slice(0, 1000)}`,
          ].join('\n')));
        await reviewChannel.send({ components: [log], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }).catch(() => null);
      }
      return;
    }
  }
  // ═══════════════════════════════════════════════
  // AUTO SEND GMAIL SAFETY GUIDE FOR NITRO 2M
  // ═══════════════════════════════════════════════
  if (ticket && ticket.status === 'OPEN' && !sentGmailGuides.has(ticket.id)) {
    const contentLower = message.content.toLowerCase();
    const isNichu2mKeyword = /nichu\s*2\s*m|nitro\s*2\s*m|nichu\s*2\s*tháng|nitro\s*2\s*tháng/i.test(message.content);
    const hasGmail = /[a-zA-Z0-9._%+-]+@gmail\.com/i.test(message.content);
    
    // Logic dự phòng thông minh: Nếu tên channel ticket có chứa nitro/nichu/trial/boost và tin nhắn chứa gmail
    const isNitroTicketChan = /nitro|nichu|boost|trial/i.test(message.channel.name);
    
    let isNitro2mOrder = false;
    if (ticket.related_order_code) {
      try {
        const order = db.prepare('SELECT * FROM orders WHERE order_code = ?').get(ticket.related_order_code);
        if (order) {
          const prodNameLower = order.product_name.toLowerCase();
          if (prodNameLower.includes('nitro') && (prodNameLower.includes('2m') || prodNameLower.includes('2 tháng') || prodNameLower.includes('2 month') || prodNameLower.includes(' 2 '))) {
            isNitro2mOrder = true;
          }
        }
      } catch (dbErr) {
        console.error('[Auto-Gmail-Guide] DB check err:', dbErr);
      }
    }

    if (hasGmail && (isNitro2mOrder || isNichu2mKeyword || isNitroTicketChan)) {
      try {
        sentGmailGuides.add(ticket.id); // Đánh dấu đã gửi để chống spam
        
        const imagePath = path.resolve(__dirname, '../assets/gmail_update.png');
        const attachment = new AttachmentBuilder(imagePath, { name: 'gmail_update.png' });
        
        const embedColor = message.guildId === '1282637033340403754' ? 0x7C3AED : 0xF472B6;
        const brandName = message.guildId === '1282637033340403754' ? 'Cenar Store 1' : 'Cenar Store 2';

        const embed = new EmbedBuilder()
          .setColor(embedColor)
          .setTitle(`## <a:tsm_fire:1327553120842158111> HƯỚNG DẪN BẢO MẬT & DUY TRÌ GMAIL NITRO <:verifybadge:1481127479702847646>`)
          .setDescription([
            `Chào quý khách! <:20952woodstockjump:1282641293474009089>`,
            'Dưới đây là các bước **cực kỳ quan trọng** giúp bạn bảo mật tối đa tài khoản Gmail liên kết Nitro, tránh tình trạng bị quét hoặc khóa tài khoản đáng tiếc từ Google:',
            '<a:ccjdeobt:1481142015994495059><a:ccjdeobt:1481142015994495059><a:ccjdeobt:1481142015994495059><a:ccjdeobt:1481142015994495059><a:ccjdeobt:1481142015994495059>',
            '',
            '### <a:starxoay:1481141954346483845> 1. DUY TRÌ TRẠNG THÁI ĐĂNG NHẬP',
            '> * <a:chamxanh:1481124932447371374> Sau khi đăng nhập thành công, bạn vui lòng **LOG OUT - LOG IN** thường xuyên để kiểm tra.',
            '> * <a:chamxanh:1481124932447371374> *Chú ý:* Gmail bị khóa (die) trên điện thoại và PC nhiều khi không hiển thị thông báo lỗi trực tiếp.',
            '',
            '### <a:starxoay:1481141954346483845> 2. CẬP NHẬT THÔNG TIN KHÔI PHỤC (Làm ngay lập tức)',
            '> *Sau khi login, hãy bổ sung ngay số điện thoại & mail khôi phục để tránh Google quét xác minh:*',
            '> * <a:69_Arrow:1448888143120957532> **Thêm Số điện thoại khôi phục (Recovery Phone):**',
            '>   👉 [Bấm vào đây để thiết lập](https://myaccount.google.com/signinoptions/rescuephone)',
            '> * <a:69_Arrow:1448888143120957532> **Thêm Email khôi phục (Recovery Gmail):**',
            '>   👉 [Bấm vào đây để thiết lập](https://myaccount.google.com/intro/recovery/email)',
            '',
            '### <a:starxoay:1481141954346483845> 3. THAY ĐỔI THÔNG TIN BẢO MẬT (Nên làm sau 7 - 14 ngày)',
            '> *Đợi mail sống ổn định từ 7-14 ngày trên thiết bị mới rồi mới tiến hành thay đổi các thông tin sau để tránh bị Google khóa tài khoản:*',
            '> * <a:chamxanh:1481124932447371374> **Thay đổi Số xác minh (Verification Phone):** Cực kỳ quan trọng - **NÊN ĐỔI + XÓA SỐ LẠ**.',
            '>   👉 [Bấm vào đây để thay đổi](https://myaccount.google.com/phone)',
            '> * <a:chamxanh:1481124932447371374> **Xác minh khuôn mặt (Video Verification):** Giúp tăng 200% độ bảo mật cho tài khoản.',
            '>   👉 [Bấm vào đây để xác minh](https://myaccount.google.com/video-verification/signin/precollection)',
            '',
            '<a:ccjdeobt:1481142015994495059><a:ccjdeobt:1481142015994495059><a:ccjdeobt:1481142015994495059><a:ccjdeobt:1481142015994495059><a:ccjdeobt:1481142015994495059>',
            '🚨 **🚨 PHÁT HIỆN THIẾT BỊ LẠ ĐĂNG NHẬP ≫ ĐỔI PASSWORD + 2FA NGAY LẬP TỨC! 🚨**',
            '',
            `-# *Nếu cần hỗ trợ thêm, bạn hãy nhắn trực tiếp tại ticket này để staff ${brandName} hỗ trợ ngay nhé!* <:purple_heart_glow:1327541911749263360>`
          ].join('\n'))
          .setImage('attachment://gmail_update.png')
          .setFooter({ text: `${brandName} — Phục Vụ Uy Tín & Tận Tâm 💜` })
          .setTimestamp();

        await message.channel.send({
          embeds: [embed],
          files: [attachment]
        });
        console.log(`[Auto-Gmail-Guide] Sent safety guide for order in channel ${message.channel.name}`);
      } catch (err) {
        console.error('[Auto-Gmail-Guide-Err]', err);
      }
    }
  }

  // ═══════════════════════════════════════════════
  // ANTI-SCAM & LINK CHECK (Chỉ áp dụng cho User thường)
  // ═══════════════════════════════════════════════
  if (!isStaff && message.member) {
    // 1. Kiểm tra MrBeast Scam Image
    const isScam = await isMrBeastScam(message);
    if (isScam) {
      console.log(`[Anti-Scam] MrBeast scam detected from user ${message.author.tag}. Deleting message and banning.`);
      await message.delete().catch(() => null);
      
      logAbuseEvent(message.guildId, message.author.id, 'MRBEAST_SCAM_BAN', `Nội dung: ${message.content || 'chỉ có ảnh'}`);
      
      await message.member.ban({ reason: 'Gửi hình ảnh MrBeast scam / lừa đảo.' }).catch(err => {
        console.error(`[Anti-Scam] Failed to ban user ${message.author.tag}:`, err.message);
      });
      
      await message.channel.send(`${E('status_warn')} **Cảnh báo bảo mật:** Tài khoản của <@${message.author.id}> đã bị cấm khỏi server vì gửi hình ảnh/nội dung lừa đảo giả mạo (MrBeast Scam).`).catch(() => null);
      return;
    }

    // 2. Kiểm tra chặn Link (Trừ kênh ticket)
    const isTicketChan = isTicketChannel(message.channel, guildConfig);
    const linkRegex = /(https?:\/\/[^\s]+|discord\.gg\/[^\s]+)/gi;
    const hasLink = linkRegex.test(message.content);

    if (hasLink && !isTicketChan && !(isPartnerChannel && isPartner)) {
      console.log(`[Anti-Link] Link detected from user ${message.author.tag} in non-ticket channel. Deleting.`);
      await message.delete().catch(() => null);
      
      const newCount = incrementLinkWarningCount(message.author.id, message.guildId);
      logAbuseEvent(message.guildId, message.author.id, 'LINK_WARNING', `Link: ${message.content}, Lần thứ: ${newCount}`);

      if (newCount <= 3) {
        await message.channel.send(`${E('status_warn')} <@${message.author.id}>, không được phép gửi liên kết quảng cáo tại kênh này! Đây là lần nhắc nhở thứ **${newCount}/3** của bạn.`).catch(() => null);
      } else if (newCount === 4) {
        // Mute (timeout) 24h
        const timeoutMs = 24 * 60 * 60 * 1000;
        await message.member.timeout(timeoutMs, 'Gửi liên kết quảng cáo quá 3 lần.').catch(err => {
          console.error(`[Anti-Link] Failed to timeout user ${message.author.tag}:`, err.message);
        });
        await message.channel.send(`${E('status_cross')} <@${message.author.id}> đã bị cấm chat **24 giờ** vì cố tình gửi liên kết quảng cáo quá 3 lần.`).catch(() => null);
      } else {
        // Lần 5+ -> Ban
        await message.member.ban({ reason: 'Gửi liên kết quảng cáo liên tục lần thứ 5.' }).catch(err => {
          console.error(`[Anti-Link] Failed to ban user ${message.author.tag}:`, err.message);
        });
        await message.channel.send(`${E('status_cross')} **Trừng phạt:** <@${message.author.id}> đã bị cấm khỏi server vì tiếp tục gửi liên kết quảng cáo (Lần thứ ${newCount}).`).catch(() => null);
      }
      return;
    }
  }

  // ═══════════════════════════════════════════════
  // AI KIỂM DUYỆT (MODERATION)
  // Chỉ áp dụng cho User thường, tin nhắn > 5 ký tự
  // ═══════════════════════════════════════════════
  const contentLower = message.content.toLowerCase();
  const suspiciousKeywords = ['lừa đảo', 'scam', 'chậm', 'lâu', 'chưa thấy', 'đợi', 'thái độ', 'rác', 'cứt', 'địt', 'lồn', 'cặc', 'loz', 'đm', 'vkl', 'vl', 'đéo', 'ngu', 'câm', 'dở', 'tệ', 'kém', 'phốt', 'chửi'];
  const isSuspicious = suspiciousKeywords.some(kw => contentLower.includes(kw));

  // AI Moderation disabled by user request to prevent false positives when customers send account credentials
  if (false) {
    const modResult = await moderateMessage(message.content);
    if (modResult) {
      if (modResult.category === 'INSULT') {
        await message.delete().catch(() => null);
        await message.member.timeout(3 * 24 * 60 * 60 * 1000, modResult.reason || 'Dùng từ ngữ xúc phạm shop').catch(() => null);
        await message.channel.send(`<@${message.author.id}> đã bị cấm chat 3 ngày vì vi phạm tiêu chuẩn cộng đồng/xúc phạm cửa hàng.`).catch(() => null);
        return;
      }
      if (modResult.category === 'SEVERE_COMPLAINT') {
        await message.delete().catch(() => null);
        return;
      }
      if (modResult.category === 'DELAY_COMPLAINT') {
        await message.delete().catch(() => null);
        await message.channel.send(`<@${message.author.id}> Các đơn hàng vẫn đang được tiến hành, nếu chậm là do nguyên liệu đang gặp vấn đề. Bạn thông cảm chờ thêm nhé!`).catch(() => null);
        return;
      }
      if (modResult.category === 'MILD_COMPLAINT' && modResult.replyText) {
        await message.reply(modResult.replyText).catch(() => null);
        return;
      }
      // Nếu là NORMAL thì cho đi tiếp xuống dưới
    }
  }

  const isMentioned = message.mentions.has(message.client.user);

  // ═══════════════════════════════════════════════
  // TRƯỜNG HỢP 1: TIN NHẮN TRONG TICKET
  // ═══════════════════════════════════════════════
  if (ticket && ticket.status === 'OPEN') {
    const isCustomer = ticket.customer_id === message.author.id;

    if (isStaff && !isCustomer) {
      if (isMentioned) {
        // Staff cố tình tag bot -> Yêu cầu bot làm việc -> Bật lại AI
        if (ticket.ai_status === 'PAUSED') {
          updateTicketAiStatus(ticket.id, 'ACTIVE');
        }
        await withChannelLock(message.channel.id, () => processAiMessage(message, true, true));
        return;
      } else {
        // Staff chat bình thường -> tắt AI tự động
        if (ticket.ai_status !== 'PAUSED') {
          updateTicketAiStatus(ticket.id, 'PAUSED');
        }
        return;
      }
    }

    // Khách hàng chat và AI đang bật
    if (isCustomer && ticket.ai_status !== 'PAUSED') {
      await withChannelLock(message.channel.id, () => processAiMessage(message, true, false));
    }
    return;
  }

  // ═══════════════════════════════════════════════
  // TRƯỜNG HỢP 2: TIN NHẮN KÊNH CHUNG (PUBLIC CHAT)
  // ═══════════════════════════════════════════════
  const purchaseKeywords = ['giá', 'nhiêu', 'shop ơi', 'hỏi', 'còn hàng', 'mua', 'tư vấn', 'hỗ trợ', 'lỗi', 'bảo hành', 'cách làm', 'thế nào', 'sao', 'không', 'ko'];
  
  const hasIntent = !isStaff && contentLower.length >= 5 && purchaseKeywords.some(kw => contentLower.includes(kw));

  if (isMentioned || hasIntent) {
    // Không reply ở các kênh log
    if (message.channel.id === guildConfig.order_log_channel_id || 
        message.channel.id === guildConfig.staff_log_channel_id ||
        message.channel.id === guildConfig.feedback_channel_id ||
        message.channel.id === guildConfig.transcript_channel_id) {
      return;
    }
    
    await withChannelLock(message.channel.id, () => processAiMessage(message, false, isStaff));
  }
}
