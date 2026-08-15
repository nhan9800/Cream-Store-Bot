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

export const SERVER_BOOST_LEVEL3_SALE = Object.freeze({
  guildId: '1282637033340403754',
  channelId: '1515008584549797979',
  audienceRoleId: '1282638730812854345',
  marker: 'CENAR SERVER BOOST LEVEL 3 · 3 MONTHS · 5 SLOTS',
  durationMonths: 3,
  price: 250_000,
  slots: 5,
  flags: MessageFlags.IsComponentsV2,
});

const divider = () => new SeparatorBuilder()
  .setDivider(true)
  .setSpacing(SeparatorSpacingSize.Small);

export function buildServerBoostLevel3SalePayload() {
  const campaign = SERVER_BOOST_LEVEL3_SALE;
  const E = createEmojiResolver(campaign.guildId);
  const audience = `@everyone <@&${campaign.audienceRoleId}>`;

  const container = new ContainerBuilder()
    .setAccentColor(0x8b5cf6)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      audience,
      `# ${E('brand_boost')} FLASH SALE · NÂNG CẤP SERVER LEVEL 3`,
      `> ${E('icon_fire')} Chỉ mở **${campaign.slots} slot** dành cho các server muốn nâng cấp diện mạo và trải nghiệm cộng đồng trong thời gian dài.`,
    ].join('\n'))))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${E('icon_crown')} Gói ưu đãi giới hạn`,
      `${E('brand_boost')} **Nâng cấp máy chủ:** Discord Server Level 3`,
      `${E('icon_duration')} **Thời hạn duy trì:** \`03 tháng\``,
      `${E('cenar_price')} **Giá trọn gói:** **250.000đ**`,
      `${E('icon_gem')} **Số lượng:** chỉ **05 slot**`,
      '',
      `> ${E('cenar_verified')} Giá được giữ nguyên trong toàn bộ thời hạn đã xác nhận. Mỗi slot áp dụng cho **01 máy chủ Discord**.`,
    ].join('\n'))))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${E('icon_sparkle')} Vì sao nên lên Level 3?`,
      `${E('status_check')} Giao diện máy chủ nổi bật và chuyên nghiệp hơn.`,
      `${E('status_check')} Mở khóa đầy đủ đặc quyền nâng cấp dành cho cộng đồng.`,
      `${E('status_check')} Phù hợp với server cộng đồng, đối tác và các sự kiện lớn.`,
    ].join('\n'))))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${E('icon_cart')} Cách giữ slot`,
      `${E('icon_number')} **1.** Nhấn **Mở Ticket Mua Ngay** bên dưới.`,
      `${E('icon_number')} **2.** Gửi link hoặc ID máy chủ cần nâng cấp.`,
      `${E('cenar_staff')} **3.** Staff kiểm tra tình trạng server và xác nhận slot trước khi thanh toán.`,
      '',
      `${E('status_warn')} Ưu đãi tự kết thúc ngay khi đủ **${campaign.slots}/${campaign.slots} slot**. Slot chỉ được giữ sau khi staff xác nhận đơn.`,
      `-# ${campaign.marker} · Cenar Store bảo lưu quyền từ chối server vi phạm Điều khoản Discord.`,
    ].join('\n'))));

  const orderButton = withButtonEmoji(
    new ButtonBuilder()
      .setCustomId('ticket:create:ORDER')
      .setLabel('Mở Ticket Mua Ngay')
      .setStyle(ButtonStyle.Success),
    E.component('icon_cart'),
    E.component('brand_boost'),
  );
  const websiteButton = withButtonEmoji(
    new ButtonBuilder()
      .setLabel('Xem Cenar Store')
      .setStyle(ButtonStyle.Link)
      .setURL('https://cenarstore.xyz/products'),
    E.component('icon_store'),
  );

  return {
    components: [container, new ActionRowBuilder().addComponents(orderButton, websiteButton)],
    flags: campaign.flags,
    allowedMentions: {
      parse: ['everyone'],
      roles: [campaign.audienceRoleId],
      users: [],
      repliedUser: false,
    },
  };
}

function containsMarker(component) {
  if (typeof component?.content === 'string' && component.content.includes(SERVER_BOOST_LEVEL3_SALE.marker)) return true;
  return Array.isArray(component?.components) && component.components.some(containsMarker);
}

export function isServerBoostLevel3SaleMessage(message, botUserId) {
  return message?.author?.id === botUserId
    && Array.isArray(message.components)
    && message.components.some(containsMarker);
}
