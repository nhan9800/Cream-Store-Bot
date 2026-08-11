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
import { getLatestOrderByTicketChannel } from '../services/orderService.js';
import { parseMoneyInput } from '../utils/formatters.js';
import { confirmOrderPaidManually } from '../services/paymentService.js';
import { completeOrderByCode } from './shared.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
import { accentFor } from '../utils/uiKit.js';

export const GMAIL_APPEAL_PROMPT = [
  'Bạn là chuyên viên chăm sóc khách hàng có kinh nghiệm xử lý tài khoản Google.',
  'Hãy soạn một thư kháng cáo bằng tiếng Anh gửi đội ngũ Google để đề nghị xem xét thủ công tài khoản Gmail bị hệ thống nhận diện nhầm là tài khoản được tạo hoặc điều khiển tự động.',
  '',
  'Yêu cầu nội dung:',
  '- Giọng văn lịch sự, chân thành, chuyên nghiệp và tự nhiên.',
  '- Dài khoảng 150–220 từ, chia thành các đoạn ngắn, dễ đọc.',
  '- Xác nhận tôi là người thật và là chủ sở hữu hợp pháp của tài khoản.',
  '- Giải thích rằng hoạt động đăng nhập từ thiết bị, trình duyệt hoặc mạng mới có thể đã gây ra cảnh báo nhầm.',
  '- Cam kết tuân thủ Điều khoản dịch vụ và Chính sách của Google.',
  '- Đề nghị Google kiểm tra thủ công và khôi phục quyền truy cập nếu tài khoản không vi phạm.',
  '- Không bịa đặt tình tiết, không viện dẫn lý do không có thật và không đưa mật khẩu, mã OTP hoặc mã dự phòng vào thư.',
  '- Kết thư bằng lời cảm ơn trang trọng.',
  '',
  'Trả về đúng định dạng sau:',
  'Appeal message:',
  '[Nội dung thư tiếng Anh]',
  '',
  'Full name: [HỌ VÀ TÊN]',
  'Account email: [EMAIL CẦN KHÁNG CÁO]',
  '',
  'Không thêm Subject nếu biểu mẫu Google không yêu cầu.',
].join('\n');

export function buildThanhChuPayload(guildId, requesterId) {
  const E = createEmojiResolver(guildId);
  const guide = new ContainerBuilder().setAccentColor(accentFor('primary'));
  guide.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('brand_chatgpt')} THẦN CHÚ KHÁNG CÁO GMAIL`,
    `> ${E('cenar_support')} Mẫu hướng dẫn dùng ChatGPT để soạn thư kháng cáo rõ ràng, trung thực và chuyên nghiệp.`,
  ].join('\n')));
  guide.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  guide.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${E('icon_link')} BƯỚC 1 · MỞ CHATGPT`,
    `Bấm **Mở ChatGPT** bên dưới, đăng nhập tài khoản của bạn và tạo một cuộc trò chuyện mới.`,
    '',
    `## ${E('icon_doc')} BƯỚC 2 · SAO CHÉP PROMPT`,
    `Sao chép nguyên khối nội dung sau rồi dán vào ChatGPT:`,
    '',
    `\`\`\`text`,
    GMAIL_APPEAL_PROMPT,
    `\`\`\``,
  ].join('\n')));

  const checklist = new ContainerBuilder().setAccentColor(accentFor('success'));
  checklist.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${E('status_check')} BƯỚC 3 · KIỂM TRA VÀ GỬI`,
    `${E('cenar_verified')} Thay chính xác **họ tên** và **email cần kháng cáo** trước khi gửi.`,
    `${E('icon_tip')} Chỉnh lại các chi tiết cho đúng tình trạng thực tế của tài khoản; không gửi máy móc nếu nội dung chưa chính xác.`,
    `${E('status_warn')} Tuyệt đối không cung cấp mật khẩu, mã 2FA, OTP hoặc mã dự phòng cho bất kỳ ai.`,
    `${E('cenar_support')} Sau đó mở trang Trợ giúp tài khoản Google và gửi nội dung vào biểu mẫu phù hợp.`,
    `-# ${E('cenar_staff')} Yêu cầu bởi <@${requesterId}> · Cenar Store Support`,
  ].join('\n')));

  const openChatGpt = withButtonEmoji(
    new ButtonBuilder()
      .setLabel('Mở ChatGPT')
      .setStyle(ButtonStyle.Link)
      .setURL('https://chatgpt.com/'),
    E.component('brand_chatgpt'),
  );
  const openGoogleHelp = withButtonEmoji(
    new ButtonBuilder()
      .setLabel('Trợ Giúp Google')
      .setStyle(ButtonStyle.Link)
      .setURL('https://support.google.com/accounts/answer/40695?hl=vi'),
    E.component('cenar_support'),
  );

  return {
    components: [
      guide,
      checklist,
      new ActionRowBuilder().addComponents(openChatGpt, openGoogleHelp),
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export async function handlePrefixThanhChu(message) {
  if (message.guild?.id !== STORE_ONE_GUILD_ID) return false;
  await message.reply(buildThanhChuPayload(message.guild.id, message.author.id));
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
