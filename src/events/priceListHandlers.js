// ═══════════════════════════════════════════════════════════════════
// priceListHandlers.js — Nhóm xử lý Bảng giá + Admin bảng giá (tách từ interactionCreate.js).
// Nằm CÙNG thư mục src/events/ để mọi đường dẫn '../services', '../utils', '../database' giữ nguyên.
// State/helper dùng chung import từ ./shared.js — KHÔNG khai báo lại.
// ═══════════════════════════════════════════════════════════════════

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import { db } from '../database/db.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { getGuildConfig, upsertGuildConfig } from '../services/guildConfigService.js';
import { isManager } from '../utils/permissions.js';
import { getActiveProducts, getProductById, updateProduct, addProduct, getAllProducts, getProductByName } from '../services/productCatalogService.js';
import { resolveSelectMenuEmoji, resolveProductEmoji } from '../services/emojiService.js';
import { refreshAllShopPanels } from '../services/shopPanelService.js';
import {
  safeReply,
  resolveDecorEmoji,
  parsePrice,
  parseCompactSecondaryPrice,
  getDefaultCategoryDetails,
} from './shared.js';

export async function handlePriceListSelect(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  const category = interaction.values[0];
  const products = getActiveProducts(interaction.guildId).filter(
    p => p.service_type && p.service_type.toLowerCase() === category.toLowerCase()
  );
  const guildConfig = getGuildConfig(interaction.guildId);

  const defaults = getDefaultCategoryDetails(category);
  let embedColor = Number.parseInt(defaults.color, 16) || 0xF3A6D7;
  let title = defaults.title;
  let categoryName = defaults.name;
  let bannerUrl = null;
  let displayMode = defaults.display_mode || 'detailed';
  let subtitle = defaults.subtitle || '';

  let customConfigs = {};
  if (guildConfig?.price_list_category_configs) {
    try {
      customConfigs = JSON.parse(guildConfig.price_list_category_configs);
    } catch (e) {}
  }
  const catConfig = customConfigs[category.toLowerCase()] || {};

  if (catConfig.title) title = catConfig.title;
  if (catConfig.color) {
    const cleanColor = catConfig.color.replace('#', '');
    const parsedColor = Number.parseInt(cleanColor, 16);
    if (!Number.isNaN(parsedColor)) {
      embedColor = parsedColor;
    }
  }
  if (catConfig.image_url) {
    bannerUrl = catConfig.image_url;
  }
  if (catConfig.display_mode) displayMode = catConfig.display_mode;
  if (catConfig.subtitle) subtitle = catConfig.subtitle;

  const embeds = [];
  let currentEmbed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(title);

  if (bannerUrl) {
    currentEmbed.setImage(bannerUrl);
  }

  // ─── Compact mode (decor-style: bullet list with price pairs) ───
  if (displayMode === 'compact') {
    let desc = '';

    if (category.toLowerCase() === 'decor') {
      const header = resolveDecorEmoji(interaction.guildId, 'header');
      const bullet = resolveDecorEmoji(interaction.guildId, 'bullet');
      const arrow = resolveDecorEmoji(interaction.guildId, 'arrow');
      const check = resolveDecorEmoji(interaction.guildId, 'check');
      const husky = resolveDecorEmoji(interaction.guildId, 'husky');

      // Update the private embed title to have the custom emoji
      title = `${header} Đề Co - Trang Trí`;
      currentEmbed.setTitle(title);

      desc = `**Giá Đít Cọt Bán** ${arrow} **Giá Sỉ To Bán**\n\n`;

      desc += `${bullet} **Dành cho acc "CÓ" Nicho**\n`;
      desc += `> • 66.000đ ${arrow} \`23.000đ\`\n`;
      desc += `> • 72.000đ ${arrow} \`35.000đ\`\n`;
      desc += `> • 92.000đ ${arrow} \`50.000đ\`\n`;
      desc += `> • 105.000đ ${arrow} \`60.000đ\`\n`;
      desc += `> • 111.000đ ${arrow} \`70.000đ\`\n`;
      desc += `> • 131.000đ ${arrow} \`79.000đ\`\n`;
      desc += `> • 141.000đ ${arrow} \`88.000đ\`\n`;
      desc += `Vui lòng gửi tài khoản mật khẩu và 4-5 mã dự phòng khi mua\n\n`;

      desc += `${bullet} **Dành cho acc "KHÔNG" Nicho**\n`;
      desc += `> • 79.000đ ${arrow} \`35.000đ\`\n`;
      desc += `> • 105.000đ ${arrow} \`60.000đ\`\n`;
      desc += `> • 131.000đ ${arrow} \`80.000đ\`\n`;
      desc += `> • 141.000đ ${arrow} \`90.000đ\`\n`;
      desc += `> • 146.000đ ${arrow} \`95.000đ\`\n`;
      desc += `> • 189.000đ ${arrow} \`110.000đ\`\n`;
      desc += `Vui lòng gửi tài khoản mật khẩu và 4-5 mã dự phòng khi mua\n\n`;

      desc += `${bullet} **Dạng gip(bấm là nhận)**\n`;
      desc += `> • 66.000đ ${arrow} \`40.000đ\`\n`;
      desc += `> • 79.000đ ${arrow} \`45.000đ\`\n`;
      desc += `> • 92.000đ ${arrow} \`58.000đ\`\n`;
      desc += `> • 105.000đ ${arrow} \`65.000đ\`\n`;
      desc += `> • 131.000đ ${arrow} \`85.000đ\`\n`;
      desc += `> • 141.000đ ${arrow} \`95.000đ\`\n`;
      desc += `> • Combo 118.000đ ${arrow} \`80.000đ\`\n`;
      desc += `> • Combo 146.000đ ${arrow} \`105.000đ\`\n`;
      desc += `> • Combo 189.000đ ${arrow} \`130.000đ\`\n`;
      desc += `> • Combo 220.000đ ${arrow} \`150.000đ\`\n\n`;

      desc += `${check} Hoàn thành trong vòng 48h , nhanh nhất trong ngày\n`;
      desc += `${check} Riêng loại gip hoàn thành trong ngày\n`;
      desc += `${husky} Một số khung mới chưa có giá , bạn có thể chụp hình gửi Shop để được báo giá rẻ hơn nhiuuu\n\n`;

      desc += '```ansi\n\u001b[1;33mTạo Ticket\u001b[0m\u001b[1;37m để mua hàng ngay nhé!!!\u001b[0m\n```';
    } else {
      // Custom description or subtitle heading
      if (catConfig.description) {
        desc = catConfig.description + '\n\n';
      } else if (subtitle) {
        desc = `## ${subtitle}  ⭐\n\n`;
      }

      if (products.length === 0) {
        desc += '*Hiện tại danh mục này chưa có sản phẩm nào hoạt động.*';
      } else {
        for (const p of products) {
          const mainPrice = Number(p.price).toLocaleString('vi-VN') + ' VND';
          // Description can contain a secondary price (e.g., "22000", "22k", or "22.000")
          const secondaryPrice = parseCompactSecondaryPrice(p.description);

          if (secondaryPrice) {
            desc += `• **\`${mainPrice}\`** — **\`${secondaryPrice}\`**\n`;
          } else {
            const emoji = resolveProductEmoji(interaction.guildId, p.emoji);
            desc += emoji ? `• ${emoji} **\`${p.name}\`** — **\`${mainPrice}\`**\n` : `• **\`${p.name}\`** — **\`${mainPrice}\`**\n`;
          }
        }
      }
    }

    if (category.toLowerCase() === 'ai') {
      const ticketTag = guildConfig?.ticket_panel_channel_id ? `<#${guildConfig.ticket_panel_channel_id}>` : '**Ticket**';
      desc += `\n**Các Sản Phẩm AI Khác Vui Lòng Liên Hệ ${ticketTag} trong server á!**\n`;
    }

    currentEmbed.setDescription(desc);
    currentEmbed.setTimestamp();
    embeds.push(currentEmbed);

  // ─── Detailed mode (default: full product cards) ───
  } else {
    let desc = '';
    if (catConfig.description) {
      desc = catConfig.description + '\n\n';
    } else {
      desc = `### ${E('icon_star')} Danh sách gói dịch vụ [${categoryName}] đang mở bán:\n\n`.trimStart();
    }

    if (products.length === 0) {
      desc += '*Hiện tại danh mục này chưa có sản phẩm nào hoạt động.*';
      currentEmbed.setDescription(desc);
      embeds.push(currentEmbed);
    } else {
      for (const p of products) {
        const priceText = p.price > 0 ? Number(p.price).toLocaleString('vi-VN') + 'đ' : 'Thương lượng';
        let statusText = `${E('icon_sparkle')} **Sẵn hàng**`.trim();
        if (p.description && p.description.includes('Hot')) statusText = `${E('order_pending')} **Hot**`.trim();
        else if (p.description && p.description.includes('Bán chạy')) statusText = `${E('order_processing')} **Bán chạy**`.trim();
        else if (p.description && p.description.includes('Mới')) statusText = `${E('icon_star')} **Mới**`.trim();
        else if (p.description && p.description.includes('Ưu đãi')) statusText = `${E('status_check')} **Ưu đãi**`.trim();

        const emoji = resolveProductEmoji(interaction.guildId, p.emoji);
        let productDesc = emoji ? `### ${emoji} ${p.name}\n` : `### ${p.name}\n`;
        productDesc += `> ${E('payment_money')} **Giá:** \`${priceText}\` | ${E('icon_clock')} **Thời hạn:** \`${p.duration_months} tháng\`\n`.trimStart();
        if (p.description) {
          productDesc += `> **Chi tiết:** *${p.description}*\n`;
        } else {
          productDesc += `> **Chi tiết:** *Đang mở bán*\n`;
        }
        productDesc += `> **Trạng thái:** ${statusText}\n\n`;

        if (desc.length + productDesc.length > 2200) {
          currentEmbed.setDescription(desc);
          embeds.push(currentEmbed);
          currentEmbed = new EmbedBuilder().setColor(embedColor);
          desc = productDesc;
        } else {
          desc += productDesc;
        }
      }

      if (category.toLowerCase() === 'ai') {
        const ticketTag = guildConfig?.ticket_panel_channel_id ? `<#${guildConfig.ticket_panel_channel_id}>` : '**Ticket**';
        desc += `\n**Các Sản Phẩm AI Khác Vui Lòng Liên Hệ ${ticketTag} trong server á!**\n`;
      }

      currentEmbed.setDescription(desc);
      currentEmbed.setTimestamp();
      embeds.push(currentEmbed);
    }
  }

  const rows = [];

  // Dropdown mua hàng
  if (products.length > 0) {
    const selectOptions = products.slice(0, 25).map(p => {
      const opt = {
        label: `${p.name}`.slice(0, 100),
        description: `Giá: ${p.price > 0 ? Number(p.price).toLocaleString('vi-VN') + 'đ' : 'Thương lượng'} | Hạn: ${p.duration_months}T`.slice(0, 100),
        value: `${p.id}`,
      };
      const emoji = resolveSelectMenuEmoji(interaction.guildId, p.emoji, '🛒');
      if (emoji) {
        opt.emoji = emoji;
      }
      return opt;
    });

    const purchaseRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('product:select')
        .setPlaceholder('🛒 Chọn gói dịch vụ bạn muốn đặt mua')
        .addOptions(selectOptions)
    );
    rows.push(purchaseRow);
  }

  // Quản lý gói sản phẩm (luôn hiển thị cho mọi người dùng)
  const adminRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`price_list:admin:add_product:${category}`)
      .setLabel('Them Goi')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`price_list:admin:edit_product:${category}`)
      .setLabel('Sua Goi')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`price_list:admin:edit_category:${category}`)
      .setLabel('Sua Chi Tiet')
      .setStyle(ButtonStyle.Secondary)
  );
  rows.push(adminRow);

  try {
    await interaction.reply({
      embeds: embeds,
      components: rows,
      ephemeral: true
    });
  } catch (error) {
    if (error.code === 50035 || error.message?.includes('50035') || error.message?.includes('emoji') || error.message?.includes('Emoji')) {
      console.warn('[handlePriceListSelect] Reply failed with emoji-related/form error, retrying without option emojis:', error);
      if (products.length > 0) {
        const cleanSelectOptions = products.slice(0, 25).map(p => ({
          label: `${p.name}`.slice(0, 100),
          description: `Giá: ${p.price > 0 ? Number(p.price).toLocaleString('vi-VN') + 'đ' : 'Thương lượng'} | Hạn: ${p.duration_months}T`.slice(0, 100),
          value: `${p.id}`
        }));

        const cleanPurchaseRow = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('product:select')
            .setPlaceholder('🛒 Chọn gói dịch vụ bạn muốn đặt mua')
            .addOptions(cleanSelectOptions)
        );

        const cleanRows = [cleanPurchaseRow];
        if (rows.length > 1) {
          cleanRows.push(rows[1]);
        }

        await interaction.reply({
          embeds: embeds,
          components: cleanRows,
          ephemeral: true
        }).catch(err => console.error('[handlePriceListSelect] Retrying without emojis also failed:', err));
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }
}

