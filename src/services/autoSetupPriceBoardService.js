import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { getActiveProducts } from './productCatalogService.js';
import { getGuildConfig } from './guildConfigService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { formatCurrency } from '../utils/formatters.js';
import { fmt, subtext } from '../utils/embedHelpers.js';
import { config } from '../config.js';
import { isInternationalGuild } from '../utils/locale.js';
import { formatInternationalPrice, translateCatalogGroup, translateProductName } from '../utils/internationalCatalog.js';
import { getNitroTrialEligibility, isNitroTrialProduct } from '../constants/nitroTrial.js';
import { getNetflixPromoDetails, isNetflixPromoProduct } from '../constants/netflixPromotion.js';

export const PRICE_BOARD_VERSION = 'CENAR-CATALOG-V3.13';
const PRIMARY_GUILD_ID = '1282637033340403754';
const PRIMARY_PRICE_CHANNEL_ID = '1514606995842273280';
const PRIMARY_PROMOTION_CHANNEL_ID = '1515008584549797979';
const OFFICIAL_SPOTIFY_PRODUCT_KEYS = new Set([
  'spotify-premium-3-months',
  'spotify-premium-6-months',
  'spotify-premium-12-months',
]);

export const PRICE_GROUPS = [
  {
    key: 'nitro', titleSlot: 'brand_nitro', title: 'Discord Nitro', accent: 0x5865F2,
    note: 'Nitro Boost, gói login và gói trial đang mở bán.',
    match: (p) => p.service_type === 'GAME' && /nitro/i.test(p.name),
  },
  {
    key: 'server_boost', titleSlot: 'brand_boost', title: 'Discord Server Boost', accent: 0xEB459E,
    note: 'Nâng Level 2–3 theo đúng thời hạn của từng gói.',
    match: (p) => p.service_type === 'GAME' && /server boost/i.test(p.name),
  },
  {
    key: 'decor_nitro', titleSlot: 'icon_sparkle', title: 'Decor Discord · Tài Khoản Có Nitro', accent: 0xC084FC,
    note: 'Trang trí hồ sơ trực tiếp trên tài khoản đã có Nitro.',
    match: (p) => p.service_type === 'decor' && /acc có nitro/i.test(p.name),
  },
  {
    key: 'decor_no_nitro', titleSlot: 'brand_nitro', title: 'Decor Discord · Tài Khoản Chưa Có Nitro', accent: 0xA78BFA,
    note: 'Gói đã bao gồm phương án phù hợp cho tài khoản chưa có Nitro.',
    match: (p) => p.service_type === 'decor' && /acc không nitro/i.test(p.name),
  },
  {
    key: 'decor_gift', titleSlot: 'icon_gift', title: 'Decor Discord · Gift & Combo', accent: 0xF472B6,
    note: 'Nhận dưới dạng Gift hoặc Combo, không cần cung cấp mật khẩu.',
    match: (p) => p.service_type === 'decor' && /gift/i.test(p.name),
  },
  {
    key: 'chatgpt', titleSlot: 'brand_chatgpt', title: 'ChatGPT Plus & Business', accent: 0x10A37F,
    note: '4 lựa chọn minh bạch: cấp tài khoản không bảo hành, cấp tài khoản full bảo hành, Business add workspace và Plus thanh toán trực tiếp trên tài khoản chính chủ.',
    match: (p) => p.service_type === 'AI' && /chat\s*gpt/i.test(p.name),
  },
  {
    key: 'gemini', titleSlot: 'brand_gemini', title: 'Gemini & Google One', accent: 0x4285F4,
    note: 'Gói Gemini Advanced/Pro kèm dung lượng Google One theo mô tả.',
    match: (p) => p.service_type === 'AI' && /gemini/i.test(p.name),
  },
  {
    key: 'claude', titleSlot: 'brand_claude', title: 'Claude Pro & Claude API', accent: 0xD97757,
    note: 'Phân biệt rõ tài khoản Claude Pro và hạn mức Claude API.',
    match: (p) => p.service_type === 'AI' && /claude/i.test(p.name),
  },
  {
    key: 'adobe', titleSlot: 'brand_adobe', title: 'Adobe Creative Cloud', accent: 0xFF0000,
    note: 'Chỉ mở bán Adobe Creative Cloud All Apps 1 tháng, bảo hành full trong thời gian sử dụng.',
    match: (p) => p.service_type === 'AI' && /adobe/i.test(p.name),
  },
  {
    key: 'creative_tools', titleSlot: 'brand_capcut', title: 'CapCut Pro & Office 365', accent: 0x22D3EE,
    note: 'Công cụ dựng video, làm việc và lưu trữ đám mây.',
    match: (p) => p.service_type === 'AI' && /(capcut|office)/i.test(p.name),
  },
  {
    key: 'youtube_continuous', titleSlot: 'brand_youtube', title: 'YouTube Premium · Gia Hạn Liên Tục', accent: 0xFF0033,
    note: 'Dòng ổn định, gia hạn liên tục và bảo hành full toàn bộ thời gian sử dụng.',
    match: (p) => String(p.product_key || '').startsWith('youtube-premium-continuous-'),
  },
  {
    key: 'youtube_family_switch', titleSlot: 'brand_youtube', title: 'YouTube Premium · Đổi Family Mỗi Tháng', accent: 0xDC2626,
    note: 'Dòng tiết kiệm, đổi Family mỗi tháng. **Không bị vướng lỗi giới hạn 12 tháng** khi rời/đổi nhóm gia đình Google theo quy trình của shop. Trường hợp hiếm nếu hệ thống vẫn hạn chế (shop ghi nhận khoảng 1–2%), khách đổi Gmail để Cenar thêm lại; bảo hành full toàn thời gian.',
    match: (p) => String(p.product_key || '').startsWith('youtube-premium-monthly-family-switch-'),
  },
  {
    key: 'spotify', titleSlot: 'brand_spotify', title: 'Spotify Premium', accent: 0x1DB954,
    note: 'Nghe nhạc chất lượng cao, không quảng cáo và tải nhạc để nghe offline theo đúng thời hạn đã chọn.',
    match: (p) => String(p.product_key || '').startsWith('spotify-premium-') || p.service_type === 'spotify',
  },
  {
    key: 'netflix', titleSlot: 'brand_netflix', title: 'Netflix Extra & Premium', accent: 0xE50914,
    note: 'Netflix Extra 75k hỗ trợ gia hạn; Netflix Premium 35k ổn định nhưng hết hạn cần đổi tài khoản mới.',
    match: (p) => p.service_type === 'netflix' || /netflix/i.test(p.name),
  },
  {
    key: 'streaming', titleSlot: 'icon_sparkle', title: 'Dịch Vụ Giải Trí Khác', accent: 0x8B5CF6,
    note: 'Các dịch vụ giải trí còn lại; vui lòng đọc kỹ chu kỳ và chính sách từng sản phẩm.',
    match: (p) => ['STREAMING', 'youtube'].includes(p.service_type),
  },
  {
    key: 'gearup', titleSlot: 'brand_gearup', title: 'GearUP Booster', accent: 0x00E6FF,
    note: 'Tối ưu kết nối và giảm ping game theo chu kỳ 3–12 tháng.',
    match: (p) => p.service_type === 'gearup',
  },
  {
    key: 'locket', titleSlot: 'brand_locket', title: 'Locket Gold', accent: 0xFACC15,
    note: 'Gói Premium dài hạn dành riêng cho Locket.',
    match: (p) => p.service_type === 'premium' || /locket/i.test(p.name),
  },
  {
    key: 'services', titleSlot: 'icon_settings', title: 'Bot, Website & Setup Discord', accent: 0x6366F1,
    note: 'Dịch vụ tùy chỉnh được khảo sát yêu cầu trước khi báo giá chính thức.',
    match: (p) => ['SERVICE', 'service'].includes(p.service_type),
  },
];

