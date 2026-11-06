import { ChannelType } from 'discord.js';
import { STORE_FORUMS } from '../config/storeForums202611.js';
import { getGuildConfig, upsertGuildConfig } from './guildConfigService.js';
import { refreshBoostPanel } from './boostServerService.js';

export async function adoptStoreForums(client) {
  const guild = client.guilds.cache.get(STORE_FORUMS.guildId);
  if (!guild) return;
  const current = getGuildConfig(guild.id);
  const boostId = STORE_FORUMS.guidePosts.boost;
  const price = await guild.channels.fetch(STORE_FORUMS.priceForumId);
  const boost = await guild.channels.fetch(boostId);
  if (price?.type !== ChannelType.GuildForum || boost?.parentId !== STORE_FORUMS.guideForumId) throw new Error('Forum migration targets have not been verified.');
  if (current?.price_list_channel_id !== price.id || current?.boost_panel_channel_id !== boost.id) {
    upsertGuildConfig({ guild_id: guild.id, price_list_channel_id: price.id,
      boost_panel_channel_id: boost.id, boost_panel_message_id: boost.id });
  }
  const result = await refreshBoostPanel(client, guild.id);
  if (result.status !== 'updated') throw new Error(`Boost panel not updated: ${result.status}`);
}