/**
 * Parse secondary price from product description for compact mode.
 * Supports formats like: "22000", "22k", "22.000", "22,000", "22.000 VND"
 * Returns formatted price string or null if description isn't a price.
 */

export async function handlePriceListAdminEditPortalButton(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const isAdmin = member && (member.permissions.has(PermissionFlagsBits.ManageGuild) || isManager(member, guildConfig));

  if (!isAdmin) {
    await interaction.reply({
      content: `${E('status_cross')} Bạn không có quyền chỉnh sửa bảng giá này!`,
      ephemeral: true
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId('price_list:admin:edit_portal_modal')
    .setTitle('✏️ Chỉnh Sửa Bảng Giá Chính');

  const defaultTitle = guildConfig?.price_list_title || '📺  PREMIUM SERVICES CATALOG — CENAR STORE  📺';
  const defaultDesc = guildConfig?.price_list_description || [
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
  const defaultImage = guildConfig?.price_list_image_url || '';

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('title')
        .setLabel('Tiêu đề bảng giá')
        .setValue(defaultTitle.slice(0, 100))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Nội dung chi tiết')
        .setValue(defaultDesc.slice(0, 4000))
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(4000)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('image_url')
        .setLabel('URL ảnh / GIF banner (Không bắt buộc)')
        .setValue(defaultImage.slice(0, 500))
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(500)
    )
  );

  await interaction.showModal(modal);
}

export async function handlePriceListAdminEditPortalModal(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  // Defer NGAY để tránh vượt timeout 3 giây của Discord trước khi gọi members.fetch()
  await interaction.deferReply({ ephemeral: true });

  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const isAdmin = member && (member.permissions.has(PermissionFlagsBits.ManageGuild) || isManager(member, guildConfig));

  if (!isAdmin) {
    await interaction.editReply({
      content: `${E('status_cross')} Bạn không có quyền chỉnh sửa bảng giá này!`,
    });
    return;
  }

  const title = interaction.fields.getTextInputValue('title');
  const description = interaction.fields.getTextInputValue('description');
  const imageUrl = interaction.fields.getTextInputValue('image_url') || null;

  const updated = upsertGuildConfig({
    guild_id: interaction.guildId,
    price_list_title: title,
    price_list_description: description,
    price_list_image_url: imageUrl
  });

  const channelId = updated.price_list_channel_id;
  const messageId = updated.price_list_message_id;

  if (channelId && messageId) {
    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (channel) {
      const msg = await channel.messages.fetch(messageId).catch(() => null);
      if (msg) {
        const embed = new EmbedBuilder()
          .setColor(0xF3A6D7)
          .setTitle(title)
          .setDescription(description)
          .setFooter({ text: 'Cenar Store • An toàn - Uy tín - Chất lượng 💙' })
          .setTimestamp();

        if (imageUrl && imageUrl.startsWith('http')) {
          embed.setImage(imageUrl);
        }

        await msg.edit({
          embeds: [embed],
          components: msg.components
        }).catch(e => console.error('Failed to update price list message:', e));
      }
    }
  }

  await interaction.editReply({
    content: `${E('status_check')} Đã chỉnh sửa bảng giá chính thành công! Tin nhắn bảng giá đã được cập nhật ngay lập tức.`
  });
}

export async function handlePriceListAdminAddButton(interaction, category) {
  const E = createEmojiResolver(interaction.guildId);
  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const isAdmin = member && (member.permissions.has(PermissionFlagsBits.ManageGuild) || isManager(member, guildConfig));

  if (!isAdmin) {
    await interaction.reply({
      content: `${E('status_cross')} Bạn không có quyền quản lý bảng giá này!`,
      ephemeral: true
    }).catch(() => null);
    return;
  }

  // Check if this category is in compact mode
  const defaults = getDefaultCategoryDetails(category);
  let customConfigs = {};
  if (guildConfig?.price_list_category_configs) {
    try {
      customConfigs = JSON.parse(guildConfig.price_list_category_configs);
    } catch (e) {}
  }
  const catConfig = customConfigs[category.toLowerCase()] || {};
  const isCompact = (catConfig.display_mode || defaults.display_mode) === 'compact';

  const modal = new ModalBuilder()
    .setCustomId(`price_list:admin:add_modal:${category}`)
    .setTitle(`➕ Thêm Gói [${category.toUpperCase()}]`);

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('name')
        .setLabel('Tên gói sản phẩm')
        .setPlaceholder(isCompact ? 'VD: Decor Effect 1' : 'VD: YouTube Premium 3 Tháng')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('price')
        .setLabel(isCompact ? 'Giá NPL (VNĐ)' : 'Giá tiền (VNĐ)')
        .setPlaceholder('VD: 66000 hoặc 66k')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('duration')
        .setLabel('Thời hạn (Tháng)')
        .setPlaceholder('VD: 3')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue('1')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('emoji')
        .setLabel('Icon / Emoji')
        .setPlaceholder('VD: 📺')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('description')
        .setLabel(isCompact ? 'Giá LOG ACC (VNĐ) — Cột giá thứ 2' : 'Mô tả ngắn / Status (VD: Sẵn hàng, Hot...)')
        .setPlaceholder(isCompact ? 'VD: 22000 hoặc 22k (hiển thị cạnh giá chính)' : 'VD: Xem không quảng cáo, tặng kèm YouTube Music VIP')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(200)
    )
  );

  await interaction.showModal(modal).catch(console.error);
}