const PRODUCT_SLOT_ALIASES = {
  claude_ai: 'brand_claude',
  locket_gold: 'brand_locket',
  '🎁': 'icon_gift',
  '✨': 'icon_sparkle',
  '🎨': 'icon_art',
  '📦': 'order_product',
  '💎': 'icon_gem',
  '🎬': 'brand_netflix',
  '🎵': 'brand_spotify',
  '🤖': 'brand_chatgpt',
};

function inferProductSlot(product) {
  const configured = PRODUCT_SLOT_ALIASES[product.emoji] || product.emoji;
  if (product.service_type === 'decor' && configured === 'brand_discord') return 'brand_nitro';
  if (['SERVICE', 'service'].includes(product.service_type) && configured === 'brand_discord') return 'icon_settings';
  if (configured && /^[a-z0-9_]+$/i.test(configured)) return configured;
  const name = String(product.name || '');
  if (/chat\s*gpt/i.test(name)) return 'brand_chatgpt';
  if (/gemini/i.test(name)) return 'brand_gemini';
  if (/claude/i.test(name)) return 'brand_claude';
  if (/adobe/i.test(name)) return 'brand_adobe';
  if (/capcut/i.test(name)) return 'brand_capcut';
  if (/office/i.test(name)) return 'brand_office';
  if (/youtube/i.test(name)) return 'brand_youtube';
  if (/spotify/i.test(name)) return 'brand_spotify';
  if (/netflix/i.test(name)) return 'brand_netflix';
  if (/nitro/i.test(name)) return 'brand_nitro';
  if (/server boost/i.test(name)) return 'brand_boost';
  if (/gearup/i.test(name)) return 'brand_gearup';
  if (/locket/i.test(name)) return 'brand_locket';
  return 'order_product';
}

