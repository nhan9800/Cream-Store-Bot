// ═══════════════════════════════════════════════════════════════════
// productHandlers.js — Nhóm xử lý Sản phẩm: chọn/mua/sửa/thêm/sale (tách từ interactionCreate.js).
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
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';
import { config } from '../config.js';
import { db } from '../database/db.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { getCustomerFlag, getTicketMuteStatus } from '../services/blacklistService.js';
import { isStaffMember } from '../utils/permissions.js';
import { TICKET_MEMBER_PERMISSIONS } from '../utils/permissions.js';
import { getProductById, updateProduct, addProduct, getProductByName } from '../services/productCatalogService.js';
import { refreshAllShopPanels } from '../services/shopPanelService.js';
import { getCenarHub } from '../services/cenarHub.js';
import { createTicket, getOpenTicketByCustomer, closeTicket } from '../services/ticketService.js';
import { createOrder, saveOrderLogMessage } from '../services/orderService.js';
import { buildTicketWelcomeV2, buildTicketControlComponents } from '../utils/embeds.js';
import { buildTicketChannelName, parseMoneyInput, buildOrderLogContent } from '../utils/formatters.js';
import { ensureRateLimit } from '../services/abuseService.js';
import { isCustomerCtv } from '../services/ctvService.js';
import { getWalletBalance, addWalletBalance } from '../services/walletService.js';
import {
  safeReply,
  getTicketCategoryId,
  activeTicketCreations,
} from './shared.js';

export async function handleProductSelect(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  const productId = interaction.values[0];
  let product = getProductById(Number(productId));

  // Fallback: nếu không tìm được theo ID (bảng-giá cũ, DB đã cập nhật)
  // thử tìm theo tên sản phẩm từ label của option đã chọn
  if (!product) {
    console.log('[DEBUG SELECT] Product not found by ID:', productId);
    const selectedLabel = interaction.component?.options?.find(
      o => o.value === productId
    )?.label;
    console.log('[DEBUG SELECT] Selected label from component options:', selectedLabel);

    if (selectedLabel) {
      product = getProductByName(interaction.guildId, selectedLabel);
      
      if (!product) {
        // Fuzzy matching fallback: match up to the first parenthesis (e.g., "YouTube Premium 3 Tháng")
        const labelPrefix = selectedLabel.split('(')[0].trim().toLowerCase();
        const allProducts = db.prepare('SELECT * FROM product_catalog WHERE is_active = 1').all();
        
        product = allProducts.find(p => {
          const dbPrefix = p.name.split('(')[0].trim().toLowerCase();
          return dbPrefix === labelPrefix;
        }) ?? null;
      }
      
      console.log('[DEBUG SELECT] Found product by name fallback:', product ? product.name : 'null');
    }

    if (!product) {
      // Auto-refresh panels in the background so next interaction will work with fresh IDs
      refreshAllShopPanels(interaction.client, interaction.guildId).catch(console.error);

      await safeReply(interaction, {
        content: `${E('status_warn')} Danh sách sản phẩm đã được cập nhật. Vui lòng chọn lại sản phẩm từ menu bên dưới.`,
        flags: 64 // Use flags instead of ephemeral: true to fix the deprecation warning
      });
      return;
    }
  }

  const flag = getCustomerFlag(interaction.guildId, interaction.user.id);
  if (Number(flag.is_blacklisted) === 1) {
    await safeReply(interaction, { content: `${E('status_cross')} Bạn đang bị chặn.`, ephemeral: true });
    return;
  }
  const muteStatus = getTicketMuteStatus(interaction.guildId, interaction.user.id);
  if (muteStatus.is_ticket_muted) {
    await safeReply(interaction, { content: `${E('status_cross')} Bạn đã bị admin ngăn tạo ticket.`, ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`product:purchase:modal:${product.id}`)
    .setTitle(`Mua: ${product.name}`.slice(0, 45));

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('quantity')
        .setLabel('Số lượng')
        .setValue('1')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('discount_code')
        .setLabel('Mã giảm giá (nếu có)')
        .setPlaceholder('VD: SALE10')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
    )
  );

  await interaction.showModal(modal).catch(console.error);
}

// Helper to parse price input (e.g. 180k -> 180000, 180000 -> 180000)

