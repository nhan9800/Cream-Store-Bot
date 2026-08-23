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

const PROMOTION_MARKER_PREFIX = 'CENAR-PROMOTION-BOARD-';

export const PROMOTION_BOARD = Object.freeze({
  guildId: '1282637033340403754',
  channelId: '1515008584549797979',
  priceChannelId: '1514606995842273280',
  audienceRoleIds: Object.freeze([
    '1282638730812854345', // Cenar Member
    '1282637103045279820', // Cenar Patron
  ]),
  marker: 'CENAR-PROMOTION-BOARD-V2',
  flags: MessageFlags.IsComponentsV2,
  prices: Object.freeze({
    nitroLogin: Object.freeze([
      Object.freeze({ duration: '2 Tháng', price: 99_000, note: 'Sale Cuối Hè' }),
      Object.freeze({ duration: '4 Tháng', price: 200_000 }),
      Object.freeze({ duration: '6 Tháng', price: 380_000 }),
      Object.freeze({ duration: '8 Tháng', price: 480_000 }),
      Object.freeze({ duration: '12 Tháng', price: 630_000, note: 'Gia hạn 2 tháng/lần · Auto New Update' }),
      Object.freeze({ duration: '12 Tháng', price: 800_000, note: 'Mua thẳng 1 lần' }),
    ]),
    serverBoost: Object.freeze([
      Object.freeze({ duration: '1 Tháng', price: 99_000 }),
      Object.freeze({ duration: '3 Tháng', price: 250_000 }),
    ]),
    youtube: Object.freeze([
      Object.freeze({ duration: '1 Năm', price: 200_000, note: 'Mỗi tháng quay lại shop gia hạn 1 lần' }),
    ]),
    spotify: Object.freeze([
      Object.freeze({ duration: '6 Tháng', price: 180_000 }),
      Object.freeze({ duration: '12 Tháng', price: 280_000 }),
    ]),
    capcut: Object.freeze([
      Object.freeze({ duration: '1 Tháng', price: 55_000, note: 'Cấp tài khoản' }),
      Object.freeze({ duration: '6 Tháng', price: 350_000, note: 'Cấp tài khoản' }),
    ]),
    office: Object.freeze([
      Object.freeze({ duration: '1 Năm', price: 100_000, note: 'Office 365 Plus + 1 TB OneDrive · Cấp tài khoản' }),
      Object.freeze({ duration: '1 Năm', price: 180_000, note: 'Office 365 + 1 TB OneDrive · Tài khoản chính chủ' }),
    ]),
    gemini: Object.freeze([
      Object.freeze({ duration: '18 Tháng', price: 150_000, note: 'Gemini Pro + 5 TB Google One' }),
    ]),
    windows: Object.freeze([
      Object.freeze({ duration: 'Vĩnh viễn', price: 150_000, note: 'Key kích hoạt Windows 10/11 Pro chính hãng' }),
    ]),
    locket: Object.freeze([
      Object.freeze({ duration: '1 Năm', price: 100_000, note: 'Locket Gold' }),
    ]),
    canva: Object.freeze([
      Object.freeze({ duration: '1 Năm', price: 130_000, note: 'Canva Pro' }),
    ]),
    chatgpt: Object.freeze([
      Object.freeze({ duration: '1 Tháng', price: 290_000, note: 'ChatGPT Plus · Cấp tài khoản · Full bảo hành' }),
    ]),
  }),
});

const divider = () => new SeparatorBuilder()
  .setDivider(true)
  .setSpacing(SeparatorSpacingSize.Small);

function money(value) {
  return `${Number(value).toLocaleString('vi-VN')}đ`;
}

function priceLines(items, icon) {
  return items.map((item) => {
    const note = item.note ? ` · *${item.note}*` : '';
    return `${icon} **${item.duration}:** \`${money(item.price)}\`${note}`;
  });
}

function productPriceLines(items, icon) {
  return items.map((item) => (
    `${icon} **${item.note}** — \`${money(item.price)}\` · *${item.duration}*`
  ));
}