function getDurationText(product, international = false) {
  const productName = String(product.name || '');
  if (international) {
    if (Number(product.price) === 0) return 'Custom project';
    if (product.service_type === 'decor') return 'Lifetime';
    const dayMatch = productName.match(/(\d+)\s*ngày/i);
    if (dayMatch && !/giữ\s*mail/i.test(productName)) return `${dayMatch[1]} day${dayMatch[1] === '1' ? '' : 's'}`;
    const yearMatch = productName.match(/(\d+)\s*năm/i);
    if (yearMatch) return `${yearMatch[1]} year${yearMatch[1] === '1' ? '' : 's'}`;
    if (['SERVICE', 'service'].includes(product.service_type)) return 'Custom scope';
    const months = Math.max(1, Number(product.duration_months) || 1);
    return `${months} month${months === 1 ? '' : 's'}`;
  }
  if (Number(product.price) === 0) return 'Theo dự án';
  if (product.service_type === 'decor') return 'Vĩnh viễn';
  const dayMatch = productName.match(/(\d+)\s*ngày/i);
  if (dayMatch && !/giữ\s*mail/i.test(productName)) return `${dayMatch[1]} ngày`;
  const yearMatch = productName.match(/(\d+)\s*năm/i);
  if (yearMatch) return `${yearMatch[1]} năm`;
  if (['SERVICE', 'service'].includes(product.service_type)) {
    return /duy trì/i.test(String(product.name))
      ? `${Math.max(1, Number(product.duration_months) || 1)} tháng`
      : 'Trọn gói';
  }
  return Number(product.duration_months) > 1 ? `${product.duration_months} tháng` : '1 tháng';
}

function setButtonEmoji(button, E, slot) {
  const emoji = E.component(slot);
  if (emoji) button.setEmoji(emoji);
  return button;
}

const FULL_WARRANTY_PRODUCT_KEYS = new Set([
  'chatgpt-plus-account-1-month-full-warranty',
  'chatgpt-business-workspace-1-month-full-warranty',
  'chatgpt-plus-direct-payment-1-month-full-warranty',
  'claude-pro-1-month',
  'gemini-pro-google-one-5tb-12-months-full-warranty',
  'gemini-pro-google-one-5tb-18-months-full-warranty',
  'adobe-creative-cloud-1-month',
  'youtube-premium-continuous-1-month',
  'youtube-premium-continuous-3-months',
  'youtube-premium-continuous-6-months',
  'youtube-premium-continuous-12-months',
  'youtube-premium-monthly-family-switch-1-month',
  'youtube-premium-monthly-family-switch-3-months',
  'youtube-premium-monthly-family-switch-6-months',
  'youtube-premium-monthly-family-switch-12-months',
]);

function hasFullDurationWarranty(product) {
  return FULL_WARRANTY_PRODUCT_KEYS.has(String(product.product_key || ''));
}

