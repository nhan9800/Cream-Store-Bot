// ═══════════════════════════════════════════════════════════════════
// ticketHandlers.js — Nhóm xử lý Ticket + Đơn hàng: tạo/đóng/giao/hàng đợi/huỷ/nhận (tách từ interactionCreate.js).
// Nằm CÙNG thư mục src/events/ để mọi đường dẫn '../services', '../utils', '../database' giữ nguyên.
// State/helper dùng chung import từ ./shared.js — KHÔNG khai báo lại.
// ═══════════════════════════════════════════════════════════════════

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { config } from '../config.js';
import { db } from '../database/db.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { getCustomerFlag, getTicketMuteStatus } from '../services/blacklistService.js';
import { canOpenMultipleOrderTickets, isStaffMember, isManager, assertStaffCapability, TICKET_MEMBER_PERMISSIONS } from '../utils/permissions.js';
import { emitStaffLog } from '../services/staffLogService.js';
import { getOrderByCode, getLatestOrderByTicketChannel, cancelOrder, getQueuePosition, setOrderStatus, claimOrder, releaseOrderClaim } from '../services/orderService.js';
import { closeTicket, createTicket, getOpenTicketByCustomer, getTicketByChannelId, getTicketById, keepTicketOpen } from '../services/ticketService.js';
import { exportTicketTranscript } from '../services/transcriptService.js';
import { deliverTranscript, sendOrderCancelledFlow, updateOrderLogMessage } from '../services/notificationService.js';
import { cancelPayOSPaymentLink } from '../services/paymentService.js';
import { ensureRateLimit } from '../services/abuseService.js';
import { getCenarHub } from '../services/cenarHub.js';
import { buildTicketChannelName } from '../utils/formatters.js';
import {
  buildTicketWelcomeV2,
  buildTicketControlComponents,
  buildCloseConfirmEmbed,
  buildCloseConfirmComponents,
  buildDeliveryCredentialEmbeds,
  buildCredentialEmbeds,
  buildDeliveryLoginComponents,
  buildQueueStatusText,
  buildCreditOfferV2,
} from '../utils/embeds.js';
import {
  safeReply,
  getTicketCategoryId,
  activeTicketCreations,
  activeTicketCloses,
} from './shared.js';

export function withoutComponentEmojis(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(withoutComponentEmojis);
  if (typeof value?.toJSON === 'function') return withoutComponentEmojis(value.toJSON());
  if (typeof value !== 'object') return value;
  const sanitized = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'emoji') continue;
    sanitized[key] = withoutComponentEmojis(child);
  }
  return sanitized;
}

function isInvalidComponentEmojiError(error) {
  return Number(error?.code) === 50035
    && JSON.stringify(error?.rawError?.errors || error?.message || '').includes('COMPONENT_INVALID_EMOJI');
}

export async function sendTicketComponents(channel, payload) {
  try {
    return await channel.send(payload);
  } catch (error) {
    if (!isInvalidComponentEmojiError(error)) throw error;
    console.warn(`[TICKET_CREATE] Emoji component không còn hợp lệ tại ${channel.id}; gửi lại panel không emoji.`);
    return channel.send({
      ...payload,
      components: withoutComponentEmojis(payload.components),
    });
  }
}