export function buildPromotionBoardPayload() {
  const campaign = PROMOTION_BOARD;
  const E = createEmojiResolver(campaign.guildId);
  const mentions = ['@everyone', ...campaign.audienceRoleIds.map((id) => `<@&${id}>`)].join(' ');

  const header = new ContainerBuilder()
    .setAccentColor(0xFF5A5F)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      mentions,
      `# ${E('promo_discount')} SALE CUỐI HÈ · CENAR STORE`,
      `### GIÁ TỐT ĐỂ CHỐT DEAL — SỐ LƯỢNG CÓ HẠN`,
      `> ${E('icon_sparkle')} Loạt dịch vụ Premium được điều chỉnh về mức giá ưu đãi để bạn học tập, giải trí và nâng cấp Discord tiết kiệm hơn.`,
      `> ${E('status_check')} Chọn đúng gói, mở ticket và chờ staff xác nhận nguồn hàng trước khi thanh toán.`,
    ].join('\n'))));

  const discordDeals = new ContainerBuilder()
    .setAccentColor(0x7C3AED)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${E('promo_nitro')} DISCORD NITRO BOOST LOGIN`,
      ...priceLines(campaign.prices.nitroLogin, E('cenar_price')),
      '',
      `> ${E('status_info')} Gói **Auto New Update** được gia hạn theo chu kỳ 2 tháng/lần trong tổng thời hạn 12 tháng.`,
      `> ${E('status_warn')} Vui lòng đăng nhập sớm và làm đúng hướng dẫn của staff để bảo đảm tiến độ xử lý.`,
    ].join('\n'))))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${E('promo_boost')} BOOST SERVER`,
      ...priceLines(campaign.prices.serverBoost, E('icon_price')),
      `> ${E('status_check')} Gửi link hoặc ID server trong ticket để staff kiểm tra trước khi thực hiện.`,
    ].join('\n'))));

  const entertainmentDeals = new ContainerBuilder()
    .setAccentColor(0xFF0033)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${E('brand_youtube')} YOUTUBE PREMIUM`,
      ...priceLines(campaign.prices.youtube, E('icon_price')),
      `> ${E('icon_calendar')} Gói 1 năm vận hành theo chu kỳ: **mỗi tháng khách quay lại shop để gia hạn một lần**.`,
    ].join('\n'))))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${E('brand_spotify')} SPOTIFY PREMIUM`,
      ...priceLines(campaign.prices.spotify, E('icon_price')),
      `> ${E('status_check')} Nghe nhạc không quảng cáo, chất lượng cao và hỗ trợ tải offline theo chính sách từng gói.`,
    ].join('\n'))));

  const productivityDeals = new ContainerBuilder()
    .setAccentColor(0x00C2FF)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${E('brand_capcut')} SÁNG TẠO & HỌC TẬP`,
      ...productPriceLines(campaign.prices.capcut, E('brand_capcut')),
      ...productPriceLines(campaign.prices.office, E('brand_office')),
      ...productPriceLines(campaign.prices.gemini, E('brand_gemini')),
    ].join('\n'))))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${E('icon_key')} TIỆN ÍCH SỐ & PREMIUM`,
      ...productPriceLines(campaign.prices.windows, E('icon_key')),
      ...productPriceLines(campaign.prices.locket, E('brand_locket')),
      ...productPriceLines(campaign.prices.canva, E('icon_art')),
      ...productPriceLines(campaign.prices.chatgpt, E('brand_chatgpt')),
    ].join('\n'))));

  const footer = new ContainerBuilder()
    .setAccentColor(0xF59E0B)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${E('icon_fire')} CHỐT ƯU ĐÃI TRƯỚC KHI KẾT THÚC`,
      `> Giá khuyến mãi có thể dừng sớm khi hết nguồn. Cenar Store chỉ xác nhận đơn sau khi staff kiểm tra đúng sản phẩm, thời hạn và điều kiện bảo hành.`,
      `${E('icon_search')} **Bảng giá niêm yết tiêu chuẩn:** <#${campaign.priceChannelId}>`,
      `${E('warranty_shield')} **Bảo hành:** áp dụng theo mô tả và xác nhận riêng của từng gói trong ticket.`,
      `-# ${campaign.marker}`,
    ].join('\n'))));

  const orderButton = withButtonEmoji(
    new ButtonBuilder()
      .setCustomId('ticket:create:ORDER')
      .setLabel('Mở Ticket Chốt Deal')
      .setStyle(ButtonStyle.Success),
    E.component('icon_cart'),
    E.component('ticket_open'),
  );
  const priceButton = withButtonEmoji(
    new ButtonBuilder()
      .setLabel('Xem Bảng Giá Tiêu Chuẩn')
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${campaign.guildId}/${campaign.priceChannelId}`),
    E.component('icon_price'),
  );

  return {
    components: [
      header,
      discordDeals,
      entertainmentDeals,
      productivityDeals,
      footer,
      new ActionRowBuilder().addComponents(orderButton, priceButton),
    ],
    flags: campaign.flags,
    allowedMentions: {
      parse: ['everyone'],
      roles: [...campaign.audienceRoleIds],
      users: [],
      repliedUser: false,
    },
  };
}

function containsMarker(component, marker = PROMOTION_MARKER_PREFIX) {
  if (typeof component?.content === 'string' && component.content.includes(marker)) return true;
  return Array.isArray(component?.components)
    && component.components.some((child) => containsMarker(child, marker));
}

function messageContainsMarker(message, marker = PROMOTION_MARKER_PREFIX) {
  return Array.isArray(message?.components)
    && message.components.some((component) => containsMarker(component, marker));
}

export function isPromotionBoardMessage(message, botUserId) {
  return message?.author?.id === botUserId && messageContainsMarker(message);
}

export async function publishPromotionBoard(client) {
  const campaign = PROMOTION_BOARD;
  const guild = client.guilds.cache.get(campaign.guildId)
    || await client.guilds.fetch(campaign.guildId).catch(() => null);
  if (!guild) throw new Error(`Không tìm thấy guild ${campaign.guildId}`);

  const channel = guild.channels.cache.get(campaign.channelId)
    || await guild.channels.fetch(campaign.channelId).catch(() => null);
  if (!channel?.isTextBased?.() || !channel.messages) {
    throw new Error(`Kênh khuyến mãi ${campaign.channelId} không khả dụng`);
  }

  const [recent, pinned] = await Promise.all([
    channel.messages.fetch({ limit: 100 }),
    channel.messages.fetchPinned().catch(() => null),
  ]);
  const candidates = new Map();
  for (const message of recent.values()) candidates.set(message.id, message);
  for (const message of pinned?.values?.() || []) candidates.set(message.id, message);

  const boards = [...candidates.values()]
    .filter((message) => isPromotionBoardMessage(message, client.user.id));
  const current = boards.find((message) => messageContainsMarker(message, campaign.marker));
  const payload = buildPromotionBoardPayload();

  if (current) {
    await current.edit(payload);
    await Promise.all(boards
      .filter((message) => message.id !== current.id)
      .map((message) => message.delete().catch(() => null)));
    await current.pin().catch(() => null);
    return { status: 'updated', messageId: current.id, removed: boards.length - 1 };
  }

  await Promise.all(boards.map((message) => message.delete().catch(() => null)));
  const message = await channel.send(payload);
  await message.pin().catch(() => null);
  return { status: 'published', messageId: message.id, removed: boards.length };
}
