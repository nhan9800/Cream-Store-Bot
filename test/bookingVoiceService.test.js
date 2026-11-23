import Database from 'better-sqlite3';
import { ChannelType, Collection } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBookingVoiceStore, createBookingVoiceTick } from '../src/services/bookingVoiceService.js';
import { STORE_TWO_GUILD_ID } from '../src/utils/locale.js';

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
    listSessions: vi.fn((guildId, { status }) => session.status === status ? [session] : []),
    getSession: vi.fn(() => session), listInvoices: vi.fn(() => [invoice]), syncInvoicePayment: vi.fn(),
    startSession: vi.fn(() => { session.status = 'ACTIVE'; return session; }),
    completeSession: vi.fn(() => { session.status = 'COMPLETED'; return session; }),
  };
  const guest = { id: 'customer', voice: { channelId: 'room', disconnect: vi.fn() } };
  const room = { name: 'cenar-phien-1', id: 'room', guildId: STORE_TWO_GUILD_ID, parentId: 'category',
    type: ChannelType.GuildVoice, members: new Collection([[guest.id, guest]]), delete: vi.fn() };
  const ticket = { type: ChannelType.GuildText, guildId: STORE_TWO_GUILD_ID, send: vi.fn() };
  const snapshots = new Collection();
  const guild = { id: STORE_TWO_GUILD_ID, client: { user: { id: 'bot' } },
    members: { me: { permissions: { has: () => true } }, fetch: vi.fn() }, channels: {
      fetch: vi.fn(id => Promise.resolve(id === 'ticket' ? ticket : id === 'room' ? room : snapshots)), create: vi.fn(() => room),
    } };
  const error = vi.fn();
  const getTick = () => createBookingVoiceTick({ db, ledger, now: () => time, onError: error });
  const tick = getTick();
  return { guild, getTick, tick: () => tick(guild, 'category'), setTime: value => { time = value; },
    setInvoice: value => { invoice = value; }, ticket, room, guest, voiceStore, ledger, session, error };
}

afterEach(() => db?.close());

describe('Cenar Booking private voice', () => {
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
    expect(f.ticket.send.mock.calls[0][0].allowedMentions).toEqual({ parse: [], users: ['host'] });
    f.setTime(start + ninety - 14 * 60_000);
    const restarted = f.getTick();
    await restarted(f.guild, 'category');
    await restarted(f.guild, 'category');
    expect(f.guild.channels.create).toHaveBeenCalledTimes(1);
    expect(f.ticket.send).toHaveBeenCalledTimes(2);
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
});