export async function handleTicketCreate(interaction, ticketType = 'ORDER', gmailAddress = null) {
  const E = createEmojiResolver(interaction.guildId);
  if (!interaction.inGuild()) {
    await safeReply(interaction, { content: 'Ticket chỉ tạo được trong server.', ephemeral: true });
    return;
  }

  const guildConfig = getGuildConfig(interaction.guildId);
  if (!guildConfig) {
    await safeReply(interaction, { content: `${E('status_warn')} Server chưa setup ticket.`, ephemeral: true });
    return;
  }

  // Kiểm tra blacklist
  const flag = getCustomerFlag(interaction.guildId, interaction.user.id);
  if (Number(flag.is_blacklisted) === 1) {
    await safeReply(interaction, {
      content: `${E('status_cross')} Bạn đang bị chặn mở ticket. Lý do: **${flag.blacklist_reason ?? 'Không rõ lý do'}**`,
      ephemeral: true,
    });
    return;
  }

  // Kiểm tra mute ticket
  const muteStatus = getTicketMuteStatus(interaction.guildId, interaction.user.id);
  if (muteStatus.is_ticket_muted) {
    await safeReply(interaction, {
      content: `${E('status_cross')} Bạn đã bị admin ngăn tạo ticket.\n> **Lý do:** ${muteStatus.ticket_mute_reason ?? 'Không rõ lý do'}`,
      ephemeral: true,
    });
    return;
  }

  const normalizedType = String(ticketType || 'ORDER').toUpperCase();

  if (normalizedType === 'APPEAL') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
  }

  // Khóa chống click đúp tạo 2 ticket
  const lockKey = `${interaction.guildId}:${interaction.user.id}:${normalizedType}`;
  if (activeTicketCreations.has(lockKey)) {
    await safeReply(interaction, { content: `${E('status_warn')} Yêu cầu tạo ticket của bạn đang được xử lý, vui lòng không bấm liên tục.`, ephemeral: true });
    return;
  }
  activeTicketCreations.add(lockKey);

  try {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => interaction.member ?? null);
    const allowMultipleTickets = normalizedType === 'ORDER'
      && canOpenMultipleOrderTickets(member, interaction.guildId);
    ensureRateLimit({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      action: `OPEN_TICKET_${normalizedType}`,
      limit: allowMultipleTickets ? config.ctvTicketOpenBurstLimit : 1,
      windowSeconds: allowMultipleTickets ? config.ctvTicketOpenBurstWindowSeconds : config.ticketOpenCooldownSeconds,
      message: allowMultipleTickets
        ? `Bạn đã mở quá nhiều ticket liên tiếp. Vui lòng chờ ${config.ctvTicketOpenBurstWindowSeconds} giây.`
        : `Bạn vừa mở ticket rồi. Vui lòng chờ ${config.ticketOpenCooldownSeconds} giây rồi thử lại.`,
    });
    const existingTicket = allowMultipleTickets
      ? null
      : getOpenTicketByCustomer(interaction.guildId, interaction.user.id, normalizedType);
    if (existingTicket) {
      // Kiểm tra channel còn tồn tại không
      const existingChannel = await interaction.guild.channels.fetch(existingTicket.channel_id).catch(() => null);
      if (existingChannel) {
        await safeReply(interaction, {
          content: `${E('status_warn')} Bạn đã có ticket ${normalizedType.toLowerCase()} đang mở tại <#${existingTicket.channel_id}>.`,
          ephemeral: true,
        });
        return;
      }
      // Channel bị xóa thủ công → tự đóng ticket trong DB
      closeTicket(existingTicket.id, interaction.client.user.id);
    }

    let channel;
    let ticket;

    if (normalizedType === 'APPEAL') {
      // Tìm kênh hướng dẫn youtube để làm parent channel cho thread
      let parentChannel = await interaction.guild.channels.fetch('1524057155022491679').catch(() => null);
      if (!parentChannel) {
        parentChannel = interaction.guild.channels.cache.find(
          c => (c.name === 'hướng-dẫn-youtube' || c.name === 'huong-dan-youtube') && c.type === ChannelType.GuildText
        );
      }
      if (!parentChannel) {
        parentChannel = interaction.channel; // fallback
      }

      ticket = createTicket({
        guildId: interaction.guildId,
        channelId: 'PENDING',
        customerId: interaction.user.id,
        openedById: interaction.user.id,
        ticketType: normalizedType,
      });

      const threadName = `khang-12t-${ticket.ticket_code}`;
      const thread = await parentChannel.threads.create({
        name: threadName,
        autoArchiveDuration: 10080,
        type: ChannelType.GuildPrivateThread,
        reason: `Ticket Kháng 12 Tháng cho ${interaction.user.username}`,
      }).catch(async (err) => {
        console.error('[THREAD-CREATE] Failed to create private thread, falling back to public:', err.message);
        return await parentChannel.threads.create({
          name: threadName,
          autoArchiveDuration: 10080,
          type: ChannelType.GuildPublicThread,
          reason: `Ticket Kháng 12 Tháng cho ${interaction.user.username}`,
        });
      });

      db.prepare("UPDATE tickets SET channel_id = ? WHERE id = ?").run(thread.id, ticket.id);
      channel = thread;
      ticket.channel_id = thread.id;

      await thread.members.add(interaction.user.id).catch(() => null);

      const hub = getCenarHub();
      if (hub) {
        hub.upsertUser({
          discord_id: interaction.user.id,
          discord_username: interaction.user.username,
          display_name: interaction.member?.displayName,
        }).catch(e => console.error('[HUB] Lỗi upsertUser:', e.message));
      }

      const mentionParts = [`<@${interaction.user.id}>`];
      if (guildConfig.support_role_id) mentionParts.push(`<@&${guildConfig.support_role_id}>`);
      if (guildConfig.manager_role_id) mentionParts.push(`<@&${guildConfig.manager_role_id}>`);
      
      // Tag thêm admin manager và owner nếu là server chính
      if (interaction.guildId === '1282637033340403754') {
        mentionParts.push('<@&1348638945793019945>'); // ｜ Admin Manager
        mentionParts.push('<@&1282638119497109524>'); // Owner
      }

      await thread.send({
        content: mentionParts.join(' '),
        allowedMentions: { 
          users: [interaction.user.id], 
          roles: [
            guildConfig.support_role_id, 
            guildConfig.manager_role_id,
            interaction.guildId === '1282637033340403754' ? '1348638945793019945' : null,
            interaction.guildId === '1282637033340403754' ? '1282638119497109524' : null
          ].filter(Boolean) 
        }
      }).catch(() => null);

      const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import('discord.js');

      const welcomeEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`<:cr_baohanh:1348625535512870965> TICKET KHÁNG 12 THÁNG YOUTUBE PREMIUM`)
        .setDescription([
          `Xin chào <@${interaction.user.id}>!`,
          `> <:cr_shop:1392749981332541501> **Mã Ticket:** \`${ticket.ticket_code}\``,
          `> <a:redload:1459179959158571119> **Thời gian:** <t:${Math.floor(Date.now() / 1000)}:R>`,
          gmailAddress ? `> 📧 **Gmail yêu cầu kháng:** \`${gmailAddress}\`` : '',
          '',
          `**Yêu cầu kháng cáo giới hạn 12 tháng gia đình YouTube của bạn đã được tiếp nhận. Vui lòng đọc kỹ các quy định sau và chuẩn bị phối hợp cùng Admin.**`,
        ].filter(Boolean).join('\n'))
        .addFields(
          {
            name: `<a:tsm_fire:1327553120842158111> 1. Luôn online`,
            value: `> Bạn cần duy trì online. Khi Admin/Chủ shop tag tên, bạn cần phản hồi ngay lập tức để tiến hành kháng.`,
            inline: false
          },
          {
            name: `<a:redload:1459179959158571119> 2. Kế hoạch dự phòng`,
            value: `> Nếu không kháng được, bắt buộc phải đổi email khác hoặc chờ 7 - 15 ngày để bắt đầu lượt kháng thứ 2.`,
            inline: false
          },
          {
            name: `<:money:1442876095442714748> 3. Phí dịch vụ (Khách vãng lai)`,
            value: `> Miễn phí nếu mua YouTube tại shop. Phí 20,000đ/lượt thành công đối với khách vãng lai.`,
            inline: false
          }
        )
        .setTimestamp()
        .setFooter({ text: `${interaction.guild.name} · Hỗ Trợ Kháng Cáo`, iconURL: interaction.guild.iconURL() });

      const btnApprove = new ButtonBuilder()
        .setCustomId(`ytb:appeal:approve:${ticket.id}`)
        .setLabel('Duyệt Kháng Thành Công')
        .setStyle(ButtonStyle.Success)
        .setEmoji('1384069022831874169');

      const btnReject = new ButtonBuilder()
        .setCustomId(`ytb:appeal:reject:${ticket.id}`)
        .setLabel('Thất Bại / Đổi Mail')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('1384069065626222632');

      const btnClose = new ButtonBuilder()
        .setCustomId(`ticket:close:${ticket.id}`)
        .setLabel('Đóng Ticket')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('1384069065626222632');

      const btnMute = new ButtonBuilder()
        .setCustomId(`ticket:mute:${interaction.user.id}`)
        .setLabel('Mute User')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('1367140105248047114');

      const appealRow = new ActionRowBuilder().addComponents(btnApprove, btnReject);
      const controlRow = new ActionRowBuilder().addComponents(btnClose, btnMute);

      await thread.send({
        embeds: [welcomeEmbed],
        components: [appealRow, controlRow]
      });

    } else {
      const overwrites = [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: TICKET_MEMBER_PERMISSIONS },
        {
          id: interaction.client.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels],
        },
      ];

      if (guildConfig.support_role_id) {
        overwrites.push({ id: guildConfig.support_role_id, allow: TICKET_MEMBER_PERMISSIONS });
      }

      const categoryId = getTicketCategoryId(guildConfig, normalizedType);
      channel = await interaction.guild.channels.create({
        name: `ticket-${Math.random().toString().slice(2, 8)}`,
        type: ChannelType.GuildText,
        parent: categoryId,
        permissionOverwrites: overwrites,
      });

      ticket = createTicket({
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

      await channel.setName(buildTicketChannelName(ticket.ticket_code, 'ticket')).catch(() => null);
      
      const { container: welcomeV2, flags: welcomeV2Flags } = buildTicketWelcomeV2(
        ticket.ticket_code, interaction.user.id, normalizedType, null, null, interaction.guildId
      );
      
      const components = [
        welcomeV2,
        ...buildTicketControlComponents(ticket.id, interaction.user.id)
      ];

      if (normalizedType === 'ORDER') {
        const profile = db.prepare('SELECT * FROM customer_profiles WHERE guild_id = ? AND customer_id = ?').get(interaction.guildId, interaction.user.id);
        if (profile && profile.total_completed_orders >= 5 && profile.total_spent >= 1000000) {
          if (!profile.credit_limit || profile.credit_limit === 0) {
            db.prepare('UPDATE customer_profiles SET credit_limit = 500000 WHERE guild_id = ? AND customer_id = ?').run(interaction.guildId, interaction.user.id);
            profile.credit_limit = 500000;
          }
          const availableCredit = profile.credit_limit - (profile.credit_used || 0);
          if (availableCredit > 0 && (profile.credit_status || 'ACTIVE') === 'ACTIVE') {
            const creditOffer = buildCreditOfferV2(
              { limit: profile.credit_limit, available: availableCredit },
              interaction.user.id,
              interaction.guildId
            );
            components.push(creditOffer.container);
            components.push(creditOffer.row);
          }
        }
      }

      await sendTicketComponents(channel, {
        components: components,
        flags: welcomeV2Flags,
      });
      await channel.send({ content: `<@${interaction.user.id}> — Ticket của bạn đã được tạo!` }).catch(() => null);
      if (allowMultipleTickets) {
        await channel.send({
          content: `${E('cenar_ctv')} **Chế độ CTV nhiều ticket:** ticket này độc lập để bạn note riêng từng đơn và không ảnh hưởng các ticket CTV đang mở khác.`,
          allowedMentions: { parse: [] },
        }).catch(() => null);
      }
    }

    await emitStaffLog(interaction.client, {
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      targetId: interaction.user.id,
      action: 'TICKET_CREATE',
      detail: `Loại ticket: ${normalizedType}`,
      relatedTicketCode: ticket.ticket_code,
    });

    if (normalizedType === 'APPEAL') {
      await safeReply(interaction, {
        content: `<a:tickgreen:1384069022831874169> **Yêu cầu Kháng 12 Tháng YouTube của bạn đã được tạo thành công!**\n> ➡️ Vui lòng nhấn vào luồng hỗ trợ riêng tư của bạn tại đây để làm việc cùng Staff nhé: <#${channel.id}>`,
        ephemeral: true,
      });
    } else {
      await safeReply(interaction, {
        content: `${E('status_check')} Ticket **${normalizedType}** của bạn đã được tạo: ${channel}`,
        ephemeral: true,
      });
    }
  } catch (error) {
    if (error.code === 'RATE_LIMITED') {
      await safeReply(interaction, { content: `${E('status_warn')} ${error.message}`, ephemeral: true });
    } else {
      console.error('[TICKET_CREATE] Lỗi:', error);
      await safeReply(interaction, { content: `${E('status_cross')} Đã có lỗi xảy ra khi tạo ticket.`, ephemeral: true });
    }
  } finally {
    activeTicketCreations.delete(lockKey);
  }
}


