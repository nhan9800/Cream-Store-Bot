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
  youtubeGuideChannelId: '1524057155022491679',
  nitroGuideChannelId: '1524057149783937214',
  marker: 'CENAR-TERMS-BOARD-V1',
  youtubeRejoinFee: 65_000,
  processingOrderRefundPercent: 50,
  flags: MessageFlags.IsComponentsV2,
});

const divider = () => new SeparatorBuilder()
  .setDivider(true)
  .setSpacing(SeparatorSpacingSize.Small);

function money(value) {
  return `${Number(value).toLocaleString('vi-VN')}đ`;
}

export function buildTermsBoardPayload() {
  const policy = TERMS_BOARD;
  const E = createEmojiResolver(policy.guildId);

  const header = new ContainerBuilder()
    .setAccentColor(0x7C3AED)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `# ${E('partner_rules')} ĐIỀU KHOẢN DỊCH VỤ & BẢO HÀNH`,
      `> ${E('verify_shield')} Quy định giúp shop xử lý sự cố đúng quy trình và bảo vệ quyền lợi khách hàng.`,
      `> Đặt hàng tại **Cenar Store** đồng nghĩa khách đã đọc và đồng ý với phiên bản mới nhất tại kênh này.`,
    ].join('\n'))));

  const general = new ContainerBuilder()
    .setAccentColor(0x2563EB)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${E('warranty_shield')} 01 · CHÍNH SÁCH BẢO HÀNH CHUNG`,
      `• Giữ mã đơn, thông tin tài khoản và nội dung bàn giao để đối chiếu khi cần.`,
      `• Gửi feedback sau khi hoàn tất đơn để ghi nhận quyền lợi bảo hành.`,
      `• Không tự đổi thông tin, rời nhóm, xoá profile hoặc can thiệp sản phẩm khi chưa được Admin hướng dẫn.`,
      `• Tự ý rời server Cenar Store có thể bị từ chối bảo hành với đơn còn thời hạn.`,
    ].join('\n'))));

  const orderAndConduct = new ContainerBuilder()
    .setAccentColor(0xF97316)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${E('payment_refund')} 02 · HOÀN ĐƠN, CHI PHÍ & QUY TẮC ỨNG XỬ`,
      `### Đơn đã nhập nguồn hoặc đang xử lý`,
      `• Khách yêu cầu huỷ/refund sau khi shop đã nhập hàng hoặc bắt đầu xử lý được hoàn tối đa **${policy.processingOrderRefundPercent}% giá trị sản phẩm**.`,
      `> Phần còn lại đối soát chi phí nguồn hàng, vận hành, thanh toán và thuế đã phát sinh.`,
    ].join('\n'))))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `### Tôn trọng trong trao đổi và hỗ trợ`,
      `• Khách hàng và staff cần lịch sự, cung cấp thông tin đúng sự thật và hợp tác xử lý sự cố.`,
      `• Với hành vi lăng mạ, đe doạ, quấy rối hoặc tiếp tục xúc phạm sau khi được nhắc nhở, shop có quyền dừng hỗ trợ, huỷ đơn và từ chối phục vụ.`,
      `> Chi phí đã phát sinh **không được hoàn lại**; phần giá trị còn lại, nếu có, được đối soát theo chính sách hoàn đơn ở trên.`,
    ].join('\n'))));

  const youtube = new ContainerBuilder()
    .setAccentColor(0xFF0000)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${E('brand_youtube')} 03 · YOUTUBE PREMIUM & GOOGLE FAMILY`,
      `### Khi mất Premium hoặc Family bị lỗi`,
      `• **Việc đầu tiên:** giữ nguyên tài khoản và liên hệ Admin ngay.`,
      `• **Không tự ý rời Google Family.** Tự rời nhóm làm gián đoạn bảo hành và có thể kích hoạt giới hạn Family của Google.`,
    ].join('\n'))))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `### ${E('icon_price')} Trường hợp khách tự ý rời nhóm`,
      `> Đơn **không còn được bảo hành miễn phí**. Muốn tiếp tục sử dụng, khách đóng phí hỗ trợ **${money(policy.youtubeRejoinFee)}** để shop kiểm tra và thêm lại.`,
      `> Phí gồm **một lần kiểm tra/xử lý giới hạn Google Family 12 tháng** nếu Gmail đủ điều kiện; không cam kết mọi Gmail đều xử lý thành công.`,
      `• Nếu Gmail cũ không đủ điều kiện do giới hạn/slot Google, khách phải đổi Gmail; phí thêm lại vẫn là **${money(policy.youtubeRejoinFee)}**.`,
      `• Cần cung cấp **Gmail cá nhân**, **Gmail chủ Family** và **mã đơn**.`,
    ].join('\n'))));

  const nitro = new ContainerBuilder()
    .setAccentColor(0x5865F2)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${E('brand_nitro')} 04 · DISCORD NITRO LOGIN & MAIL SHOP CẤP`,
      `• **Bảo mật ngay khi nhận mail:** đổi mật khẩu Gmail, bật 2FA, thêm số điện thoại và email khôi phục trước khi sử dụng Nitro.`,
      `• Nếu không hoàn tất, shop từ chối trách nhiệm với mất mail, chiếm quyền truy cập hoặc mất Nitro do tài khoản chưa được bảo mật.`,
      `• **Mail còn sống:** giữ mail shop cấp và gia hạn đúng chu kỳ **2 tháng/lần**.`,
      `• **Mail chết nhưng Nitro còn:** liên hệ Admin ngay, không tự can thiệp.`,
      `• **Mail chết và Nitro cũng mất:** **không thuộc phạm vi bảo hành**; shop chỉ hỗ trợ giá ưu đãi nếu khách muốn mua lại.`,
      `> Bảo quản mail shop cấp là điều kiện bắt buộc để duy trì bảo hành và gia hạn.`,
    ].join('\n'))));

  const netflix = new ContainerBuilder()
    .setAccentColor(0xE50914)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${E('brand_netflix')} 05 · QUY ĐỊNH NETFLIX`,
      `• Không đổi mật khẩu tài khoản, không xoá hoặc truy cập profile của người khác.`,
      `• Được đổi tên/đặt PIN profile của mình nhưng phải báo lại shop.`,
      `• Được đăng nhập nhiều thiết bị nhưng chỉ xem đồng thời trên **01 thiết bị**, trừ khi gói ghi khác.`,
    ].join('\n'))));

  const footer = new ContainerBuilder()
    .setAccentColor(0xF59E0B)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${E('cenar_verified')} 06 · TIẾN ĐỘ, HỖ TRỢ & HIỆU LỰC`,
      `• Tiến độ phụ thuộc nguồn hàng; staff sẽ cập nhật trong ticket.`,
      `• Báo sự cố tại <#${policy.supportChannelId}> **trước khi tự thao tác**.`,
      `• Điều khoản có thể đổi theo nhà cung cấp; phiên bản tại kênh này là phiên bản có hiệu lực.`,
      `-# ${policy.marker}`,
    ].join('\n'))));

  const supportButton = withButtonEmoji(
    new ButtonBuilder()
      .setCustomId('ticket:create:SUPPORT')
      .setLabel('Liên Hệ Admin Hỗ Trợ')
      .setStyle(ButtonStyle.Primary),
    E.component('cenar_support'),
    E.component('ticket_open'),
  );
  const youtubeGuideButton = withButtonEmoji(
    new ButtonBuilder()
      .setLabel('Hướng Dẫn YouTube')
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${policy.guildId}/${policy.youtubeGuideChannelId}`),
    E.component('brand_youtube'),
  );
  const nitroGuideButton = withButtonEmoji(
    new ButtonBuilder()
      .setLabel('Hướng Dẫn Nitro')
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${policy.guildId}/${policy.nitroGuideChannelId}`),
    E.component('brand_nitro'),
  );

  return {
    components: [
      header,
      general,
      orderAndConduct,
      youtube,
      nitro,
      netflix,
      footer,
      new ActionRowBuilder().addComponents(supportButton, youtubeGuideButton, nitroGuideButton),
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
  const current = boards.find(hasCurrentMarker);
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
