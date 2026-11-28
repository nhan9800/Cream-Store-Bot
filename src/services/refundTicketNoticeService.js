import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { getRefundCase } from './geminiRefundService.js';
import { buildRefundOffer, buildRefundOfferReplaced } from './refundPresentation.js';
import { isStaffMember } from '../utils/permissions.js';
import { isGemini18MonthRefundNotice } from '../config/geminiRefundNoticeScope.js';
import { createHash } from 'node:crypto';

/** Never publish a customer's financial quote into a shared or unrelated ticket. */
export async function isPrivateRefundTicket(channel, guild, customerId, guildConfig) {
  if (!channel || channel.guildId !== guild.id || channel.type !== ChannelType.GuildText
    || channel.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel) !== false) return false;
  const buyer = await guild.members.fetch(customerId).catch(() => null);
  if (!buyer || !channel.permissionsFor(buyer)?.has(P.ViewChannel)
    || !channel.permissionOverwrites.cache.get(customerId)?.allow.has(P.ViewChannel)) return false;
  const staffRoles = new Set([guildConfig?.manager_role_id, guildConfig?.support_role_id, guildConfig?.shipper_role_id].filter(Boolean));
  for (const overwrite of channel.permissionOverwrites.cache.values()) {
    if (!overwrite.allow.has(P.ViewChannel)) continue;
    if (overwrite.id === customerId || overwrite.id === guild.client.user.id) continue;
    if (overwrite.type === 0) {
      const role = await guild.roles.fetch(overwrite.id).catch(() => null);
      if (!role || (!staffRoles.has(role.id) && !role.permissions.has(P.Administrator) && !role.permissions.has(P.ManageGuild))) return false;
    } else {
      const member = await guild.members.fetch(overwrite.id).catch(() => null);
      if (!isStaffMember(member, guildConfig)) return false;
    }
  }
  return true;
}

export async function sendRefundTicketNotice(db, { id, guild, guildConfig }) {
  const row = getRefundCase(db, id);
  if (!row?.active || row.guild_id !== guild.id) return 'Hồ sơ đã đóng hoặc khác shop.';
  if (!isGemini18MonthRefundNotice(row)) return 'Ngoài phạm vi thông báo Gemini 18 tháng đang bảo hành.';
  if (row.notice_state === 'SENT') return 'Đã gửi DM; không gửi trùng qua ticket.';
  if (row.ticket_notice_state !== 'UNSENT') return `Ticket đã xử lý (${row.ticket_notice_state}); không gửi lại.`;
  const tickets = db.prepare(`SELECT * FROM tickets WHERE guild_id=? AND customer_id=?
    AND related_order_code=? AND status='OPEN' AND ticket_type IN ('WARRANTY','ORDER')
    ORDER BY CASE WHEN ticket_type='WARRANTY' THEN 0 ELSE 1 END,id DESC`)
    .all(row.guild_id, row.customer_id, row.order_code);
  for (const ticket of tickets) {
    const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
    if (!await isPrivateRefundTicket(channel, guild, row.customer_id, guildConfig)) continue;
    const fresh = getRefundCase(db, id);
    if (!isGemini18MonthRefundNotice(fresh)) return 'Đơn vừa thay đổi; không gửi thông báo.';
    const claimed = db.prepare(`UPDATE order_refund_cases SET ticket_notice_state='SENDING',ticket_notice_channel_id=?,updated_at=?
      WHERE id=? AND ticket_notice_state='UNSENT'`).run(channel.id, new Date().toISOString(), id).changes;
    if (!claimed) return 'Ticket đã được xử lý bởi lượt khác.';
    try {
      const message = await channel.send({ ...buildRefundOffer(fresh,{mentionCustomer:true}),
        allowedMentions: { users: [row.customer_id], parse: [] }, nonce: `rf-ticket-${row.order_code}`, enforceNonce: true });
      db.prepare(`UPDATE order_refund_cases SET ticket_notice_state='SENT',ticket_notice_message_id=?,updated_at=? WHERE id=?`)
        .run(message.id, new Date().toISOString(), id);
      return 'Đã gửi hồ sơ trong ticket riêng.';
    } catch (error) {
      db.prepare("UPDATE order_refund_cases SET ticket_notice_state='UNCERTAIN',updated_at=? WHERE id=?")
        .run(new Date().toISOString(), id);
      // Numeric error code only; never log or return customer input or the payload.
      return `Chưa xác nhận gửi ticket (mã ${Number.isSafeInteger(error.code) ? error.code : 'kết nối'}); không tự gửi lại.`;
    }
  }
  return 'Không tìm thấy ticket riêng đúng khách/đơn. Khách dùng /hoan-tien ma_don.';
}

