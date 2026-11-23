import Database from 'better-sqlite3';
import { ChannelType, Collection } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBookingVoiceStore, createBookingVoiceTick } from '../src/services/bookingVoiceService.js';
import { STORE_ONE_GUILD_ID, STORE_TWO_GUILD_ID } from '../src/utils/locale.js';

const start = 1_900_000_000_000;
const ninety = 90 * 60_000;
let db;

function fixture() {
  db = new Database(':memory:');
  const voiceStore = createBookingVoiceStore(db);
  let time = start;
  const session = { ticket_id: 1, host_id: 'host', customer_id: 'customer', ticket_channel_id: 'ticket',
    starts_at: start, ends_at: start + ninety, duration_minutes: 90, status: 'CONFIRMED' };
  let invoice = { kind: 'BASE', status: 'FREE' };
  const ledger = {
    listSessions: vi.fn((guildId, { status, dueBefore }) => session.status === status && session.starts_at <= dueBefore ? [session] : []),
    claimUpcomingHostStart: vi.fn(() => null),
    getSession: vi.fn(() => session), listInvoices: vi.fn(() => [invoice]), syncInvoicePayment: vi.fn(),
    startSession: vi.fn(() => { session.status = 'ACTIVE'; return session; }),
    completeSession: vi.fn(() => { session.status = 'COMPLETED'; return session; }),
    reviewExpiredSession: vi.fn(() => { session.status = 'NEEDS_REVIEW'; return session; }),
  };
  const guest = { id: 'customer', voice: { channelId: 'room', disconnect: vi.fn() } };
  const room = { name: 'cenar-phien-1', id: 'room', guildId: STORE_TWO_GUILD_ID, parentId: 'category',
    type: ChannelType.GuildVoice, members: new Collection([[guest.id, guest]]), delete: vi.fn() };
  const ticket = { type: ChannelType.GuildText, guildId: STORE_TWO_GUILD_ID, send: vi.fn() };
  const host = { send: vi.fn(async () => {}) };
  const snapshots = new Collection();
  const guild = { id: STORE_TWO_GUILD_ID, client: { user: { id: 'bot' } },
    members: { me: { permissions: { has: () => true } }, fetch: vi.fn(async () => host) }, channels: {
      fetch: vi.fn(id => Promise.resolve(id === 'ticket' ? ticket : id === 'room' ? room : snapshots)), create: vi.fn(() => room),
    } };
  const error = vi.fn();
  const getTick = () => createBookingVoiceTick({ db, ledger, now: () => time, onError: error });
  const tick = getTick();
  return { guild, getTick, tick: () => tick(guild, 'category'), setTime: value => { time = value; },
    setInvoice: value => { invoice = value; }, ticket, host, room, guest, voiceStore, ledger, session, error };
}

afterEach(() => db?.close());

