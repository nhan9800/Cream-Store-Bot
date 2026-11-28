import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
} from 'discord.js';
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';
import { normalizeV2Text } from '../utils/uiKit.js';

const TERMS_MARKER_PREFIX = 'CENAR-TERMS-BOARD-';
const LEGACY_TERMS_TEXT_MARKERS = Object.freeze([
  'ĐIỀU KHOẢN DỊCH VỤ & CHÍNH SÁCH BẢO HÀNH',
  'CHÍNH SÁCH BẢO HÀNH CHUNG',
  'QUY ĐỊNH BẢO HÀNH & GIA HẠN DISCORD NITRO',
  'QUY ĐỊNH DỊCH VỤ YOUTUBE PREMIUM',
  'CHÍNH SÁCH & QUY ĐỊNH NETFLIX',
  'CAM KẾT TRẢ ĐƠN & TIẾN ĐỘ',
  'Điều khoản có thể được cập nhật theo chính sách',
]);

export const TERMS_BOARD = Object.freeze({
  guildId: '1282637033340403754',
  channelId: '1514597981666672691',
  supportChannelId: '1514607020098191393',
  youtubeGuideChannelId: '1568246979128074280',
  nitroGuideChannelId: '1568246897754513518',
  websiteTermsUrl: 'https://cenarstore.xyz/terms',
  // V2 approved by the owner on 2026-11-28; same rules as the website /terms page.
  marker: 'CENAR-TERMS-BOARD-V2',
  effectiveDate: '28/11/2026',
  familyRejoinFee: 65_000,
  processingOrderRefundPercent: 50,
  maxRefundFeePercent: 50,
  providerChangeFeePercent: 30,
  flags: MessageFlags.IsComponentsV2,
});

function money(value) {
  return `${Number(value).toLocaleString('vi-VN')}đ`;
}

const section = (accent, lines) => new ContainerBuilder()
  .setAccentColor(accent)
  .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text(lines.join('\n'))));

