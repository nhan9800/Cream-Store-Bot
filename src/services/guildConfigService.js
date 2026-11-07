import { db, nowIso } from '../database/db.js';
import { STORE_SERVICE_FORUM, serviceChannelTarget, serviceMessageTarget } from '../config/storeServiceForum202611.js';

function upsertGuildConfigStmt() {
  return db.prepare(`
    INSERT INTO guild_settings (
      guild_id,
      ticket_panel_channel_id,
      ticket_panel_message_id,
      ticket_category_id,
      warranty_category_id,
      support_category_id,
      complaint_category_id,
      partnership_category_id,
      support_role_id,
      shipper_role_id,
      manager_role_id,
      order_log_channel_id,
      feedback_channel_id,
      transcript_channel_id,
      non_legit_role_id,
      staff_log_channel_id,
      reminder_channel_id,
      customer_role_id,
      loyal_role_id,
      vip_role_id,
      blacklist_role_id,
      bank_alias,
      bank_bin,
      bank_account_no,
      bank_account_name,
      panel_title,
      panel_description,
      panel_image_url,
      public_order_log_channel_id,
      price_list_channel_id,
      price_list_message_id,
      price_list_title,
      price_list_description,
      price_list_image_url,
      sale_channel_id,
      sale_message_id,
      sale_percent,
      warranty_log_channel_id,
      boost_panel_channel_id,
      boost_panel_message_id,
      boost_log_channel_id,
      updated_by,
      updated_at
    ) VALUES (
      @guild_id,
      @ticket_panel_channel_id,
      @ticket_panel_message_id,
      @ticket_category_id,
      @warranty_category_id,
      @support_category_id,
      @complaint_category_id,
      @partnership_category_id,
      @support_role_id,
      @shipper_role_id,
      @manager_role_id,
      @order_log_channel_id,
      @feedback_channel_id,
      @transcript_channel_id,
      @non_legit_role_id,
      @staff_log_channel_id,
      @reminder_channel_id,
      @customer_role_id,
      @loyal_role_id,
      @vip_role_id,
      @blacklist_role_id,
      @bank_alias,
      @bank_bin,
      @bank_account_no,
      @bank_account_name,
      @panel_title,
      @panel_description,
      @panel_image_url,
      @public_order_log_channel_id,
      @price_list_channel_id,
      @price_list_message_id,
      @price_list_title,
      @price_list_description,
      @price_list_image_url,
      @sale_channel_id,
      @sale_message_id,
      @sale_percent,
      @warranty_log_channel_id,
      @boost_panel_channel_id,
      @boost_panel_message_id,
      @boost_log_channel_id,
      @updated_by,
      @updated_at
    )
    ON CONFLICT(guild_id) DO UPDATE SET
      ticket_panel_channel_id = COALESCE(excluded.ticket_panel_channel_id, guild_settings.ticket_panel_channel_id),
      ticket_panel_message_id = COALESCE(excluded.ticket_panel_message_id, guild_settings.ticket_panel_message_id),
      ticket_category_id = COALESCE(excluded.ticket_category_id, guild_settings.ticket_category_id),
      warranty_category_id = COALESCE(excluded.warranty_category_id, guild_settings.warranty_category_id),
      support_category_id = COALESCE(excluded.support_category_id, guild_settings.support_category_id),
      complaint_category_id = COALESCE(excluded.complaint_category_id, guild_settings.complaint_category_id),
      partnership_category_id = COALESCE(excluded.partnership_category_id, guild_settings.partnership_category_id),
      support_role_id = COALESCE(excluded.support_role_id, guild_settings.support_role_id),
      shipper_role_id = COALESCE(excluded.shipper_role_id, guild_settings.shipper_role_id),
      manager_role_id = COALESCE(excluded.manager_role_id, guild_settings.manager_role_id),
      order_log_channel_id = COALESCE(excluded.order_log_channel_id, guild_settings.order_log_channel_id),
      feedback_channel_id = COALESCE(excluded.feedback_channel_id, guild_settings.feedback_channel_id),
      transcript_channel_id = COALESCE(excluded.transcript_channel_id, guild_settings.transcript_channel_id),
      non_legit_role_id = COALESCE(excluded.non_legit_role_id, guild_settings.non_legit_role_id),
      staff_log_channel_id = COALESCE(excluded.staff_log_channel_id, guild_settings.staff_log_channel_id),
      reminder_channel_id = COALESCE(excluded.reminder_channel_id, guild_settings.reminder_channel_id),
      customer_role_id = COALESCE(excluded.customer_role_id, guild_settings.customer_role_id),
      loyal_role_id = COALESCE(excluded.loyal_role_id, guild_settings.loyal_role_id),
      vip_role_id = COALESCE(excluded.vip_role_id, guild_settings.vip_role_id),
      blacklist_role_id = COALESCE(excluded.blacklist_role_id, guild_settings.blacklist_role_id),
      bank_alias = COALESCE(excluded.bank_alias, guild_settings.bank_alias),
      bank_bin = COALESCE(excluded.bank_bin, guild_settings.bank_bin),
      bank_account_no = COALESCE(excluded.bank_account_no, guild_settings.bank_account_no),
      bank_account_name = COALESCE(excluded.bank_account_name, guild_settings.bank_account_name),
      panel_title = COALESCE(excluded.panel_title, guild_settings.panel_title),
      panel_description = COALESCE(excluded.panel_description, guild_settings.panel_description),
      panel_image_url = COALESCE(excluded.panel_image_url, guild_settings.panel_image_url),
      public_order_log_channel_id = COALESCE(excluded.public_order_log_channel_id, guild_settings.public_order_log_channel_id),
      price_list_channel_id = COALESCE(excluded.price_list_channel_id, guild_settings.price_list_channel_id),
      price_list_message_id = COALESCE(excluded.price_list_message_id, guild_settings.price_list_message_id),
      price_list_title = COALESCE(excluded.price_list_title, guild_settings.price_list_title),
      price_list_description = COALESCE(excluded.price_list_description, guild_settings.price_list_description),
      price_list_image_url = COALESCE(excluded.price_list_image_url, guild_settings.price_list_image_url),
      sale_channel_id = COALESCE(excluded.sale_channel_id, guild_settings.sale_channel_id),
      sale_message_id = COALESCE(excluded.sale_message_id, guild_settings.sale_message_id),
      sale_percent = COALESCE(excluded.sale_percent, guild_settings.sale_percent),
      warranty_log_channel_id = COALESCE(excluded.warranty_log_channel_id, guild_settings.warranty_log_channel_id),
      boost_panel_channel_id = COALESCE(excluded.boost_panel_channel_id, guild_settings.boost_panel_channel_id),
      boost_panel_message_id = COALESCE(excluded.boost_panel_message_id, guild_settings.boost_panel_message_id),
      boost_log_channel_id = COALESCE(excluded.boost_log_channel_id, guild_settings.boost_log_channel_id),
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `);
}