export async function handlePriceListAdminAddModal(interaction, category) {
  const E = createEmojiResolver(interaction.guildId);
  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const isAdmin = member && (member.permissions.has(PermissionFlagsBits.ManageGuild) || isManager(member, guildConfig));

  if (!isAdmin) {
    await interaction.reply({
      content: `${E('status_cross')} Bạn không có quyền quản lý bảng giá này!`,
      ephemeral: true
    }).catch(() => null);
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const name = interaction.fields.getTextInputValue('name')?.trim();
  const rawPrice = interaction.fields.getTextInputValue('price')?.trim();
  const rawDuration = interaction.fields.getTextInputValue('duration')?.trim();
  const emoji = interaction.fields.getTextInputValue('emoji')?.trim() || '📦';
  const description = interaction.fields.getTextInputValue('description')?.trim() || '';

  const price = parsePrice(rawPrice);
  if (price === null) {
    await interaction.editReply(`${E('status_cross')} Giá tiền không hợp lệ. Vui lòng nhập số (VD: 180000 hoặc 180k).`);
    return;
  }

  const duration = Number.parseInt(rawDuration, 10);
  if (Number.isNaN(duration) || duration <= 0) {
    await interaction.editReply(`${E('status_cross')} Thời hạn không hợp lệ. Vui lòng nhập số tháng lớn hơn 0.`);
    return;
  }

  try {
    addProduct({
      guildId: 'WEB',
      name,
      description,
      price,
      durationMonths: duration,
      serviceType: category,
      emoji
    });

    await interaction.editReply(`${E('status_check')} Đã thêm thành công sản phẩm **${name}** vào danh mục \`${category}\`!\nHãy chọn lại danh mục để tải lại bảng giá mới.`);
  } catch (error) {
    console.error('[PRICE LIST ADD PRODUCT]', error);
    await interaction.editReply(`${E('status_cross')} Lỗi thêm sản phẩm: ${error.message}`);
  }
}


export async function handlePriceListAdminEditCategoryButton(interaction, category) {
  const E = createEmojiResolver(interaction.guildId);
  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const isAdmin = member && (member.permissions.has(PermissionFlagsBits.ManageGuild) || isManager(member, guildConfig));

  if (!isAdmin) {
    await interaction.reply({
      content: `${E('status_cross')} Bạn không có quyền chỉnh sửa bảng giá này!`,
      ephemeral: true
    }).catch(() => null);
    return;
  }

  let customConfigs = {};
  if (guildConfig?.price_list_category_configs) {
    try {
      customConfigs = JSON.parse(guildConfig.price_list_category_configs);
    } catch (e) {}
  }
  const catConfig = customConfigs[category.toLowerCase()] || {};
  const defaults = getDefaultCategoryDetails(category);

  const defaultTitle = catConfig.title || defaults.title;
  const defaultColor = catConfig.color || defaults.color;
  const defaultImage = catConfig.image_url || '';
  const defaultDesc = catConfig.description || `### 🌟 Danh sách gói dịch vụ [${defaults.name}] đang mở bán:`;
  const currentMode = catConfig.display_mode || defaults.display_mode || 'detailed';
  const currentSubtitle = catConfig.subtitle || defaults.subtitle || '';
  // Combine display_mode and subtitle into one field for the modal
  const displayModeValue = currentMode === 'compact'
    ? (currentSubtitle ? `compact | ${currentSubtitle}` : 'compact')
    : 'detailed';

  const modal = new ModalBuilder()
    .setCustomId(`price_list:admin:edit_category_modal:${category}`)
    .setTitle(`✏️ Sửa Chi Tiết [${category.toUpperCase()}]`);

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('title')
        .setLabel('Tiêu đề bảng giá')
        .setValue(defaultTitle.slice(0, 100))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Nội dung giới thiệu (Markdown)')
        .setValue(defaultDesc.slice(0, 1000))
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(1000)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('color')
        .setLabel('Màu viền Embed (Mã Hex)')
        .setValue(defaultColor.slice(0, 10))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(10)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('image_url')
        .setLabel('URL ảnh / GIF banner (Không bắt buộc)')
        .setValue(defaultImage.slice(0, 500))
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(500)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('display_mode')
        .setLabel('Kiểu hiển thị: detailed / compact | Phụ đề')
        .setValue(displayModeValue.slice(0, 100))
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setPlaceholder('VD: compact | DEC/NPL (LOG ACC)')
        .setMaxLength(100)
    )
  );

  await interaction.showModal(modal).catch(console.error);
}