export async function handleTicketCloseRequest(interaction, ticketId) {
  const E = createEmojiResolver(interaction.guildId);
  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

  // Tìm ticket trước để đảm bảo tồn tại
  const ticket = getTicketById(Number(ticketId)) ?? getTicketByChannelId(interaction.channelId);
  if (!ticket) {
    await safeReply(interaction, { content: `${E('status_warn')} Không tìm thấy thông tin ticket này. Có thể đã bị xóa khỏi hệ thống.`, ephemeral: true });
    return;
  }
  if (ticket.status !== 'OPEN') {
    await safeReply(interaction, { content: `${E('icon_lock')} Ticket \`${ticket.ticket_code}\` đã được đóng trước đó rồi.`, ephemeral: true });
    return;
  }

  // Sau khi xác nhận ticket tồn tại và OPEN mới check quyền
  if (!isManager(member, guildConfig)) {
    await safeReply(interaction, { content: `${E('status_cross')} Chỉ **Admin / Manager** mới có thể đóng ticket.\n> Nếu bạn muốn yêu cầu staff đóng hộ, hãy nhắn vào ticket.`, ephemeral: true });
    return;
  }
  await safeReply(interaction, {
    embeds: [buildCloseConfirmEmbed(ticket.ticket_code, null, interaction.guildId)],
    components: buildCloseConfirmComponents(ticket.id, interaction.guildId),
    ephemeral: true,
  });
}

