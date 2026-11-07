import { config } from '../config.js';
import { db } from '../database/db.js';
import { STORE_SERVICE_FORUM } from '../config/storeServiceForum202611.js';
import { STORE_FORUMS } from '../config/storeForums202611.js';
import { restoredFeedbackReferenceHealth } from './restoredFeedbackReferenceService.js';

export function getPremiumLayoutHealth(guildId = config.guildId) {
  if (String(guildId) !== STORE_FORUMS.guildId) return { mode: 'legacy' };
  const channelId = STORE_FORUMS.pricePosts.locket;
  // Premium columns are created lazily by its setup service. Public health is
  // read-only and remains available before that service has ever run.
  const columns = new Set(db.prepare('PRAGMA table_info(guild_settings)').all().map(column => column.name));
  if (!['premium_category_id', 'locket_channel_id', 'locket_product_message_id'].every(name => columns.has(name))) {
    return { mode: 'price-forum', adopted: false, locketChannelId: channelId, locketMessageId: null };
  }
  const row = db.prepare(`SELECT premium_category_id, locket_channel_id, locket_product_message_id
    FROM guild_settings WHERE guild_id = ?`).get(STORE_FORUMS.guildId);
  const adopted = Boolean(row && row.premium_category_id === null && row.locket_channel_id === channelId
    && /^\d{15,22}$/.test(String(row.locket_product_message_id || '')));
  return { mode: 'price-forum', adopted, locketChannelId: channelId,
    locketMessageId: adopted ? row.locket_product_message_id : null };
}

export function getStoreChannelRoutingHealth(guildId = config.guildId) {
  if (String(guildId) !== STORE_FORUMS.guildId) return { mode: 'configured' };
  const row = db.prepare(`SELECT order_log_channel_id, sale_channel_id, feedback_channel_id,
    public_order_log_channel_id FROM guild_settings WHERE guild_id = ?`).get(guildId);
  return { mode: 'standalone-reviews-and-logs', orderLogChannelId: STORE_SERVICE_FORUM.orderLogChannelId,
    feedbackChannelId: STORE_SERVICE_FORUM.feedbackChannelId,
    completedOrderLogChannelId: STORE_SERVICE_FORUM.completedOrderLogChannelId,
    serviceForumPostCount: Object.keys(STORE_SERVICE_FORUM.posts).length,
    feedbackHistory: restoredFeedbackReferenceHealth(),
    promotionChannelId: STORE_SERVICE_FORUM.promotionChannelId,
    persisted: Boolean(row && row.order_log_channel_id === STORE_SERVICE_FORUM.orderLogChannelId
      && row.feedback_channel_id === STORE_SERVICE_FORUM.feedbackChannelId
      && row.public_order_log_channel_id === STORE_SERVICE_FORUM.completedOrderLogChannelId
      && row.sale_channel_id === STORE_SERVICE_FORUM.promotionChannelId) };
}