export async function handlePriceListAdminEditCategoryModal(interaction, category) {
  const E = createEmojiResolver(interaction.guildId);
  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const isAdmin = member && (member.permissions.has(PermissionFlagsBits.ManageGuild) || isManager(member, guildConfig));

  if (!isAdmin) {
    await interaction.reply({
      content: `${E('status_cross')} Bạn không có quyền chỉnh sửa bảng giá này!`,
      ephemeral: true
    }).catch(() => null);
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const title = interaction.fields.getTextInputValue('title')?.trim();
  const description = interaction.fields.getTextInputValue('description')?.trim() || '';
  const color = interaction.fields.getTextInputValue('color')?.trim().replace('#', '');
  const imageUrl = interaction.fields.getTextInputValue('image_url')?.trim() || '';
  const displayModeRaw = interaction.fields.getTextInputValue('display_mode')?.trim() || '';

  const parsedColor = Number.parseInt(color, 16);
  if (color && (Number.isNaN(parsedColor) || color.length < 3 || color.length > 6)) {
    await interaction.editReply(`${E('status_cross')} Mã màu Hex không hợp lệ. Vui lòng nhập mã Hex hợp lệ (VD: ED4245).`);
    return;
  }

  // Parse display_mode field: "compact | subtitle" or "detailed"
  let displayMode = 'detailed';
  let subtitleValue = '';
  if (displayModeRaw) {
    const parts = displayModeRaw.split('|').map(s => s.trim());
    const mode = parts[0].toLowerCase();
    if (mode === 'compact') {
      displayMode = 'compact';
      subtitleValue = parts[1] || '';
    } else {
      displayMode = 'detailed';
    }
  }

  let customConfigs = {};
  if (guildConfig?.price_list_category_configs) {
    try {
      customConfigs = JSON.parse(guildConfig.price_list_category_configs);
    } catch (e) {}
  }

  customConfigs[category.toLowerCase()] = {
    title,
    description,
    color,
    image_url: imageUrl,
    display_mode: displayMode,
    subtitle: subtitleValue
  };

  try {
    const { db } = await import('../database/db.js');
    const ts = new Date().toISOString();
    const result = db.prepare(`
      UPDATE guild_settings
      SET price_list_category_configs = @configs, updated_at = @now
      WHERE guild_id = @guild_id
    `).run({
      configs: JSON.stringify(customConfigs),
      now: ts,
      guild_id: interaction.guildId
    });

    if (result.changes === 0) {
      db.prepare(`
        INSERT INTO guild_settings (guild_id, ticket_category_id, price_list_category_configs, updated_at)
        VALUES (@guild_id, '', @configs, @now)
      `).run({
        guild_id: interaction.guildId,
        configs: JSON.stringify(customConfigs),
        now: ts
      });
    }

    await interaction.editReply(`${E('status_check')} Đã cập nhật chi tiết danh mục **${category.toUpperCase()}** thành công!\nHãy chọn lại danh mục để xem thay đổi.`);
  } catch (error) {
    console.error('[PRICE LIST EDIT CATEGORY]', error);
    await interaction.editReply(`${E('status_cross')} Lỗi cập nhật chi tiết danh mục: ${error.message}`);
  }
}

export async function handlePriceListAdminEditButton(interaction, category) {
  const E = createEmojiResolver(interaction.guildId);
  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const isAdmin = member && (member.permissions.has(PermissionFlagsBits.ManageGuild) || isManager(member, guildConfig));

  if (!isAdmin) {
    await interaction.reply({
      content: `${E('status_cross')} Bạn không có quyền quản lý bảng giá này!`,
      ephemeral: true
    }).catch(() => null);
    return;
  }

  const products = getAllProducts(interaction.guildId).filter(
    p => p.service_type && p.service_type.toLowerCase() === category.toLowerCase()
  );

  if (products.length === 0) {
    await safeReply(interaction, {
      content: `${E('status_cross')} Không tìm thấy sản phẩm nào trong danh mục \`${category}\` để chỉnh sửa.`,
      ephemeral: true
    });
    return;
  }

  const selectOptions = products.slice(0, 25).map(p => {
    const statusText = p.is_active ? '🟢' : '🔴';
    return {
      label: `${p.name}`.slice(0, 100),
      description: `Giá: ${Number(p.price).toLocaleString('vi-VN')}đ | Hạn: ${p.duration_months}T | Trạng thái: ${statusText}`.slice(0, 100),
      value: `${p.id}`,
      emoji: resolveSelectMenuEmoji(interaction.guildId, p.emoji, '📦') || undefined
    };
  });

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`price_list:admin:select_product_to_edit:${category}`)
      .setPlaceholder('✏️ Chọn sản phẩm bạn muốn sửa thông tin')
      .addOptions(selectOptions)
  );

  await safeReply(interaction, {
    content: `${E('icon_settings')} Vui lòng chọn sản phẩm trong danh mục \`${category}\` để bắt đầu chỉnh sửa:`,
    components: [row],
    ephemeral: true
  });
}