// Bước 2: Thực sự đóng ticket sau khi confirm
export async function handleTicketClose(interaction, ticketId) {
  const E = createEmojiResolver(interaction.guildId);
  if (!interaction.inGuild()) {
    await safeReply(interaction, { content: 'Ticket chỉ đóng được trong server.', ephemeral: true });
    return;
  }

  const { db, nowIso } = await import('../database/db.js');
  const ticket = ticketId === 'orphan' ? null : (getTicketById(Number(ticketId)) ?? getTicketByChannelId(interaction.channelId));

  // Xử lý đóng ticket tạo thủ công/không có trong DB
  if (!ticket) {
    if (interaction.isButton()) {
      await interaction.update({ content: `${E('icon_clipboard')} Đang đóng kênh ticket tạo tay...`, embeds: [], components: [] }).catch(() => null);
    }
    
    // Tạo bản ghi đóng trong database để lưu vết và đồng bộ
    try {
      const chanName = interaction.channel.name;
      const ticketCode = `MANUAL_${chanName.replace(/[^0-9]/g, '') || String(Date.now()).slice(-6)}`;
      
      let customerId = 'MANUAL';
      try {
        const guildConfig = getGuildConfig(interaction.guildId);
        const supportRoleId = guildConfig?.support_role_id;
        const managerRoleId = guildConfig?.manager_role_id;
        const shipperRoleId = guildConfig?.shipper_role_id;
        
        const overwrites = interaction.channel.permissionOverwrites.cache;
        for (const [id, overwrite] of overwrites) {
          if (overwrite.type === 1) { // member
            const member = await interaction.guild.members.fetch(id).catch(() => null);
            if (member && !member.user.bot && !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
              const hasStaffRole = (supportRoleId && member.roles.cache.has(supportRoleId)) ||
                                   (managerRoleId && member.roles.cache.has(managerRoleId)) ||
                                   (shipperRoleId && member.roles.cache.has(shipperRoleId));
              if (!hasStaffRole) {
                customerId = id;
                break;
              }
            }
          }
        }
      } catch {}

      const type = chanName.startsWith('bao-hanh-') ? 'WARRANTY' : 'ORDER';
      const now = nowIso();
      
      db.prepare(`
        INSERT INTO tickets (ticket_code, guild_id, channel_id, customer_id, opened_by_id, ticket_type, status, created_at, closed_at, closed_by_id)
        VALUES (?, ?, ?, ?, ?, ?, 'CLOSED', ?, ?, ?)
      `).run(ticketCode, interaction.guildId, interaction.channelId, customerId, customerId, type, now, now, interaction.user.id);
      
      console.log(`[MANUAL TICKET CLOSE] Saved manual ticket ${ticketCode} to DB.`);
    } catch (err) {
      console.error('[MANUAL TICKET CLOSE] Lỗi ghi DB:', err.message);
    }

    setTimeout(async () => {
      try {
        const channel = await interaction.guild.channels.fetch(interaction.channelId).catch(() => null);
        if (channel) await channel.delete(`Ticket tạo tay đóng bởi ${interaction.user.tag}`).catch(() => null);
      } catch {}
    }, 1000);
    return;
  }

  // Nếu ticket đã CLOSED trong DB nhưng kênh Discord vẫn mở (lệch sync)
  if (ticket.status !== 'OPEN') {
    try {
      closeTicket(ticket.id, interaction.user.id);
    } catch (err) {
      console.error('[TICKET_CLOSE] Lỗi cập nhật lại DB cho ticket lệch sync:', err.message);
    }
    
    if (interaction.isButton()) {
      await interaction.update({ content: `${E('icon_clipboard')} Kênh đang đóng và đồng bộ database...`, embeds: [], components: [] }).catch(() => null);
    }
    setTimeout(async () => {
      try {
        const channel = await interaction.guild.channels.fetch(interaction.channelId).catch(() => null);
        if (channel) await channel.delete(`Ép đóng ticket lệch sync ${ticket.ticket_code} bởi ${interaction.user.tag}`).catch(() => null);
      } catch {}
    }, 1000);
    return;
  }

  const lockKey = `${ticket.id}`;
  if (activeTicketCloses.has(lockKey)) {
    return;
  }
  activeTicketCloses.add(lockKey);

  try {
    // Cập nhật trạng thái database ngay lập tức để tránh race condition khi click nhanh
    closeTicket(ticket.id, interaction.user.id);

    const ticketChannel = await interaction.guild.channels
      .fetch(interaction.channelId)
      .catch(() => interaction.channel);

    // 1. KHÓA QUYỀN TRUY CẬP VÀ ĐỔI TÊN KÊNH LẬP TỨC (để ép đóng giao diện đối với user)
    try {
      const everyone = interaction.guild.roles.everyone;
      const guildConfig = getGuildConfig(interaction.guildId);

      // Khóa tất cả, chỉ để bot + manager chat được
      const newOverwrites = [
        { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions] },
        { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
      ];
      if (ticket.customer_id) {
        newOverwrites.push({ id: ticket.customer_id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions] });
      }
      if (guildConfig?.manager_role_id) {
        newOverwrites.push({ id: guildConfig.manager_role_id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
      }
      if (ticketChannel?.permissionOverwrites?.set) {
        await ticketChannel.permissionOverwrites.set(newOverwrites).catch(() => null);
      }

      if (ticketChannel?.name && typeof ticketChannel.setName === 'function' && !ticketChannel.name.startsWith('closed-')) {
        const newName = `closed-${ticketChannel.name}`.slice(0, 95);
        await ticketChannel.setName(newName).catch(() => null);
      }
    } catch (err) {
      console.error('[TICKET_CLOSE] Lỗi đổi tên kênh/khóa quyền sớm:', err.message);
    }

    // Ack confirm button
    if (interaction.isButton()) {
      await interaction.update({ content: `${E('icon_clipboard')} Đang xuất transcript và đóng ticket...`, embeds: [], components: [] }).catch(() => null);
    }

    // 2. XUẤT TRANSCRIPT SAU KHI ĐÃ KHÓA KÊNH
    const transcriptResult = ticketChannel
      ? await exportTicketTranscript(ticketChannel).catch(() => null)
      : null;

    // Nếu Admin đóng ticket khi khách chưa thanh toán, đơn liên kết phải đóng
    // cùng trạng thái CANCELLED ở log và khách nhận được DM rõ lý do.
    const linkedOrder = getLatestOrderByTicketChannel(ticket.channel_id || interaction.channelId);
    if (linkedOrder?.status === 'PENDING_PAYMENT' && linkedOrder.payment_status !== 'PAID') {
      const cancellationReason = 'Ticket đã đóng do quá hạn/chưa hoàn tất thanh toán';
      await cancelPayOSPaymentLink(linkedOrder, cancellationReason).catch((error) => {
        console.error(`[TICKET_CLOSE] Không thể hủy link PayOS ${linkedOrder.order_code}:`, error.message);
      });
      const cancelledOrder = cancelOrder(linkedOrder.order_code, cancellationReason);
      if (cancelledOrder) {
        await updateOrderLogMessage(interaction.guild, cancelledOrder).catch(() => null);
        await sendOrderCancelledFlow({
          guild: interaction.guild,
          order: cancelledOrder,
          reason: cancellationReason,
        }).catch(() => null);
      }
    }

    await emitStaffLog(interaction.client, {
      guildId: interaction.guildId, actorId: interaction.user.id, targetId: ticket.customer_id, action: 'TICKET_CLOSE',
      detail: `Đóng ticket ${ticket.ticket_type}`, relatedTicketCode: ticket.ticket_code, relatedOrderCode: ticket.related_order_code ?? null,
    });

    if (ticket.ticket_type === 'WARRANTY' && ticket.related_order_code) {
      const order = setOrderStatus(ticket.related_order_code, 'COMPLETED');
      if (order) await updateOrderLogMessage(interaction.guild, order);
    }

    if (transcriptResult) {
      await deliverTranscript({ guild: interaction.guild, ticket, transcriptResult, closedById: interaction.user.id });
    }

    const closeContainer = new ContainerBuilder().setAccentColor(0xED4245);
    closeContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        `## ${E('icon_lock')} Ticket Đã Đóng`.trim(),
        `> ${E('ticket_user')} **Đóng bởi:** <@${interaction.user.id}>`,
        `> ${E('icon_clock')} Channel sẽ **tự xóa sau 1.5 giây**.`,
        transcriptResult
          ? (transcriptResult.partial
              ? `> ${E('status_warn')} Transcript xuất **một phần** (tải tin nhắn bị gián đoạn) nhưng vẫn đã gửi cho khách.`
              : `> ${E('icon_clipboard')} Transcript đã được lưu và gửi cho khách.`)
          : `> ${E('status_warn')} Không thể xuất transcript lần này.`,
      ].filter(Boolean).join('\n'))
    );
    closeContainer.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );
    closeContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# ${E('icon_heart_purple')} Cảm ơn bạn đã tin tưởng sử dụng dịch vụ!`.trim()
      )
    );
    if (ticketChannel?.send) {
      await ticketChannel.send({
        components: [closeContainer],
        flags: MessageFlags.IsComponentsV2,
      }).catch(() => null);
    }

    setTimeout(async () => {
      try {
        const channel = await interaction.guild.channels.fetch(interaction.channelId).catch(() => null);
        if (channel) await channel.delete(`Ticket ${ticket.ticket_code} đóng bởi ${interaction.user.tag}`).catch(() => null);
      } catch {}
    }, 1500);

  } catch (error) {
    console.error('[TICKET_CLOSE] Lỗi khi đóng ticket:', error);
  } finally {
    activeTicketCloses.delete(lockKey);
  }
}