function getGuildConfigStmt() {
  return db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?');
}

export function upsertGuildConfig(payload) {
  const existing = getGuildConfig(payload.guild_id);
  const params = {
    guild_id: payload.guild_id,
    ticket_panel_channel_id: payload.ticket_panel_channel_id ?? existing?.ticket_panel_channel_id ?? null,
    ticket_panel_message_id: payload.ticket_panel_message_id ?? existing?.ticket_panel_message_id ?? null,
    ticket_category_id: payload.ticket_category_id ?? existing?.ticket_category_id ?? null,
    warranty_category_id: payload.warranty_category_id ?? existing?.warranty_category_id ?? null,
    support_category_id: payload.support_category_id ?? existing?.support_category_id ?? null,
    complaint_category_id: payload.complaint_category_id ?? existing?.complaint_category_id ?? null,
    partnership_category_id: payload.partnership_category_id ?? existing?.partnership_category_id ?? null,
    support_role_id: payload.support_role_id ?? existing?.support_role_id ?? null,
    shipper_role_id: payload.shipper_role_id ?? existing?.shipper_role_id ?? null,
    manager_role_id: payload.manager_role_id ?? existing?.manager_role_id ?? null,
    order_log_channel_id: payload.order_log_channel_id ?? existing?.order_log_channel_id ?? null,
    feedback_channel_id: payload.feedback_channel_id ?? existing?.feedback_channel_id ?? null,
    transcript_channel_id: payload.transcript_channel_id ?? existing?.transcript_channel_id ?? null,
    non_legit_role_id: payload.non_legit_role_id ?? existing?.non_legit_role_id ?? null,
    staff_log_channel_id: payload.staff_log_channel_id ?? existing?.staff_log_channel_id ?? null,
    reminder_channel_id: payload.reminder_channel_id ?? existing?.reminder_channel_id ?? null,
    customer_role_id: payload.customer_role_id ?? existing?.customer_role_id ?? null,
    loyal_role_id: payload.loyal_role_id ?? existing?.loyal_role_id ?? null,
    vip_role_id: payload.vip_role_id ?? existing?.vip_role_id ?? null,
    blacklist_role_id: payload.blacklist_role_id ?? existing?.blacklist_role_id ?? null,
    bank_alias: payload.bank_alias ?? existing?.bank_alias ?? null,
    bank_bin: payload.bank_bin ?? existing?.bank_bin ?? null,
    bank_account_no: payload.bank_account_no ?? existing?.bank_account_no ?? null,
    bank_account_name: payload.bank_account_name ?? existing?.bank_account_name ?? null,
    panel_title: payload.panel_title !== undefined ? (payload.panel_title || null) : (existing?.panel_title ?? null),
    panel_description: payload.panel_description !== undefined ? (payload.panel_description || null) : (existing?.panel_description ?? null),
    panel_image_url: payload.panel_image_url !== undefined ? (payload.panel_image_url || null) : (existing?.panel_image_url ?? null),
    public_order_log_channel_id: payload.public_order_log_channel_id ?? existing?.public_order_log_channel_id ?? null,
    price_list_channel_id: payload.price_list_channel_id ?? existing?.price_list_channel_id ?? null,
    price_list_message_id: payload.price_list_message_id ?? existing?.price_list_message_id ?? null,
    price_list_title: payload.price_list_title !== undefined ? (payload.price_list_title || null) : (existing?.price_list_title ?? null),
    price_list_description: payload.price_list_description !== undefined ? (payload.price_list_description || null) : (existing?.price_list_description ?? null),
    price_list_image_url: payload.price_list_image_url !== undefined ? (payload.price_list_image_url || null) : (existing?.price_list_image_url ?? null),
    sale_channel_id: payload.sale_channel_id ?? existing?.sale_channel_id ?? null,
    sale_message_id: payload.sale_message_id ?? existing?.sale_message_id ?? null,
    sale_percent: payload.sale_percent !== undefined ? payload.sale_percent : (existing?.sale_percent ?? 0),
    warranty_log_channel_id: payload.warranty_log_channel_id ?? existing?.warranty_log_channel_id ?? null,
    boost_panel_channel_id: payload.boost_panel_channel_id ?? existing?.boost_panel_channel_id ?? null,
    boost_panel_message_id: payload.boost_panel_message_id ?? existing?.boost_panel_message_id ?? null,
    boost_log_channel_id: payload.boost_log_channel_id ?? existing?.boost_log_channel_id ?? null,
    updated_by: payload.updated_by ?? existing?.updated_by ?? null,
    updated_at: nowIso(),
  };

  upsertGuildConfigStmt().run(params);
  return getGuildConfig(payload.guild_id);
}

export function getGuildConfig(guildId) {
  const row = getGuildConfigStmt().get(guildId) ?? null;
  if (!row) return null;
  for (const key of Object.keys(row)) {
    if (key.endsWith('_channel_id')) row[key] = serviceChannelTarget(guildId, row[key]);
    else if (key.endsWith('_message_id')) row[key] = serviceMessageTarget(guildId, row[key]);
  }
  if (String(guildId) === STORE_SERVICE_FORUM.guildId) {
    row.order_log_channel_id = STORE_SERVICE_FORUM.orderLogChannelId;
    row.feedback_channel_id = STORE_SERVICE_FORUM.feedbackChannelId;
    row.public_order_log_channel_id = STORE_SERVICE_FORUM.completedOrderLogChannelId;
  }
  return row;
}

export function hasBankConfig(guildConfig) {
  return Boolean(
    guildConfig?.bank_alias
    && guildConfig?.bank_bin
    && guildConfig?.bank_account_no
    && guildConfig?.bank_account_name,
  );
}
