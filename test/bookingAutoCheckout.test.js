import { beforeEach, expect, it, vi } from 'vitest';
import { BOOKING_PANEL_IDS } from '../src/utils/bookingPortalViews.js';
import { STORE_TWO_GUILD_ID } from '../src/utils/locale.js';

const mocks = vi.hoisted(() => ({ create: vi.fn(), reply: vi.fn(), open: vi.fn(), ticket: vi.fn(), paid: vi.fn(), qr: vi.fn() }));
vi.mock('../src/services/ticketService.js', () => ({ getOpenTicketByCustomer: mocks.open, getTicketByChannelId: mocks.ticket }));
vi.mock('../src/events/ticketHandlers.js', () => ({ handleTicketCreate: mocks.create }));
vi.mock('../src/events/shared.js', () => ({ safeReply: mocks.reply }));
vi.mock('../src/services/paymentService.js', () => ({ sendOrRefreshPaymentQr: mocks.qr }));
vi.mock('../src/services/bookingPaymentService.js', () => ({ bookingPayosAvailable: mocks.paid, createBookingPaymentOrder: () => vi.fn() }));

import { handleBookingAutoCheckout } from '../src/events/bookingAutoCheckout.js';

const owner = '123456789012345678';
const bot = '1139187282075721768';
const portal = { request: 'request', tickets: 'private', emoji: {} };
const slot = { id: 7, hostName: 'Host thử', service: 'voice', startsAt: 1_800_000_000_000, durationMinutes: 30, amount: 0 };

function press(customId, { channelId = portal.request, userId = owner, select = false } = {}) {
  return { customId, guildId: STORE_TWO_GUILD_ID, channelId, id: '123456789012345688',
    client: { user: { id: bot } }, user: { id: userId }, message: { author: { id: bot }, flags: new Set([64]),
      components: [{ id: BOOKING_PANEL_IDS.request }] },
    isButton: () => !select, isStringSelectMenu: () => select, values: ['7'],
    reply: vi.fn(), deferReply: vi.fn(), editReply: vi.fn(),
  };
}

beforeEach(() => { vi.resetAllMocks(); mocks.paid.mockReturnValue(false); });

it('opens a private owned selector from the current bot panel without reserving a slot', async () => {
  const service = { listSlots: vi.fn(() => [slot]) };
  const launch = press('booking:dashboard:auto');
  await handleBookingAutoCheckout(launch, portal, { createService: () => service });
  expect(service.listSlots).toHaveBeenCalledWith({ guildId: STORE_TWO_GUILD_ID, customerId: owner, paymentAvailable: false, limit: 20 });
  const payload = launch.reply.mock.lastCall[0];
  expect(payload.flags & 64).toBeTruthy();
  expect(JSON.stringify(payload.components[0].toJSON())).toContain(`booking:auto:select:${owner}`);
  await handleBookingAutoCheckout(press(`booking:auto:confirm:${owner}:7`, { userId: '123456789012345679' }), portal,
    { createService: () => { throw new Error('unauthorized control reached database'); } });
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.reply).toHaveBeenCalledOnce();
});

it('reserves only after the owner confirms and sends no QR for a free slot', async () => {
  const service = { quoteSlot: vi.fn(() => slot), reserveSlot: vi.fn(() => ({ slot, invoice: { status: 'FREE' } })) };
  const selection = press(`booking:auto:select:${owner}`, { select: true });
  await handleBookingAutoCheckout(selection, portal, { createService: () => service });
  expect(JSON.stringify(selection.reply.mock.lastCall[0].components[0].toJSON())).toContain('Xác nhận giữ chỗ');
  expect(service.reserveSlot).not.toHaveBeenCalled();
  const confirmation = press(`booking:auto:confirm:${owner}:7`);
  mocks.create.mockImplementation(async (_interaction, _type, _email, options) => {
    const card = options.booking.render({ id: 22, ticket_code: 'TKT_0022' }).container.toJSON();
    expect(JSON.stringify(card)).toContain('Ca đã xác nhận');
  });
  await handleBookingAutoCheckout(confirmation, portal, { createService: () => service });
  expect(service.reserveSlot).toHaveBeenCalledWith(expect.objectContaining({ slotId: 7, ticketId: 22, customerId: owner,
    requestId: confirmation.id, paymentAvailable: false }));
  expect(mocks.qr).not.toHaveBeenCalled();
});