export async function handleDeliveryClaim(interaction, orderCode) {
  const E = createEmojiResolver(interaction.guildId);
  const order = getOrderByCode(orderCode);
  if (!order) {
    await safeReply(interaction, { content: `${E('status_warn')} Không tìm thấy dữ liệu giao hàng cho đơn này.`, ephemeral: true });
    return;
  }

  if (order.customer_id !== interaction.user.id) {
    await safeReply(interaction, { content: `${E('status_warn')} Bạn không phải chủ sở hữu của đơn này.`, ephemeral: true });
    return;
  }

  if (!order.credential_email || !order.credential_password) {
    await safeReply(interaction, {
      content: `${E('status_info')} Đơn này không có Gmail để nhận. Hãy liên hệ shop trong ticket nếu cần.`,
      ephemeral: true,
    });
    return;
  }

  const embeds = order.credential_profile || order.delivery_login_url
    ? buildDeliveryCredentialEmbeds(order)
    : buildCredentialEmbeds(order);

  await safeReply(interaction, {
    embeds,
    components: buildDeliveryLoginComponents(order),
    ephemeral: true,
  });
}

export async function handleQueueView(interaction, orderCode) {
  const E = createEmojiResolver(interaction.guildId);
  const order = getOrderByCode(orderCode);
  if (!order) {
    await safeReply(interaction, { content: `${E('status_warn')} Không tìm thấy đơn hàng.`, ephemeral: true });
    return;
  }

  const queue = getQueuePosition(order);
  await safeReply(interaction, {
    content: buildQueueStatusText(order, queue.position, queue.total),
    ephemeral: true,
  });
}