export async function handlePriceListAdminSelectProductToEdit(interaction, category) {
  const E = createEmojiResolver(interaction.guildId);
  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const isAdmin = member && (member.permissions.has(PermissionFlagsBits.ManageGuild) || isManager(member, guildConfig));

  if (!isAdmin) {
    await interaction.reply({
      content: `${E('status_cross')} Bạn không có quyền quản lý bảng giá này!`,
      ephemeral: true
    }).catch(() => null);
    return;
  }

  const productId = interaction.values[0];
  const product = getProductById(Number(productId));
  if (!product) {
    await safeReply(interaction, { content: `${E('status_cross')} Sản phẩm không còn tồn tại.`, ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`price_list:admin:edit_modal:${product.id}`)
    .setTitle(`✏️ Sửa: ${product.name}`.slice(0, 45));

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('name')
        .setLabel('Tên gói sản phẩm')
        .setValue(product.name)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('price')
        .setLabel('Giá tiền (VNĐ)')
        .setValue(String(product.price))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('duration')
        .setLabel('Thời hạn (Tháng)')
        .setValue(String(product.duration_months))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('emoji')
        .setLabel('Icon / Emoji')
        .setValue(product.emoji || '📦')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('is_active')
        .setLabel('Kích hoạt hiển thị (1 = Có, 0 = Không)')
        .setValue(String(product.is_active))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(1)
    )
  );

  await interaction.showModal(modal).catch(console.error);
}

