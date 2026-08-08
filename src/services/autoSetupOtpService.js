import { MessageFlags } from 'discord.js';
import { db } from '../database/db.js';
import { buildOtpPanel } from '../commands/setup-otp.js';

function containsOtpButton(message) {
  return JSON.stringify(message.components.map((component) => component.toJSON())).includes('otp:open_menu');
}

export async function autoRefreshOtpPanel(client) {
  const guildRows = db.prepare('SELECT guild_id FROM guild_settings').all();
  for (const row of guildRows) {
    const guild = client.guilds.cache.get(row.guild_id)
      || await client.guilds.fetch(row.guild_id).catch(() => null);
    if (!guild) continue;
    const channel = guild.channels.cache.find((item) => item.isTextBased?.() && (
      item.name.includes('thue-sim-online')
      || item.name.includes('thue-so')
      || item.name.includes('thuê-sim-online')
      || item.name.includes('thuê-số')
      || item.name.includes('otp')
    ));
    if (!channel?.messages?.fetch) continue;
    const messages = await channel.messages.fetch({ limit: 30 }).catch(() => null);
    const existing = messages?.find((message) => message.author.id === client.user.id && containsOtpButton(message));
    const payload = buildOtpPanel(guild.id);
    if (existing?.flags?.has(MessageFlags.IsComponentsV2)) {
      await existing.edit(payload).catch((error) => console.error('[AUTO-OTP] Không thể cập nhật panel:', error.message));
    } else {
      if (existing) await existing.delete('Thay panel OTP cũ bằng Components V2').catch(() => null);
      await channel.send(payload).catch((error) => console.error('[AUTO-OTP] Không thể gửi panel:', error.message));
    }
  }
}
