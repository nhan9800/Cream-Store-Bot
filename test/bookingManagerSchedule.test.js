import { beforeEach, expect, it, vi } from 'vitest';
import { STORE_ONE_GUILD_ID, STORE_TWO_GUILD_ID } from '../src/utils/locale.js';
import { bookingManagerScheduleView, bookingManagerSlotRange } from '../src/utils/bookingManagerScheduleView.js';

const mocks = vi.hoisted(() => ({ read: vi.fn(), parse: vi.fn(), payos: vi.fn() }));
vi.mock('../src/database/db.js', () => ({ db: {} }));
vi.mock('../src/services/bookingLedgerService.js', () => ({ createBookingLedger: () => ({}) }));
vi.mock('../src/services/bookingSelfService.js', () => ({ createBookingSelfService: () => ({ listManagerSlots: mocks.read }) }));
vi.mock('../src/services/bookingStoreSetupService.js', () => ({ BOOKING_APP_ID: 'booking-bot', bookingPortal: () => ({ emoji: {} }) }));
vi.mock('../src/services/guildConfigService.js', () => ({ getGuildConfig: () => ({ manager_role_id: 'manager', support_role_id: 'support' }) }));
vi.mock('../src/services/ticketService.js', () => ({ getTicketByChannelId: vi.fn() }));
vi.mock('../src/services/bookingPaymentService.js', () => ({ bookingPayosAvailable: mocks.payos }));
vi.mock('../src/events/bookingHandlers.js', () => ({ parseBookingTime: mocks.parse }));

import { execute } from '../src/commands/cenar-booking.js';

const fromAt = Date.parse('2026-11-23T17:00:00Z');
const untilAt = Date.parse('2026-11-24T17:00:00Z');

function interaction({ role = 'manager', guildId = STORE_TWO_GUILD_ID } = {}) {
  return { guildId, client: { user: { id: 'booking-bot' } }, user: { id: 'staff' },
    guild: { members: { fetch: vi.fn(async () => ({ permissions: { has: () => false }, roles: { cache: new Set([role]) } })) } },
    options: { getSubcommand: () => 'quan-ly-ca', getString: () => '24/11/2026', getUser: () => ({ id: 'selected-host' }),
      getInteger: () => 2 }, reply: vi.fn(), deferReply: vi.fn(), editReply: vi.fn() };
}

beforeEach(() => vi.resetAllMocks());

it('reads the relevant date and payment readiness only after private manager authorization', async () => {
  const denied = interaction({ role: 'support' });
  await execute(denied);
  expect(denied.deferReply).toHaveBeenCalledWith({ flags: 64 });
  expect(denied.editReply).toHaveBeenCalledWith(expect.stringContaining('Chỉ quản lý'));
  const wrongGuild = interaction({ guildId: STORE_ONE_GUILD_ID });
  await execute(wrongGuild);
  expect(wrongGuild.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: 64 }));
  expect(mocks.read).not.toHaveBeenCalled();

  mocks.read.mockReturnValue({ slots: [], page: 1, pageCount: 1, total: 0, fromAt, untilAt });
  mocks.parse.mockReturnValue(fromAt / 1000);
  mocks.payos.mockReturnValue(false);
  const manager = interaction();
  await execute(manager);
  expect(mocks.parse).toHaveBeenCalledWith('24/11/2026 00:00', 0);
  expect(mocks.read).toHaveBeenCalledWith({ guildId: STORE_TWO_GUILD_ID, fromAt, untilAt, hostId: 'selected-host', page: 2,
    paymentAvailable: false });
  expect(manager.deferReply).toHaveBeenCalledWith({ flags: 64 });
  expect(JSON.stringify(manager.editReply.mock.lastCall[0].components[0].toJSON())).toContain('Chưa có ca');
});

it('renders Vietnam time, booking state and the close shortcut in a narrow stacked card', () => {
  expect(bookingManagerSlotRange(null, fromAt + 1)).toMatchObject({ fromAt, untilAt: fromAt + 7 * 86_400_000 });
  const payload = bookingManagerScheduleView({ page: 1, pageCount: 2, total: 9, fromAt, untilAt,
    slots: [{ id: 41, hostName: '**Tú**', service: 'game', startsAt: fromAt + 2 * 3_600_000,
      durationMinutes: 30, hourlyPrice: 100_000, amount: 50_000, state: 'HELD',
      holdUntil: fromAt + 3_600_000, closedAt: fromAt }],
  });
  const content = payload.components[0].toJSON().components.filter(item => item.content).map(item => item.content).join('\n');
  expect(content).toContain('#41');
  expect(content).toContain('Trang 1/2');
  expect(content).toContain('02:00');
  expect(content).toContain('Đang giữ chỗ đến 01:00 · Đã đóng nhận mới');
  expect(content).toContain('100.000 VND/giờ · Tổng 50.000 VND');
  expect(content).toContain('/cenar-booking dong-ca');
  expect(payload.allowedMentions).toEqual({ parse: [] });
});