describe('Cenar Booking private voice', () => {
  it('sends the upcoming reminder privately, before any room or ticket announcement', async () => {
    const f = fixture();
    const reminderAt = start - 15 * 60_000;
    f.setTime(reminderAt);
    f.ledger.claimUpcomingHostStart.mockReturnValueOnce({ hostId: 'host', startsAt: start });
    await f.tick();
    const restarted = f.getTick();
    await restarted(f.guild, 'category');
    expect(f.ledger.claimUpcomingHostStart).toHaveBeenCalledWith(STORE_TWO_GUILD_ID, { after: reminderAt, through: start });
    expect(f.guild.members.fetch.mock.calls).toEqual([[{ user: 'host', force: true }]]);
    expect(f.host.send).toHaveBeenCalledOnce();
    const reminder = f.host.send.mock.lastCall[0];
    expect(reminder.allowedMentions).toEqual({ parse: [] });
    expect(reminder.components[0].toJSON().components[0].content).toContain(`<t:${Math.floor(start / 1000)}:f>`);
    expect(f.ticket.send).not.toHaveBeenCalled();
    expect(f.guild.channels.create).not.toHaveBeenCalled();
    expect(f.ledger.startSession).not.toHaveBeenCalled();
  });

  it('caps private pre-start sends within one pass', async () => {
    const f = fixture();
    f.setTime(start - 10 * 60_000);
    let claim = 0;
    f.ledger.claimUpcomingHostStart.mockImplementation(() => ({ hostId: `host-${++claim}`, startsAt: start }));
    await f.tick();
    expect(f.ledger.claimUpcomingHostStart).toHaveBeenCalledTimes(5);
    expect(f.host.send).toHaveBeenCalledTimes(5);
    expect(f.ticket.send).not.toHaveBeenCalled();
  });

  it('reports a blocked DM without repeating the same reminder or falling back to a channel', async () => {
    const f = fixture();
    f.setTime(start - 10 * 60_000);
    f.ledger.claimUpcomingHostStart.mockReturnValueOnce({ hostId: 'host', startsAt: start });
    f.host.send.mockRejectedValue(new Error('DISCORD_CANNOT_MESSAGE_USER'));
    await f.tick();
    await f.getTick()(f.guild, 'category');
    expect(f.host.send).toHaveBeenCalledOnce();
    expect(f.error.mock.calls).toEqual([['BOOKING_HOST_PRESTART_DM_UNAVAILABLE']]);
    expect(f.ticket.send).not.toHaveBeenCalled();
  });

  it('does not claim a reminder in Store 1 or without voice permissions', async () => {
    const f = fixture();
    f.setTime(start - 10 * 60_000);
    await f.getTick()({ ...f.guild, id: STORE_ONE_GUILD_ID }, 'category');
    f.guild.members.me.permissions.has = () => false;
    await f.tick();
    expect(f.ledger.claimUpcomingHostStart).not.toHaveBeenCalled();
    expect(f.host.send).not.toHaveBeenCalled();
  });

  it('does not provision an unpaid room', async () => {
    const f = fixture();
    f.setInvoice({ kind: 'BASE', status: 'PENDING', id: 2, order_code: 'ORDER' });
    await f.tick();
    expect(f.guild.channels.create).not.toHaveBeenCalled();
    expect(f.ledger.startSession).not.toHaveBeenCalled();
    expect(f.ledger.syncInvoicePayment).toHaveBeenCalledWith(STORE_TWO_GUILD_ID, 2);
  });

  it('opens for host and customer, notices once across restart, and expires only the dedicated room', async () => {
    const f = fixture();
    await f.tick();
    expect(f.guild.channels.create).toHaveBeenCalledTimes(1);
    expect(f.guild.channels.create.mock.calls[0][0].permissionOverwrites.map(grant => grant.id)).toEqual([
      STORE_TWO_GUILD_ID, 'bot', 'host', 'customer',
    ]);
    expect(f.ticket.send.mock.calls[0][0].allowedMentions).toEqual({ parse: [] });
    expect(f.host.send).toHaveBeenCalledOnce();
    const hostNotice = f.host.send.mock.lastCall[0].components[0].toJSON();
    expect(hostNotice.components.find(item => item.type === 1).components[0]).toMatchObject({
      url: `https://discord.com/channels/${STORE_TWO_GUILD_ID}/room`, label: 'Vào phòng voice',
    });
    f.room.members.set('host', { id: 'host', voice: { channelId: 'room', disconnect: vi.fn() } });
    f.setTime(start + ninety - 14 * 60_000);
    const restarted = f.getTick();
    await restarted(f.guild, 'category');
    await restarted(f.guild, 'category');
    expect(f.guild.channels.create).toHaveBeenCalledTimes(1);
    expect(f.host.send).toHaveBeenCalledOnce();
    expect(f.ticket.send).toHaveBeenCalledTimes(2);
    const warning = f.ticket.send.mock.lastCall[0].components[0].toJSON();
    expect(warning.components.find(item => item.type === 1).components[0].custom_id).toBe('booking:extension:open:1');
    f.setTime(start + ninety);
    await restarted(f.guild, 'category');
    expect(f.ledger.completeSession).toHaveBeenCalledWith(expect.objectContaining({ onlyIfDue: true }));
    expect(f.guest.voice.disconnect).toHaveBeenCalledOnce();
    expect(f.room.delete).toHaveBeenCalledOnce();
    expect(f.voiceStore.get(1).released).toBe(1);
  });

  it('does not delete a recorded room moved by staff to a different category', async () => {
    const f = fixture();
    await f.tick();
    f.room.parentId = 'unrelated';
    f.setTime(start + ninety);
    await f.tick();
    expect(f.error).toHaveBeenCalled();
    expect(f.room.delete).not.toHaveBeenCalled();
    expect(f.guest.voice.disconnect).not.toHaveBeenCalled();
  });

  it('removes a room when the ticket closes between allocation and session start', async () => {
    const f = fixture();
    f.ledger.startSession.mockImplementation(() => { throw Object.assign(new Error(), { code: 'TICKET_CLOSED' }); });
    await f.tick();
    expect(f.room.delete).toHaveBeenCalledOnce();
    expect(f.voiceStore.get(1).released).toBe(1);
    expect(f.host.send).not.toHaveBeenCalled();
  });

  it('expires an unattended booking without granting completion or wages', async () => {
    const f = fixture();
    await f.tick();
    f.setTime(start + ninety);
    await f.tick();
    expect(f.room.delete).toHaveBeenCalledOnce();
    expect(f.ledger.reviewExpiredSession).toHaveBeenCalledOnce();
    expect(f.ledger.completeSession).not.toHaveBeenCalled();
  });
});
