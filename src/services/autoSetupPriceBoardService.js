import {
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
} from 'discord.js';
import { getActiveProducts } from './productCatalogService.js';
import { getGuildConfig } from './guildConfigService.js';
import { resolveSelectMenuEmoji, getEmojiMap, resolveProductEmoji } from './emojiService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { formatCurrency } from '../utils/formatters.js';
import { fmt, subtext } from '../utils/embedHelpers.js';
import { config } from '../config.js';

export function buildPricePortalPayload(guildId, guildConfig) {
  const title = guildConfig?.price_list_title || '📺  PREMIUM SERVICES CATALOG — CENAR STORE  📺';
  const description = guildConfig?.price_list_description || [
    '# 🌟 CHÀO MỪNG BẠN ĐẾN VỚI HỆ THỐNG DỊCH VỤ PREMIUM 🌟',
    '',
    'Cửa hàng chuyên cung cấp các tài khoản giải trí, học tập và làm việc Premium chính chủ với giá siêu ưu đãi, bảo hành trọn vẹn thời gian sử dụng.',
    '',
    '---',
    '',
    '### 🛍️ DANH MỤC DỊCH VỤ NỔI BẬT:',
    '📺 **YouTube Premium** — Xem video không quảng cáo, chạy nền tiện lợi.',
    '🎵 **Spotify Premium** — Nghe nhạc chất lượng cao offline không giới hạn.',
    '🍿 **Netflix Premium** — Trải nghiệm phim ảnh chất lượng UltraHD 4K.',
    '💎 **Discord Nitro** — Đầy đủ đặc quyền VIP, nhận 2 Boosts Server.',
    '🚀 **Discord Boost Server** — Tối ưu hóa cộng đồng của bạn nhanh chóng.',
    '🛠️ **Dịch vụ Setup & Custom** — Thiết kế máy chủ, làm bot & website (Giá: **Thương lượng**).',
    '',
    '---',
    '',
    '### 💡 HƯỚNG DẪN MUA HÀNG:',
    '1. Sử dụng **Menu Thả Xuống** bên dưới để chọn dịch vụ bạn muốn xem bảng giá.',
    '2. Bảng giá chi tiết sẽ hiện lên riêng tư kèm nút đặt mua.',
    '3. Chọn gói và điền thông tin để hệ thống tự động mở ticket xử lý nhanh chóng.',
    '',
    '🛡️ *Mọi giao dịch đều được đảm bảo an toàn & bảo hành trọn vẹn thời hạn sử dụng!*'
  ].join('\n');
  const imageUrl = guildConfig?.price_list_image_url || null;

  const portalEmbed = new EmbedBuilder()
    .setColor(0xF3A6D7)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: 'Cenar Store • An toàn - Uy tín - Chất lượng 💙' })
    .setTimestamp();

  if (imageUrl && imageUrl.startsWith('http')) {
    portalEmbed.setImage(imageUrl);
  }

  const portalOptions = [
    { label: 'YouTube Premium (Siêu Ổn Định)', description: 'Gói ổn định chính chủ 3T - 6T - 12T', value: 'youtube', emoji: resolveSelectMenuEmoji(guildId, 'brand_youtube', '📺') },
    { label: 'Spotify Premium (Siêu Ổn Định)', description: 'Nghe nhạc chất lượng cao offline', value: 'spotify', emoji: resolveSelectMenuEmoji(guildId, 'brand_spotify', '🎵') },
    { label: 'Netflix Extra Premium', description: 'Xem cùng lúc 1 thiết bị, UltraHD 4K', value: 'netflix', emoji: resolveSelectMenuEmoji(guildId, 'brand_netflix', '🍿') },
    { label: 'Discord Nitro Full Premium', description: 'Đầy đủ đặc quyền VIP Discord', value: 'nitro', emoji: resolveSelectMenuEmoji(guildId, 'brand_discord', '💎') },
    { label: 'Discord Boost Server', description: 'Bơm thẳng Server lên Level 3 nhanh chóng', value: 'boost', emoji: resolveSelectMenuEmoji(guildId, 'brand_discord', '🚀') },
    { label: 'Decor Discord (Hiệu ứng hồ sơ)', description: 'Hiệu ứng hồ sơ & trang trí ảnh đại diện Discord', value: 'decor', emoji: resolveSelectMenuEmoji(guildId, 'icon_sparkle', '✨') },
    { label: 'AI & Phần Mềm Premium', description: 'ChatGPT, Gemini Pro, Office 365, Adobe, CapCut...', value: 'ai', emoji: resolveSelectMenuEmoji(guildId, 'brand_chatgpt', '🤖') },
    { label: 'GearUP Booster (Giảm Lag Ping)', description: 'Tối ưu kết nối, giảm ping game 3T - 6T - 12T', value: 'gearup', emoji: resolveSelectMenuEmoji(guildId, 'brand_gearup', '🎮') },
    { label: 'Dịch vụ Setup & Custom', description: 'Thiết kế máy chủ, làm bot & website (Giá: Thương lượng)', value: 'service', emoji: resolveSelectMenuEmoji(guildId, 'brand_discord', '🛠️') }
  ].map(opt => {
    if (!opt.emoji) delete opt.emoji; // Bỏ emoji nếu null để tránh lỗi API
    return opt;
  });

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('price_list:select')
      .setPlaceholder('🛒 Chọn danh mục sản phẩm để xem bảng giá')
      .addOptions(portalOptions)
  );

  const editButton = new ButtonBuilder()
    .setCustomId('price_list:admin:edit_portal')
    .setLabel('Sửa bảng giá')
    .setStyle(ButtonStyle.Secondary);
  const editEmoji = E.component('icon_edit');
  if (editEmoji) editButton.setEmoji(editEmoji);
  const buttonRow = new ActionRowBuilder().addComponents(editButton);

  return { embeds: [portalEmbed], components: [selectRow, buttonRow] };
}

