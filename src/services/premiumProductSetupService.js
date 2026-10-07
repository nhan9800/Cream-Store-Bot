import { ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags } from 'discord.js';
import { db } from '../database/db.js';
import { API_CREDIT_BANNER, API_CREDIT_DURATION, getApiCreditProducts } from '../config/apiCreditCatalog.js';
import { buildApiCreditPanel, buildApiCreditSelector } from './apiCreditPanel.js';
import { handleProductSelect } from '../events/productHandlers.js';
import { getActiveProducts, getProductByName } from './productCatalogService.js';
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';
import { getWalletBalance } from './walletService.js';
import { getGuildConfig } from './guildConfigService.js';
import { createOrder, payOrderWithWallet, saveOrderLogMessage } from './orderService.js';
import { createTicket, closeTicket, getOpenTicketByCustomer } from './ticketService.js';
import { getTicketCategoryId, activeTicketCreations } from '../events/shared.js';
import { buildTicketWelcomeV2, buildTicketControlComponents } from '../utils/embeds.js';
import { buildOrderLogContent, buildTicketChannelName } from '../utils/formatters.js';
import { canOpenMultipleOrderTickets, TICKET_MEMBER_PERMISSIONS } from '../utils/permissions.js';
import { isCustomerCtv } from './ctvService.js';
import { buildCtvPriorityNotice } from './ctvOrderLogService.js';
import { ensureRateLimit } from './abuseService.js';
import { config } from '../config.js';
import { getCenarHub } from './cenarHub.js';
import { sendOrRefreshPaymentQr } from './paymentService.js';
import { STORE_ONE_CHANNEL_NAMES } from '../config/storeOneChannelAesthetic.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const botRoot = path.resolve(__dirname, '..', '..');
const PREMIUM_CATEGORY_NAME = STORE_ONE_CHANNEL_NAMES.premiumCategory;
const CLAUDE_CHANNEL_NAME = STORE_ONE_CHANNEL_NAMES.claudeApi;
const LOCKET_CHANNEL_NAME = STORE_ONE_CHANNEL_NAMES.locketGold;

// Helper to ensure column exists
function ensureGuildSettingColumn(columnName) {
  try {
    const columns = db.prepare(`PRAGMA table_info(guild_settings)`).all();
    if (!columns.some(c => c.name === columnName)) {
      db.exec(`ALTER TABLE guild_settings ADD COLUMN ${columnName} TEXT`);
    }
  } catch (err) {
    console.error(err);
  }
}