export async function handleProductPurchaseFlow(interaction, productId) {
  const E = createEmojiResolver(interaction.guildId);
  const product = getProductById(Number(productId));
  if (!product) {
    await safeReply(interaction, { content: `${E('status_cross')} Sản phẩm không còn tồn tại.`, ephemeral: true });
    return;
  }

  const rawQty = interaction.fields.getTextInputValue('quantity');
  // const discountCode = interaction.fields.getTextInputValue('discount_code'); // For future

  const quantity = Number.parseInt(rawQty, 10);
  if (Number.isNaN(quantity) || quantity <= 0) {
    await safeReply(interaction, { content: `${E('status_cross')} Số lượng không hợp lệ.`, ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const guildConfig = getGuildConfig(interaction.guildId);
  if (!guildConfig) {
    await interaction.editReply(`${E('status_warn')} Server chưa setup ticket.`);
    return;
  }

  const isCtv = isCustomerCtv(interaction.guildId, interaction.user.id);
  const unitPrice = (isCtv && product.ctv_price !== null) ? product.ctv_price : product.price;
  const totalPrice = unitPrice * quantity;

  const currentBalance = getWalletBalance(interaction.guildId, interaction.user.id);
  if (currentBalance < totalPrice) {
    const missing = totalPrice - currentBalance;
    await interaction.editReply(`${E('status_cross')} Số dư trong ví không đủ!\nSản phẩm: **${product.name}**\nĐơn giá: **${unitPrice.toLocaleString('vi-VN')}đ** x ${quantity}\nTổng tiền: **${totalPrice.toLocaleString('vi-VN')}đ**\n\nSố dư hiện tại: **${currentBalance.toLocaleString('vi-VN')}đ**\nBạn cần nạp thêm: **${missing.toLocaleString('vi-VN')}đ**.\n> Vui lòng nạp tiền vào ví bằng lệnh \`/wallet\` hoặc bảng Nạp Tiền để có thể mua sản phẩm.`);
    return;
  }

  // Khóa chống click đúp tạo 2 ticket
  const normalizedType = 'ORDER';
  const lockKey = `${interaction.guildId}:${interaction.user.id}:${normalizedType}`;
  if (activeTicketCreations.has(lockKey)) {
    await interaction.editReply(`${E('status_warn')} Yêu cầu tạo ticket của bạn đang được xử lý, vui lòng không bấm liên tục.`);
    return;
  }
  activeTicketCreations.add(lockKey);

  try {
    ensureRateLimit({ guildId: interaction.guildId, userId: interaction.user.id, action: `OPEN_TICKET_ORDER`, limit: 1, windowSeconds: config.ticketOpenCooldownSeconds, message: `Bạn vừa mở ticket rồi. Vui lòng chờ.` });
    
    const existingTicket = getOpenTicketByCustomer(interaction.guildId, interaction.user.id, normalizedType);
    if (existingTicket) {
      // Kiểm tra channel còn tồn tại không
      const existingChannel = await interaction.guild.channels.fetch(existingTicket.channel_id).catch(() => null);
      if (existingChannel) {
        await interaction.editReply(`${E('status_warn')} Bạn đã có đơn hàng đang xử lý tại <#${existingTicket.channel_id}>.`);
        activeTicketCreations.delete(lockKey);
        return;
      }
      // Channel bị xóa thủ công → tự đóng ticket trong DB
      closeTicket(existingTicket.id, interaction.client.user.id);
    }

    import('discord.js').then(async ({ PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle }) => {
      try {
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
        const prefix = (product.service_type || 'ticket').toLowerCase();
        
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
          productName: product.name,
          quantity,
          totalAmount: totalPrice,
          durationMonths: product.duration_months,
          orderLogChannelId: guildConfig.order_log_channel_id ?? null,
          createdById: interaction.client.user.id,
        });

        // Trừ tiền ngay sau khi order được tạo (cộng số âm)
        addWalletBalance(
          interaction.guildId, 
          interaction.user.id, 
          -totalPrice, 
          'PAY_ORDER', 
          `Thanh toán đơn ${order.order_code}: x${quantity} ${product.name}`, 
          order.order_code
        );

        // Đánh dấu PAID trong DB
        db.prepare("UPDATE store_orders SET status = 'PAID' WHERE order_code = ?").run(order.order_code);
        order.status = 'PAID';

        // Gửi log đơn hàng vào kênh order log
        try {
          const orderLogChannel = guildConfig.order_log_channel_id
            ? await interaction.guild.channels.fetch(guildConfig.order_log_channel_id).catch(() => null)
            : null;
          if (orderLogChannel?.isTextBased()) {
            const logMessage = await orderLogChannel.send({ content: buildOrderLogContent(order, interaction.guildId) });
            saveOrderLogMessage(order.order_code, logMessage.id);
          }
        } catch (logErr) {
          console.error('[PANEL ORDER] Lỗi gửi log đơn:', logErr.message);
        }

        // Gửi welcome ticket V2 (không dùng content với IsComponentsV2)
        const { container: welcomeContainer, flags: welcomeFlags } = buildTicketWelcomeV2(
          ticket.ticket_code,
          interaction.user.id,
          normalizedType,
          order.order_code,
          product.name,
          interaction.guildId
        );
        await channel.send({
          components: [welcomeContainer, ...buildTicketControlComponents(ticket.id, interaction.user.id)],
          flags: welcomeFlags,
        });
        // Ping riêng (content không được dùng với V2 flag)
        await channel.send({ content: `<@${interaction.user.id}> — Đơn hàng **${order.order_code}** đã được tạo!` }).catch(() => null);

        if (isCtv) {
          const supportPing = [guildConfig.support_role_id && `<@&${guildConfig.support_role_id}>`, guildConfig.shipper_role_id && `<@&${guildConfig.shipper_role_id}>`].filter(Boolean).join(' ');
          await channel.send({ content: `${supportPing} ⚡ **ĐƠN HÀNG CTV ƯU TIÊN CAO:** CTV <@${interaction.user.id}> vừa lên đơn hàng \`${order.order_code}\` (Sản phẩm: **${product.name}**). Vui lòng ưu tiên xử lý và bàn giao nhanh nhất!` }).catch(() => null);
        }

        // Nếu có tiền và chưa thanh toán -> tạo QR PayOS
        if (totalPrice > 0 && order.status !== 'PAID') {
          import('../services/paymentService.js').then(async ({ sendOrRefreshPaymentQr }) => {
            await sendOrRefreshPaymentQr({ guild: interaction.guild, orderCode: order.order_code }).catch(err => {
              console.error('[ORDER] Lỗi tạo QR PayOS:', err);
              channel.send(`${E('status_warn')} Lỗi tạo mã QR thanh toán: ${err.message}`);
            });
          });
        } else if (order.status === 'PAID') {
          await channel.send({ content: `${E('tickgreen') || '✅'} **THANH TOÁN THÀNH CÔNG:** Đơn hàng này đã được thanh toán 100% qua Ví Store. Nhân viên sẽ tiến hành xử lý và giao hàng cho bạn.` }).catch(() => null);
        }

        await interaction.editReply(`${E('status_check')} Đã tạo đơn hàng tại <#${channel.id}>`);
      } catch (err) {
        console.error('[ORDER_TICKET_CREATE_ASYNC] Lỗi:', err);
        await interaction.editReply(`${E('status_cross')} Đã có lỗi xảy ra khi tạo ticket đơn hàng.`);
      } finally {
        activeTicketCreations.delete(lockKey);
      }
    }).catch(err => {
      console.error('[IMPORT_ERROR] Lỗi import discord.js:', err);
      activeTicketCreations.delete(lockKey);
    });

  } catch (error) {
    activeTicketCreations.delete(lockKey);
    if (error.code === 'RATE_LIMITED') {
      await interaction.editReply(`${E('status_warn')} ${error.message}`);
    } else {
      console.error('[ORDER_TICKET_FLOW] Lỗi:', error);
      await interaction.editReply(`${E('status_cross')} Đã có lỗi xảy ra khi xử lý yêu cầu.`);
    }
  }
}

// Bước 1: Hiện confirmation embed (chỉ admin/manager)

export async function handleProductEditButton(interaction, productId) {
  const E = createEmojiResolver(interaction.guildId);
  const product = getProductById(Number(productId));
  if (!product) {
    await safeReply(interaction, { content: `${E('status_warn')} Sản phẩm không tồn tại.`, ephemeral: true });
    return;
  }

  // Chỉ staff/admin mới được edit
  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!isStaffMember(member, guildConfig)) {
    await safeReply(interaction, { content: `${E('status_cross')} Chỉ staff mới có thể chỉnh sửa sản phẩm.`, ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`product:edit:modal:${product.id}:${interaction.message?.id || ''}`)
    .setTitle(`✏️ Sửa: ${product.name}`.slice(0, 45));

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('name')
        .setLabel('Tên sản phẩm')
        .setValue(product.name)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('price')
        .setLabel('Giá tiền')
        .setValue(String(product.price))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('duration')
        .setLabel('Thời hạn (tháng)')
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
        .setCustomId('description')
        .setLabel('Mô tả')
        .setValue(product.description || '')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
    )
  );

  await interaction.showModal(modal);
}

