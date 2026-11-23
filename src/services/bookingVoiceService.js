import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { buildBookingVoiceNotice } from '../utils/bookingTicketUi.js';
import { STORE_TWO_GUILD_ID } from '../utils/locale.js';

const REASON = 'Cenar Booking · Phòng theo lịch';
const UNKNOWN_CHANNEL = 10003;
const MINUTE = 60_000;

export function createBookingVoiceStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS booking_voice_rooms (
    ticket_id INTEGER PRIMARY KEY, room_id TEXT UNIQUE, warning_for INTEGER,
    reminder_sent INTEGER NOT NULL DEFAULT 0, host_notice_attempted INTEGER NOT NULL DEFAULT 0,
    participants_met INTEGER NOT NULL DEFAULT 0,
    released INTEGER NOT NULL DEFAULT 0
  )`);
  return {
    get: ticketId => db.prepare('SELECT * FROM booking_voice_rooms WHERE ticket_id = ?').get(ticketId),
    listOpen: () => db.prepare('SELECT * FROM booking_voice_rooms WHERE released = 0 AND room_id IS NOT NULL').all(),
    room: (ticketId, roomId) => db.prepare(`INSERT INTO booking_voice_rooms (ticket_id,room_id) VALUES (?,?)
      ON CONFLICT(ticket_id) DO UPDATE SET room_id=excluded.room_id`).run(ticketId, roomId),
    warn: (ticketId, endAt) => db.prepare('UPDATE booking_voice_rooms SET warning_for = ? WHERE ticket_id = ?').run(endAt, ticketId),
    remind: ticketId => db.prepare(`INSERT INTO booking_voice_rooms (ticket_id,reminder_sent) VALUES (?,1)
      ON CONFLICT(ticket_id) DO UPDATE SET reminder_sent=1`).run(ticketId),
    claimHostNotice: ticketId => db.prepare(`UPDATE booking_voice_rooms SET host_notice_attempted = 1
      WHERE ticket_id = ? AND host_notice_attempted = 0`).run(ticketId).changes === 1,
    recordAttendance: ticketId => db.prepare('UPDATE booking_voice_rooms SET participants_met = 1 WHERE ticket_id = ?').run(ticketId),
    release: ticketId => db.prepare('UPDATE booking_voice_rooms SET released = 1 WHERE ticket_id = ?').run(ticketId),
  };
}

function isManagedRoom(channel, guild, session, categoryId) {
  return channel?.type === ChannelType.GuildVoice && channel.guildId === guild.id
    && channel.parentId === categoryId && channel.name === `cenar-phien-${session.ticket_id}`;
}

async function getRoom(guild, roomId) {
  return guild.channels.fetch(roomId, { force: true }).catch(error => {
    if (error.code === UNKNOWN_CHANNEL) return null;
    throw error;
  });
}

async function openRoom(guild, session, categoryId, state, voiceStore) {
  const permissions = guild.members.me?.permissions;
  if (!permissions?.has([P.ManageChannels, P.MoveMembers, P.ManageRoles])) return null;
  if (state?.released) return null;
  let room = state?.room_id && await getRoom(guild, state.room_id);
  if (room) return isManagedRoom(room, guild, session, categoryId) ? room : null;

  const inventory = await guild.channels.fetch();
  // A room created just before a restart can be recovered only if its identity and private grants match.
  const matches = inventory.filter(candidate => {
    if (!isManagedRoom(candidate, guild, session, categoryId)) return false;
    const grants = candidate.permissionOverwrites.cache;
    return grants.size === 4 && grants.get(guild.id)?.deny.has([P.ViewChannel, P.Connect])
      && [session.host_id, session.customer_id, guild.client.user.id]
        .every(id => grants.get(id)?.allow.has([P.ViewChannel, P.Connect]));
  });
  if (matches.size > 1) throw new Error('BOOKING_DUPLICATE_VOICE_ROOM');
  room = matches.first();
  if (!room) {
    await Promise.all([session.host_id, session.customer_id].map(user => guild.members.fetch({ user, force: true })));
    const access = [P.ViewChannel, P.Connect, P.Speak];
    room = await guild.channels.create({
      name: `cenar-phien-${session.ticket_id}`, type: ChannelType.GuildVoice, parent: categoryId, userLimit: 2, reason: REASON,
      permissionOverwrites: [
        { id: guild.id, deny: [P.ViewChannel, P.Connect] },
        { id: guild.client.user.id, allow: [...access, P.ManageChannels, P.MoveMembers] },
        ...[session.host_id, session.customer_id].map(id => ({ id, allow: access })),
      ],
    });
  }
  voiceStore.room(session.ticket_id, room.id);
  return room;
}

async function closeRoom(guild, session, categoryId, state, voiceStore) {
  const room = await getRoom(guild, state.room_id);
  if (room && !isManagedRoom(room, guild, session, categoryId)) throw new Error('BOOKING_VOICE_ROOM_IDENTITY_MISMATCH');
  if (room) {
    const guests = new Set([session.host_id, session.customer_id]);
    await Promise.all([...room.members.values()].filter(member => guests.has(member.id) && member.voice.channelId === room.id)
      .map(member => member.voice.disconnect(REASON)));
    // Staff with administrator access can enter for assistance. Don't interrupt them.
    if ([...room.members.values()].some(member => !guests.has(member.id))) return false;
    await room.delete(REASON);
  }
  voiceStore.release(session.ticket_id);
  return true;
}

export function createBookingVoiceTick({ db, ledger, voiceStore = createBookingVoiceStore(db), now = Date.now, onError = () => {} }) {
  let checking = false;
  return async function tick(guild, categoryId) {
    if (checking || guild?.id !== STORE_TWO_GUILD_ID || !categoryId) return;
    checking = true;
    const time = now();
    try {
      const sessions = new Map(['CONFIRMED', 'ACTIVE'].flatMap(status => ledger.listSessions(guild.id, { status, dueBefore: time, limit: 100 }))
        .map(session => [session.ticket_id, session]));
      for (const row of voiceStore.listOpen()) {
        if (!sessions.has(row.ticket_id)) sessions.set(row.ticket_id, ledger.getSession(guild.id, row.ticket_id));
      }
      for (let session of sessions.values()) {
        if (!session) continue;
        const ticketId = session.ticket_id;
        try {
          let state = voiceStore.get(ticketId);
          if (['COMPLETED', 'DECLINED', 'NEEDS_REVIEW'].includes(session.status)) {
            if (state?.room_id && !state.released) await closeRoom(guild, session, categoryId, state, voiceStore);
            continue;
          }
          if (session.status === 'CONFIRMED' && time >= session.ends_at && state?.room_id && !state.released) {
            await closeRoom(guild, session, categoryId, state, voiceStore);
            continue;
          }
          if (session.status === 'CONFIRMED' && time >= session.starts_at && time < session.starts_at + session.duration_minutes * MINUTE) {
            const pending = ledger.listInvoices(guild.id, ticketId).filter(invoice => invoice.status === 'PENDING' && invoice.order_code);
            for (const item of pending) ledger.syncInvoicePayment(guild.id, item.id);
            if (ledger.listInvoices(guild.id, ticketId).some(invoice => invoice.kind === 'BASE' && ['FREE', 'PAID'].includes(invoice.status))) {
              if (!await openRoom(guild, session, categoryId, state, voiceStore)) continue;
              try {
                session = ledger.startSession({ guildId: guild.id, ticketId, actorId: guild.client.user.id });
              } catch (error) {
                await closeRoom(guild, session, categoryId, voiceStore.get(ticketId), voiceStore);
                throw error;
              }
              state = voiceStore.get(ticketId);
            }
          }
          if (session.status !== 'ACTIVE' || !session.host_id) continue;
          for (const invoice of ledger.listInvoices(guild.id, ticketId)) {
            if (invoice.kind === 'EXTENSION' && invoice.status === 'PENDING' && invoice.order_code) ledger.syncInvoicePayment(guild.id, invoice.id);
          }
          session = ledger.getSession(guild.id, ticketId);
          if (time >= session.ends_at) {
            const completion = { guildId: guild.id, ticketId, actorId: guild.client.user.id };
            try {
              session = state?.participants_met ? ledger.completeSession({ ...completion, onlyIfDue: true })
                : ledger.reviewExpiredSession(completion);
            } catch (error) {
              if (error.code !== 'INVOICE_NOT_SETTLED') throw error;
              session = ledger.reviewExpiredSession(completion);
            }
            if (state?.room_id && !state.released) await closeRoom(guild, session, categoryId, state, voiceStore);
            continue;
          }
          const room = await openRoom(guild, session, categoryId, state, voiceStore);
          if (!room) continue;
          if (!state?.participants_met && room.members.has(session.host_id) && room.members.has(session.customer_id)) {
            voiceStore.recordAttendance(ticketId);
          }
          const notice = { guildId: guild.id, roomId: room.id, endsAt: session.ends_at, ticketId };
          if (voiceStore.claimHostNotice(ticketId)) {
            const host = await guild.members.fetch({ user: session.host_id, force: true }).catch(() => null);
            await host?.send(buildBookingVoiceNotice({ ...notice, audience: 'host' })).catch(() => onError('BOOKING_HOST_DM_UNAVAILABLE'));
          }
          const ticket = await guild.channels.fetch(session.ticket_channel_id);
          if (!(ticket?.type === ChannelType.GuildText && ticket.guildId === guild.id)) continue;
          if (!state?.reminder_sent) {
            await ticket.send(buildBookingVoiceNotice(notice));
            voiceStore.remind(ticketId);
          }
          const remaining = session.ends_at - time;
          const warningTime = Math.min(15 * MINUTE, Math.max(MINUTE, session.duration_minutes * MINUTE / 2));
          if (remaining <= warningTime && state?.warning_for !== session.ends_at) {
            await ticket.send(buildBookingVoiceNotice({ ...notice, audience: 'warning' }));
            voiceStore.warn(ticketId, session.ends_at);
          }
        } catch (error) {
          onError(error.code || error.name);
        }
      }
    } finally {
      checking = false;
    }
  };
}