export async function setupPremiumProducts(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const guild = interaction.guild;
  
  ensureGuildSettingColumn('premium_category_id');
  ensureGuildSettingColumn('claude_channel_id');
  ensureGuildSettingColumn('locket_channel_id');
  ensureGuildSettingColumn('claude_product_message_id');
  ensureGuildSettingColumn('locket_product_message_id');

  let settings = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guild.id);
  if (!settings) {
    db.prepare('INSERT INTO guild_settings (guild_id) VALUES (?)').run(guild.id);
    settings = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guild.id);
  }

  // 1. Category
  let categoryId = settings.premium_category_id;
  let category = categoryId ? guild.channels.cache.get(categoryId) : null;
  
    if (!category) {
      category = await guild.channels.create({
        name: PREMIUM_CATEGORY_NAME,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
          deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads]
        },
        {
          id: guild.members.me.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory]
        }
      ]
    });
    db.prepare('UPDATE guild_settings SET premium_category_id = ? WHERE guild_id = ?').run(category.id, guild.id);
  }

  // 2. Channels
  let claudeChannel = settings.claude_channel_id ? guild.channels.cache.get(settings.claude_channel_id) : null;
  if (!claudeChannel) {
    claudeChannel = await guild.channels.create({
      name: CLAUDE_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: category.id,
    });
    db.prepare('UPDATE guild_settings SET claude_channel_id = ? WHERE guild_id = ?').run(claudeChannel.id, guild.id);
  }

  let locketChannel = settings.locket_channel_id ? guild.channels.cache.get(settings.locket_channel_id) : null;
  if (!locketChannel) {
    locketChannel = await guild.channels.create({
      name: LOCKET_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: category.id,
    });
    db.prepare('UPDATE guild_settings SET locket_channel_id = ? WHERE guild_id = ?').run(locketChannel.id, guild.id);
  }

  // 3. Auto xóa tin cũ của bot và republish giao diện mới nhất
  const autoFakeInteraction = {
    guild,
    guildId: guild.id,
    deferReply: async () => {},
    editReply: async (msg) => console.log('[AUTO-PUBLISH]', typeof msg === 'string' ? msg : 'Payload sent'),
    isChatInputCommand: () => false,
  };

  // Xóa tất cả tin cũ của bot trong 2 kênh
  for (const ch of [claudeChannel, locketChannel]) {
    if (!ch) continue;
    const msgs = await ch.messages.fetch({ limit: 20 }).catch(() => null);
    if (msgs) {
      for (const m of msgs.filter(m => m.author.id === guild.members.me.id).values()) {
        await m.delete().catch(() => null);
        await new Promise(r => setTimeout(r, 300));
      }
    }
  }

  // Reset message IDs để buộc gửi mới
  db.prepare('UPDATE guild_settings SET claude_product_message_id = NULL, locket_product_message_id = NULL WHERE guild_id = ?').run(guild.id);

  // Republish giao diện mới nhất
  await publishPremiumProductsForGuild(guild);
  console.log(`[AUTO-PUBLISH-PREMIUM] ✅ Đã republish xong giao diện Premium cho guild: ${guild.name}`);
}

export async function publishPremiumProducts(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const guild = interaction.guild;

  // Xóa tin cũ của bot trước khi publish lại
  const settings = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guild.id);
  if (!settings?.claude_channel_id || !settings?.locket_channel_id) {
    return interaction.editReply('❌ Vui lòng chạy `/product setup` trước!');
  }

  const claudeChannel = guild.channels.cache.get(settings.claude_channel_id);
  const locketChannel = guild.channels.cache.get(settings.locket_channel_id);

  if (!claudeChannel || !locketChannel) {
    return interaction.editReply('❌ Không tìm thấy channel, vui lòng chạy `/product repair`.');
  }

  // Xóa tin cũ
  for (const ch of [claudeChannel, locketChannel]) {
    const msgs = await ch.messages.fetch({ limit: 20 }).catch(() => null);
    if (msgs) {
      for (const m of msgs.filter(m => m.author.id === guild.members.me.id).values()) {
        await m.delete().catch(() => null);
        await new Promise(r => setTimeout(r, 300));
      }
    }
  }
  db.prepare('UPDATE guild_settings SET claude_product_message_id = NULL, locket_product_message_id = NULL WHERE guild_id = ?').run(guild.id);

  await publishPremiumProductsForGuild(guild);
  await interaction.editReply('✅ Đã xóa tin cũ và publish lại giao diện mới nhất!');
}