export async function handlePriceListAdminEditModal(interaction, productId) {
  const E = createEmojiResolver(interaction.guildId);
  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const isAdmin = member && (member.permissions.has(PermissionFlagsBits.ManageGuild) || isManager(member, guildConfig));

  if (!isAdmin) {
    await interaction.reply({
      content: `${E('status_cross')} Bạn không có quyền quản lý bảng giá này!`,
      ephemeral: true
    }).catch(() => null);
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const name = interaction.fields.getTextInputValue('name')?.trim();
  const rawPrice = interaction.fields.getTextInputValue('price')?.trim();
  const rawDuration = interaction.fields.getTextInputValue('duration')?.trim();
  const emoji = interaction.fields.getTextInputValue('emoji')?.trim() || '📦';
  const rawActive = interaction.fields.getTextInputValue('is_active')?.trim();

  const price = parsePrice(rawPrice);
  if (price === null) {
    await interaction.editReply(`${E('status_cross')} Giá tiền không hợp lệ. Vui lòng nhập số (VD: 180000 hoặc 180k).`);
    return;
  }

  const duration = Number.parseInt(rawDuration, 10);
  if (Number.isNaN(duration) || duration <= 0) {
    await interaction.editReply(`${E('status_cross')} Thời hạn không hợp lệ. Vui lòng nhập số tháng lớn hơn 0.`);
    return;
  }

  const isActive = rawActive === '1' ? 1 : 0;

  try {
    updateProduct(Number(productId), {
      name,
      price,
      durationMonths: duration,
      emoji,
      isActive: isActive === 1
    });

    await interaction.editReply(`${E('status_check')} Đã cập nhật thành công sản phẩm **${name}**!\nHãy chọn lại danh mục để xem bảng giá mới.`);
  } catch (error) {
    console.error('[PRICE LIST EDIT PRODUCT]', error);
    await interaction.editReply(`${E('status_cross')} Lỗi cập nhật sản phẩm: ${error.message}`);
  }
}

