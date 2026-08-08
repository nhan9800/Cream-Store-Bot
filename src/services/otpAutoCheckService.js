import { ContainerBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from 'discord.js';
import { db } from '../database/db.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { emitAutomationLog, maskPhone } from './automationLogService.js';
import { completeOtpOrder, expireOtpOrder, failOtpOrder } from './otpLifecycleService.js';
import { checkSession } from './viotpService.js';

let intervalHandle = null;

function privateOtpNotice(guildId, { title, summary, lines = [], status = 'info' }) {
  const E = createEmojiResolver(guildId);
  const palette = {
    success: { color: 0x57f287, emoji: E('status_check') },
    warning: { color: 0xfee75c, emoji: E('status_warn') },
    danger: { color: 0xed4245, emoji: E('status_cross') },
    info: { color: 0x5865f2, emoji: E('status_info') },
  };
  const tone = palette[status] || palette.info;
  const container = new ContainerBuilder().setAccentColor(tone.color);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${tone.emoji} ${title}`,
    `> ${summary}`,
    '',
    ...lines,
  ].join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${E('cenar_verified')} Cenar OTP · Thông tin riêng tư chỉ dành cho bạn`));
  return container;
}

async function sendPrivate(client, order, options) {
  const user = await client.users.fetch(order.customer_id).catch(() => null);
  if (!user) return;
  await user.send({
    components: [privateOtpNotice(order.guild_id, options)],
    flags: MessageFlags.IsComponentsV2,
  }).catch((error) => console.error(`[OTP Auto] Không thể gửi DM cho khách ${order.customer_id}:`, error.message));
}

async function complete(client, order, sessionData) {
  const result = completeOtpOrder(order.request_id, sessionData.Code);
  if (!result.transitioned) return;
  const E = createEmojiResolver(order.guild_id);
  await sendPrivate(client, order, {
    title: 'ĐÃ NHẬN ĐƯỢC MÃ OTP',
    summary: 'Tin nhắn xác minh đã về. Hãy nhập mã ngay trước khi mã hết hiệu lực.',
    status: 'success',
    lines: [
      `${E('panel_order')} **Dịch vụ** — ${order.service_name}`,
      `${E('icon_id')} **Số điện thoại** — \`${order.phone_number}\``,
      `${E('icon_key')} **Mã OTP** — \`${sessionData.Code}\``,
      `${E('status_info')} **Nội dung SMS** — ${String(sessionData.SmsContent || 'Nhà cung cấp không trả nội dung').slice(0, 500)}`,
    ],
  });
  await emitAutomationLog(client, {
    guildId: order.guild_id,
    customerId: order.customer_id,
    action: 'OTP_COMPLETED',
    title: 'ĐÃ NHẬN MÃ OTP',
    summary: 'Phiên hoàn tất; mã xác minh không được ghi vào kênh log.',
    reference: order.request_id,
    status: 'success',
    fields: [
      { label: 'Dịch vụ', value: order.service_name, emoji: 'status_check' },
      { label: 'Số thuê', value: `\`${maskPhone(order.phone_number)}\``, emoji: 'icon_id' },
    ],
  });
}

async function refund(client, order, { failed = false, providerMessage = '' } = {}) {
  const reason = failed
    ? `Hoàn tiền OTP lỗi phiên (${order.service_name})`
    : `Hoàn tiền OTP tự động hết hạn (${order.service_name})`;
  const result = failed
    ? failOtpOrder(order.request_id, reason)
    : expireOtpOrder(order.request_id, reason);
  if (!result.transitioned) return;
  const E = createEmojiResolver(order.guild_id);
  await sendPrivate(client, order, {
    title: failed ? 'PHIÊN OTP GẶP LỖI' : 'PHIÊN OTP ĐÃ HẾT HẠN',
    summary: failed ? 'Nhà cung cấp không thể tiếp tục phiên này.' : 'Không nhận được mã trong thời gian cho phép.',
    status: failed ? 'danger' : 'warning',
    lines: [
      `${E('panel_order')} **Dịch vụ** — ${order.service_name}`,
      `${E('icon_id')} **Số thuê** — \`${maskPhone(order.phone_number)}\``,
      `${E('payment_refund')} **Đã hoàn ví** — ${Number(order.price).toLocaleString('vi-VN')}đ`,
      providerMessage ? `${E('status_info')} **Nhà cung cấp** — ${providerMessage.slice(0, 300)}` : null,
    ].filter(Boolean),
  });
  await emitAutomationLog(client, {
    guildId: order.guild_id,
    customerId: order.customer_id,
    action: failed ? 'OTP_FAILED_REFUNDED' : 'OTP_EXPIRED_REFUNDED',
    title: failed ? 'OTP LỖI PHIÊN · ĐÃ HOÀN TIỀN' : 'OTP HẾT HẠN · ĐÃ HOÀN TIỀN',
    summary: providerMessage || 'Phiên được khóa idempotent và hoàn ví đúng một lần.',
    reference: order.request_id,
    status: failed ? 'danger' : 'warning',
    fields: [{ label: 'Đã hoàn', value: `${Number(order.price).toLocaleString('vi-VN')}đ`, emoji: 'payment_refund' }],
  });
}

export function startOtpAutoCheck(client) {
  if (intervalHandle) return;

  async function checkLoop() {
    if (!intervalHandle) return;
    try {
      const pendingOrders = db.prepare("SELECT * FROM viotp_orders WHERE status = 'PENDING'").all();
      for (const order of pendingOrders) {
        try {
          const sessionData = await checkSession(order.request_id);
          if (sessionData.Status === 1) {
            await complete(client, order, sessionData);
          } else if (sessionData.Status === 2) {
            await refund(client, order);
          } else if (sessionData.Status === 0) {
            const createdAt = new Date(order.created_at).getTime();
            if (Number.isFinite(createdAt) && Date.now() - createdAt > 10 * 60 * 1000) {
              await refund(client, order);
            }
          }
        } catch (error) {
          const message = String(error?.message || '');
          if (message.includes('Mã phiên không đúng') || message.includes('-2')) {
            await refund(client, order, { failed: true, providerMessage: message });
          } else {
            console.error(`[OTP Auto] Lỗi khi kiểm tra phiên ${order.request_id}:`, message);
          }
        }
      }
    } catch (error) {
      console.error('[OTP Auto] Lỗi vòng lặp quét OTP:', error.message);
    }

    if (intervalHandle) intervalHandle = setTimeout(checkLoop, 15_000);
  }

  intervalHandle = setTimeout(checkLoop, 0);
  console.log('[OTP Auto Check] Service started (15s recursive interval).');
}

export function stopOtpAutoCheck() {
  if (!intervalHandle) return;
  clearTimeout(intervalHandle);
  intervalHandle = null;
  console.log('[OTP Auto Check] Service stopped.');
}