export function groupPriceProducts(products) {
  // Bảng giá công khai chỉ nhận ba gói Spotify chính thức. Dữ liệu Spotify
  // thủ công cũ được giữ trong DB phục vụ lịch sử đơn hàng nhưng không xuất bản.
  const visibleProducts = products.filter((product) => {
    const key = String(product.product_key || '');
    const isSpotify = product.service_type === 'spotify' || /spotify/i.test(String(product.name || ''));
    return !isSpotify || OFFICIAL_SPOTIFY_PRODUCT_KEYS.has(key);
  });
  const used = new Set();
  const panels = [];
  for (const group of PRICE_GROUPS) {
    const items = visibleProducts.filter((product) => !used.has(product.id) && group.match(product));
    items.forEach((product) => used.add(product.id));
    if (items.length) panels.push({ group, items });
  }
  // Sản phẩm chưa được phân nhóm không được xuất bản công khai.
  return panels;
}

export function getPriceBoardProducts(products) {
  const publishedIds = new Set(
    groupPriceProducts(products).flatMap((panel) => panel.items.map((product) => String(product.id))),
  );
  return products.filter((product) => publishedIds.has(String(product.id)));
}

export function buildPricePortalPayload(guildId, guildConfig, panels = []) {
  const E = createEmojiResolver(guildId);
  const international = isInternationalGuild(guildId);
  const container = new ContainerBuilder().setAccentColor(config.accentColorPrimary);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      international ? `# ${E('icon_store')} CENAR GLOBAL • LIVE PRICING` : `# ${E('icon_store')} BẢNG GIÁ CENAR STORE`,
      international ? `> ${E('status_check')} **Live catalog synchronized across Discord and the website.**` : `> ${E('status_check')} **Đồng bộ trực tiếp từ hệ thống sản phẩm đang hoạt động.**`,
      ...(guildId === PRIMARY_GUILD_ID ? [
        `> ${E('icon_fire')} **Ưu đãi đang áp dụng:** xem bảng khuyến mãi tại <#${PRIMARY_PROMOTION_CHANNEL_ID}>.`,
      ] : []),
    ].join('\n'))
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      international ? `### ${E('icon_search')} QUICK GUIDE` : `### ${E('icon_search')} HƯỚNG DẪN NHANH`,
      international ? `${E('icon_search')} **Compare:** Review the package name, current price and duration.` : `${E('icon_search')} **Tra cứu:** Cuộn đến đúng danh mục, sau đó đối chiếu **tên gói · giá bán · thời hạn**.`,
      international ? `${E('icon_cart')} **Order:** Select the exact package from the menu below its category.` : `${E('icon_cart')} **Đặt hàng:** Chọn đúng sản phẩm trong menu ngay bên dưới danh mục.`,
      international ? `${E('warranty_shield')} **Warranty:** Coverage follows the product description and selected duration.` : `${E('warranty_shield')} **Bảo hành:** Áp dụng theo mô tả sản phẩm và thời gian sử dụng của từng gói.`,
    ].join('\n'))
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      subtext(international
        ? `${E('icon_price')} ${panels.length} categories · ${panels.reduce((sum, panel) => sum + panel.items.length, 0)} active products · ${PRICE_BOARD_VERSION}`
        : `${E('icon_price')} ${panels.length} danh mục · ${panels.reduce((sum, panel) => sum + panel.items.length, 0)} sản phẩm đang mở bán · ${PRICE_BOARD_VERSION}`)
    )
  );

  const row = new ActionRowBuilder();
  if (guildConfig?.ticket_panel_channel_id) {
    row.addComponents(setButtonEmoji(
      new ButtonBuilder()
        .setLabel(international ? 'Order & Support' : 'Mua Hàng & Hỗ Trợ')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${guildId}/${guildConfig.ticket_panel_channel_id}`),
      E,
      'ticket_open',
    ));
  }
  if (/^https?:\/\//i.test(config.storeWebsiteUrl || '')) {
    row.addComponents(setButtonEmoji(
      new ButtonBuilder().setLabel(international ? 'Shop on Website' : 'Mua Trên Website').setStyle(ButtonStyle.Link).setURL(config.storeWebsiteUrl),
      E,
      'icon_cart',
    ));
  }
  row.addComponents(setButtonEmoji(
    new ButtonBuilder().setCustomId('price_list:admin:edit_portal').setLabel(international ? 'Manage Catalog' : 'Quản Lý Bảng Giá').setStyle(ButtonStyle.Secondary),
    E,
    'icon_settings',
  ));

  return {
    components: [container, row],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export function buildPriceGroupPayload(guildId, group, products) {
  const E = createEmojiResolver(guildId);
  const international = isInternationalGuild(guildId);
  if (international) group = translateCatalogGroup(group);
  const container = new ContainerBuilder().setAccentColor(group.accent || config.accentColorPrimary);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `## ${E(group.titleSlot)} ${group.title}`,
      `> ${E('status_info')} ${group.note}`,
      subtext(international ? `${products.length} options · Live prices` : `${products.length} lựa chọn · Giá hiển thị là giá bán hiện tại`),
    ].join('\n'))
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  products.forEach((product, index) => {
    if (index > 0) {
      container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      );
    }
    const slot = inferProductSlot(product);
    const productIcon = E(slot) || E(group.titleSlot) || E('order_product');
    const duration = getDurationText(product, international);
    const hasDiscount = Number(product.original_price) > Number(product.price) && Number(product.price) > 0;
    const price = Number(product.price) > 0
      ? (hasDiscount
        ? `~~${international ? formatInternationalPrice(product.original_price) : formatCurrency(product.original_price)}~~ → ${fmt.b(international ? formatInternationalPrice(product.price) : formatCurrency(product.price))}`
        : `\`${international ? formatInternationalPrice(product.price) : formatCurrency(product.price)}\``)
      : fmt.b(international ? 'Contact for quote' : 'Liên hệ báo giá');
    const trialEligibility = isNitroTrialProduct(product)
      ? getNitroTrialEligibility(international)
      : [];
    const netflixPromo = isNetflixPromoProduct(product)
      ? getNetflixPromoDetails(international)
      : null;
    const fullDurationWarranty = hasFullDurationWarranty(product);
    const warrantyPolicy = String(product.warranty_policy || '').trim();
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        `### ${productIcon} ${international ? translateProductName(product.name) : product.name}`,
        `> ${E('payment_money')} **${international ? 'Price' : 'Giá bán'}:** ${price}`,
        `> ${E('icon_duration')} **${international ? 'Duration' : 'Thời hạn'}:** \`${duration}\``,
        ...(trialEligibility.length ? [
          `> ${E('status_check')} **${international ? 'Eligibility' : 'Đối tượng áp dụng'}:**`,
          ...trialEligibility.map((item) => `> - ${item}`),
        ] : []),
        ...(netflixPromo ? [
          `> ${E('status_check')} **${international ? 'Quality' : 'Chất lượng'}:** ${netflixPromo.quality}`,
          `> ${E('warranty_shield')} **${international ? 'Warranty' : 'Bảo hành'}:** ${netflixPromo.warranty}`,
          `> ${E('status_warn')} **${international ? 'Renewal' : 'Gia hạn'}:** ${netflixPromo.renewal}`,
        ] : []),
        ...(fullDurationWarranty ? [
          `> ${E('warranty_shield')} **${international ? 'Warranty' : 'Bảo hành'}:** ${international ? 'Full coverage for the entire service period' : 'Full trong suốt thời gian sử dụng'}`,
        ] : !netflixPromo && warrantyPolicy ? [
          `> ${E('warranty_shield')} **${international ? 'Warranty' : 'Bảo hành'}:** ${warrantyPolicy}`,
        ] : []),
      ].join('\n'))
    );
  });

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      subtext(international
        ? `${E('icon_heart_purple')} Cenar Global · Select the exact package below to order`
        : `${E('icon_heart_purple')} Cenar Store · Chọn đúng tên gói trong menu để đặt hàng`)
    )
  );

  const options = products.slice(0, 25).map((product) => {
    const option = {
      label: String(international ? translateProductName(product.name) : product.name).slice(0, 100),
      description: `${Number(product.price) > 0 ? (international ? formatInternationalPrice(product.price) : formatCurrency(product.price)) : (international ? 'Contact us' : 'Liên hệ')} · ${getDurationText(product, international)}`.slice(0, 100),
      value: String(product.id),
    };
    const emoji = E.component(inferProductSlot(product)) || E.component(group.titleSlot) || E.component('order_product');
    if (emoji) option.emoji = emoji;
    return option;
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId('product:select')
    .setPlaceholder(`${international ? 'Select a product' : 'Chọn sản phẩm'} · ${group.title}`.slice(0, 150))
    .addOptions(options);

  return {
    components: [container, new ActionRowBuilder().addComponents(select)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export function buildPriceBoardPayloads(guildId, guildConfig, products = getActiveProducts(guildId)) {
  const panels = groupPriceProducts(getPriceBoardProducts(products));
  return [
    buildPricePortalPayload(guildId, guildConfig, panels),
    ...panels.map(({ group, items }) => buildPriceGroupPayload(guildId, group, items)),
  ];
}

async function findPriceChannel(guild, guildConfig) {
  const configuredId = guildConfig?.price_list_channel_id
    || (guild.id === PRIMARY_GUILD_ID ? PRIMARY_PRICE_CHANNEL_ID : null);
  if (configuredId) {
    const configured = await guild.channels.fetch(configuredId).catch(() => null);
    if (configured?.isTextBased() && !configured.isThread()) return configured;
  }

  const sendableChannels = [...guild.channels.cache.values()].filter((channel) => (
    channel.isTextBased?.()
    && !channel.isThread?.()
    && typeof channel.send === 'function'
  ));
  const exactNames = new Set(['pricing', 'price-list', 'bang-gia', 'bảng-giá']);
  return sendableChannels.find((channel) => exactNames.has(channel.name))
    || sendableChannels.find((channel) => (
      channel.parent?.name === 'GLOBAL MARKETPLACE'
      && channel.name.includes('price')
    ))
    || null;
}

async function hasCurrentPriceBoard(channel, botId) {
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return false;
  return messages.some((message) =>
    message.author.id === botId && JSON.stringify(message.toJSON()).includes(PRICE_BOARD_VERSION)
  );
}

async function clearBotMessages(channel, botId, keepIds = new Set()) {
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) return 0;
  let deleted = 0;
  for (const message of messages.filter((item) =>
    item.author.id === botId && !keepIds.has(item.id)
  ).values()) {
    if (await message.delete().then(() => true).catch(() => false)) deleted++;
  }
  return deleted;
}

export async function publishPriceBoard(guild, { force = false, keepMessageIds = [] } = {}) {
  await guild.channels.fetch().catch(() => null);
  await guild.emojis.fetch().catch(() => null);
  const guildConfig = getGuildConfig(guild.id);
  const channel = await findPriceChannel(guild, guildConfig);
  if (!channel) return { guildId: guild.id, status: 'channel_not_found' };

  if (!force && await hasCurrentPriceBoard(channel, guild.client.user.id)) {
    return { guildId: guild.id, channelId: channel.id, status: 'current' };
  }

  const products = getPriceBoardProducts(getActiveProducts(guild.id));
  const payloads = buildPriceBoardPayloads(guild.id, guildConfig, products);
  const sentMessageIds = [];
  try {
    // Đăng đủ panel mới trước, chỉ xóa panel cũ sau khi tất cả đã thành công.
    // Nếu Discord từ chối một payload, rollback các tin mới và giữ nguyên bảng cũ.
    for (const payload of payloads) {
      const message = await channel.send(payload);
      sentMessageIds.push(message.id);
    }
  } catch (error) {
    for (const messageId of sentMessageIds) {
      await channel.messages.delete(messageId).catch(() => null);
    }
    throw error;
  }
  const deleted = await clearBotMessages(
    channel,
    guild.client.user.id,
    new Set([...sentMessageIds, ...keepMessageIds.map(String)]),
  );

  return {
    guildId: guild.id,
    channelId: channel.id,
    status: 'published',
    deleted,
    sent: sentMessageIds.length,
    sentMessageIds,
    products: products.length,
    version: PRICE_BOARD_VERSION,
  };
}

export async function autoSetupPriceBoard(client, { force = false, targetGuildId = null } = {}) {
  const results = [];
  for (const guild of client.guilds.cache.values()) {
    if (targetGuildId && guild.id !== targetGuildId) continue;
    try {
      const result = await publishPriceBoard(guild, { force });
      results.push(result);
      console.log('[PRICE BOARD]', JSON.stringify(result));
    } catch (error) {
      console.error(`[PRICE BOARD] Lỗi guild ${guild.id}:`, error);
      results.push({ guildId: guild.id, status: 'error', error: error.message });
    }
  }
  return results;
}

export const priceBoardInternals = { findPriceChannel };
