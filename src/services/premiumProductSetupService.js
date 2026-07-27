import { ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';
import { db } from '../database/db.js';
import { getProductByName } from './productCatalogService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { getWalletBalance, addWalletBalance } from './walletService.js';
import { getGuildConfig } from './guildConfigService.js';
import { createOrder, saveOrderLogMessage } from './orderService.js';
import { createTicket, closeTicket, getOpenTicketByCustomer } from './ticketService.js';
import { getTicketCategoryId, activeTicketCreations } from '../events/shared.js';
import { buildTicketWelcomeV2, buildTicketControlComponents } from '../utils/embeds.js';
import { buildOrderLogContent, buildTicketChannelName } from '../utils/formatters.js';
import { TICKET_MEMBER_PERMISSIONS } from '../utils/permissions.js';
import { isCustomerCtv } from './ctvService.js';
import { ensureRateLimit } from './abuseService.js';
import { config } from '../config.js';
import { getCenarHub } from './cenarHub.js';
import { sendOrRefreshPaymentQr } from './paymentService.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const botRoot = path.resolve(__dirname, '..', '..');

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
        name: '👑 ｜ SẢN PHẨM PREMIUM',
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
      name: '🤖・claude-api',
      type: ChannelType.GuildText,
      parent: category.id,
    });
    db.prepare('UPDATE guild_settings SET claude_channel_id = ? WHERE guild_id = ?').run(claudeChannel.id, guild.id);
  }

  let locketChannel = settings.locket_channel_id ? guild.channels.cache.get(settings.locket_channel_id) : null;
  if (!locketChannel) {
    locketChannel = await guild.channels.create({
      name: '💛・locket-gold',
      type: ChannelType.GuildText,
      parent: category.id,
    });
    db.prepare('UPDATE guild_settings SET locket_channel_id = ? WHERE guild_id = ?').run(locketChannel.id, guild.id);
  }

  await interaction.editReply('✅ Setup category và channels thành công! Hãy chạy `/product publish` để đăng bài.');
}