// ─── Core publish function (dùng cho cả manual và auto) ───
export async function publishPremiumProductsForGuild(guild, settingOverrides = {}) {

  const storedSettings = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guild.id) || {};
  const settings = { ...storedSettings, ...settingOverrides };
  if (!settings?.claude_channel_id || !settings?.locket_channel_id) {
    console.log(`[PUBLISH-PREMIUM] Guild ${guild.name} chưa setup channels, bỏ qua.`);
    return;
  }

  const claudeChannel = guild.channels.cache.get(settings.claude_channel_id) || await guild.channels.fetch(settings.claude_channel_id).catch(() => null);
  const locketChannel = guild.channels.cache.get(settings.locket_channel_id) || await guild.channels.fetch(settings.locket_channel_id).catch(() => null);

  if (!claudeChannel || !locketChannel) {
    console.log(`[PUBLISH-PREMIUM] Không tìm thấy channels cho guild ${guild.name}, bỏ qua.`);
    return;
  }

  const E = createEmojiResolver(guild.id);


  // ══════════════════════════════════════════
  // CLAUDE API — Component V2
  // ══════════════════════════════════════════
  const creditProducts = getApiCreditProducts(getActiveProducts(guild.id));
  if (creditProducts.length) {
    const claudeBannerPath = path.join(botRoot, 'assets/products/claude', API_CREDIT_BANNER);
    const claudeHasBanner = fs.existsSync(claudeBannerPath);
    const claudePayload = {
      ...buildApiCreditPanel(guild.id, creditProducts, claudeHasBanner),
      files: claudeHasBanner ? [new AttachmentBuilder(claudeBannerPath)] : [],
    };

    if (settings.claude_product_message_id) {
      try {
        const msg = await claudeChannel.messages.fetch(settings.claude_product_message_id);
        await msg.edit({ ...claudePayload, attachments: [] });
      } catch (e) {
        const msg = await claudeChannel.send(claudePayload);
        db.prepare('UPDATE guild_settings SET claude_product_message_id = ? WHERE guild_id = ?').run(msg.id, guild.id);
      }
    } else {
      const msg = await claudeChannel.send(claudePayload);
      db.prepare('UPDATE guild_settings SET claude_product_message_id = ? WHERE guild_id = ?').run(msg.id, guild.id);
    }
  }

  // ══════════════════════════════════════════
  // LOCKET GOLD — Component V2
  // ══════════════════════════════════════════
  const locketProduct = getProductByName('WEB', 'Locket Gold — 1 năm');
  if (locketProduct) {
    const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags } = await import('discord.js');

    const locketBannerPath = path.join(botRoot, 'assets/products/locket-gold/locket-gold-banner.webp');
    const locketHasBanner = fs.existsSync(locketBannerPath);

    const container = new ContainerBuilder().setAccentColor(0xFFD700);

    if (locketHasBanner) {
      container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder().setURL('attachment://locket-gold-banner.webp')
        )
      );
    }

    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
    );

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${E('brand_locket')} LOCKET GOLD — 1 NĂM\n` +
        `> ${E('icon_sparkle')} Nâng cấp chính chủ bằng Username · Không cần mật khẩu · Không cần OTP`
      )
    );

    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${E('icon_wallet')} THÔNG TIN NÂNG CẤP\n` +
        `${E('payment_money')} **Giá trọn gói** · \`${locketProduct.base_price.toLocaleString('vi-VN')}đ\`\n` +
        `${E('icon_duration')} **Thời hạn** · \`12 tháng\`\n` +
        `${E('icon_id')} **Thông tin cần gửi** · \`Username Locket chính xác\`\n` +
        `${E('icon_key')} **Bảo mật** · \`Không thu mật khẩu hoặc OTP\``
      )
    );

    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${E('icon_crown')} ĐẶC QUYỀN & QUY TRÌNH\n` +
        `${E('icon_star')} Mở khóa tùy biến biểu tượng ứng dụng và trải nghiệm không quảng cáo.\n` +
        `${E('icon_fire')} Hỗ trợ khôi phục streak khi bị gián đoạn theo chính sách Locket.\n` +
        `${E('cenar_verified')} Bấm **Mua ngay** · Nhập Username · Xác nhận giá · Thanh toán trong ticket.\n` +
        `${E('cenar_staff')} Staff kiểm tra Username và thông báo ngay khi nâng cấp hoàn tất.\n` +
        `${E('status_warn')} *Kiểm tra kỹ Username trước khi xác nhận; sai Username có thể làm chậm xử lý.*`
      )
    );

    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
    );

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# ${E('icon_heart_purple')} Cenar Store · Nâng cấp an toàn · Theo dõi đơn trong ticket · Hỗ trợ rõ ràng`
      )
    );

    const locketRow = new ActionRowBuilder().addComponents(
      withButtonEmoji(new ButtonBuilder().setCustomId('product:locket:buy').setLabel('Mua ngay').setStyle(ButtonStyle.Success), E.component('panel_order')),
      withButtonEmoji(new ButtonBuilder().setCustomId('product:locket:features').setLabel('Đặc quyền').setStyle(ButtonStyle.Secondary), E.component('icon_star')),
      withButtonEmoji(new ButtonBuilder().setCustomId('product:locket:policy').setLabel('Điều khoản').setStyle(ButtonStyle.Secondary), E.component('icon_gem'))
    );

    const locketAttachment = new AttachmentBuilder(locketBannerPath);
    const locketPayload = {
      components: [container, locketRow],
      files: locketHasBanner ? [locketAttachment] : [],
      flags: MessageFlags.IsComponentsV2,
    };

    if (settings.locket_product_message_id) {
      try {
        const msg = await locketChannel.messages.fetch(settings.locket_product_message_id);
        await msg.edit({ ...locketPayload, attachments: [] });
      } catch (e) {
        const msg = await locketChannel.send(locketPayload);
        db.prepare('UPDATE guild_settings SET locket_product_message_id = ? WHERE guild_id = ?').run(msg.id, guild.id);
      }
    } else {
      const msg = await locketChannel.send(locketPayload);
      db.prepare('UPDATE guild_settings SET locket_product_message_id = ? WHERE guild_id = ?').run(msg.id, guild.id);
    }
  }

  await guild.channels.cache; // ensure cache
  console.log(`[PUBLISH-PREMIUM] Done for guild: ${guild.name}`);
}

import { ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

export async function handlePremiumProductInteraction(interaction) {
  const { customId } = interaction;

  if (customId === 'product:claude:credit_select') {
    const products = getApiCreditProducts(getActiveProducts(interaction.guildId));
    const selected = products.find((product) => String(product.id) === interaction.values?.[0]);
    if (!selected) return interaction.reply({ content: 'Gói đã thay đổi hoặc ngừng bán. Vui lòng mở bảng giá mới.', flags: 64 });
    return handleProductSelect(interaction);
  }

  if (customId === 'product:claude:buy' || customId === 'product:claude:modal_buy' || customId === 'product:claude:pricing') {
    const products = getApiCreditProducts(getActiveProducts(interaction.guildId));
    const selector = buildApiCreditSelector(products);
    return interaction.reply({
      content: `**API Codex/Claude · Bảng giá hiện tại**\n${products.map((product) => `**$${product.quota_value} credit** · ${Number(product.price).toLocaleString('vi-VN')}đ`).join('\n')}\n\n${API_CREDIT_DURATION}. Chọn gói bên dưới để đặt hàng.`,
      components: selector ? [selector] : [], flags: 64, allowedMentions: { parse: [] },
    });
  }

  if (customId === 'product:locket:buy') {
    const modal = new ModalBuilder()
      .setCustomId('product:locket:modal_buy')
      .setTitle('Mua Locket Gold 1 Năm');

    const usernameInput = new TextInputBuilder()
      .setCustomId('username')
      .setLabel('Nhập Username Locket của bạn')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ví dụ: nguyenvan_a')
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(usernameInput)
    );

    await interaction.showModal(modal);
    return;
  }

  if (customId === 'product:claude:models') {
    return interaction.reply({
      content: '**Hướng dẫn API Codex/Claude**\nNhận token/API riêng, địa chỉ kết nối và hướng dẫn trong ticket sau khi thanh toán. Không gửi token vào kênh công khai.\n\nModel khả dụng và mức tiêu hao credit theo hệ thống nhà cung cấp tại thời điểm sử dụng; shop xác nhận trước khi giao.\nHướng dẫn: https://cenarstore.xyz/huong-dan-api\nKiểm tra token/model: https://cenarstore.xyz/check-token',
      flags: 64, allowedMentions: { parse: [] },
    });
  }

  if (customId === 'product:claude:policy') {
    return interaction.reply({
      content: '**Điều khoản API AI Credit**\n• Không giới hạn ngày; dùng đến khi hết credit đã mua. Không tính phí gia hạn theo ngày.\n• Credit là hạn mức sử dụng API, không phải tiền mặt hay số token cố định. Mức tiêu hao theo model và hệ thống nhà cung cấp.\n• Token/API và hướng dẫn được giao riêng trong ticket, không cần mật khẩu tài khoản cá nhân.\n• Bảo hành và hỗ trợ trong thời gian sử dụng đến hết credit.\n• Danh sách model có thể thay đổi. Không hoàn tiền sau khi đã kích hoạt và sử dụng token.',
      flags: 64, allowedMentions: { parse: [] },
    });
  }

  if (customId === 'product:locket:features') {
    const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = await import('discord.js');
    const E = createEmojiResolver(interaction.guildId);
    const container = new ContainerBuilder().setAccentColor(0xFFD700);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ${E('icon_heart_purple', '💛')} Đặc Quyền Locket Gold\n` +
      `> ${E('icon_sparkle', '✨')} *Tất cả những gì bạn nhận được khi nâng cấp Gold.*`
    ));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `### ${E('icon_crown', '🏆')} TÍNH NĂNG ĐỘC QUYỀN GOLD\n` +
      `${E('status_check', '✅')} **Biểu tượng app tùy chỉnh** — Đổi icon app theo sở thích.\n` +
      `${E('status_check', '✅')} **Streak Shield** — Bảo vệ & khôi phục streak dễ dàng.\n` +
      `${E('status_check', '✅')} **Không quảng cáo** — Trải nghiệm sạch hoàn toàn.\n` +
      `${E('status_check', '✅')} **Reaction đặc biệt** — Emoji phản ứng độc quyền Gold.\n` +
      `${E('status_check', '✅')} **Chủ đề màu sắc** — Cá nhân hóa giao diện Locket.`
    ));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `### ${E('icon_wallet', '💳')} GÓI 1 NĂM — GIÁ TỐT NHẤT\n` +
      `${E('icon_price', '💰')} Chỉ **\`150,000đ\`** cho **12 tháng** đầy đủ đặc quyền!\n` +
      `${E('icon_key', '🔒')} Kích hoạt bằng **Username** — Không cần mật khẩu.`
    ));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `-# ${E('icon_heart_purple', '💜')} Nhấn **Mua ngay** để đặt hàng ngay!`
    ));
    return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | 64 });
  }

  if (customId === 'product:locket:policy') {
    const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = await import('discord.js');
    const E = createEmojiResolver(interaction.guildId);
    const container = new ContainerBuilder().setAccentColor(0xFFD700);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ${E('icon_gem', '💎')} Điều Khoản Dịch Vụ — Locket Gold\n` +
      `> ${E('icon_sparkle', '✨')} *Vui lòng đọc kỹ trước khi mua.*`
    ));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `### ${E('status_check', '✅')} CAM KẾT CỦA SHOP\n` +
      `${E('icon_gem', '💎')} Bảo hành full 12 tháng thời hạn đã mua.\n` +
      `${E('icon_key', '🔒')} Kích hoạt bằng Username — Không cần mật khẩu/OTP.\n` +
      `${E('status_check', '✅')} Hỗ trợ trong suốt thời hạn sử dụng.`
    ));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `### ${E('status_warn', '⚠️')} LƯU Ý QUAN TRỌNG\n` +
      `${E('status_warn', '⚠️')} **Kiểm tra thật kỹ Username trước khi xác nhận!**\n` +
      `${E('status_cross', '❌')} Không hoàn tiền sau khi đã kích hoạt thành công.\n` +
      `${E('icon_duration', '⏱️')} Thời hạn 12 tháng tính từ ngày kích hoạt.`
    ));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `-# ${E('icon_heart_purple', '💜')} Cenar Store — Uy Tín · Chất Lượng · Hỗ Trợ 24/7`
    ));
    return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | 64 });
  }

  // Handle modals
  if (customId === 'product:locket:modal_buy') {
    const username = interaction.fields.getTextInputValue('username');
    
    const product = getProductByName('WEB', 'Locket Gold — 1 năm');
    if (!product) return interaction.reply({ content: '❌ Sản phẩm không khả dụng.', ephemeral: true });

    const locketPrice = product.base_price ?? product.price ?? 0;
    await handlePremiumBuyOrder(interaction, product.name, 1, locketPrice, `Username Locket: ${username}`, product);
    return;
  }

  await interaction.reply({ content: 'Tính năng đang được phát triển.', ephemeral: true });
}

