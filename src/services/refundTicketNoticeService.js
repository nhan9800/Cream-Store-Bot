import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { getRefundCase } from './geminiRefundService.js';
import { buildRefundOffer } from './refundPresentation.js';
import { isStaffMember } from '../utils/permissions.js';

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
    if (!fresh.active) return 'Đơn vừa thay đổi; không gửi thông báo.';
    const claimed = db.prepare(`UPDATE order_refund_cases SET ticket_notice_state='SENDING',ticket_notice_channel_id=?,updated_at=?
      WHERE id=? AND ticket_notice_state='UNSENT'`).run(channel.id, new Date().toISOString(), id).changes;
    if (!claimed) return 'Ticket đã được xử lý bởi lượt khác.';
    try {
      const message = await channel.send({ ...buildRefundOffer(fresh), content: `<@${row.customer_id}> Shop đã mở hồ sơ hoàn cho đơn \`${row.order_code}\`. Vui lòng đọc bảng tính và dùng nút bên dưới; thông tin tài khoản được nhập trong biểu mẫu riêng tư.`,
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
