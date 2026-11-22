import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORE_TWO_GUILD_ID } from '../src/utils/locale.js';

const mocks = vi.hoisted(() => ({
  open: vi.fn(), reply: vi.fn(), ticket: vi.fn(), config: vi.fn(),
  portal: { request: 'request', apply: 'apply', tickets: 'private-category', emoji: {} },
}));
vi.mock('../src/services/bookingStoreSetupService.js', () => ({
  BOOKING_APP_ID: '1139187282075721768', bookingPortal: () => mocks.portal,
}));
vi.mock('../src/services/guildConfigService.js', () => ({ getGuildConfig: mocks.config }));
vi.mock('../src/services/ticketService.js', () => ({ getTicketByChannelId: mocks.ticket }));
vi.mock('../src/events/shared.js', () => ({ safeReply: mocks.reply }));
vi.mock('../src/events/ticketHandlers.js', () => ({ handleTicketCreate: mocks.open }));

import { bookingForm, handleBookingInteraction, parseBookingTime } from '../src/events/bookingHandlers.js';

function interaction(customId, { channel = 'request', guildId = STORE_TWO_GUILD_ID, fields = {} } = {}) {
  return {
    customId, guildId, channelId: channel, client: { user: { id: '1139187282075721768' } },
    user: { id: 'member' }, isButton: () => !customId.includes(':form:'),
    isModalSubmit: () => customId.includes(':form:'), fields: { getTextInputValue: key => fields[key] ?? '' },
    deferReply: vi.fn(async () => {}), showModal: vi.fn(async () => {}),
  };
}

describe('Cenar Booking intake and private ticket controls', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.setSystemTime(new Date('2026-11-22T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('converts Vietnam time exactly and rejects invalid or past slots', () => {
    expect(parseBookingTime('23/11/2026 20:30')).toBe(Date.parse('2026-11-23T13:30:00Z') / 1000);
    expect(parseBookingTime('21/11/2026 20:30')).toBeNull();
    expect(parseBookingTime('31/11/2026 20:30')).toBeNull();
    expect(parseBookingTime('23/11/2026 25:30')).toBeNull();
  });

  it('offers distinct game, voice and opt-in host application forms', async () => {
    const game = interaction('booking:open:game');
    const voice = interaction('booking:open:voice');
    await handleBookingInteraction(game);
    await handleBookingInteraction(voice);
    expect(game.showModal.mock.lastCall[0].toJSON().custom_id).toBe('booking:form:game');
    expect(voice.showModal.mock.lastCall[0].toJSON().custom_id).toBe('booking:form:voice');
    expect(bookingForm('apply').toJSON().components[1].components[0].required).toBe(false);
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('routes valid dates to a dedicated private ticket with a Vietnamese summary', async () => {
    const submitted = interaction('booking:form:game', {
      fields: { host: '', start: '23/11/2026 20:30', duration: '60', details: '**Valorant**' },
    });
    await handleBookingInteraction(submitted);
    expect(submitted.deferReply).toHaveBeenCalledWith({ flags: 64 });
    expect(mocks.open).toHaveBeenCalledWith(submitted, 'BOOKING', null, { booking: expect.objectContaining({ categoryId: 'private-category' }) });
    const data = mocks.open.mock.lastCall[3].booking.render({ id: 19, ticket_code: 'TKT_001' }).container.toJSON();
    expect(data.components.find(component => component.content?.includes('Thời lượng')).content).toContain('**Thời lượng** · 60 phút');
    expect(data.components.find(component => component.type === 1).components[0].custom_id).toBe('booking:state:confirm:19');
  });

  it('blocks wrong guild or channel and invalid form data without opening a ticket', async () => {
    const wrongGuild = interaction('booking:open:game', { guildId: 'other' });
    const wrongChannel = interaction('booking:open:apply');
    const invalid = interaction('booking:form:voice', { fields: { start: '23/11/2026 20:30', duration: '1.5' } });
    await handleBookingInteraction(wrongGuild);
    await handleBookingInteraction(wrongChannel);
    await handleBookingInteraction(invalid);
    expect(wrongGuild.showModal).not.toHaveBeenCalled();
    expect(wrongChannel.showModal).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('blocks nonstaff, then confirms a valid booking once and exposes the completion control', async () => {
    const ownerId = '1139187282075721768';
    const opened = { guild_id: STORE_TWO_GUILD_ID, status: 'OPEN', ticket_type: 'BOOKING', id: 19 };
    mocks.ticket.mockReturnValue(opened);
    mocks.config.mockReturnValue({ support_role_id: 'staff' });
    const update = interaction('booking:state:confirm:19', { channel: 'private' });
    const msg = {
      id: 'message', author: { id: ownerId }, edit: vi.fn(async (payload) => {
        msg.components = payload.components.map(row => ({ toJSON: () => structuredClone(row) }));
      }),
      components: [{ toJSON: () => structuredClone({ type: 17, components: [
        { type: 10, content: '### Trạng thái\nChờ xác nhận' },
        { type: 1, components: [{ type: 2, custom_id: 'booking:state:confirm:19' }] },
      ] }) }],
    };
    update.guild = { members: { fetch: vi.fn().mockResolvedValue({
      permissions: { has: () => false }, roles: { cache: new Map() },
    }) } };
    update.channel = { messages: { fetch: vi.fn().mockResolvedValue(msg) } };
    update.message = msg;
    await handleBookingInteraction(update);
    expect(msg.edit).not.toHaveBeenCalled();
    update.guild.members.fetch.mockResolvedValue({
      permissions: { has: () => false }, roles: { cache: new Map([['staff', true]]) },
    });
    await handleBookingInteraction(update);
    await handleBookingInteraction(update);
    expect(msg.edit).toHaveBeenCalledTimes(1);
    const card = msg.components[0].toJSON();
    expect(card.components[0].content).toBe('### Trạng thái\nĐã xác nhận lịch');
    expect(card.components[1].components.map(button => button.custom_id)).toEqual([
      'booking:state:complete:19', 'booking:state:decline:19',
    ]);
  });
});