async function handlePremiumBuyOrder(interaction, productName, quantity, totalPrice, note, productObj = null) {
  const E = createEmojiResolver(interaction.guildId);
  await interaction.deferReply({ ephemeral: true });

  const guildConfig = getGuildConfig(interaction.guildId);
  if (!guildConfig) {
    return interaction.editReply(`${E('status_warn')} Server chưa setup ticket.`);
  }

  const currentBalance = getWalletBalance(interaction.guildId, interaction.user.id);
  if (currentBalance < totalPrice) {
    const missing = totalPrice - currentBalance;
    return interaction.editReply(`${E('status_cross')} Số dư trong ví không đủ!\nSản phẩm: **${productName}**\nTổng tiền: **${totalPrice.toLocaleString('vi-VN')}đ**\n\nSố dư hiện tại: **${currentBalance.toLocaleString('vi-VN')}đ**\nBạn cần nạp thêm: **${missing.toLocaleString('vi-VN')}đ**.\n> Vui lòng nạp tiền vào ví bằng lệnh \`/wallet\` hoặc bảng Nạp Tiền.`);
  }

  const normalizedType = 'ORDER';
  const lockKey = `${interaction.guildId}:${interaction.user.id}:${normalizedType}`;
  if (activeTicketCreations.has(lockKey)) {
    return interaction.editReply(`${E('status_warn')} Yêu cầu tạo ticket của bạn đang được xử lý, vui lòng không bấm liên tục.`);
  }
  activeTicketCreations.add(lockKey);

  try {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => interaction.member ?? null);
    const allowMultipleTickets = canOpenMultipleOrderTickets(member, interaction.guildId);
    ensureRateLimit({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      action: 'OPEN_TICKET_ORDER',
      limit: allowMultipleTickets ? config.ctvTicketOpenBurstLimit : 1,
      windowSeconds: allowMultipleTickets ? config.ctvTicketOpenBurstWindowSeconds : config.ticketOpenCooldownSeconds,
      message: allowMultipleTickets
        ? `Bạn đã mở quá nhiều ticket liên tiếp. Vui lòng chờ ${config.ctvTicketOpenBurstWindowSeconds} giây.`
        : 'Bạn vừa mở ticket rồi. Vui lòng chờ.',
    });
    
    const existingTicket = allowMultipleTickets
      ? null
      : getOpenTicketByCustomer(interaction.guildId, interaction.user.id, normalizedType);
    if (existingTicket) {
      const existingChannel = await interaction.guild.channels.fetch(existingTicket.channel_id).catch(() => null);
      if (existingChannel) {
        await interaction.editReply(`${E('status_warn')} Bạn đã có đơn hàng đang xử lý tại <#${existingTicket.channel_id}>.`);
        activeTicketCreations.delete(lockKey);
        return;
      }
      closeTicket(existingTicket.id, interaction.client.user.id);
    }

    const { PermissionFlagsBits, ChannelType } = await import('discord.js');
    const overwrites = [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: TICKET_MEMBER_PERMISSIONS },
      { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
    ];
    if (guildConfig.support_role_id) overwrites.push({ id: guildConfig.support_role_id, allow: TICKET_MEMBER_PERMISSIONS });

    const categoryId = getTicketCategoryId(guildConfig, normalizedType);
    const channel = await interaction.guild.channels.create({
      name: `tmp-${Math.random().toString().slice(2, 8)}`,
      type: ChannelType.GuildText,
      parent: categoryId,
      permissionOverwrites: overwrites,
    });

    const ticket = createTicket({
      guildId: interaction.guildId,
      channelId: channel.id,
      customerId: interaction.user.id,
      openedById: interaction.user.id,
      ticketType: normalizedType,
    });

    const hub = getCenarHub();
    if (hub) {
      hub.upsertUser({
        discord_id: interaction.user.id,
        discord_username: interaction.user.username,
        display_name: interaction.member?.displayName,
      }).catch(e => console.error('[HUB] Lỗi upsertUser:', e.message));
    }

    const isCtv = isCustomerCtv(interaction.guildId, interaction.user.id, interaction.member);
    const prefix = (productObj?.service_type || 'ticket').toLowerCase();
    
    if (isCtv) {
      await channel.setName(`🥝-ctv-${ticket.ticket_code}`).catch(() => null);
    } else {
      await channel.setName(buildTicketChannelName(ticket.ticket_code, prefix)).catch(() => null);
    }

    let order = createOrder({
      guildId: interaction.guildId,
      ticketId: ticket.id,
      ticketChannelId: channel.id,
      customerId: interaction.user.id,
      productName: productName,
      serviceType: productObj?.service_type,
      quantity,
      note,
      totalAmount: totalPrice,
      durationMonths: productObj?.duration_months || 0,
      orderLogChannelId: guildConfig.order_log_channel_id ?? null,
      createdById: interaction.client.user.id,
    });

    const currentBalance = getWalletBalance(interaction.guildId, interaction.user.id);
    if (currentBalance >= totalPrice && totalPrice > 0) {
      order = payOrderWithWallet({
        orderCode: order.order_code,
        guildId: interaction.guildId,
        customerId: interaction.user.id,
        amount: totalPrice,
      }).order;
    }

    try {
      const orderLogChannel = guildConfig.order_log_channel_id
        ? await interaction.guild.channels.fetch(guildConfig.order_log_channel_id).catch(() => null)
        : null;
      if (orderLogChannel?.isTextBased()) {
        const logMessage = await orderLogChannel.send({ content: buildOrderLogContent(order, interaction.guildId) });
        saveOrderLogMessage(order.order_code, logMessage.id);
      }
    } catch (logErr) {
      console.error('[PREMIUM ORDER] Lỗi gửi log đơn:', logErr.message);
    }

    const { container: welcomeContainer, flags: welcomeFlags } = buildTicketWelcomeV2(
      ticket.ticket_code,
      interaction.user.id,
      normalizedType,
      order.order_code,
      productName,
      interaction.guildId
    );
    await channel.send({
      components: [welcomeContainer, ...buildTicketControlComponents(ticket.id, interaction.user.id)],
      flags: welcomeFlags,
    });
    
    await channel.send({ content: `${E('cenar_verified')} <@${interaction.user.id}> — Đơn hàng **${order.order_code}** đã được tạo! ${note ? `\n> ${E('cenar_support')} Ghi chú: **${note}**` : ''}` }).catch(() => null);

    if (isCtv) {
      await channel.send(buildCtvPriorityNotice(
        interaction.guildId,
        interaction.user.id,
        order,
        [guildConfig.support_role_id, guildConfig.shipper_role_id],
      )).catch(() => null);
    }

    if (totalPrice > 0 && order.payment_status !== 'PAID') {
      await sendOrRefreshPaymentQr({ guild: interaction.guild, orderCode: order.order_code }).catch(err => {
        console.error('[ORDER] Lỗi tạo QR PayOS:', err);
        channel.send(`${E('status_warn', '⚠️')} Lỗi tạo mã QR thanh toán: ${err.message}`).catch(() => null);
      });
    } else {
      await channel.send({ content: `${E('status_check', '✅')} **THANH TOÁN THÀNH CÔNG:** Đơn hàng này đã được thanh toán qua Ví Store. Nhân viên sẽ tiến hành xử lý và giao hàng cho bạn.` }).catch(() => null);
    }

    await interaction.editReply(`${E('status_check', '✅')} Đã tạo đơn hàng thành công tại <#${channel.id}>`);
  } catch (err) {
    console.error('[PREMIUM ORDER] Lỗi xử lý:', err);
    await interaction.editReply(`${E('status_cross')} Đã xảy ra lỗi khi tạo đơn hàng: ${err.message}`);
  } finally {
    activeTicketCreations.delete(lockKey);
  }
}

