import { ChannelType } from 'discord.js';
import { STORE_FORUMS } from '../config/storeForums202611.js';
import { getGuildConfig, upsertGuildConfig } from './guildConfigService.js';
import { refreshBoostPanel } from './boostServerService.js';
import { db } from '../database/db.js';
import { STORE_SERVICE_FORUM, serviceChannelTarget, serviceMessageTarget } from '../config/storeServiceForum202611.js';

export async function adoptStoreForums(client) {
  const guild = client.guilds.cache.get(STORE_FORUMS.guildId);
  if (!guild) return;
  const serviceForum = await guild.channels.fetch(STORE_SERVICE_FORUM.forumId);
  if (serviceForum?.type !== ChannelType.GuildForum) throw new Error('Store service forum is unavailable.');
  const posts = await Promise.all(Object.values(STORE_SERVICE_FORUM.posts).map(id => guild.channels.fetch(id)));
  if (posts.some(post => post?.parentId !== serviceForum.id)) throw new Error('Store service forum post is unavailable.');
  const row = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guild.id);
  if (row) db.transaction(() => {
    db.prepare("UPDATE guild_settings SET order_log_channel_id = ?, sale_channel_id = ? WHERE guild_id = ?").run(STORE_SERVICE_FORUM.orderLogChannelId, STORE_SERVICE_FORUM.promotionChannelId, guild.id);
    for (const key of Object.keys(row)) {
      if (['order_log_channel_id', 'sale_channel_id'].includes(key)) continue;
      const next = key.endsWith('_channel_id') ? serviceChannelTarget(guild.id, row[key])
        : key.endsWith('_message_id') ? serviceMessageTarget(guild.id, row[key]) : row[key];
      if (next !== row[key]) db.prepare(`UPDATE guild_settings SET "${key}" = ? WHERE guild_id = ?`).run(next, guild.id);
    }
  })();
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