export async function handleOrderCancel(interaction, orderCode) {
  const E = createEmojiResolver(interaction.guildId);
  const order = getOrderByCode(orderCode);
  if (!order) {
    await safeReply(interaction, { content: `${E('status_warn')} Không tìm thấy đơn hàng.`, ephemeral: true });
    return;
  }

  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const isOwner = order.customer_id === interaction.user.id;
  const isStaff = isStaffMember(member, guildConfig);

  if (!isOwner && !isStaff) {
    await safeReply(interaction, { content: `${E('status_warn')} Bạn không có quyền hủy đơn này.`, ephemeral: true });
    return;
  }

  if (!['PENDING_PAYMENT', 'PROCESSING'].includes(order.status)) {
    await safeReply(interaction, { content: `${E('status_warn')} Chỉ có thể hủy đơn đang chờ thanh toán hoặc đang xử lý.`, ephemeral: true });
    return;
  }

  try {
    if (order.payment_status !== 'PAID' && order.status === 'PENDING_PAYMENT') {
      await cancelPayOSPaymentLink(order, `Cancelled by ${interaction.user.tag}`);
    }
  } catch (error) {
    console.error('[ORDER CANCEL] PayOS cancel failed:', error.message);
  }

  const cancelled = cancelOrder(orderCode, `Cancelled by ${interaction.user.tag}`);
  await updateOrderLogMessage(interaction.guild, cancelled);
  // Chỉ xóa components của tin hiện tại nếu không phải kênh log (tránh làm trắng V2 log embed)
  if (interaction.channelId !== cancelled.order_log_channel_id) {
    await interaction.message.edit({ components: [] }).catch(() => null);
  }

  // Nếu staff hủy đơn của khách khác → DM khách
  if (!isOwner && cancelled.customer_id !== interaction.user.id) {
    await sendOrderCancelledFlow({
      guild: interaction.guild,
      order: cancelled,
      reason: `Đơn được hủy bởi staff ${interaction.user.tag}`,
    }).catch(() => null);
  }

  await safeReply(interaction, {
    content: `${E('status_cross')} Đơn \`${cancelled.order_code}\` đã được hủy.`,
    ephemeral: true,
  });
}


