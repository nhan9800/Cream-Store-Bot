import { STORE_TWO_GUILD_ID } from '../utils/locale.js';
import { BookingLedgerError, createBookingLedger, quoteBookingRates } from './bookingLedgerService.js';
import { canRequestHostService, createBookingProfileService } from './bookingProfileService.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MANAGER_PAGE_SIZE = 8;
export const BOOKING_AUTO_PAYMENT_HOLD_MS = 15 * MINUTE;
const SERVICES = new Set(['game', 'voice']);
const SNOWFLAKE = /^\d{17,20}$/;
const validId = value => typeof value === 'string' && SNOWFLAKE.test(value);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;

function requireValue(condition, code, message) {
  if (!condition) throw new BookingLedgerError(code, message);
}

function requireStore(guildId) {
  requireValue(guildId === STORE_TWO_GUILD_ID, 'WRONG_STORE', 'Chức năng này chỉ dùng trong Cenar Booking.');
}

function validateCustomer(customerId) {
  requireValue(validId(customerId), 'INVALID_ACTOR', 'Không xác định được người đặt lịch.');
}

function toPublicSlot(row, hostName) {
  return {
    id: row.id, hostId: row.host_id, hostName, service: row.service, startsAt: row.starts_at,
    durationMinutes: row.duration_minutes, hourlyPrice: row.hourly_price,
    amount: quoteBookingRates(row.duration_minutes, row.hourly_price, row.hourly_wage).amount,
  };
}

