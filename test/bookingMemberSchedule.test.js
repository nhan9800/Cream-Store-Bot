import { expect, it, vi } from 'vitest';
import { bookingMemberSchedule } from '../src/services/bookingMemberSchedule.js';
import { STORE_TWO_GUILD_ID as guildId } from '../src/utils/locale.js';

const viewer = '123456789012345678';
const other = '123456789012345679';
const ticket = '123456789012345680';
const room = '123456789012345681';
const now = 1_800_000_000_000;

it('prioritizes near sessions, displays canonical payment state and keeps the customer ticket private from hosts', () => {
  const base = { service: 'voice', status: 'CONFIRMED', duration_minutes: 30, ticket_channel_id: ticket };
  const farHold = { ...base, ticket_id: 1, customer_id: viewer, starts_at: now + 60_000, ends_at: now + 90_000 };
  const active = { ...base, ticket_id: 2, customer_id: other, host_id: viewer, status: 'ACTIVE', starts_at: now - 50_000, ends_at: now + 30_000 };
  const complete = { ...base, ticket_id: 3, customer_id: viewer, status: 'COMPLETED', starts_at: now - 150_000, ends_at: now - 50_000 };
  const ledger = { listSessions: vi.fn((_, scope) => scope.endsBy ? scope.customerId ? [complete] : []
    : scope.hostId ? [active] : [farHold]), listInvoices: vi.fn(() => [{ kind: 'BASE', id: 55 }]) };
  const receipts = { getForTicket: vi.fn(() => ({ status: 'EXPIRED', amount: 88_000 })) };
  const voice = { get: vi.fn(() => ({ room_id: room, released: 0 })) };
  const list = bookingMemberSchedule({ ledger, receipts, voice, guildId, userId: viewer, now });
  expect(list[0]).toContain('Đang diễn ra');
  expect(list[0]).toContain(`Phòng <#${room}>`);
  expect(list[0]).not.toContain(ticket);
  expect(list[1]).toContain('Đã hết hạn thanh toán');
  expect(list[1]).toContain(`Phiếu <#${ticket}>`);
  expect(list[1]).not.toContain('88000');
  expect(list[2]).toContain('Đã hoàn thành');
  expect(receipts.getForTicket).toHaveBeenCalledExactlyOnceWith({ guildId, ticketId: farHold.ticket_id, viewerId: viewer, invoiceId: 55 });
});
