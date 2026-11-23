import { Events } from 'discord.js';
import { db } from '../database/db.js';
import { bookingPortal, BOOKING_APP_ID } from '../services/bookingStoreSetupService.js';
import { COMMUNITY_VOICE_INTERVAL_MS, createBookingCommunityService } from '../services/bookingCommunityService.js';
import { STORE_TWO_GUILD_ID } from '../utils/locale.js';

let community;
const registered = new WeakSet();

export function bookingCommunity() {
  community ??= createBookingCommunityService(db);
  return community;
}

export function isBookingCommunityGuild(client, guildId) {
  return guildId === STORE_TWO_GUILD_ID && client.user?.id === BOOKING_APP_ID;
}

export function eligibleVoiceMembers(guild, channels) {
  const present = new Map();
  for (const state of guild.voiceStates.cache.values()) {
    if (!channels.includes(state.channelId) || !state.member?.user || state.member.user.bot
      || state.channelId === guild.afkChannelId || state.deaf) continue;
    const room = present.get(state.channelId) ?? [];
    room.push(state.id);
    present.set(state.channelId, room);
  }
  const active = new Map();
  for (const [channelId, members] of present) {
    if (members.length < 2) continue;
    for (const id of members) active.set(id, channelId);
  }
  return active;
}

export function registerBookingCommunity(client) {
  if (registered.has(client)) return;
  registered.add(client);
  const accumulated = new Map();

  function updateVoice(credit) {
    const guild = client.guilds.cache.get(STORE_TWO_GUILD_ID);
    const channels = bookingPortal(client)?.voiceChannels;
    if (!guild || !channels?.length || !client.isReady() || !isBookingCommunityGuild(client, guild.id)) {
      accumulated.clear();
      return;
    }
    const now = Date.now();
    const active = eligibleVoiceMembers(guild, channels);
    for (const id of accumulated.keys()) if (!active.has(id)) accumulated.delete(id);
    for (const [id, channelId] of active) {
      const previous = accumulated.get(id);
      if (!previous || previous.channelId !== channelId) {
        accumulated.set(id, { channelId, since: now });
      } else if (credit && now - previous.since >= COMMUNITY_VOICE_INTERVAL_MS) {
        bookingCommunity().voiceMinute(id);
        previous.since = now;
      }
    }
  }

  function safely(callback) {
    return (...args) => {
      try {
        callback(...args);
      } catch (error) {
        console.error('[BOOKING-COMMUNITY]', error);
      }
    };
  }

  client.on(Events.MessageCreate, safely((message) => {
    if (!isBookingCommunityGuild(client, message.guildId) || message.author.bot || message.webhookId
      || message.channelId !== bookingPortal(client)?.chat || (message.content?.trim().length ?? 0) < 3) return;
    bookingCommunity().message(message.author.id);
  }));
  client.on(Events.VoiceStateUpdate, safely((previous, current) => {
    if (isBookingCommunityGuild(client, current.guild.id)) updateVoice(false);
  }));
  client.on(Events.ShardDisconnect, () => accumulated.clear());
  const onReady = () => {
    if (client.user.id !== BOOKING_APP_ID) return;
    setInterval(safely(() => updateVoice(true)), COMMUNITY_VOICE_INTERVAL_MS / 2).unref();
  };
  if (client.isReady()) onReady();
  else client.once(Events.ClientReady, onReady);
}