export async function handleOrderClaim(interaction, orderCode) {
  const E = createEmojiResolver(interaction.guildId);
  const order = getOrderByCode(orderCode);
  if (!order) {
    await safeReply(interaction, { content: `${E('status_warn')} Không tìm thấy đơn hàng.`, ephemeral: true });
    return;
  }

  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!assertStaffCapability(member, guildConfig, 'SUPPORT')) {
    await safeReply(interaction, { content: `${E('status_warn')} Chỉ staff mới được claim đơn.`, ephemeral: true });
    return;
  }

  if (order.claimed_by_id && order.claimed_by_id !== interaction.user.id) {
    await safeReply(interaction, { content: `${E('status_warn')} Đơn này đang được <@${order.claimed_by_id}> claim.`, ephemeral: true });
    return;
  }

  const updated = order.claimed_by_id === interaction.user.id ? releaseOrderClaim(orderCode) : claimOrder(orderCode, interaction.user.id);
  await emitStaffLog(interaction.client, { guildId: interaction.guildId, actorId: interaction.user.id, targetId: updated.customer_id, action: updated.claimed_by_id ? 'ORDER_CLAIM' : 'ORDER_RELEASE', detail: updated.claimed_by_id ? 'Nhận xử lý đơn' : 'Nhả claim đơn', relatedOrderCode: updated.order_code });
  await safeReply(interaction, { content: updated.claimed_by_id ? `${E('status_check')} Bạn đã claim đơn \`${updated.order_code}\`.` : `${E('status_info')} Bạn đã nhả claim đơn \`${updated.order_code}\`.`, ephemeral: true });
}