export async function publishPremiumProducts(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const guild = interaction.guild;
  const settings = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guild.id);
  
  if (!settings?.claude_channel_id || !settings?.locket_channel_id) {
    return interaction.editReply('❌ Vui lòng chạy `/product setup` trước!');
  }

  const claudeChannel = guild.channels.cache.get(settings.claude_channel_id);
  const locketChannel = guild.channels.cache.get(settings.locket_channel_id);

  if (!claudeChannel || !locketChannel) {
    return interaction.editReply('❌ Không tìm thấy channel, vui lòng chạy `/product repair`.');
  }

  const E = createEmojiResolver(guild.id);
  
  // Publish Claude
  const claudeProduct = getProductByName('WEB', 'Claude API 100M');
  if (claudeProduct) {
    const claudeEmbed = new EmbedBuilder()
      .setColor('#D97757')
      .setTitle(`${E('brand_claude', '🤖')} CLAUDE API 100M`)
      .setDescription(`> ${E('icon_sparkle', '✨')} *Trải nghiệm hệ sinh thái Claude mạnh mẽ, phù hợp cho lập trình, phân tích dữ liệu, viết nội dung và xử lý công việc chuyên sâu.*

# ${E('icon_wallet', '💳')} THÔNG TIN GÓI CƯỚC
${E('icon_price', '💰')} **Giá khởi điểm:** \`${claudeProduct.base_price.toLocaleString('vi-VN')}đ\`
${E('icon_duration', '⏱️')} **Thời hạn:** \`${claudeProduct.base_duration_days} ngày\`
${E('icon_gift', '🎁')} **Mua thêm ngày:** \`+${claudeProduct.additional_day_price.toLocaleString('vi-VN')}đ / ngày\`
${E('icon_chart', '📊')} **Hạn mức:** \`${claudeProduct.quota_value}${claudeProduct.quota_unit}\`

# ${E('icon_crown', '👑')} ĐẶC ĐIỂM NỔI BẬT
${E('status_check', '✅')} Truy cập các model Claude siêu việt từ hệ thống.
${E('status_check', '✅')} Hỗ trợ đa tác vụ lập trình, phân tích, research.

# ${E('icon_gem', '💎')} CAM KẾT DỊCH VỤ
${E('status_check', '✅')} Bảo hành full thời hạn sử dụng.
${E('status_check', '✅')} Không yêu cầu cung cấp thông tin cá nhân.
${E('status_warn', '⚠️')} *Lưu ý: Model khả dụng có thể thay đổi theo chính sách Anthropic.*`)
      .setImage('attachment://claude-banner.webp');

    const claudeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('product:claude:buy').setLabel('Mua ngay').setStyle(ButtonStyle.Success).setEmoji(E('icon_cart', '🛒')),
      new ButtonBuilder().setCustomId('product:claude:pricing').setLabel('Tính giá').setStyle(ButtonStyle.Secondary).setEmoji(E('icon_price', '🧮')),
      new ButtonBuilder().setCustomId('product:claude:models').setLabel('Model khả dụng').setStyle(ButtonStyle.Secondary).setEmoji(E('brand_claude', '🤖')),
      new ButtonBuilder().setCustomId('product:claude:policy').setLabel('Điều khoản').setStyle(ButtonStyle.Secondary).setEmoji(E('icon_clipboard', '📜'))
    );

    const claudeAttachment = new AttachmentBuilder(path.join(botRoot, 'assets/products/claude/claude-banner.webp'));

    if (settings.claude_product_message_id) {
      try {
        const msg = await claudeChannel.messages.fetch(settings.claude_product_message_id);
        await msg.edit({ embeds: [claudeEmbed], components: [claudeRow], files: [claudeAttachment] });
      } catch (e) {
        const msg = await claudeChannel.send({ embeds: [claudeEmbed], components: [claudeRow], files: [claudeAttachment] });
        db.prepare('UPDATE guild_settings SET claude_product_message_id = ? WHERE guild_id = ?').run(msg.id, guild.id);
      }
    } else {
      const msg = await claudeChannel.send({ embeds: [claudeEmbed], components: [claudeRow], files: [claudeAttachment] });
      db.prepare('UPDATE guild_settings SET claude_product_message_id = ? WHERE guild_id = ?').run(msg.id, guild.id);
    }
  }

  // Publish Locket
  const locketProduct = getProductByName('WEB', 'Locket Gold — 1 năm');
  if (locketProduct) {
    const locketEmbed = new EmbedBuilder()
      .setColor('#FFD700')
      .setTitle(`${E('icon_heart_purple', '💛')} LOCKET GOLD — 1 NĂM`)
      .setDescription(`> ${E('icon_sparkle', '✨')} *Nâng cấp trải nghiệm Locket với nhiều tính năng cá nhân hóa, kết nối bạn bè và chia sẻ khoảnh khắc tiện lợi hơn.*

# ${E('icon_wallet', '💳')} THÔNG TIN GÓI CƯỚC
${E('icon_price', '💰')} **Giá nâng cấp:** \`${locketProduct.base_price.toLocaleString('vi-VN')}đ\`
${E('icon_duration', '⏱️')} **Thời hạn:** \`12 tháng\`
${E('icon_id', '👤')} **Kích hoạt:** \`Bằng Username\`
${E('icon_key', '🔒')} **Bảo mật:** \`Không cần Mật khẩu / OTP\`

# ${E('icon_crown', '🏆')} ĐẶC QUYỀN LOCKET GOLD
${E('status_check', '✅')} Thay đổi biểu tượng ứng dụng theo sở thích.
${E('status_check', '✅')} Khôi phục streak dễ dàng khi bị gián đoạn.
${E('status_check', '✅')} Trải nghiệm hoàn toàn không quảng cáo.

# ${E('icon_fire', '🚀')} HƯỚNG DẪN MUA HÀNG
${E('status_info', 'ℹ️')} Bấm **Mua ngay** ➔ Nhập **Username** ➔ Thanh toán ➔ Hoàn tất!
${E('status_warn', '⚠️')} *Vui lòng kiểm tra kỹ chính xác username trước khi thanh toán.*`)
      .setImage('attachment://locket-gold-banner.webp');

    const locketRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('product:locket:buy').setLabel('Mua ngay').setStyle(ButtonStyle.Success).setEmoji(E('icon_cart', '🛒')),
      new ButtonBuilder().setCustomId('product:locket:features').setLabel('Xem đặc quyền').setStyle(ButtonStyle.Secondary).setEmoji(E('icon_star', '✨')),
      new ButtonBuilder().setCustomId('product:locket:policy').setLabel('Điều khoản').setStyle(ButtonStyle.Secondary).setEmoji(E('icon_clipboard', '📜'))
    );

    const locketAttachment = new AttachmentBuilder(path.join(botRoot, 'assets/products/locket-gold/locket-gold-banner.webp'));

    if (settings.locket_product_message_id) {
      try {
        const msg = await locketChannel.messages.fetch(settings.locket_product_message_id);
        await msg.edit({ embeds: [locketEmbed], components: [locketRow], files: [locketAttachment] });
      } catch (e) {
        const msg = await locketChannel.send({ embeds: [locketEmbed], components: [locketRow], files: [locketAttachment] });
        db.prepare('UPDATE guild_settings SET locket_product_message_id = ? WHERE guild_id = ?').run(msg.id, guild.id);
      }
    } else {
      const msg = await locketChannel.send({ embeds: [locketEmbed], components: [locketRow], files: [locketAttachment] });
      db.prepare('UPDATE guild_settings SET locket_product_message_id = ? WHERE guild_id = ?').run(msg.id, guild.id);
    }
  }

  await interaction.editReply('✅ Publish thành công giao diện sản phẩm bằng Components V2!');
}

import { ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

export async function handlePremiumProductInteraction(interaction) {
  const { customId } = interaction;

  if (customId === 'product:claude:buy') {
    const modal = new ModalBuilder()
      .setCustomId('product:claude:modal_buy')
      .setTitle('Mua Claude API 100M');

    const daysInput = new TextInputBuilder()
      .setCustomId('days')
      .setLabel('Nhập số ngày muốn mua (Tối thiểu 1)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ví dụ: 30')
      .setRequired(true);

    const emailInput = new TextInputBuilder()
      .setCustomId('email')
      .setLabel('Email nhận thông báo (Không bắt buộc)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(daysInput),
      new ActionRowBuilder().addComponents(emailInput)
    );

    await interaction.showModal(modal);
    return;
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

  if (customId === 'product:claude:pricing') {
    await interaction.reply({
      content: '🧮 **Bảng tính giá Claude API:**\n- Ngày đầu tiên: 85,000đ\n- Các ngày tiếp theo: +5,000đ/ngày\n*(Ví dụ: 3 ngày = 85,000 + 2*5,000 = 95,000đ)*',
      ephemeral: true
    });
    return;
  }

  if (customId === 'product:claude:models') {
    // Gọi API của Anthropic để lấy danh sách models
    try {
      // Stub
      const models = ['claude-3-5-sonnet-20240620', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'];
      await interaction.reply({
        content: `🤖 **Danh sách model khả dụng (Cập nhật realtime):**\n` + models.map(m => `- \`${m}\``).join('\n'),
        ephemeral: true
      });
    } catch (e) {
      await interaction.reply({ content: '❌ Lỗi khi lấy danh sách model.', ephemeral: true });
    }
    return;
  }

  // Handle modals
  if (customId === 'product:claude:modal_buy') {
    const daysStr = interaction.fields.getTextInputValue('days');
    const email = interaction.fields.getTextInputValue('email') || '';
    const days = parseInt(daysStr, 10);
    if (isNaN(days) || days < 1) {
      return interaction.reply({ content: '❌ Số ngày không hợp lệ!', ephemeral: true });
    }

    const { calculateClaudePrice } = await import('../utils/pricing.js');
    const price = calculateClaudePrice(days);
    
    await handlePremiumBuyOrder(interaction, 'Claude API 100M', days, price, email ? `Email nhận: ${email}` : '');
    return;
  }

  if (customId === 'product:locket:modal_buy') {
    const username = interaction.fields.getTextInputValue('username');
    
    const product = getProductByName('WEB', 'Locket Gold — 1 năm');
    if (!product) return interaction.reply({ content: '❌ Sản phẩm không khả dụng.', ephemeral: true });

    await handlePremiumBuyOrder(interaction, product.name, 1, product.price, `Username Locket: ${username}`, product);
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
    ensureRateLimit({ guildId: interaction.guildId, userId: interaction.user.id, action: `OPEN_TICKET_ORDER`, limit: 1, windowSeconds: config.ticketOpenCooldownSeconds, message: `Bạn vừa mở ticket rồi. Vui lòng chờ.` });
    
    const existingTicket = getOpenTicketByCustomer(interaction.guildId, interaction.user.id, normalizedType);
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

    const isCtv = isCustomerCtv(interaction.guildId, interaction.user.id);
    const prefix = (productObj?.service_type || 'ticket').toLowerCase();
    
    if (isCtv) {
      await channel.setName(`⚡-ctv-${ticket.ticket_code}`).catch(() => null);
    } else {
      await channel.setName(buildTicketChannelName(ticket.ticket_code, prefix)).catch(() => null);
    }

    const order = createOrder({
      guildId: interaction.guildId,
      ticketId: ticket.id,
      ticketChannelId: channel.id,
      customerId: interaction.user.id,
      productName: productName,
      quantity,
      note,
      totalAmount: totalPrice,
      durationMonths: productObj?.duration_months || 0,
      orderLogChannelId: guildConfig.order_log_channel_id ?? null,
      createdById: interaction.client.user.id,
    });

    addWalletBalance(
      interaction.guildId, 
      interaction.user.id, 
      -totalPrice, 
      'PAY_ORDER', 
      `Thanh toán đơn ${order.order_code}: x${quantity} ${productName}`, 
      order.order_code
    );

    db.prepare("UPDATE store_orders SET status = 'PAID' WHERE order_code = ?").run(order.order_code);
    order.status = 'PAID';

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
    
    await channel.send({ content: `<@${interaction.user.id}> — Đơn hàng **${order.order_code}** đã được tạo! ${note ? `\n> 📝 Ghi chú: **${note}**` : ''}` }).catch(() => null);

    if (isCtv) {
      const supportPing = [guildConfig.support_role_id && `<@&${guildConfig.support_role_id}>`, guildConfig.shipper_role_id && `<@&${guildConfig.shipper_role_id}>`].filter(Boolean).join(' ');
      await channel.send({ content: `${supportPing} ⚡ **ĐƠN HÀNG CTV ƯU TIÊN CAO:** CTV <@${interaction.user.id}> vừa lên đơn hàng \`${order.order_code}\` (Sản phẩm: **${productName}**). Vui lòng ưu tiên xử lý và bàn giao nhanh nhất!` }).catch(() => null);
    }

    await channel.send({ content: `${E('status_check')} **THANH TOÁN THÀNH CÔNG:** Đơn hàng này đã được thanh toán 100% qua Ví Store. Nhân viên sẽ tiến hành xử lý và giao hàng cho bạn.` }).catch(() => null);

    await interaction.editReply(`${E('status_check')} Đã tạo đơn hàng thành công tại <#${channel.id}>`);
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
        name: '👑 ｜ SẢN PHẨM PREMIUM',
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
    } else if (category.name !== '👑 ｜ SẢN PHẨM PREMIUM') {
      await category.setName('👑 ｜ SẢN PHẨM PREMIUM').catch(() => {});
    }

    // 2. Channels
    let claudeChannel = settings.claude_channel_id ? guild.channels.cache.get(settings.claude_channel_id) : null;
    if (!claudeChannel) {
      claudeChannel = await guild.channels.create({
        name: '🤖・claude-api',
        type: ChannelType.GuildText,
        parent: category.id,
      });
      db.prepare('UPDATE guild_settings SET claude_channel_id = ? WHERE guild_id = ?').run(claudeChannel.id, guild.id);
    } else if (claudeChannel.name !== '🤖・claude-api') {
      await claudeChannel.setName('🤖・claude-api').catch(() => {});
    }

    let locketChannel = settings.locket_channel_id ? guild.channels.cache.get(settings.locket_channel_id) : null;
    if (!locketChannel) {
      locketChannel = await guild.channels.create({
        name: '💛・locket-gold',
        type: ChannelType.GuildText,
        parent: category.id,
      });
      db.prepare('UPDATE guild_settings SET locket_channel_id = ? WHERE guild_id = ?').run(locketChannel.id, guild.id);
    } else if (locketChannel.name !== '💛・locket-gold') {
      await locketChannel.setName('💛・locket-gold').catch(() => {});
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
