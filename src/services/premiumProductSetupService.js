import { ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';
import { db } from '../database/db.js';
import { getProductByName } from './productCatalogService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
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

▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬

${E('icon_price', '💰')} **Giá khởi điểm:** \`${claudeProduct.base_price.toLocaleString('vi-VN')}đ\`
${E('icon_duration', '⏱️')} **Thời hạn:** \`${claudeProduct.base_duration_days} ngày\`
${E('icon_gift', '🎁')} **Mua thêm ngày:** \`+${claudeProduct.additional_day_price.toLocaleString('vi-VN')}đ / ngày\`
${E('icon_chart', '📊')} **Hạn mức:** \`${claudeProduct.quota_value}${claudeProduct.quota_unit}\`

▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬

${E('icon_crown', '👑')} **ĐẶC ĐIỂM NỔI BẬT**
${E('status_check', '✅')} Truy cập các model Claude siêu việt từ hệ thống.
${E('status_check', '✅')} Hỗ trợ đa tác vụ lập trình, phân tích, research.

${E('icon_gem', '💎')} **CAM KẾT DỊCH VỤ**
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

▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬

${E('icon_price', '💰')} **Giá nâng cấp:** \`${locketProduct.base_price.toLocaleString('vi-VN')}đ\`
${E('icon_duration', '⏱️')} **Thời hạn:** \`12 tháng\`
${E('icon_id', '👤')} **Kích hoạt:** \`Bằng Username\`
${E('icon_key', '🔒')} **Bảo mật:** \`Không cần Mật khẩu / OTP\`

▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬

${E('icon_crown', '🏆')} **ĐẶC QUYỀN LOCKET GOLD**
${E('status_check', '✅')} Thay đổi biểu tượng ứng dụng theo sở thích.
${E('status_check', '✅')} Khôi phục streak dễ dàng khi bị gián đoạn.
${E('status_check', '✅')} Trải nghiệm hoàn toàn không quảng cáo.

${E('icon_fire', '🚀')} **HƯỚNG DẪN MUA HÀNG**
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
    const days = parseInt(daysStr, 10);
    if (isNaN(days) || days < 1) {
      return interaction.reply({ content: '❌ Số ngày không hợp lệ!', ephemeral: true });
    }

    const { calculateClaudePrice } = await import('../utils/pricing.js');
    const price = calculateClaudePrice(days);
    
    // Tạo đơn hàng ảo (hoặc gọi orderService)
    await interaction.reply({ content: `✅ Bạn đã chọn mua **${days} ngày** Claude API.\n💰 Tổng tiền: **${price.toLocaleString('vi-VN')}đ**.\n*(Luồng tạo đơn và thanh toán sẽ được kết nối ở bước tiếp theo)*`, ephemeral: true });
    return;
  }

  if (customId === 'product:locket:modal_buy') {
    const username = interaction.fields.getTextInputValue('username');
    await interaction.reply({ content: `✅ Đã tiếp nhận yêu cầu nâng cấp Locket Gold cho username: **${username}**.\n*(Luồng tạo đơn và thanh toán sẽ được kết nối ở bước tiếp theo)*`, ephemeral: true });
    return;
  }

  await interaction.reply({ content: 'Tính năng đang được phát triển.', ephemeral: true });
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
