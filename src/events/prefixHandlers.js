import {
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
} from 'discord.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { getLatestOrderByTicketChannel } from '../services/orderService.js';
import { parseMoneyInput } from '../utils/formatters.js';
import { confirmOrderPaidManually } from '../services/paymentService.js';
import { completeOrderByCode } from './shared.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
import { accentFor } from '../utils/uiKit.js';

export const GMAIL_APPEAL_PROMPT = 'Hãy viết giúp tôi một đoạn thư kháng cáo gửi đến đội ngũ hỗ trợ Google khi tài khoản Gmail của tôi bị gắn cờ là do máy tính hoặc robot tạo ra. Yêu cầu: Giọng văn lịch sự, chuyên nghiệp và chân thành. Có lời chào mở đầu và lời cảm ơn kết thúc gửi đến đội ngũ Google. Trình bày rõ ràng rằng tài khoản do con người thật sử dụng, không phải bot. Nêu lý do có thể khiến hệ thống hiểu nhầm (ví dụ: hoạt động đăng nhập lạ, dùng nhiều thiết bị, v.v.). Giữ độ dài khoảng 2-3 đoạn ngắn, đủ súc tích và dễ đọc. Bằng tiếng Anh, bỏ Subject, bỏ phần full name và your email.';

export function isPublicPrefixCommand(command) {
  return String(command || '').toLowerCase() === '+thanchu';
}

export function buildThanhChuPayload(guildId) {
  const E = createEmojiResolver(guildId);
  const guide = new ContainerBuilder().setAccentColor(accentFor('primary'));
  guide.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    '# HƯỚNG DẪN TẠO VĂN KHÁNG CÁO VỚI CHATGPT',
    '',
    `## ${E('icon_doc')} Hướng dẫn sử dụng ChatGPT`,
    '**Bước 1:** Vào https://chatgpt.com/',
    '**Bước 2:** Nhập prompt sau:',
    '',
    '```text',
    GMAIL_APPEAL_PROMPT,
    '```',
    '',
    '**Bước 3:** Copy văn kháng cáo được tạo và gửi đến Google Support',
  ].join('\n')));

  return {
    components: [guide],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export async function handlePrefixThanhChu(message) {
  if (message.guild?.id !== STORE_ONE_GUILD_ID) return false;
  await message.reply(buildThanhChuPayload(message.guild.id));
  return true;
}

export async function handlePrefixQr(message, args) {
  const E = createEmojiResolver(message.guild?.id);
  const order = getLatestOrderByTicketChannel(message.channel.id);
  if (!order) {
    await message.reply(`${E('status_warn')} Ticket này chưa có đơn nào để xác nhận QR.`).catch(() => null);
    return;
  }

  if (order.payment_status === 'PAID') {
    await message.reply(`${E('status_info')} Đơn ${order.order_code} đã thanh toán rồi.`).catch(() => null);
    return;
  }

  const amount = parseMoneyInput(args.join(' ')) ?? order.total_amount;
  const updated = await confirmOrderPaidManually(message.guild, order.order_code, amount);
  await message.reply(`${E('status_check')} Đã xác nhận tay thanh toán cho đơn ${updated.order_code}.`).catch(() => null);
}

export async function handlePrefixDone(message, args) {
  const E = createEmojiResolver(message.guild?.id);
  const fallbackOrder = getLatestOrderByTicketChannel(message.channel.id);
  const orderCode = args[0]?.trim().toUpperCase() || fallbackOrder?.order_code;
  if (!orderCode) {
    await message.reply(`${E('status_warn')} Hãy nhập mã đơn hoặc dùng lệnh trong ticket có đơn hàng.`).catch(() => null);
    return;
  }

  try {
    const result = await completeOrderByCode(message.guild, orderCode, message.author.id);
    if (!result) {
      await message.reply(`${E('status_warn')} Không tìm thấy mã đơn này.`).catch(() => null);
      return;
    }

    if (result.alreadyCompleted) {
      await message.reply(`${E('status_info')} Đơn ${result.order.order_code} đã hoàn thành trước đó rồi.`).catch(() => null);
      return;
    }

    await message.reply(result.dmResult.dmSent
      ? `${E('status_check')} Đã hoàn tất đơn ${result.order.order_code} và gửi DM cho khách.`
      : `${E('status_check')} Đã hoàn tất đơn ${result.order.order_code}, nhưng DM chưa gửi được cho khách.`).catch(() => null);
  } catch (error) {
    await message.reply(`${E('status_warn')} ${error.message}`).catch(() => null);
  }
}