export async function handleProductEditModal(interaction, productId) {
  const E = createEmojiResolver(interaction.guildId);
  const product = getProductById(Number(productId));
  if (!product) {
    await safeReply(interaction, { content: `${E('status_warn')} Sản phẩm không tồn tại.`, ephemeral: true });
    return;
  }

  const name = interaction.fields.getTextInputValue('name');
  const rawPrice = interaction.fields.getTextInputValue('price');
  const rawDuration = interaction.fields.getTextInputValue('duration');
  const emoji = interaction.fields.getTextInputValue('emoji');
  const category = interaction.fields.getTextInputValue('category')?.trim() || null;

  const price = parseMoneyInput(rawPrice);
  if (price === null) {
    await safeReply(interaction, { content: `${E('status_cross')} Giá tiền không hợp lệ.`, ephemeral: true });
    return;
  }

  const durationMonths = Number.parseInt(rawDuration, 10);
  if (Number.isNaN(durationMonths) || durationMonths <= 0) {
    await safeReply(interaction, { content: `${E('status_cross')} Thời hạn không hợp lệ.`, ephemeral: true });
    return;
  }

  const updated = updateProduct(Number(productId), {
    name,
    price,
    durationMonths,
    emoji: emoji || '📦',
    description: null,
    serviceType: category || undefined,
  });

  import('../commands/stock.js').then(({ refreshStockPanel }) => {
    refreshStockPanel(interaction.client, interaction.guildId).catch(() => null);
  });
  import('../services/shopPanelService.js').then(({ refreshAllShopPanels }) => {
    refreshAllShopPanels(interaction.client, interaction.guildId).catch(() => null);
  });

  await safeReply(interaction, {
    content: `${E('status_check')} Đã cập nhật **${updated.emoji} ${updated.name}** — Giá: **${Number(updated.price).toLocaleString('vi-VN')} VND** / ${updated.duration_months}T`,
    ephemeral: true,
  });
}