export function createBookingSelfService(db, { now = Date.now, ledger = createBookingLedger(db, { now }) } = {}) {
  const profiles = createBookingProfileService(db);
  const findSlot = db.prepare('SELECT * FROM booking_auto_slots WHERE guild_id = ? AND id = ?');
  const listOpenSlots = db.prepare(`SELECT * FROM booking_auto_slots WHERE guild_id = @guildId AND closed_at IS NULL
    AND starts_at > @earliestFree AND (hourly_price = 0 OR (@paymentAvailable = 1 AND starts_at >= @earliestPaid))
    AND (@hostId IS NULL OR host_id = @hostId) AND (@service IS NULL OR service = @service)
    ORDER BY starts_at, id`);
  const managerRange = `FROM booking_auto_slots WHERE guild_id = @guildId AND starts_at >= @fromAt
    AND starts_at < @untilAt AND (@hostId IS NULL OR host_id = @hostId)`;
  const countManagerSlots = db.prepare(`SELECT COUNT(*) AS total ${managerRange}`);
  const managerSlots = db.prepare(`SELECT * ${managerRange} ORDER BY starts_at, id LIMIT @limit OFFSET @offset`);
  const currentReservations = db.prepare(`SELECT s.status AS session_status, b.status AS invoice_status, r.checkout_expires_at
    FROM booking_auto_reservations r JOIN booking_sessions s ON s.ticket_id = r.ticket_id
    JOIN booking_invoices b ON b.ticket_id = s.ticket_id AND b.kind = 'BASE' AND b.host_id = s.host_id
    JOIN tickets t ON t.id = s.ticket_id AND t.guild_id = s.guild_id AND t.customer_id = s.customer_id
      AND t.channel_id = s.ticket_channel_id AND t.ticket_type = 'BOOKING'
    WHERE r.slot_id = @slotId AND s.guild_id = @guildId AND s.host_id = @hostId
      AND (s.status IN ('ACTIVE', 'COMPLETED') OR (s.status = 'CONFIRMED' AND t.status = 'OPEN'))
      AND (b.status IN ('FREE', 'PAID') OR (b.status = 'PENDING' AND r.checkout_expires_at > @at))
    ORDER BY CASE WHEN b.status IN ('FREE', 'PAID') THEN 0 ELSE 1 END, r.checkout_expires_at DESC
    LIMIT 1`);
  const insertSlot = db.prepare(`INSERT INTO booking_auto_slots
    (guild_id,host_id,service,starts_at,duration_minutes,hourly_price,hourly_wage,created_by_id,created_at)
    VALUES (@guildId,@hostId,@service,@startsAt,@durationMinutes,@hourlyPrice,@hourlyWage,@actorId,@at)
    ON CONFLICT(guild_id,host_id,service,starts_at,duration_minutes) WHERE closed_at IS NULL DO NOTHING`);
  const closeOpenSlot = db.prepare(`UPDATE booking_auto_slots SET closed_at = ?, closed_by_id = ?
    WHERE guild_id = ? AND id = ? AND closed_at IS NULL`);
  const owningTicket = db.prepare(`SELECT 1 FROM tickets WHERE guild_id = ? AND id = ? AND customer_id = ?
    AND ticket_type = 'BOOKING' AND status = 'OPEN'`);
  const findTicketReservation = db.prepare('SELECT * FROM booking_auto_reservations WHERE ticket_id = ?');
  const findRequest = db.prepare('SELECT * FROM booking_auto_reservations WHERE request_id = ?');
  const insertReservation = db.prepare(`INSERT INTO booking_auto_reservations
    (ticket_id,slot_id,request_id,checkout_expires_at,reserved_at) VALUES (?,?,?,?,?)`);

  function publishedProfile(hostId, service) {
    const profile = profiles.get(hostId);
    return profile?.profile_number && profile.forum_thread_id && profile.approved?.consent === true
      && canRequestHostService(profile, service) ? profile : null;
  }

  function available(guildId, row, customerId) {
    return ledger.isReservationSlotAvailable({ guildId, hostId: row.host_id, customerId,
      startsAt: row.starts_at, endsAt: row.starts_at + row.duration_minutes * MINUTE });
  }

  function managerState(row, profile, paymentAvailable, at) {
    const reservation = currentReservations.get({ slotId: row.id, guildId: row.guild_id, hostId: row.host_id, at });
    if (reservation?.invoice_status === 'PENDING') return { state: 'HELD', holdUntil: reservation.checkout_expires_at };
    if (reservation) return { state: 'BOOKED', sessionStatus: reservation.session_status };
    if (row.closed_at !== null) return { state: 'CLOSED' };
    if (row.starts_at <= at) return { state: 'PAST' };
    if (!profile) return { state: 'HOST_HIDDEN' };
    if (row.hourly_price > 0 && !paymentAvailable) return { state: 'PAYMENT_OFF' };
    if (row.starts_at <= at + MINUTE || (row.hourly_price > 0 && row.starts_at < at + BOOKING_AUTO_PAYMENT_HOLD_MS)) {
      return { state: 'TOO_SOON' };
    }
    return { state: available(row.guild_id, row, null) ? 'AVAILABLE' : 'OCCUPIED' };
  }

  const readManagerSchedule = db.transaction(({ guildId, hostId, fromAt, untilAt, page, paymentAvailable }) => {
    const filter = { guildId, hostId: hostId ?? null, fromAt, untilAt };
    const { total } = countManagerSlots.get(filter);
    const pageCount = Math.max(1, Math.ceil(total / MANAGER_PAGE_SIZE));
    const currentPage = Math.min(page, pageCount);
    const at = now();
    const slots = managerSlots.all({ ...filter, limit: MANAGER_PAGE_SIZE, offset: (currentPage - 1) * MANAGER_PAGE_SIZE })
      .map(row => {
        const profile = publishedProfile(row.host_id, row.service);
        return { id: row.id, hostName: profile?.approved.name ?? null, service: row.service, startsAt: row.starts_at,
          durationMinutes: row.duration_minutes, hourlyPrice: row.hourly_price,
          amount: quoteBookingRates(row.duration_minutes, row.hourly_price, row.hourly_wage).amount, closedAt: row.closed_at,
          ...managerState(row, profile, paymentAvailable, at) };
      });
    return { slots, page: currentPage, pageCount, total, fromAt, untilAt };
  });

  function listManagerSlots({ guildId, hostId, fromAt, untilAt, page = 1, paymentAvailable = false }) {
    requireStore(guildId);
    requireValue((hostId === undefined || validId(hostId)) && positiveInteger(fromAt) && positiveInteger(untilAt)
      && untilAt > fromAt && untilAt - fromAt <= 7 * DAY && positiveInteger(page), 'INVALID_FILTER', 'Bộ lọc lịch ca không hợp lệ.');
    return readManagerSchedule({ guildId, hostId, fromAt, untilAt, page, paymentAvailable: paymentAvailable === true });
  }

  function eligibleSlot({ guildId, slotId, customerId, paymentAvailable, at }) {
    const row = findSlot.get(guildId, slotId);
    const profile = row?.closed_at == null && row && publishedProfile(row.host_id, row.service);
    requireValue(profile && row.host_id !== customerId && row.starts_at > at + MINUTE,
      'BOOKING_AUTO_SLOT_UNAVAILABLE', 'Khung giờ này không còn nhận đặt tự động. Hãy chọn giờ khác.');
    if (row.hourly_price > 0) {
      requireValue(paymentAvailable === true, 'BOOKING_PAYMENTS_DISABLED', 'Thanh toán tự động của Booking chưa sẵn sàng.');
      requireValue(row.starts_at >= at + BOOKING_AUTO_PAYMENT_HOLD_MS, 'BOOKING_AUTO_SLOT_UNAVAILABLE',
        'Khung giờ này sắp bắt đầu. Hãy chọn giờ khác.');
    }
    requireValue(available(guildId, row, customerId), 'BOOKING_AUTO_SLOT_BUSY',
      'Host hoặc bạn đã có lịch trùng khung giờ. Hãy chọn giờ khác.');
    return { row, profile };
  }

  const addSlotTransaction = db.transaction(input => {
    const profile = publishedProfile(input.hostId, input.service);
    requireValue(profile, 'BOOKING_AUTO_HOST_NOT_PUBLISHED', 'Host cần có hồ sơ công khai đã duyệt cho dịch vụ này.');
    const result = insertSlot.run(input);
    requireValue(result.changes === 1, 'BOOKING_AUTO_SLOT_EXISTS', 'Khung giờ này đã được mở.');
    return toPublicSlot(findSlot.get(input.guildId, result.lastInsertRowid), profile.approved.name);
  });

  function addSlot({ guildId, hostId, service, startsAt, durationMinutes, hourlyPrice, hourlyWage, actorId }) {
    requireStore(guildId);
    const at = now();
    requireValue(validId(hostId) && validId(actorId) && SERVICES.has(service) && Number.isSafeInteger(startsAt)
      && startsAt > at + MINUTE && startsAt <= 8_640_000_000_000_000 - 1440 * MINUTE,
    'BOOKING_AUTO_INVALID_SLOT', 'Chọn host, dịch vụ và giờ bắt đầu hợp lệ trong tương lai.');
    quoteBookingRates(durationMinutes, hourlyPrice, hourlyWage);
    return addSlotTransaction.immediate({ guildId, hostId, service, startsAt, durationMinutes, hourlyPrice, hourlyWage, actorId, at });
  }

  function closeSlot({ guildId, slotId, actorId }) {
    requireStore(guildId);
    requireValue(positiveInteger(slotId) && validId(actorId), 'BOOKING_AUTO_INVALID_SLOT', 'Mã khung giờ không hợp lệ.');
    return closeOpenSlot.run(now(), actorId, guildId, slotId).changes === 1;
  }

  function listSlots({ guildId, customerId, hostId, service, paymentAvailable = false, limit = 20 }) {
    requireStore(guildId);
    validateCustomer(customerId);
    requireValue((hostId === undefined || validId(hostId)) && (service === undefined || SERVICES.has(service))
      && positiveInteger(limit) && limit <= 25, 'INVALID_FILTER', 'Bộ lọc khung giờ không hợp lệ.');
    const at = now();
    const slots = [];
    for (const row of listOpenSlots.iterate({ guildId, hostId: hostId ?? null, service: service ?? null,
      earliestFree: at + MINUTE, earliestPaid: at + BOOKING_AUTO_PAYMENT_HOLD_MS, paymentAvailable: Number(paymentAvailable === true) })) {
      if (row.host_id === customerId) continue;
      const profile = publishedProfile(row.host_id, row.service);
      if (!profile || !available(guildId, row, customerId)) continue;
      slots.push(toPublicSlot(row, profile.approved.name));
      if (slots.length === limit) break;
    }
    return slots;
  }

  function quoteSlot({ guildId, slotId, customerId, paymentAvailable = false }) {
    requireStore(guildId);
    validateCustomer(customerId);
    requireValue(positiveInteger(slotId), 'BOOKING_AUTO_INVALID_SLOT', 'Mã khung giờ không hợp lệ.');
    const { row, profile } = eligibleSlot({ guildId, slotId, customerId, paymentAvailable, at: now() });
    return toPublicSlot(row, profile.approved.name);
  }

  function getReservation({ guildId, ticketId, customerId }) {
    requireStore(guildId);
    validateCustomer(customerId);
    requireValue(positiveInteger(ticketId), 'BOOKING_AUTO_INVALID_TICKET', 'Mã phiếu không hợp lệ.');
    const session = ledger.getSession(guildId, ticketId);
    if (session?.customer_id !== customerId) return null;
    const reservation = findTicketReservation.get(ticketId);
    if (!reservation) return null;
    const row = findSlot.get(guildId, reservation.slot_id);
    const invoice = ledger.listInvoices(guildId, ticketId).find(item => item.kind === 'BASE');
    if (!row || !invoice) return null;
    const slot = toPublicSlot(row, publishedProfile(row.host_id, row.service)?.approved.name ?? null);
    return { session, invoice, slot, checkoutExpiresAt: reservation.checkout_expires_at, replayed: true };
  }

  const reserveTransaction = db.transaction(({ guildId, slotId, ticketId, customerId, requestId, paymentAvailable, createPaymentOrder }) => {
    const previous = findRequest.get(requestId);
    if (previous) {
      const result = previous.ticket_id === ticketId && previous.slot_id === slotId && getReservation({ guildId, ticketId, customerId });
      requireValue(result, 'BOOKING_AUTO_REPLAY_CONFLICT', 'Yêu cầu này đã gắn với phiếu đặt lịch khác.');
      return result;
    }
    requireValue(owningTicket.get(guildId, ticketId, customerId), 'BOOKING_AUTO_INVALID_TICKET', 'Phiếu đặt lịch riêng không còn khả dụng.');
    requireValue(!ledger.getSession(guildId, ticketId), 'BOOKING_EXISTS', 'Phiếu này đã có lịch. Xem Lịch của bạn để theo dõi.');
    const at = now();
    const { row } = eligibleSlot({ guildId, slotId, customerId, paymentAvailable, at });
    const checkoutExpiresAt = row.hourly_price > 0 ? at + BOOKING_AUTO_PAYMENT_HOLD_MS : null;
    requireValue(checkoutExpiresAt == null || typeof createPaymentOrder === 'function', 'BOOKING_PAYMENTS_DISABLED',
      'Thanh toán tự động của Booking chưa sẵn sàng.');
    ledger.createSession({ guildId, ticketId, service: row.service, startsAt: row.starts_at, durationMinutes: row.duration_minutes });
    ledger.assignHost({ guildId, ticketId, hostId: row.host_id, actorId: customerId });
    ledger.createInvoice({ guildId, ticketId, hourlyPrice: row.hourly_price, hourlyWage: row.hourly_wage,
      actorId: customerId, createPaymentOrder });
    insertReservation.run(ticketId, slotId, requestId, checkoutExpiresAt, at);
    return { ...getReservation({ guildId, ticketId, customerId }), replayed: false };
  });

  function reserveSlot(options) {
    requireStore(options.guildId);
    validateCustomer(options.customerId);
    requireValue(positiveInteger(options.slotId) && positiveInteger(options.ticketId) && validId(options.requestId),
      'BOOKING_AUTO_INVALID_SLOT', 'Khung giờ hoặc yêu cầu đặt lịch không hợp lệ.');
    return reserveTransaction.immediate(options);
  }

  return { addSlot, closeSlot, listSlots, listManagerSlots, quoteSlot, reserveSlot, getReservation };
}