const GROUPS = [
  { titleSlot: 'brand_nitro',   title: 'Discord Nitro & Server Boost',           match: (p) => ['nitro', 'boost', 'GAME'].includes(p.service_type) && !/decor/i.test(p.name) },
  { titleSlot: 'icon_art',      title: 'Decor Discord — Trang Trí Hồ Sơ',        match: (p) => p.service_type === 'decor' && /Acc /i.test(p.name) },
  { titleSlot: 'icon_gift',     title: 'Decor Discord — Gift & Combo',           match: (p) => p.service_type === 'decor' && /Gift/i.test(p.name) },
  { titleSlot: 'icon_brain',    title: 'AI & Phần Mềm Bản Quyền',                match: (p) => p.service_type === 'AI' && !['Claude API 100M'].includes(p.name) },
  { titleSlot: 'brand_claude',  title: 'Claude API & Locket Gold — Premium',    match: (p) => p.service_type === 'AI' && p.name === 'Claude API 100M' || p.service_type === 'premium' },
  { titleSlot: 'brand_youtube', title: 'Giải Trí — YouTube · Spotify · Netflix', match: (p) => ['youtube', 'spotify', 'netflix', 'STREAMING'].includes(p.service_type) },
  { titleSlot: 'brand_gearup',  title: 'Tăng Tốc Game — GearUP Booster',         match: (p) => p.service_type === 'gearup' },
  { titleSlot: 'brand_discord', title: 'Dịch Vụ Setup & Custom',                 match: (p) => ['SERVICE', 'service'].includes(p.service_type) },
];

const UNICODE_TO_SLOT = {
  '✨': 'icon_sparkle', '🎨': 'icon_art', '🎁': 'icon_gift', '📦': 'order_product',
  '💎': 'icon_gem', '🎬': 'brand_netflix', '🎵': 'brand_spotify', '🤖': 'icon_brain',
};

function getDurText(p) {
  if (p.price === 0 || ['SERVICE', 'service'].includes(p.service_type)) return 'Theo yêu cầu';
  if (p.service_type === 'decor') return 'Vĩnh viễn';
  return p.duration_months > 1 ? `${p.duration_months} tháng` : '1 tháng';
}

function productEmoji(guildId, em, E, p) {
  if (em[p.emoji]) return em[p.emoji];
  const slot = UNICODE_TO_SLOT[p.emoji];
  if (slot && em[slot]) return em[slot];
  return E('order_product');
}

function productSelectEmoji(guildId, em, p) {
  if (em[p.emoji]) return resolveSelectMenuEmoji(guildId, p.emoji, em.order_product);
  const slot = UNICODE_TO_SLOT[p.emoji];
  if (slot) return resolveSelectMenuEmoji(guildId, slot, em.order_product);
  return resolveSelectMenuEmoji(guildId, 'order_product', em.order_product);
}