export async function handleKeepOpen(interaction, ticketId) {
  const E = createEmojiResolver(interaction.guildId);
  const ticket = keepTicketOpen(Number(ticketId));
  if (!ticket) {
    await safeReply(interaction, { content: `${E('status_warn')} Không tìm thấy ticket.`, ephemeral: true });
    return;
  }
  await safeReply(interaction, { content: `${E('status_check')} Bot sẽ giữ ticket mở, không tự đóng nữa.`, ephemeral: true });
}

export async function handleCreditApply(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  const guildConfig = getGuildConfig(interaction.guildId);

  const mentionParts = [];
  if (guildConfig.manager_role_id) mentionParts.push(`<@&${guildConfig.manager_role_id}>`);
  if (guildConfig.support_role_id) mentionParts.push(`<@&${guildConfig.support_role_id}>`);
  
  await interaction.reply({
    content: `${E('payment_payos')} **XÁC NHẬN SỬ DỤNG VÍ TRẢ SAU / TRẢ GÓP**\n> Khách hàng <@${interaction.user.id}> đã yêu cầu kích hoạt thanh toán bằng Ví Trả Sau cho đơn hàng này.\n> Vui lòng Admin vào kiểm tra đơn, báo mức cọc (nếu có) và khởi tạo đơn cho khách.\n\n${mentionParts.join(' ')}`,
    allowedMentions: { roles: [guildConfig.manager_role_id, guildConfig.support_role_id].filter(Boolean) }
  });
}

export async function handleCreditRules(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  await interaction.reply({
    content: `${E('icon_doc')} **QUY CHẾ VÍ TRẢ SAU (BNPL) & TRẢ GÓP 0%:**\n` +
      `> 1. **Dùng trước trả sau:** Khách hàng được nhận tài khoản dùng ngay, thanh toán số dư trong 7 - 14 ngày.\n` +
      `> 2. **Trả góp 0%:** Áp dụng gói lớn 12T (Nitro, Adobe, CapCut), trả trước 30-50%, còn lại chia 2-3 kỳ.\n` +
      `> 3. **Phạt vi phạm:** Trễ 1-3 ngày phạt 5%/ngày. Trễ 7-14 ngày thu hồi tài khoản, đưa ID vào Blacklist MMO.\n` +
      `> 4. **Bảo hành:** Vẫn được hỗ trợ bảo hành 1 đổi 1 trong thời gian chưa tất toán.`,
    ephemeral: true
  });
}