// Duplicate import removed

export async function handleProductAddModal(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  const name = interaction.fields.getTextInputValue('name');
  const rawPrice = interaction.fields.getTextInputValue('price');
  const rawDuration = interaction.fields.getTextInputValue('duration');
  const emoji = interaction.fields.getTextInputValue('emoji');
  const category = interaction.fields.getTextInputValue('category')?.trim() || 'other';

  const price = parseMoneyInput(rawPrice);
  if (price === null || price <= 0) {
    await safeReply(interaction, { content: `${E('status_cross')} Giá tiền không hợp lệ.`, ephemeral: true });
    return;
  }

  const durationMonths = Number.parseInt(rawDuration, 10);
  if (Number.isNaN(durationMonths) || durationMonths <= 0) {
    await safeReply(interaction, { content: `${E('status_cross')} Thời hạn không hợp lệ.`, ephemeral: true });
    return;
  }

  const existing = getProductByName(interaction.guildId, name);
  if (existing) {
    await safeReply(interaction, { content: `${E('status_warn')} Sản phẩm **${name}** đã tồn tại (ID: ${existing.id}).`, ephemeral: true });
    return;
  }

  const product = addProduct({
    guildId: interaction.guildId,
    name,
    description: null,
    price,
    durationMonths,
    serviceType: category,
    emoji: emoji || '📦',
  });

  import('../commands/stock.js').then(({ refreshStockPanel }) => {
    refreshStockPanel(interaction.client, interaction.guildId).catch(() => null);
  });
  import('../services/shopPanelService.js').then(({ refreshAllShopPanels }) => {
    refreshAllShopPanels(interaction.client, interaction.guildId).catch(() => null);
  });

  await safeReply(interaction, {
    content: `${E('status_check')} Đã thêm sản phẩm **${product.emoji} ${product.name}** (ID: ${product.id}) thành công!`,
    ephemeral: true,
  });
}

