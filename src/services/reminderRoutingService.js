import { config } from '../config.js';
import { db } from '../database/db.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';

export const STORE_ONE_REMINDER_CHANNEL_ID = '1514607032760799313';

export function reminderGuildId(guildId) {
  return String(guildId || '') === 'WEB' ? String(config.guildId || '') : String(guildId || '');
}

export function reminderChannelId(guildId, settings, { staffFallback = true } = {}) {
  if (reminderGuildId(guildId) === STORE_ONE_GUILD_ID) return STORE_ONE_REMINDER_CHANNEL_ID;
  return settings?.reminder_channel_id || (staffFallback ? settings?.staff_log_channel_id : null) || null;
}

// Route only new reminder deliveries. Existing message IDs/channel IDs remain
// historical provenance and must not be rewritten or have their dedupe reset.
export async function resolveReminderChannel(client, guild, settings, options) {
  const id = reminderChannelId(guild?.id, settings, options);
  if (!id || !guild) return null;
  const channel = guild.channels.cache.get(id)
    || await guild.channels.fetch(id).catch(() => null)
    || client.channels?.cache?.get(id)
    || await client.channels?.fetch?.(id).catch(() => null);
  if (!channel?.isTextBased?.() || String(channel.guildId || channel.guild?.id || '') !== String(guild.id)) return null;
  return channel;
}

export function adoptStoreOneReminderRouting(guildId = config.guildId) {
  if (String(guildId) !== STORE_ONE_GUILD_ID) return { skipped: true, changed: false };
  const result = db.prepare(`
    UPDATE guild_settings SET reminder_channel_id = ?
    WHERE guild_id = ? AND reminder_channel_id IS NOT ?
  `).run(STORE_ONE_REMINDER_CHANNEL_ID, STORE_ONE_GUILD_ID, STORE_ONE_REMINDER_CHANNEL_ID);
  const row = db.prepare('SELECT reminder_channel_id FROM guild_settings WHERE guild_id = ?').get(STORE_ONE_GUILD_ID);
  if (row?.reminder_channel_id !== STORE_ONE_REMINDER_CHANNEL_ID) throw new Error('STORE_ONE_REMINDER_SETTINGS_MISSING');
  return { skipped: false, changed: result.changes > 0 };
}

export function getReminderRoutingHealth(guildId = config.guildId) {
  const id = reminderGuildId(guildId);
  const settings = db.prepare('SELECT reminder_channel_id, staff_log_channel_id FROM guild_settings WHERE guild_id = ?').get(id);
  const channelId = reminderChannelId(id, settings);
  return { guildId: id, channelId, persisted: Boolean(channelId && settings?.reminder_channel_id === channelId) };
}
