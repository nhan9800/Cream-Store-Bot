import { db, nowIso } from '../database/db.js';

export function getCtvSettings(guildId) {
  let row = db.prepare('SELECT * FROM ctv_settings WHERE guild_id = ?').get(guildId);
  if (!row) {
    db.prepare('INSERT OR IGNORE INTO ctv_settings (guild_id) VALUES (?)').run(guildId);
    row = db.prepare('SELECT * FROM ctv_settings WHERE guild_id = ?').get(guildId);
  }
  return row;
}

export function upsertCtvSettings({
  guild_id,
  recruit_channel_id,
  approve_channel_id,
  ctv_role_id,
  category_id,
  chat_channel_id,
  order_log_channel_id,
  price_channel_id,
  price_message_id,
  price_message_ids,
}) {
  db.prepare(`
    INSERT INTO ctv_settings (
      guild_id, recruit_channel_id, approve_channel_id, ctv_role_id,
      category_id, chat_channel_id, order_log_channel_id, price_channel_id,
      price_message_id, price_message_ids, updated_at
    )
    VALUES (
      @guild_id, @recruit_channel_id, @approve_channel_id, @ctv_role_id,
      @category_id, @chat_channel_id, @order_log_channel_id, @price_channel_id,
      @price_message_id, @price_message_ids, CURRENT_TIMESTAMP
    )
    ON CONFLICT(guild_id) DO UPDATE SET
      recruit_channel_id = COALESCE(excluded.recruit_channel_id, recruit_channel_id),
      approve_channel_id = COALESCE(excluded.approve_channel_id, approve_channel_id),
      ctv_role_id = COALESCE(excluded.ctv_role_id, ctv_role_id),
      category_id = COALESCE(excluded.category_id, category_id),
      chat_channel_id = COALESCE(excluded.chat_channel_id, chat_channel_id),
      order_log_channel_id = COALESCE(excluded.order_log_channel_id, order_log_channel_id),
      price_channel_id = COALESCE(excluded.price_channel_id, price_channel_id),
      price_message_id = COALESCE(excluded.price_message_id, price_message_id),
      price_message_ids = COALESCE(excluded.price_message_ids, price_message_ids),
      updated_at = CURRENT_TIMESTAMP
  `).run({
    guild_id,
    recruit_channel_id: recruit_channel_id ?? null,
    approve_channel_id: approve_channel_id ?? null,
    ctv_role_id: ctv_role_id ?? null,
    category_id: category_id ?? null,
    chat_channel_id: chat_channel_id ?? null,
    order_log_channel_id: order_log_channel_id ?? null,
    price_channel_id: price_channel_id ?? null,
    price_message_id: price_message_id ?? null,
    price_message_ids: price_message_ids ?? null,
  });
  return getCtvSettings(guild_id);
}

export function setCtvPriceMessage(guildId, messageId) {
  db.prepare('UPDATE ctv_settings SET price_message_id = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?')
    .run(messageId, guildId);
  return getCtvSettings(guildId);
}

export function setCtvPriceMessages(guildId, messageIds) {
  const ids = [...new Set((messageIds || []).filter(Boolean).map(String))];
  db.prepare(`
    UPDATE ctv_settings
    SET price_message_id = ?, price_message_ids = ?, updated_at = CURRENT_TIMESTAMP
    WHERE guild_id = ?
  `).run(ids[0] ?? null, JSON.stringify(ids), guildId);
  return getCtvSettings(guildId);
}

export function isCustomerCtv(guildId, customerId) {
  const row = db.prepare('SELECT is_ctv FROM customer_profiles WHERE guild_id = ? AND customer_id = ?').get(guildId, customerId);
  return row ? row.is_ctv === 1 : false;
}

export function setCustomerCtvStatus(guildId, customerId, isCtv) {
  const timestamp = nowIso();
  // Ensure profile exists
  db.prepare(`
    INSERT INTO customer_profiles (guild_id, customer_id, is_ctv, ctv_joined_at, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, customer_id) DO UPDATE SET
      is_ctv = excluded.is_ctv,
      ctv_joined_at = COALESCE(excluded.ctv_joined_at, ctv_joined_at),
      last_seen_at = excluded.last_seen_at
  `).run(guildId, customerId, isCtv ? 1 : 0, isCtv ? timestamp : null, timestamp, timestamp);
}