export async function handleProductSaleModal(interaction) {
  const bulkData = interaction.fields.getTextInputValue('bulk_data');
  const lines = bulkData.split('\n').map(l => l.trim()).filter(l => l);

  let successCount = 0;
  const errors = [];

  for (const line of lines) {
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 2) {
      errors.push(`- Thiếu giá: \`${line}\``);
      continue;
    }

    const firstPart = parts[0];
    let icon = '📦';
    let name = firstPart;

    // Phân tích emoji (Custom Emoji hoặc Unicode Emoji)
    const customEmojiMatch = firstPart.match(/^(<a?:\w+:\d+>)\s*(.*)$/);
    if (customEmojiMatch) {
      icon = customEmojiMatch[1];
      name = customEmojiMatch[2] || 'Sản phẩm';
    } else {
      const words = firstPart.split(' ');
      if (words.length > 1 && !/[a-zA-Z0-9\u00C0-\u1EF9]/.test(words[0])) {
        icon = words[0];
        name = words.slice(1).join(' ');
      }
    }

    const rawPrice = parts[1];
    const rawDuration = parts[2] || '1';
    const desc = parts[3] || null;

    const price = parseMoneyInput(rawPrice);
    if (price === null || price <= 0) {
      errors.push(`- Lỗi giá: \`${line}\``);
      continue;
    }

    const durationMonths = Number.parseInt(rawDuration, 10);
    if (Number.isNaN(durationMonths) || durationMonths <= 0) {
      errors.push(`- Lỗi thời hạn: \`${line}\``);
      continue;
    }

    const existing = getProductByName(interaction.guildId, name);
    if (existing) {
      errors.push(`- Đã tồn tại: \`${name}\``);
      continue;
    }

    addProduct({
      guildId: interaction.guildId,
      name,
      description: desc,
      price,
      durationMonths,
      serviceType: 'other',
      emoji: icon,
    });
    successCount++;
  }

  const E_sale = createEmojiResolver(interaction.guildId);
  let replyText = `${E_sale('status_check')} Đã thêm **${successCount}** sản phẩm thành công!`;
  if (errors.length) {
    replyText += `\n\n${E_sale('status_warn')} **Có ${errors.length} lỗi:**\n${errors.slice(0, 10).join('\n')}${errors.length > 10 ? '\n...với nhiều lỗi khác' : ''}`;
  }

  if (successCount > 0) {
    import('../commands/stock.js').then(({ refreshStockPanel }) => {
      refreshStockPanel(interaction.client, interaction.guildId).catch(() => null);
    });
    import('../services/shopPanelService.js').then(({ refreshAllShopPanels }) => {
      refreshAllShopPanels(interaction.client, interaction.guildId).catch(() => null);
    });
  }

  await safeReply(interaction, { content: replyText, ephemeral: true });
}

// ═══════════════════════════════════════════════
// ═════════ BOOST SERVER HANDLERS ═══════════════
// ═══════════════════════════════════════════════

export async function handleSaleRunModal(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  const parts = interaction.customId.split(':');
  const percent = Number.parseInt(parts[3], 10) || 0;
  const bulkData = interaction.fields.getTextInputValue('bulk_data');

  await interaction.deferReply({ ephemeral: true });

  try {
    const { runSale } = await import('../services/saleService.js');
    await runSale(interaction.client, interaction.guildId, percent, bulkData);

    await safeReply(interaction, {
      content: `${E('status_check')} Khởi chạy chương trình Sale **${percent}%** thành công! Bảng giá sale đã được ghim/cập nhật.`,
      ephemeral: true
    });
  } catch (error) {
    console.error('[SALE RUN MODAL] Error:', error);
    await safeReply(interaction, {
      content: `${E('status_cross')} Lỗi khi khởi chạy Sale: ${error.message}`,
      ephemeral: true
    });
  }
}

// ═══════════════ Subscription Handlers ═══════════════
