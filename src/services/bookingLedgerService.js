import { STORE_TWO_GUILD_ID } from '../utils/locale.js';
import { getStoredPayOSReceivedAmount } from '../utils/payosReceipt.js';

const MINUTE = 60_000;
const MAX_MINUTES = 1440;
const MAX_RATE = 100_000_000;
const STATUSES = new Set(['REQUESTED', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'DECLINED', 'NEEDS_REVIEW']);
const SETTLED_ORDER_STATES = new Set(['PROCESSING', 'COMPLETED']);

export function getBookingInvoiceForOrder(db, order) {
  if (order?.guild_id !== STORE_TWO_GUILD_ID || !order.id
    || !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='booking_invoices'").get()) return null;
  return db.prepare(`SELECT i.id, i.amount, i.provider_order_code, i.status FROM booking_invoices i
    JOIN booking_sessions s ON s.ticket_id = i.ticket_id
    WHERE i.order_id = ? AND i.order_code = ? AND s.guild_id = ?`).get(order.id, order.order_code, order.guild_id) ?? null;
}

export function isBookingPayOSReceipt(order, invoice, data) {
  return Boolean(order.payment_link_id && data && Number(data.orderCode) === invoice.provider_order_code
    && order.payos_order_code === invoice.provider_order_code && order.total_amount === invoice.amount
    && (data.paymentLinkId ?? data.id) === order.payment_link_id);
}

export class BookingLedgerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BookingLedgerError';
    this.code = code;
  }
}

function requireBooking(condition, code, message) {
  if (!condition) throw new BookingLedgerError(code, message);
}

function requireStore(guildId) {
  requireBooking(guildId === STORE_TWO_GUILD_ID, 'WRONG_STORE', 'Chức năng này chỉ dùng trong Cenar Booking.');
}