export function buildTermsBoardPayload() {
  const policy = TERMS_BOARD;
  const E = createEmojiResolver(policy.guildId);

  const header = section(0x7C3AED, [
    `# ${E('icon_book')} ĐIỀU KHOẢN DỊCH VỤ, BẢO HÀNH & HOÀN TIỀN · V2`,
    `${E('icon_calendar')} Hiệu lực từ **${policy.effectiveDate}**. Đơn đã thanh toán theo điều khoản lúc mua, trừ khi bản mới có lợi hơn cho bạn.`,
  ]);

  const orderAndWarranty = section(0x2563EB, [
    `## ${E('warranty_shield')} 01 · ĐẶT HÀNG, GIAO HÀNG & BẢO HÀNH`,
    `${E('order_id')} Giữ mã đơn \`CN_xxxxxx\`; chuyển đúng số tiền và nội dung QR.`,
    `${E('icon_price')} Giá sale đăng trên Discord áp dụng khi đặt qua ticket.`,
    `${E('icon_clock')} Quá **24 giờ** sau thanh toán chưa giao (trừ gói ghi lâu hơn): chờ tiếp hoặc **hoàn 100%**.`,
    `${E('status_check')} Bảo hành theo từng gói. Lỗi shop không sửa được: hoàn phần còn lại, **phí 0%**.`,
    `${E('ticket_open')} Báo sự cố tại <#${policy.supportChannelId}> trước khi tự thao tác.`,
    `${E('icon_heart')} Feedback **không phải điều kiện bảo hành**. Rời server không làm mất bảo hành.`,
  ]);

  const refund = section(0xF97316, [
    `## ${E('payment_money')} 02 · HỦY ĐƠN & HOÀN TIỀN`,
    `**Số hoàn = Đã trả − Thời gian đã dùng − Phí xử lý (0–${policy.maxRefundFeePercent}%) − Chi phí khác có tên**`,
    `• Đổi ý khi **đang xử lý**: hoàn tối đa **${policy.processingOrderRefundPercent}%** sau đối soát chi phí. Đã giao đúng mà đổi ý: shop không bắt buộc hoàn.`,
    `• Nhà cung cấp đổi chính sách / ngừng dịch vụ: hoàn phần còn lại, phí thường **${policy.providerChangeFeePercent}%**.`,
    `${E('payment_qr')} Bạn **xem trước** bảng tính, STK, tên, số tiền và QR trong ticket riêng rồi mới xác nhận.`,
    `${E('icon_cycle')} Trước khi chuyển, shop có thể gửi bảng mới kèm lý do; bạn xác nhận lại.`,
    `${E('status_warn')} Chuyển khoản dự kiến **2–3 tuần**. Shop không hỏi mật khẩu, số thẻ, OTP. Vi phạm quy định làm mất gói: không hoàn.`,
  ]);

  const family = section(0xFF0000, [
    `## ${E('brand_youtube', 'cenar_youtube')} 03 · YOUTUBE & SPOTIFY FAMILY`,
    `${E('icon_group')} **Không tự rời nhóm**; mất Premium thì báo shop ngay.`,
    `> Tự rời nhóm: hết bảo hành miễn phí, phí thêm lại **${money(policy.familyRejoinFee)}**, gồm 1 lần kiểm tra giới hạn Family; không cam kết mọi Gmail.`,
    '• Báo lỗi YouTube: gửi Gmail, Gmail chủ Family, mã đơn.',
  ]);

  const nitro = section(0x5865F2, [
    `## ${E('brand_nitro', 'cenar_board26_nitro')} 04 · NITRO LOGIN & MAIL SHOP CẤP`,
    `${E('icon_key')} **Bảo mật ngay:** đổi mật khẩu Gmail, bật 2FA, thêm SĐT và email khôi phục.`,
    '• Giữ mail shop cấp **suốt thời gian sử dụng** để được bảo hành và gia hạn.',
    '• Mail chết, Nitro còn: báo Admin ngay. Mất cả mail và Nitro do chưa bảo mật: ngoài bảo hành, shop hỗ trợ giá ưu đãi mua lại.',
  ]);

  const netflix = section(0xE50914, [
    `## ${E('brand_netflix', 'cenar_board26_netflix')} 05 · NETFLIX & TÀI KHOẢN DÙNG CHUNG`,
    `${E('ticket_user')} Giữ nguyên tên hồ sơ, PIN, email, mật khẩu; không dùng hồ sơ người khác, không thêm thanh toán.`,
    `${E('music_play')} Đăng nhập tối đa **3 thiết bị**. Chỉ xem trên **1 thiết bị cùng lúc**.`,
    '> Xem cùng lúc từ **2 thiết bị**: thu hồi quyền dùng, không bảo hành.',
  ]);

  const ownAccounts = section(0x10B981, [
    `## ${E('order_product')} 06 · TÀI KHOẢN CHÍNH CHỦ, KEY & DỊCH VỤ DISCORD`,
    '• **Chính chủ** (ChatGPT, Gemini, Canva…): không tự hủy gói, đổi thanh toán, rời workspace khi chưa hỏi shop; bị khóa do bạn vi phạm chính sách thì không bảo hành.',
    '• **Key Windows:** 1 key 1 máy; bảo hành kích hoạt lần đầu, cài lại cùng máy được hỗ trợ, đổi mainboard/máy thì không.',
    '• Nitro Trial cần tài khoản đủ điều kiện. Làm Decor/Boost xong thì đổi mật khẩu.',
  ]);

  const footer = section(0xF59E0B, [
    `## ${E('icon_announce')} 07 · GIA HẠN, ỨNG XỬ & CẬP NHẬT`,
    `${E('music_refresh')} Bot nhắc gia hạn khoảng **3 ngày** trước khi hết hạn; gia hạn bằng \`/renew\` hoặc ticket.`,
    `${E('status_info')} Lăng mạ, đe doạ, quấy rối sau khi được nhắc: shop dừng hỗ trợ; đơn đã trả xử lý theo mục 02.`,
    '• Thay đổi được đăng tại kênh này và website. Quyền người tiêu dùng theo luật luôn được giữ.',
    `-# ${policy.marker}`,
  ]);

  const supportButton = withButtonEmoji(
    new ButtonBuilder()
      .setCustomId('ticket:create:SUPPORT')
      .setLabel('Liên Hệ Admin Hỗ Trợ')
      .setStyle(ButtonStyle.Primary),
    E.component('cenar_support'),
    E.component('ticket_open'),
  );
  const websiteButton = withButtonEmoji(
    new ButtonBuilder().setLabel('Toàn Văn Trên Website').setStyle(ButtonStyle.Link).setURL(policy.websiteTermsUrl),
    E.component('icon_web'),
  );
  const youtubeGuideButton = withButtonEmoji(
    new ButtonBuilder()
      .setLabel('Hướng Dẫn YouTube')
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${policy.guildId}/${policy.youtubeGuideChannelId}`),
    E.component('icon_search'),
  );
  const nitroGuideButton = withButtonEmoji(
    new ButtonBuilder()
      .setLabel('Hướng Dẫn Nitro')
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${policy.guildId}/${policy.nitroGuideChannelId}`),
    E.component('icon_tip'),
  );

  return {
    components: [
      header,
      orderAndWarranty,
      refund,
      family,
      nitro,
      netflix,
      ownAccounts,
      footer,
      new ActionRowBuilder().addComponents(supportButton, websiteButton, youtubeGuideButton, nitroGuideButton),
    ],
    flags: policy.flags,
    allowedMentions: { parse: [], roles: [], users: [], repliedUser: false },
  };
}