function buildGroupPanel(guildId, group, products) {
  const em = getEmojiMap(guildId);
  const E = createEmojiResolver(guildId);

  const container = new ContainerBuilder().setAccentColor(config.accentColorPrimary);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${E(group.titleSlot)}  ${group.title}\n` +
      `> ${E('icon_sparkle')} ${fmt.b('Chính chủ — Bảo hành — Giao tự động 24/7')}\n` +
      subtext('Chọn sản phẩm ở dropdown bên dưới để đặt hàng ngay!')
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  const lines = products.map((p) => {
    const emoji = productEmoji(guildId, em, E, p);
    const durText = getDurText(p);
    const hasSale = p.original_price > 0 && p.original_price > p.price;
    const priceText = p.price > 0
      ? (hasSale ? `~~${formatCurrency(p.original_price)}~~ → ${fmt.b(formatCurrency(p.price))}` : fmt.b(formatCurrency(p.price)))
      : `${E('icon_gift')} ${fmt.b('Thương lượng')}`;
    return `${emoji} ${fmt.b(p.name)}\n> ${E('payment_money')} ${priceText} ${fmt.b('·')} ${E('icon_duration')} ${durText}`;
  });

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      subtext(`${E('icon_heart_purple')} ${products.length} sản phẩm · Cenar Store — Uy Tín & Chất Lượng`)
    )
  );

  const options = products.slice(0, 25).map((p) => {
    const durText = getDurText(p);
    const priceLabel = p.price > 0 ? formatCurrency(p.price) : 'Thương lượng';
    const opt = {
      label: `${p.name}`.slice(0, 100),
      description: `${priceLabel} · ${durText}`.slice(0, 100),
      value: `${p.id}`,
    };
    const emoji = productSelectEmoji(guildId, em, p);
    if (emoji) opt.emoji = emoji;
    return opt;
  });

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('product:select').setPlaceholder('Chọn sản phẩm muốn mua...').addOptions(options)
  );

  return { components: [container, selectRow], flags: MessageFlags.IsComponentsV2 };
}

export async function autoSetupPriceBoard(client) {
  try {
    for (const guild of client.guilds.cache.values()) {
      let channel = guild.channels.cache.find(c => 
        c.isTextBased() && (c.name.includes('bang-gia') || c.name.includes('bảng-giá') || c.name.includes('price'))
      );

      if (!channel) {
        channel = await guild.channels.create({
          name: '💰・bảng-giá',
          type: ChannelType.GuildText,
          reason: 'Tự động tạo kênh Bảng giá sản phẩm tự động',
        }).catch(() => null);
      }
      if (!channel) continue;

      // Kiểm tra kênh đã có bảng giá chưa, nếu có rồi thì bỏ qua không tạo lại
      const existingMsgs = await channel.messages.fetch({ limit: 5 }).catch(() => null);
      if (existingMsgs && existingMsgs.size > 0) {
        console.log(`[AUTO-SETUP-PRICE] Kênh #${channel.name} (${guild.name}) đã có bảng giá, bỏ qua.`);
        continue;
      }

      const guildConfig = getGuildConfig(guild.id);
      
      // Mảng chứa TẤT CẢ các payload (tin nhắn) cần gửi theo thứ tự
      const payloads = [];

      // 1. Portal Catalog
      payloads.push(buildPricePortalPayload(guild.id, guildConfig));

      // 2. Các Panel sản phẩm theo nhóm
      const allProducts = getActiveProducts(guild.id);
      const used = new Set();
      for (const g of GROUPS) {
        const items = allProducts.filter((p) => !used.has(p.id) && g.match(p));
        items.forEach((p) => used.add(p.id));
        if (items.length > 0) {
          payloads.push(buildGroupPanel(guild.id, g, items));
        }
      }
      const rest = allProducts.filter((p) => !used.has(p.id));
      if (rest.length > 0) {
        payloads.push(buildGroupPanel(guild.id, { titleSlot: 'order_product', title: 'Sản Phẩm Khác' }, rest));
      }

      // Xóa tất cả tin nhắn cũ của bot trong kênh (để setup lại từ A-Z một cách sạch sẽ và đúng thứ tự)
      const oldMessages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
      if (oldMessages) {
        for (const m of oldMessages.filter(m => m.author.id === client.user.id).values()) {
          await m.delete().catch(() => null);
          await new Promise(r => setTimeout(r, 350));
        }
      }

      // Gửi lần lượt các payload
      for (const payload of payloads) {
        await channel.send(payload).catch(err => console.error('[AUTO-SETUP-PRICE] Lỗi gửi payload:', err.message));
        await new Promise(r => setTimeout(r, 500)); // Delay để đảm bảo thứ tự
      }

      console.log(`[AUTO-SETUP-PRICE] Đã thả ĐẦY ĐỦ từ A-Z (${payloads.length} panels) vào #${channel.name} (${guild.name})`);
    }
  } catch (error) {
    console.error('[AUTO-SETUP-PRICE] Lỗi khi setup bảng giá:', error);
  }
}
