const PAGE_SIZE = 8;
const snowflake = value => typeof value === 'string' && /^\d{17,20}$/u.test(value);
const time = ms => `<t:${Math.floor(ms / 1000)}:f>`;
const concluded = {
  COMPLETED: 'Đã hoàn thành', DECLINED: 'Đã từ chối', NEEDS_REVIEW: 'Chờ staff kiểm tra',
};
const billing = {
  PENDING: 'Chờ thanh toán', EXPIRED: 'Đã hết hạn thanh toán', NEEDS_REVIEW: 'Cần đối soát',
  FREE: 'Đã xác nhận · Miễn phí', PAID: 'Đã xác nhận · Đã đối soát',
};

function displayStatus(ledger, receipts, guildId, session, now) {
  if (Object.hasOwn(concluded, session.status)) return concluded[session.status];
  if (session.status === 'ACTIVE') return session.ends_at > now ? 'Đang diễn ra' : 'Chờ bot kết phiên';
  if (session.status === 'REQUESTED') return session.ends_at > now ? 'Chờ xếp host' : 'Giờ yêu cầu đã qua';
  const base = ledger.listInvoices(guildId, session.ticket_id).find(invoice => invoice.kind === 'BASE');
  const receipt = base && receipts.getForTicket({ guildId, ticketId: session.ticket_id,
    viewerId: session.customer_id, invoiceId: base.id });
  if (!receipt) return session.ends_at > now ? 'Chờ báo giá' : 'Phiên đã qua giờ';
  if (session.ends_at <= now && ['FREE', 'PAID'].includes(receipt.status)) return 'Chờ staff kiểm tra';
  return billing[receipt.status] ?? 'Chờ staff kiểm tra';
}

export function bookingMemberSchedule({ ledger, receipts, voice, guildId, userId, now = Date.now() }) {
  const scopes = [{ customerId: userId }, { hostId: userId }];
  const upcoming = scopes.flatMap(scope => ledger.listSessions(guildId, { ...scope, endsAfter: now, startAscending: true, limit: PAGE_SIZE }));
  const recent = scopes.flatMap(scope => ledger.listSessions(guildId, { ...scope, endsBy: now, limit: PAGE_SIZE }));
  const unique = new Map([...upcoming, ...recent].map(session => [session.ticket_id, session]));
  if (!unique.size) return ['Bạn chưa có phiên nào. Mở kênh đặt lịch để chọn giờ hoặc gửi yêu cầu.'];

  const sortKey = session => session.ends_at > now && !Object.hasOwn(concluded, session.status)
    ? [0, session.starts_at] : [1, -session.starts_at];
  return [...unique.values()].sort((a, b) => {
    const [stageA, timeA] = sortKey(a), [stageB, timeB] = sortKey(b);
    return stageA - stageB || timeA - timeB || a.ticket_id - b.ticket_id;
  }).slice(0, PAGE_SIZE).map(session => {
    const customer = session.customer_id === userId;
    const room = session.status === 'ACTIVE' && session.ends_at > now ? voice.get(session.ticket_id) : null;
    const links = [room && !room.released && snowflake(room.room_id) ? `Phòng <#${room.room_id}>` : null,
      customer && snowflake(session.ticket_channel_id) ? `Phiếu <#${session.ticket_channel_id}>` : null].filter(Boolean);
    return `**${session.service === 'game' ? 'Chơi game' : 'Trò chuyện'} · ${displayStatus(ledger, receipts, guildId, session, now)}**\n`
      + `${time(session.starts_at)} · ${session.duration_minutes} phút · ${customer ? 'Bạn đặt' : 'Bạn là host'}`
      + (links.length ? `\n${links.join(' · ')}` : '');
  });
}