export async function autoSetupAndPublishPremiumProducts(guild) {
  try {
    ensureGuildSettingColumn('premium_category_id');
    ensureGuildSettingColumn('claude_channel_id');
    ensureGuildSettingColumn('locket_channel_id');
    ensureGuildSettingColumn('claude_product_message_id');
    ensureGuildSettingColumn('locket_product_message_id');

    let settings = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guild.id);
    if (!settings) {
      db.prepare('INSERT INTO guild_settings (guild_id) VALUES (?)').run(guild.id);
      settings = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guild.id);
    }

    // 1. Category
    let categoryId = settings.premium_category_id;
    let category = categoryId ? guild.channels.cache.get(categoryId) : null;
    
    if (!category) {
      category = await guild.channels.create({
        name: PREMIUM_CATEGORY_NAME,
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
            deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads]
          },
          {
            id: guild.members.me.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory]
          }
        ]
      });
      db.prepare('UPDATE guild_settings SET premium_category_id = ? WHERE guild_id = ?').run(category.id, guild.id);
    } else if (category.name !== PREMIUM_CATEGORY_NAME) {
      await category.setName(PREMIUM_CATEGORY_NAME).catch(() => {});
    }

    // 2. Channels
    let claudeChannel = settings.claude_channel_id ? guild.channels.cache.get(settings.claude_channel_id) : null;
    if (!claudeChannel) {
      claudeChannel = await guild.channels.create({
        name: CLAUDE_CHANNEL_NAME,
        type: ChannelType.GuildText,
        parent: category.id,
      });
      db.prepare('UPDATE guild_settings SET claude_channel_id = ? WHERE guild_id = ?').run(claudeChannel.id, guild.id);
    } else if (claudeChannel.name !== CLAUDE_CHANNEL_NAME) {
      await claudeChannel.setName(CLAUDE_CHANNEL_NAME).catch(() => {});
    }

    let locketChannel = settings.locket_channel_id ? guild.channels.cache.get(settings.locket_channel_id) : null;
    if (!locketChannel) {
      locketChannel = await guild.channels.create({
        name: LOCKET_CHANNEL_NAME,
        type: ChannelType.GuildText,
        parent: category.id,
      });
      db.prepare('UPDATE guild_settings SET locket_channel_id = ? WHERE guild_id = ?').run(locketChannel.id, guild.id);
    } else if (locketChannel.name !== LOCKET_CHANNEL_NAME) {
      await locketChannel.setName(LOCKET_CHANNEL_NAME).catch(() => {});
    }

    // Kiểm tra nếu kênh đã có tin nhắn rồi thì bỏ qua không tạo lại panel
    const claudeMsgs = claudeChannel ? await claudeChannel.messages.fetch({ limit: 5 }).catch(() => null) : null;
    const locketMsgs = locketChannel ? await locketChannel.messages.fetch({ limit: 5 }).catch(() => null) : null;
    if ((claudeMsgs && claudeMsgs.size > 0) || (locketMsgs && locketMsgs.size > 0)) {
      console.log(`[AUTO-SETUP-PREMIUM] Guild ${guild.name} đã có panel Premium, bỏ qua.`);
      return;
    }

    // Auto Publish logic
    const mockInteraction = {
      guild,
      deferReply: async () => {},
      editReply: async (msg) => console.log('[AUTO-SETUP]', msg)
    };
    
    await publishPremiumProducts(mockInteraction);
    console.log('[AUTO-SETUP] Successfully created and published Premium Products channels automatically.');
  } catch (error) {
    console.error('[AUTO-SETUP] Error during automatic setup:', error);
  }
}