function isInteger(value, min, max = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function isId(value) {
  return typeof value === 'string' && /^\d{17,20}$/.test(value);
}

function requireActor(value) {
  requireBooking(isId(value), 'INVALID_ACTOR', 'Không xác định được người thực hiện.');
}

// Invoice amounts round up to a whole đồng; the wage rounds to the nearest đồng.
function quoteFor(minutes, hourlyPrice, hourlyWage) {
  requireBooking(isInteger(minutes, 1, MAX_MINUTES), 'INVALID_DURATION', 'Nhập thời lượng từ 1 đến 1440 phút.');
  requireBooking(isInteger(hourlyPrice, 0, MAX_RATE) && isInteger(hourlyWage, 0, hourlyPrice),
    'INVALID_RATE', 'Kiểm tra lại giá giờ và lương giờ.');
  const amount = Math.ceil(hourlyPrice * minutes / 60);
  requireBooking(amount <= MAX_RATE, 'AMOUNT_LIMIT', 'Tổng báo giá vượt giới hạn cho một phiếu.');
  return { amount, wage: Math.round(hourlyWage * minutes / 60) };
}

export function createBookingLedger(db, { now = Date.now } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS booking_sessions (
      ticket_id INTEGER PRIMARY KEY REFERENCES tickets(id),
      guild_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      ticket_channel_id TEXT NOT NULL,
      service TEXT NOT NULL CHECK (service IN ('game','voice')),
      host_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('REQUESTED','CONFIRMED','ACTIVE','COMPLETED','DECLINED','NEEDS_REVIEW')),
      starts_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      requested_duration_minutes INTEGER NOT NULL CHECK (requested_duration_minutes BETWEEN 1 AND 1440),
      duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 1440),
      started_at INTEGER,
      completed_at INTEGER,
      updated_by_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS booking_sessions_host_slots
      ON booking_sessions(guild_id, host_id, status, starts_at, ends_at);
    CREATE INDEX IF NOT EXISTS booking_sessions_customer_slots
      ON booking_sessions(guild_id, customer_id, starts_at);

    CREATE TABLE IF NOT EXISTS booking_invoices (
      id INTEGER PRIMARY KEY,
      ticket_id INTEGER NOT NULL REFERENCES booking_sessions(ticket_id),
      kind TEXT NOT NULL CHECK (kind IN ('BASE','EXTENSION')),
      request_key TEXT,
      host_id TEXT NOT NULL,
      minutes INTEGER NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
      hourly_price INTEGER NOT NULL CHECK (hourly_price >= 0),
      hourly_wage INTEGER NOT NULL CHECK (hourly_wage BETWEEN 0 AND hourly_price),
      amount INTEGER NOT NULL CHECK (amount >= 0),
      wage INTEGER NOT NULL CHECK (wage BETWEEN 0 AND amount),
      status TEXT NOT NULL CHECK (status IN ('FREE','PENDING','PAID','NEEDS_REVIEW')),
      order_id INTEGER UNIQUE REFERENCES orders(id),
      order_code TEXT,
      provider_order_code INTEGER,
      payment_event_id INTEGER UNIQUE REFERENCES payment_events(id),
      created_by_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      paid_at INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS booking_invoice_base ON booking_invoices(ticket_id) WHERE kind = 'BASE';
    CREATE UNIQUE INDEX IF NOT EXISTS booking_invoice_request ON booking_invoices(ticket_id, request_key);
    CREATE INDEX IF NOT EXISTS booking_invoice_status ON booking_invoices(ticket_id, status);
  `);

  const sessionByTicket = db.prepare('SELECT * FROM booking_sessions WHERE guild_id = ? AND ticket_id = ?');
  const invoiceById = db.prepare(`SELECT i.* FROM booking_invoices i JOIN booking_sessions s ON s.ticket_id = i.ticket_id
    WHERE s.guild_id = ? AND i.id = ?`);
  const invoicesByTicket = db.prepare(`SELECT * FROM booking_invoices WHERE ticket_id = ? ORDER BY id`);
  const orderById = db.prepare('SELECT * FROM orders WHERE id = ?');
  const openTicket = db.prepare(`SELECT id, guild_id, customer_id, channel_id FROM tickets
    WHERE id = ? AND guild_id = ? AND ticket_type = 'BOOKING' AND status = 'OPEN'`);
  const overlappingSlot = db.prepare(`
    SELECT 1 FROM booking_sessions s
    WHERE s.guild_id = @guildId AND s.host_id = @hostId AND s.ticket_id <> @ticketId
      AND s.status IN ('CONFIRMED','ACTIVE') AND COALESCE(s.started_at,s.starts_at) < @endsAt
      AND (s.status = 'ACTIVE' OR EXISTS (SELECT 1 FROM tickets t WHERE t.id = s.ticket_id AND t.status = 'OPEN'))
      AND s.ends_at + 60000 * COALESCE((SELECT SUM(i.minutes) FROM booking_invoices i
        WHERE i.ticket_id = s.ticket_id AND i.kind = 'EXTENSION' AND i.status = 'PENDING'),0) > @startsAt
    LIMIT 1`);
  const insertSession = db.prepare(`INSERT INTO booking_sessions
    (ticket_id, guild_id, customer_id, ticket_channel_id, service, status, starts_at, ends_at,
      requested_duration_minutes, duration_minutes, updated_by_id, created_at, updated_at)
    VALUES (@ticketId, @guildId, @customerId, @channelId, @service, 'REQUESTED', @startsAt, @endsAt,
      @durationMinutes, @durationMinutes, @customerId, @at, @at)`);
  const insertInvoice = db.prepare(`INSERT INTO booking_invoices
    (ticket_id, kind, request_key, host_id, minutes, hourly_price, hourly_wage, amount, wage,
      status, created_by_id, created_at)
    VALUES (@ticketId, @kind, @requestKey, @hostId, @minutes, @hourlyPrice, @hourlyWage, @amount, @wage,
      @status, @actorId, @at)`);

  function getSession(guildId, ticketId) {
    requireStore(guildId);
    return sessionByTicket.get(guildId, ticketId) ?? null;
  }

  function requireSession(guildId, ticketId, statuses) {
    const session = getSession(guildId, ticketId);
    requireBooking(session && statuses.includes(session.status), 'INVALID_BOOKING_STATUS', 'Phiếu không ở trạng thái phù hợp.');
    return session;
  }

  function requireOpenTicket(guildId, ticketId) {
    const ticket = openTicket.get(ticketId, guildId);
    requireBooking(ticket, 'TICKET_CLOSED', 'Phiếu booking đã đóng hoặc không còn hợp lệ.');
    return ticket;
  }

  function isSlotAvailable(session, hostId, startsAt, endsAt) {
    return !overlappingSlot.get({ guildId: session.guild_id, ticketId: session.ticket_id, hostId, startsAt, endsAt });
  }

  function createSession({ guildId, ticketId, service, startsAt, durationMinutes }) {
    requireStore(guildId);
    requireBooking(isInteger(ticketId, 1) && (service === 'voice' || service === 'game')
      && isInteger(startsAt, 1, 8_640_000_000_000_000 - MAX_MINUTES * MINUTE)
      && isInteger(durationMinutes, 1, MAX_MINUTES), 'INVALID_BOOKING', 'Ngày giờ hoặc nội dung đặt lịch không hợp lệ.');
    return db.transaction(() => {
      const ticket = requireOpenTicket(guildId, ticketId);
      const existing = getSession(guildId, ticketId);
      if (existing) {
        requireBooking(existing.service === service && existing.starts_at === startsAt && existing.requested_duration_minutes === durationMinutes,
          'BOOKING_EXISTS', 'Phiếu đã có lịch đặt khác.');
        return existing;
      }
      const at = now();
      requireBooking(startsAt > at, 'BOOKING_IN_PAST', 'Chọn giờ trong tương lai.');
      insertSession.run({ guildId, ticketId, service, startsAt, durationMinutes,
        customerId: ticket.customer_id, channelId: ticket.channel_id, endsAt: startsAt + durationMinutes * MINUTE, at });
      return getSession(guildId, ticketId);
    }).immediate();
  }

  function listSessions(guildId, { status, customerId, hostId, dueBefore, startAscending = false, limit = 20 } = {}) {
    requireStore(guildId);
    requireBooking((status === undefined || STATUSES.has(status)) && isInteger(limit, 1, 100)
      && (dueBefore === undefined || isInteger(dueBefore, 1)) && typeof startAscending === 'boolean'
      && (customerId === undefined || isId(customerId)) && (hostId === undefined || isId(hostId)),
    'INVALID_FILTER', 'Bộ lọc danh sách lịch không hợp lệ.');
    const order = startAscending ? 'ASC' : 'DESC';
    return db.prepare(`SELECT * FROM booking_sessions WHERE guild_id = @guildId
      AND (@status IS NULL OR status = @status) AND (@customerId IS NULL OR customer_id = @customerId)
      AND (@hostId IS NULL OR host_id = @hostId) AND (@dueBefore IS NULL OR starts_at <= @dueBefore)
      ORDER BY starts_at ${order}, ticket_id ${order} LIMIT @limit`)
      .all({ guildId, status: status ?? null, customerId: customerId ?? null, hostId: hostId ?? null,
        dueBefore: dueBefore ?? null, limit });
  }

  function assignHost({ guildId, ticketId, hostId, actorId }) {
    requireActor(actorId);
    requireBooking(isId(hostId), 'INVALID_HOST', 'Chọn một host hợp lệ.');
    return db.transaction(() => {
      const session = requireSession(guildId, ticketId, ['REQUESTED', 'CONFIRMED']);
      requireOpenTicket(guildId, ticketId);
      const at = now();
      requireBooking(session.ends_at > at && session.customer_id !== hostId,
        'INVALID_HOST_ASSIGNMENT', 'Host và lịch đã chọn không phù hợp.');
      if (session.host_id === hostId) return session;
      requireBooking(!invoicesByTicket.get(ticketId), 'QUOTED_HOST', 'Không đổi host sau khi đã lập báo giá.');
      requireBooking(isSlotAvailable(session, hostId, session.starts_at, session.ends_at),
        'HOST_UNAVAILABLE', 'Host đã có lịch trùng giờ.');
      db.prepare(`UPDATE booking_sessions SET host_id = ?, status = 'CONFIRMED', updated_by_id = ?, updated_at = ?
        WHERE ticket_id = ?`).run(hostId, actorId, at, ticketId);
      return getSession(guildId, ticketId);
    }).immediate();
  }

  function isOrderForSession(order, session, amount) {
    return order?.guild_id === session.guild_id && order.ticket_id === session.ticket_id
      && order.ticket_channel_id === session.ticket_channel_id && order.customer_id === session.customer_id
      && order.total_amount === amount && order.payment_provider === 'PAYOS'
      && isInteger(order.payos_order_code, 1) && typeof order.order_code === 'string' && Boolean(order.order_code);
  }

  function bindNewPaymentOrder(guildId, invoiceId, session, amount, createPaymentOrder) {
    const previousId = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM orders').get().id;
    const created = createPaymentOrder({ guildId, customerId: session.customer_id, ticketId: session.ticket_id,
      ticketChannelId: session.ticket_channel_id, amount, invoiceId });
    const order = isInteger(created?.id, previousId + 1) ? orderById.get(created.id) : null;
    requireBooking(isOrderForSession(order, session, amount) && order.payment_status === 'UNPAID'
      && order.status === 'PENDING_PAYMENT' && order.amount_paid === 0 && !order.payment_link_id,
    'INVALID_PAYMENT_ORDER', 'Không tạo được đơn PayOS phù hợp cho báo giá.');
    db.prepare(`UPDATE booking_invoices SET order_id = ?, order_code = ?, provider_order_code = ? WHERE id = ?`)
      .run(order.id, order.order_code, order.payos_order_code, invoiceId);
  }

  function applyExtension(session, minutes, at, actorId) {
    db.prepare(`UPDATE booking_sessions SET duration_minutes = duration_minutes + ?, ends_at = ends_at + ?,
      updated_by_id = ?, updated_at = ? WHERE ticket_id = ?`)
      .run(minutes, minutes * MINUTE, actorId, at, session.ticket_id);
  }

  function issueInvoice({ guildId, ticketId, kind, durationMinutes, hourlyPrice, hourlyWage, actorId,
    requestKey = null, createPaymentOrder }) {
    requireActor(actorId);
    return db.transaction(() => {
      const extension = kind === 'EXTENSION';
      const session = getSession(guildId, ticketId);
      requireBooking(session, 'BOOKING_NOT_FOUND', 'Không tìm thấy phiếu booking.');
      const minutes = extension ? durationMinutes : session.requested_duration_minutes;
      const invoices = invoicesByTicket.all(ticketId);
      const previous = invoices.find(invoice => extension ? invoice.request_key === requestKey : invoice.kind === 'BASE');
      if (previous) {
        requireBooking(previous.minutes === minutes && previous.hourly_price === hourlyPrice && previous.hourly_wage === hourlyWage,
          'QUOTE_CONFLICT', 'Báo giá đã lưu có thông tin khác.');
        return previous;
      }
      requireBooking((extension ? ['CONFIRMED', 'ACTIVE'] : ['CONFIRMED']).includes(session.status),
        'INVALID_BOOKING_STATUS', 'Phiếu không ở trạng thái phù hợp.');
      requireOpenTicket(guildId, ticketId);
      const { amount, wage } = quoteFor(minutes, hourlyPrice, hourlyWage);
      const at = now();
      requireBooking(session.host_id && at < session.ends_at, 'EXPIRED_SLOT', 'Lịch không còn khả dụng để lập báo giá.');
      if (extension) {
        const base = invoices.find(invoice => invoice.kind === 'BASE');
        requireBooking(isSettled(base, session) && !invoices.some(invoice => invoice.status === 'PENDING'),
          'INVOICE_PENDING', 'Cần đối soát hóa đơn trước khi gia hạn.');
        requireBooking(session.duration_minutes + minutes <= MAX_MINUTES, 'INVALID_DURATION', 'Tổng phiên tối đa 1440 phút.');
        requireBooking(isSlotAvailable(session, session.host_id, session.started_at ?? session.starts_at, session.ends_at + minutes * MINUTE),
          'HOST_UNAVAILABLE', 'Host có lịch khác trong thời gian gia hạn.');
      }
      requireBooking(amount === 0 || typeof createPaymentOrder === 'function', 'PAYMENT_NOT_CONFIGURED',
        'Thanh toán booking chưa được cấu hình.');
      const { lastInsertRowid } = insertInvoice.run({ ticketId, kind, requestKey, hostId: session.host_id, minutes,
        hourlyPrice, hourlyWage, amount, wage, status: amount === 0 ? 'FREE' : 'PENDING', actorId, at });
      const id = Number(lastInsertRowid);
      if (amount > 0) bindNewPaymentOrder(guildId, id, session, amount, createPaymentOrder);
      else if (extension) applyExtension(session, minutes, at, actorId);
      return invoiceById.get(guildId, id);
    }).immediate();
  }

  function createInvoice(options) {
    return issueInvoice({ ...options, kind: 'BASE', requestKey: null });
  }

  function extendSession(options) {
    requireBooking(isId(options.requestKey), 'INVALID_REQUEST_KEY', 'Không xác định được yêu cầu gia hạn.');
    return issueInvoice({ ...options, kind: 'EXTENSION' });
  }

  function findReceipt(order, invoice, session) {
    if (!(isOrderForSession(order, session, invoice.amount) && order.order_code === invoice.order_code
      && order.payos_order_code === invoice.provider_order_code && order.payment_status === 'PAID'
      && Number.isSafeInteger(order.amount_paid) && order.amount_paid >= invoice.amount
      && order.payment_link_id && order.paid_transaction_id)) return null;

    const receipt = db.prepare(`SELECT id, amount, raw_payload FROM payment_events
      WHERE order_code = ? AND provider = 'PAYOS' AND transaction_id = ?`)
      .get(invoice.order_code, order.paid_transaction_id);
    if (!receipt || receipt.amount !== order.amount_paid
      || Number(getStoredPayOSReceivedAmount(receipt.raw_payload)) !== order.amount_paid) return null;
    const data = JSON.parse(receipt.raw_payload);
    return Number(data.orderCode) === invoice.provider_order_code
      && (data.paymentLinkId ?? data.id) === order.payment_link_id ? receipt : null;
  }

  function isSettled(invoice, session) {
    if (invoice?.status === 'FREE') return true;
    if (invoice?.status !== 'PAID') return false;
    const order = orderById.get(invoice.order_id);
    return SETTLED_ORDER_STATES.has(order?.status) && order.amount_paid === invoice.amount
      && findReceipt(order, invoice, session)?.id === invoice.payment_event_id;
  }

  // Only the canonical PAYOS receipt committed by the existing verification path is accepted.
  // An unverified or mismatched receipt leaves the invoice pending for a provider recheck.
  function syncInvoicePayment(guildId, invoiceId) {
    requireStore(guildId);
    return db.transaction(() => {
      const invoice = invoiceById.get(guildId, invoiceId);
      requireBooking(invoice, 'INVOICE_NOT_FOUND', 'Không tìm thấy hóa đơn booking.');
      if (invoice.status !== 'PENDING') return invoice;
      const session = getSession(guildId, invoice.ticket_id);
      const order = orderById.get(invoice.order_id);
      const receipt = findReceipt(order, invoice, session);
      if (!receipt) return invoice;
      const at = now();
      const extension = invoice.kind === 'EXTENSION';
      const ticketOpen = openTicket.get(session.ticket_id, guildId);
      const applicable = order.amount_paid === invoice.amount && SETTLED_ORDER_STATES.has(order.status) && ticketOpen
        && ['CONFIRMED', 'ACTIVE'].includes(session.status) && at < session.ends_at
        && (!extension || isSlotAvailable(session, session.host_id, session.started_at ?? session.starts_at,
          session.ends_at + invoice.minutes * MINUTE));
      db.prepare(`UPDATE booking_invoices SET status = ?, payment_event_id = ?, paid_at = ? WHERE id = ?`)
        .run(applicable ? 'PAID' : 'NEEDS_REVIEW', receipt.id, at, invoiceId);
      if (applicable && extension) applyExtension(session, invoice.minutes, at, invoice.created_by_id);
      return invoiceById.get(guildId, invoiceId);
    }).immediate();
  }

  function listInvoices(guildId, ticketId) {
    requireStore(guildId);
    return getSession(guildId, ticketId) ? invoicesByTicket.all(ticketId) : [];
  }

  function startSession({ guildId, ticketId, actorId }) {
    requireActor(actorId);
    return db.transaction(() => {
      const session = requireSession(guildId, ticketId, ['CONFIRMED', 'ACTIVE']);
      if (session.status === 'ACTIVE') return session;
      requireOpenTicket(guildId, ticketId);
      const invoices = invoicesByTicket.all(ticketId);
      const base = invoices.find(invoice => invoice.kind === 'BASE');
      requireBooking(isSettled(base, session), 'INVOICE_NOT_SETTLED', 'Phiên cần hóa đơn đã đối soát hoặc báo giá miễn phí.');
      const at = now();
      requireBooking(at >= session.starts_at && at < session.ends_at, 'OUTSIDE_BOOKING_WINDOW', 'Chưa đến giờ hoặc lịch đã hết hạn.');
      const pendingMinutes = invoices.find(invoice => invoice.kind === 'EXTENSION' && invoice.status === 'PENDING')?.minutes ?? 0;
      requireBooking(isSlotAvailable(session, session.host_id, at, session.ends_at + pendingMinutes * MINUTE),
        'HOST_UNAVAILABLE', 'Host đã có lịch khác sau phiên này.');
      db.prepare(`UPDATE booking_sessions SET status = 'ACTIVE', started_at = ?, updated_by_id = ?,
        updated_at = ? WHERE ticket_id = ?`).run(at, actorId, at, ticketId);
      return getSession(guildId, ticketId);
    }).immediate();
  }

  function completeSession({ guildId, ticketId, actorId, onlyIfDue = false }) {
    requireActor(actorId);
    return db.transaction(() => {
      const session = requireSession(guildId, ticketId, ['ACTIVE', 'COMPLETED', 'NEEDS_REVIEW']);
      if (session.status === 'COMPLETED') return session;
      const at = now();
      requireBooking(!onlyIfDue || at >= session.ends_at, 'SESSION_NOT_DUE', 'Phiên vẫn còn thời gian.');
      const applied = invoicesByTicket.all(ticketId).filter(invoice => ['PAID', 'FREE'].includes(invoice.status));
      requireBooking(applied.some(invoice => invoice.kind === 'BASE') && applied.every(invoice => isSettled(invoice, session)),
        'INVOICE_NOT_SETTLED', 'Cần đối soát thanh toán trước khi hoàn tất sổ lương.');
      db.prepare(`UPDATE booking_sessions SET status = 'COMPLETED', completed_at = ?, updated_by_id = ?,
        updated_at = ? WHERE ticket_id = ?`).run(at, actorId, at, ticketId);
      return getSession(guildId, ticketId);
    }).immediate();
  }

  function reviewExpiredSession({ guildId, ticketId, actorId }) {
    requireActor(actorId);
    return db.transaction(() => {
      const session = requireSession(guildId, ticketId, ['ACTIVE', 'NEEDS_REVIEW']);
      if (session.status === 'NEEDS_REVIEW') return session;
      const at = now();
      requireBooking(at >= session.ends_at, 'SESSION_NOT_DUE', 'Phiên vẫn còn thời gian.');
      db.prepare(`UPDATE booking_sessions SET status = 'NEEDS_REVIEW', updated_by_id = ?, updated_at = ? WHERE ticket_id = ?`)
        .run(actorId, at, ticketId);
      return getSession(guildId, ticketId);
    }).immediate();
  }

  function declineSession({ guildId, ticketId, actorId }) {
    requireActor(actorId);
    return db.transaction(() => {
      const session = requireSession(guildId, ticketId, ['REQUESTED', 'CONFIRMED', 'DECLINED']);
      if (session.status === 'DECLINED') return session;
      requireBooking(!invoicesByTicket.all(ticketId).some(invoice => invoice.amount > 0),
        'INVOICE_EXISTS', 'Đối soát hóa đơn với staff trước khi hủy lịch.');
      db.prepare(`UPDATE booking_sessions SET status = 'DECLINED', updated_by_id = ?, updated_at = ? WHERE ticket_id = ?`)
        .run(actorId, now(), ticketId);
      return getSession(guildId, ticketId);
    }).immediate();
  }

  function getWages(guildId, { hostId, from = 0, to = Number.MAX_SAFE_INTEGER } = {}) {
    requireStore(guildId);
    requireBooking(isInteger(from, 0) && isInteger(to, from + 1) && (hostId === undefined || isId(hostId)),
      'INVALID_PAYROLL_FILTER', 'Khoảng thời gian hoặc host không hợp lệ.');
    return db.prepare(`SELECT i.host_id, COUNT(DISTINCT s.ticket_id) AS sessions, SUM(i.minutes) AS minutes,
      SUM(i.amount) AS revenue, SUM(i.wage) AS wage
      FROM booking_invoices i JOIN booking_sessions s ON s.ticket_id = i.ticket_id
      LEFT JOIN orders o ON o.id = i.order_id
      LEFT JOIN payment_events p ON p.id = i.payment_event_id
      WHERE s.guild_id = @guildId AND s.status = 'COMPLETED' AND s.completed_at >= @from AND s.completed_at < @to
        AND (i.status = 'FREE' OR (i.status = 'PAID' AND o.status IN ('PROCESSING','COMPLETED')
          AND o.payment_status = 'PAID' AND o.payment_provider = 'PAYOS' AND o.guild_id = s.guild_id
          AND o.ticket_id = s.ticket_id AND o.ticket_channel_id = s.ticket_channel_id AND o.customer_id = s.customer_id
          AND o.order_code = i.order_code AND o.payos_order_code = i.provider_order_code
          AND o.total_amount = i.amount AND o.amount_paid = i.amount AND p.order_code = i.order_code
          AND p.provider = 'PAYOS' AND p.transaction_id = o.paid_transaction_id AND p.amount = i.amount))
        AND (@hostId IS NULL OR i.host_id = @hostId)
      GROUP BY i.host_id ORDER BY wage DESC, minutes DESC, i.host_id`)
      .all({ guildId, hostId: hostId ?? null, from, to });
  }

  function getPayrollReport(guildId, { from, to } = {}) {
    const hosts = getWages(guildId, { from, to });
    return { hosts, totals: hosts.reduce((totals, row) => ({
      sessions: totals.sessions + row.sessions, minutes: totals.minutes + row.minutes,
      revenue: totals.revenue + row.revenue, wage: totals.wage + row.wage,
    }), { sessions: 0, minutes: 0, revenue: 0, wage: 0 }) };
  }

  return { createSession, getSession, listSessions, assignHost, createInvoice, extendSession, syncInvoicePayment,
    listInvoices, startSession, completeSession, declineSession, reviewExpiredSession, getWages, getPayrollReport };
}
