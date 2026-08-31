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

export const YOUTUBE_STABILITY_TRANSITION = Object.freeze({
  guildId: '1282637033340403754',
  announcementChannelId: '1514598369597587546',
  supportChannelId: '1514607020098191393',
  priceChannelId: '1514606995842273280',
  marker: 'CENAR-YOUTUBE-STABILITY-TRANSITION-2026-09',
  storeUrl: 'https://cenarstore.xyz/products',
  effectiveDate: '01/09/2026',
  retailPrices: Object.freeze([
    Object.freeze({ duration: '1 tháng', price: '60.000đ' }),
    Object.freeze({ duration: '3 tháng', price: '195.000đ' }),
    Object.freeze({ duration: '6 tháng', price: '320.000đ' }),
    Object.freeze({ duration: '12 tháng', price: '580.000đ' }),
  ]),
});

export function buildYoutubeStabilityTransitionSections(
  guildId,
  E = createEmojiResolver(guildId),
) {
  const header = [
    `# ${E('brand_youtube')} THÔNG BÁO CHUYỂN ĐỔI DỊCH VỤ YOUTUBE PREMIUM`,
    '> Cenar Store xin thông báo chính sách hỗ trợ dành cho khách vừa mua dòng **đổi Family mỗi tháng** và các đơn YouTube thuộc lô cũ đang có dấu hiệu thiếu ổn định.',
    '',
    `${E('status_warn')} YouTube liên tục thay đổi cơ chế xác minh Family/hộ gia đình. Để bảo vệ trải nghiệm và quyền lợi khách hàng, shop chủ động chuyển đổi sớm thay vì tiếp tục duy trì một nguồn hàng không còn đủ ổn định.`,
    `-# Chính sách có hiệu lực từ ${YOUTUBE_STABILITY_TRANSITION.effectiveDate}.`,
  ].join('\n');

  const options = [
    `## ${E('cenar_support')} HAI PHƯƠNG ÁN DÀNH CHO ĐƠN BỊ ẢNH HƯỞNG`,
    `### ${E('guide_upgrade')} PHƯƠNG ÁN 1 · NÂNG CẤP DÒNG ỔN ĐỊNH CAO`,
    '- Shop kiểm tra thời hạn còn lại và tình trạng thực tế của đơn.',
    '- Khách được chuyển sang dòng YouTube ổn định cao; phần chênh lệch, nếu có, sẽ được báo rõ trước khi xử lý.',
    '- Dòng mới không vận hành bằng cơ chế đổi Family mỗi tháng, hạn chế tối đa tình trạng mất Premium và được ưu tiên bảo hành theo thời hạn gói.',
    '',
    `### ${E('guide_refund')} PHƯƠNG ÁN 2 · ĐỐI SOÁT QUYỀN LỢI`,
    '- Sau khi xác minh đơn đủ điều kiện, khách có thể chọn **hoàn 50% giá trị sản phẩm**.',
    `- Hoặc ${E('guide_exchange')} **đổi sang sản phẩm khác tại shop**; giá trị hỗ trợ và phần chênh lệch được xác nhận minh bạch theo từng đơn trước khi thực hiện.`,
    '',
    `${E('status_info')} Hai phương án trên áp dụng cho đơn thuộc diện ảnh hưởng sau khi shop kiểm tra mã đơn, Gmail đăng ký và trạng thái dịch vụ.`,
  ].join('\n');

  const pricing = [
    `## ${E('icon_price')} DÒNG YOUTUBE ĐANG MỞ BÁN`,
    `${E('status_cross')} Shop đã **dừng toàn bộ dòng đổi Family/gia hạn mỗi tháng**, bao gồm gói 12 tháng gia hạn 1 tháng/lần. Các đơn cũ vẫn được lưu để đối soát và hỗ trợ.`,
    `${E('cenar_verified')} Từ nay shop chỉ mở bán **YouTube Premium · Ổn định cao**:`,
    ...YOUTUBE_STABILITY_TRANSITION.retailPrices.map(({ duration, price }) => (
      `- **${duration}:** \`${price}\``
    )),
    '',
    `${E('warranty_shield')} Mức giá được điều chỉnh để ưu tiên nguồn hàng, quy trình vận hành và chất lượng bảo hành ổn định hơn. Do chính sách nền tảng có thể tiếp tục thay đổi, shop cam kết **hạn chế tối đa tình trạng mất Premium và hỗ trợ theo chính sách**, thay vì đưa ra lời hứa tuyệt đối thiếu căn cứ.`,
    '',
    `## ${E('icon_ticket')} CÁCH GỬI YÊU CẦU`,
    '1. Mở **một ticket hỗ trợ**.',
    '2. Gửi **mã đơn + Gmail đã đăng ký**.',
    '3. Ghi rõ lựa chọn: **nâng cấp**, **hoàn 50%** hoặc **đổi sản phẩm**.',
    '4. Không gửi lặp lại nhiều ticket để shop có thể xử lý đúng thứ tự.',
    '',
    `${E('icon_heart_purple')} Cenar Store chân thành xin lỗi vì sự bất tiện và cảm ơn mọi người đã đồng hành. Shop sẽ đối soát từng trường hợp rõ ràng, công bằng và có trách nhiệm.`,
    `-# ${YOUTUBE_STABILITY_TRANSITION.marker}`,
  ].join('\n');

  return { header, options, pricing };
}

export function buildYoutubeStabilityTransitionMessage({
  guildId = YOUTUBE_STABILITY_TRANSITION.guildId,
  tagEveryone = true,
  E = createEmojiResolver(guildId),
} = {}) {
  const sections = buildYoutubeStabilityTransitionSections(guildId, E);
  const buildContainer = (content, color) => new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small),
    );

  const supportUrl = `https://discord.com/channels/${guildId}/${YOUTUBE_STABILITY_TRANSITION.supportChannelId}`;
  const priceUrl = `https://discord.com/channels/${guildId}/${YOUTUBE_STABILITY_TRANSITION.priceChannelId}`;
  const supportButton = withButtonEmoji(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Mở Ticket Hỗ Trợ')
      .setURL(supportUrl),
    E.component?.('ticket_open'),
    E.component?.('cenar_support'),
  );
  const priceButton = withButtonEmoji(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Xem Bảng Giá Mới')
      .setURL(priceUrl),
    E.component?.('icon_price'),
    E.component?.('brand_youtube'),
  );
  const storeButton = withButtonEmoji(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Mở Cenar Store')
      .setURL(YOUTUBE_STABILITY_TRANSITION.storeUrl),
    E.component?.('icon_store'),
  );

  return {
    components: [
      buildContainer(`${tagEveryone ? '@everyone\n' : ''}${sections.header}`, 0xff0033),
      buildContainer(sections.options, 0xf59e0b),
      buildContainer(sections.pricing, 0x22c55e),
      new ActionRowBuilder().addComponents(supportButton, priceButton, storeButton),
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      parse: tagEveryone ? ['everyone'] : [],
      roles: [],
      users: [],
      repliedUser: false,
    },
  };
}

export function isYoutubeStabilityTransitionAnnouncement(message, botId) {
  return message?.author?.id === botId
    && JSON.stringify(message.toJSON?.() || message)
      .includes(YOUTUBE_STABILITY_TRANSITION.marker);
}