export async function refreshRefundTicketNotice(db, { id, guild, guildConfig }) {
  const row = getRefundCase(db,id);
  if (!row?.active || row.guild_id !== guild.id || !isGemini18MonthRefundNotice(row)) return 'Ngoài phạm vi cập nhật thông báo Gemini 18 tháng.';
  if (row.ticket_notice_state !== 'SENT' || !row.ticket_notice_message_id || !row.ticket_notice_channel_id) return 'Chưa có thông báo đã gửi để sửa.';
  const ticket = db.prepare(`SELECT 1 FROM tickets WHERE channel_id=? AND guild_id=? AND customer_id=?
    AND related_order_code=? AND status='OPEN'`).get(row.ticket_notice_channel_id,row.guild_id,row.customer_id,row.order_code);
  const channel = ticket ? await guild.channels.fetch(row.ticket_notice_channel_id).catch(()=>null) : null;
  if (!await isPrivateRefundTicket(channel,guild,row.customer_id,guildConfig)) return 'Ticket không còn đúng phạm vi riêng tư.';
  const message = await channel.messages.fetch(row.ticket_notice_message_id).catch(()=>null);
  const componentText = node => JSON.stringify(node?.toJSON?.() || node);
  const recognizable = message?.embeds?.some(e=>e.title === `HỒ SƠ HOÀN TIỀN · ${row.order_code}`)
    || message?.components?.some(c=>componentText(c).includes(`refund:bank:${row.id}`)
      || componentText(c).includes(`**${row.order_code}**`));
  if (!message || message.author.id !== guild.client.user.id || !recognizable) return 'Thông báo gốc không khớp; chưa chỉnh sửa.';
  const fresh = getRefundCase(db,id);
  if (!isGemini18MonthRefundNotice(fresh)) return 'Hồ sơ vừa thay đổi; chưa chỉnh sửa.';
  const payload = buildRefundOffer(fresh);
  const renderHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  if (fresh.ticket_notice_render_hash === renderHash) return 'Thông báo đã đúng phiên bản hiện tại.';
  await message.edit({...payload,content:null,embeds:[]});
  db.prepare('UPDATE order_refund_cases SET ticket_notice_render_hash=? WHERE id=?').run(renderHash,id);
  return 'Đã cập nhật thông báo cũ, không gửi thêm hoặc tag lại.';
}

/**
 * Post (or refresh) a standard refund case card in the customer's private ticket.
 * A re-quote edits the existing card instead of pinging again.
 */
export async function publishStandardRefundCase(db, { id, guild, guildConfig }) {
  const row = getRefundCase(db, id);
  if (!row?.active || row.guild_id !== guild.id) return { ok: false, message: 'Hồ sơ đã đóng hoặc khác shop.' };
  if (row.ticket_notice_message_id && row.ticket_notice_channel_id) {
    const channel = await guild.channels.fetch(row.ticket_notice_channel_id).catch(() => null);
    const message = channel ? await channel.messages.fetch(row.ticket_notice_message_id).catch(() => null) : null;
    const reoffer = row.quote?.reoffer;
    if (reoffer && message && message.author.id === guild.client.user.id && await isPrivateRefundTicket(channel, guild, row.customer_id, guildConfig)) {
      // A withdrawn quote gets a fresh card that tags the customer; the old card loses its buttons.
      const sent = await channel.send({ ...buildRefundOffer(row, { mentionCustomer: true }), allowedMentions: { users: [row.customer_id], parse: [] } });
      await message.edit({ ...buildRefundOfferReplaced(row, { ...reoffer, url: sent.url }), content: null, embeds: [] }).catch(() => null);
      db.prepare('UPDATE order_refund_cases SET ticket_notice_message_id=?, updated_at=? WHERE id=?').run(sent.id, new Date().toISOString(), id);
      return { ok: true, message: 'Đã gửi bảng tính mới vào ticket, tag khách và tắt nút của bảng cũ.', url: sent.url };
    }
    if (message && message.author.id === guild.client.user.id && await isPrivateRefundTicket(channel, guild, row.customer_id, guildConfig)) {
      await message.edit({ ...buildRefundOffer(row), content: null, embeds: [] });
      return { ok: true, message: 'Đã cập nhật thẻ hồ sơ cũ trong ticket (không tag lại).', url: message.url };
    }
  }
  const tickets = db.prepare(`SELECT channel_id FROM tickets WHERE guild_id=? AND customer_id=? AND status='OPEN'
    AND (related_order_code=? OR channel_id=(SELECT ticket_channel_id FROM orders WHERE order_code=?))
    ORDER BY id DESC`).all(row.guild_id, row.customer_id, row.order_code, row.order_code);
  for (const ticket of tickets) {
    const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
    if (!await isPrivateRefundTicket(channel, guild, row.customer_id, guildConfig)) continue;
    const sent = await channel.send({ ...buildRefundOffer(row, { mentionCustomer: true }), allowedMentions: { users: [row.customer_id], parse: [] } });
    db.prepare(`UPDATE order_refund_cases SET ticket_notice_state='SENT', ticket_notice_channel_id=?, ticket_notice_message_id=?, updated_at=? WHERE id=?`)
      .run(channel.id, sent.id, new Date().toISOString(), id);
    return { ok: true, message: 'Đã gửi hồ sơ vào ticket riêng của khách.', url: sent.url };
  }
  return { ok: false, message: 'Không tìm thấy ticket riêng đang mở của khách cho đơn này. Nhắn khách dùng `/hoan-tien ma_don:' + row.order_code + '`.' };
}