function containsText(component, predicate) {
  if (typeof component?.content === 'string' && predicate(component.content)) return true;
  return Array.isArray(component?.components)
    && component.components.some((child) => containsText(child, predicate));
}

function messageContains(message, predicate) {
  if (typeof message?.content === 'string' && predicate(message.content)) return true;
  return Array.isArray(message?.components)
    && message.components.some((component) => containsText(component, predicate));
}

function hasCurrentMarker(message) {
  return messageContains(message, (text) => text.includes(TERMS_BOARD.marker));
}

export function isTermsBoardMessage(message, botUserId) {
  if (message?.author?.id !== botUserId) return false;
  return messageContains(message, (text) => (
    text.includes(TERMS_MARKER_PREFIX)
    || LEGACY_TERMS_TEXT_MARKERS.some((marker) => text.includes(marker))
  ));
}

export async function publishTermsBoard(client) {
  const policy = TERMS_BOARD;
  const guild = client.guilds.cache.get(policy.guildId)
    || await client.guilds.fetch(policy.guildId).catch(() => null);
  if (!guild) throw new Error(`Không tìm thấy guild ${policy.guildId}`);

  const channel = guild.channels.cache.get(policy.channelId)
    || await guild.channels.fetch(policy.channelId).catch(() => null);
  if (!channel?.isTextBased?.() || !channel.messages) {
    throw new Error(`Kênh điều khoản ${policy.channelId} không khả dụng`);
  }

  const [recent, pinned] = await Promise.all([
    channel.messages.fetch({ limit: 100 }),
    channel.messages.fetchPinned().catch(() => null),
  ]);
  const candidates = new Map();
  for (const message of recent.values()) candidates.set(message.id, message);
  for (const message of pinned?.values?.() || []) candidates.set(message.id, message);

  const boards = [...candidates.values()]
    .filter((message) => isTermsBoardMessage(message, client.user.id));
  // An older versioned board (e.g. V1) is edited in place to the current version.
  const current = boards.find(hasCurrentMarker)
    || boards.find((message) => messageContains(message, (text) => text.includes(TERMS_MARKER_PREFIX)));
  const payload = buildTermsBoardPayload();

  if (current) {
    await current.edit(payload);
    await Promise.all(boards
      .filter((message) => message.id !== current.id)
      .map((message) => message.delete().catch(() => null)));
    await current.pin().catch(() => null);
    return { status: 'updated', messageId: current.id, removed: boards.length - 1 };
  }

  const message = await channel.send(payload);
  await message.pin().catch(() => null);
  await Promise.all(boards.map((legacy) => legacy.delete().catch(() => null)));
  return { status: 'published', messageId: message.id, removed: boards.length };
}
