import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { encrypt, isEncrypted } from '../utils/crypto.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const resolvedDatabasePath = path.resolve(projectRoot, config.databasePath);

fs.mkdirSync(path.dirname(resolvedDatabasePath), { recursive: true });

console.log('[DB-INIT] Creating Database connection on path:', resolvedDatabasePath);
export const db = new Database(resolvedDatabasePath);
const originalClose = db.close;
db.close = function(...args) {
  console.log('[DB-CLOSE] db.close was called! Stack trace:', new Error().stack);
  return originalClose.apply(db, args);
};
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -8000');
db.pragma('temp_store = MEMORY');
db.pragma('mmap_size = 268435456');

// Kiểm tra integrity khi khởi động — phát hiện DB corrupt sau crash
const integrityResult = db.pragma('integrity_check');
if (integrityResult[0]?.integrity_check !== 'ok') {
  console.error('[DB-INIT] ❌ INTEGRITY CHECK FAILED:', integrityResult);
  console.error('[DB-INIT] DB file có thể bị corrupt. Khôi phục từ backup trước khi tiếp tục.');
  process.exit(1);
}
console.log('[DB-INIT] ✅ Integrity check passed.');


function ensureColumn(tableName, columnName, definitionSql) {
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
  if (!tableExists) return;

  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((column) => column.name === columnName);
  if (!exists) {
    try {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definitionSql}`);
    } catch (error) {
      // Vitest/cluster workers có thể cùng khởi tạo một DB mới: worker khác đã
      // thêm cột sau lần PRAGMA ở trên thì trạng thái cuối vẫn hợp lệ.
      if (!/duplicate column name/i.test(String(error?.message || ''))) throw error;
    }
  }
}

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      ticket_panel_channel_id TEXT,
      ticket_panel_message_id TEXT,
      ticket_category_id TEXT NOT NULL,
      warranty_category_id TEXT,
      support_role_id TEXT,
      shipper_role_id TEXT,
      manager_role_id TEXT,
      order_log_channel_id TEXT NOT NULL,
      feedback_channel_id TEXT NOT NULL,
      transcript_channel_id TEXT,
      non_legit_role_id TEXT,
      staff_log_channel_id TEXT,
      reminder_channel_id TEXT,
      customer_role_id TEXT,
      loyal_role_id TEXT,
      vip_role_id TEXT,
      blacklist_role_id TEXT,
      bank_alias TEXT,
      bank_bin TEXT,
      bank_account_no TEXT,
      bank_account_name TEXT,
      support_category_id TEXT,
      complaint_category_id TEXT,
      partnership_category_id TEXT,
      panel_title TEXT,
      panel_description TEXT,
      panel_image_url TEXT,
      public_order_log_channel_id TEXT,
      price_list_channel_id TEXT,
      price_list_message_id TEXT,
      price_list_title TEXT,
      price_list_description TEXT,
      price_list_image_url TEXT,
      price_list_category_configs TEXT,
      custom_emojis TEXT,
      warranty_log_channel_id TEXT,
      admin_order_category_id TEXT,
      admin_order_channel_id TEXT,
      admin_order_panel_message_id TEXT,
      sale_channel_id TEXT,
      sale_message_id TEXT,
      sale_percent INTEGER DEFAULT 0,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_code TEXT UNIQUE,
      guild_id TEXT NOT NULL,
      channel_id TEXT UNIQUE NOT NULL,
      customer_id TEXT NOT NULL,
      opened_by_id TEXT NOT NULL,
      ticket_type TEXT NOT NULL DEFAULT 'ORDER',
      related_order_code TEXT,
      ticket_subject TEXT,
      support_source TEXT,
      client_request_id TEXT,
      last_activity_at TEXT,
      auto_close_at TEXT,
      keep_open_requested INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      closed_at TEXT,
      closed_by_id TEXT
    );

    CREATE TABLE IF NOT EXISTS ticket_transcript_archives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      archive_code TEXT UNIQUE NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      guild_id TEXT NOT NULL,
      ticket_id INTEGER,
      ticket_code TEXT,
      ticket_type TEXT,
      channel_id TEXT,
      channel_name TEXT NOT NULL,
      customer_id TEXT,
      closed_by_id TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      format_version INTEGER NOT NULL DEFAULT 2,
      compression TEXT NOT NULL DEFAULT 'GZIP',
      storage_backend TEXT NOT NULL DEFAULT 'LOCAL_GZIP',
      local_file_name TEXT,
      original_bytes INTEGER NOT NULL DEFAULT 0,
      compressed_bytes INTEGER NOT NULL DEFAULT 0,
      checksum_sha256 TEXT NOT NULL,
      partial INTEGER NOT NULL DEFAULT 0,
      fetch_error TEXT,
      discord_channel_id TEXT,
      discord_message_id TEXT,
      discord_attachment_id TEXT,
      discord_attachment_url TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT,
      last_accessed_at TEXT,
      access_count INTEGER NOT NULL DEFAULT 0,
      revoked_at TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      FOREIGN KEY (ticket_id) REFERENCES tickets(id)
    );

    CREATE INDEX IF NOT EXISTS idx_transcript_archives_token_hash
      ON ticket_transcript_archives(token_hash);
    CREATE INDEX IF NOT EXISTS idx_transcript_archives_ticket
      ON ticket_transcript_archives(ticket_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_transcript_archives_expiry
      ON ticket_transcript_archives(status, expires_at);

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_code TEXT UNIQUE,
      guild_id TEXT NOT NULL,
      ticket_id INTEGER NOT NULL,
      ticket_channel_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      total_amount INTEGER NOT NULL DEFAULT 0,
      amount_paid INTEGER NOT NULL DEFAULT 0,
      payment_provider TEXT NOT NULL DEFAULT 'PAYOS',
      payment_code TEXT UNIQUE,
      payos_order_code INTEGER UNIQUE,
      payment_link_id TEXT,
      payment_merchant_trade_no TEXT,
      payment_checkout_url TEXT,
      payment_qr_code TEXT,
      payment_qr_url TEXT,
      payment_qr_text TEXT,
      payment_status TEXT NOT NULL DEFAULT 'UNPAID',
      payment_expired_at TEXT,
      payment_cancel_reason TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
      status_changed_at TEXT,
      queue_group TEXT,
      priority_rank INTEGER NOT NULL DEFAULT 0,
      claimed_by_id TEXT,
      claimed_at TEXT,
      order_log_channel_id TEXT NOT NULL,
      order_log_message_id TEXT,
      ctv_order_log_channel_id TEXT,
      ctv_order_log_message_id TEXT,
      payment_message_id TEXT,
      created_by_id TEXT NOT NULL,
      paid_at TEXT,
      paid_transaction_id TEXT,
      paid_transaction_content TEXT,
      duration_months INTEGER NOT NULL DEFAULT 1,
      duration_days INTEGER,
      expiry_at TEXT,
      expiry_notice_2d_sent_at TEXT,
      expiry_notice_1d_sent_at TEXT,
      completed_by_id TEXT,
      completed_at TEXT,
      delivered_by_id TEXT,
      delivered_at TEXT,
      credential_email TEXT,
      credential_password TEXT,
      credential_profile TEXT,
      credential_pin TEXT,
      delivery_login_url TEXT,
      claim_notes TEXT,
      delivery_dm_channel_id TEXT,
      delivery_dm_message_id TEXT,
      feedback_requested_at TEXT,
      feedback_due_at TEXT,
      feedback_submitted_at TEXT,
      non_legit_assigned_at TEXT,
      payment_reminder_sent_at TEXT,
      processing_reminder_sent_at TEXT,
      admin_age_reminder_1w_sent_at TEXT,
      admin_age_reminder_2w_sent_at TEXT,
      feedback_reminder_sent_at TEXT,
      warranty_completed_at TEXT,
      warranty_completed_by_id TEXT,
      warranty_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id)
    );

    CREATE TABLE IF NOT EXISTS feedbacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      order_id INTEGER,
      order_code TEXT,
      ticket_id INTEGER,
      ticket_code TEXT,
      customer_id TEXT NOT NULL,
      stars INTEGER NOT NULL,
      content TEXT NOT NULL,
      feedback_channel_id TEXT NOT NULL,
      feedback_message_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (ticket_id) REFERENCES tickets(id)
    );

    CREATE TABLE IF NOT EXISTS giveaways (
      message_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      host_id TEXT NOT NULL,
      prize TEXT NOT NULL,
      winners_count INTEGER NOT NULL DEFAULT 1,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS giveaway_entries (
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (message_id, user_id),
      FOREIGN KEY (message_id) REFERENCES giveaways(message_id)
    );

    CREATE TABLE IF NOT EXISTS user_invites (
      invited_id TEXT PRIMARY KEY,
      inviter_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      has_purchased INTEGER NOT NULL DEFAULT 0,
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invite_rewards_claimed (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invite_campaigns (
      event_key TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      required_valid_invites INTEGER NOT NULL DEFAULT 5,
      min_stay_hours INTEGER NOT NULL DEFAULT 48,
      min_account_age_days INTEGER NOT NULL DEFAULT 30,
      reward_name TEXT NOT NULL,
      reward_value INTEGER NOT NULL DEFAULT 0,
      announcement_channel_id TEXT,
      announcement_message_id TEXT,
      admin_log_channel_id TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invite_campaign_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_key TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      inviter_id TEXT,
      invited_id TEXT NOT NULL,
      invite_code TEXT,
      status TEXT NOT NULL,
      disqualify_reason TEXT,
      account_created_at TEXT,
      account_age_days INTEGER NOT NULL DEFAULT 0,
      joined_at TEXT NOT NULL,
      qualifies_at TEXT,
      validated_at TEXT,
      left_at TEXT,
      risk_flags TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_key, guild_id, invited_id),
      FOREIGN KEY (event_key) REFERENCES invite_campaigns(event_key) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS invite_campaign_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_key TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      inviter_id TEXT NOT NULL,
      valid_invites INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ELIGIBLE',
      eligible_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      user_notified_at TEXT,
      notification_method TEXT,
      admin_notified_at TEXT,
      admin_message_id TEXT,
      notification_attempts INTEGER NOT NULL DEFAULT 0,
      last_notification_error TEXT,
      claimed_at TEXT,
      claimed_by_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_key, guild_id, inviter_id),
      FOREIGN KEY (event_key) REFERENCES invite_campaigns(event_key) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS customer_profiles (
      guild_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      first_seen_at TEXT,
      last_seen_at TEXT,
      total_orders INTEGER NOT NULL DEFAULT 0,
      total_open_orders INTEGER NOT NULL DEFAULT 0,
      total_completed_orders INTEGER NOT NULL DEFAULT 0,
      total_paid_orders INTEGER NOT NULL DEFAULT 0,
      total_spent INTEGER NOT NULL DEFAULT 0,
      total_paid_amount INTEGER NOT NULL DEFAULT 0,
      last_order_code TEXT,
      last_order_at TEXT,
      last_completed_at TEXT,
      PRIMARY KEY (guild_id, customer_id)
    );

    CREATE TABLE IF NOT EXISTS customer_flags (
      guild_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      warning_count INTEGER NOT NULL DEFAULT 0,
      is_blacklisted INTEGER NOT NULL DEFAULT 0,
      blacklist_reason TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, customer_id)
    );

    CREATE TABLE IF NOT EXISTS staff_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      actor_id TEXT,
      target_id TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      related_order_code TEXT,
      related_ticket_code TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      related_code TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS wallet_topup_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topup_code TEXT UNIQUE,
      guild_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      payos_order_code INTEGER UNIQUE,
      payment_link_id TEXT,
      payment_checkout_url TEXT,
      payment_qr_code TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      paid_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payment_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_code TEXT,
      provider TEXT NOT NULL,
      transaction_id TEXT NOT NULL,
      amount INTEGER,
      content TEXT,
      raw_payload TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, transaction_id)
    );

    CREATE TABLE IF NOT EXISTS abuse_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS scam_image_fingerprints (
      sha256 TEXT PRIMARY KEY,
      verdict TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      category TEXT,
      signals_json TEXT,
      visible_text TEXT,
      reason TEXT,
      first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_scanned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      hit_count INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS owner_ping_enforcement (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      window_started_at TEXT NOT NULL,
      mention_count INTEGER NOT NULL DEFAULT 0,
      penalty_level INTEGER NOT NULL DEFAULT 0,
      last_mention_at TEXT NOT NULL,
      last_penalty_at TEXT,
      policy_version INTEGER NOT NULL DEFAULT 2,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS ai_knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(guild_id)
    );

    CREATE TABLE IF NOT EXISTS product_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      price INTEGER NOT NULL DEFAULT 0,
      duration_months INTEGER NOT NULL DEFAULT 1,
      service_type TEXT DEFAULT 'other',
      emoji TEXT DEFAULT '📦',
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      stock_channel_id TEXT,
      stock_message_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS subscription_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      service_type TEXT NOT NULL DEFAULT 'nitro',
      renewal_mode TEXT NOT NULL DEFAULT 'auto_cycle',
      gmail_email TEXT NOT NULL,
      gmail_password TEXT NOT NULL,
      customer_id TEXT,
      customer_discord_name TEXT,
      related_order_code TEXT,
      purchase_date TEXT NOT NULL,
      total_duration_months INTEGER NOT NULL DEFAULT 2,
      renewal_cycle_months INTEGER NOT NULL DEFAULT 2,
      next_renewal_at TEXT,
      expiry_at TEXT NOT NULL,
      times_renewed INTEGER NOT NULL DEFAULT 0,
      spotify_family_name TEXT,
      spotify_slots_used INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      renewal_remind_sent_at TEXT,
      customer_response TEXT,
      admin_reminder_stage TEXT,
      admin_reminder_sent_at TEXT,
      admin_reminder_message_id TEXT,
      admin_reminder_channel_id TEXT,
      admin_claimed_by_id TEXT,
      admin_claimed_at TEXT,
      admin_snoozed_until TEXT,
      admin_last_action_at TEXT,
      progress_status TEXT NOT NULL DEFAULT 'VERIFIED',
      progress_review_note TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS subscription_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      fulfilled_months INTEGER,
      total_months INTEGER,
      scheduled_for TEXT,
      actor_id TEXT,
      source TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (subscription_id) REFERENCES subscription_accounts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_subscription_events_subscription
      ON subscription_events (subscription_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_subscription_events_guild
      ON subscription_events (guild_id, event_type, created_at DESC);

    CREATE TABLE IF NOT EXISTS spotify_families (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      login_email TEXT NOT NULL,
      login_password TEXT NOT NULL,
      payment_card_label TEXT,
      payment_card_number TEXT,
      renewal_cost INTEGER NOT NULL DEFAULT 0,
      total_slots INTEGER NOT NULL DEFAULT 6,
      cycle_started_at TEXT NOT NULL,
      next_renewal_at TEXT NOT NULL,
      reminder_days_before INTEGER NOT NULL DEFAULT 7,
      reminder_stage TEXT,
      reminder_sent_at TEXT,
      reminder_for_renewal_at TEXT,
      reminder_message_id TEXT,
      reminder_channel_id TEXT,
      snoozed_until TEXT,
      times_renewed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS spotify_family_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      family_id INTEGER NOT NULL,
      spotify_username TEXT NOT NULL,
      spotify_email TEXT,
      customer_name TEXT,
      discord_id TEXT,
      related_order_code TEXT,
      joined_at TEXT NOT NULL,
      purchased_months INTEGER NOT NULL DEFAULT 1,
      member_expiry_at TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (family_id) REFERENCES spotify_families(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS youtube_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      contact TEXT,
      payment_method TEXT,
      payment_account TEXT,
      default_cycle_cost INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS youtube_memberships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      customer_gmail TEXT NOT NULL,
      customer_name TEXT,
      customer_discord_id TEXT,
      related_order_code TEXT,
      plan_type TEXT NOT NULL DEFAULT 'STABLE_FAMILY',
      current_family_label TEXT,
      total_months INTEGER NOT NULL DEFAULT 1,
      cycle_months INTEGER NOT NULL DEFAULT 1,
      paid_cycles INTEGER NOT NULL DEFAULT 0,
      sale_price INTEGER NOT NULL DEFAULT 0,
      source_cost_per_cycle INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      next_source_payment_at TEXT,
      customer_expiry_at TEXT NOT NULL,
      reminder_days_before INTEGER NOT NULL DEFAULT 7,
      reminder_stage TEXT,
      reminder_sent_at TEXT,
      reminder_for_payment_at TEXT,
      reminder_message_id TEXT,
      reminder_channel_id TEXT,
      snoozed_until TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (source_id) REFERENCES youtube_sources(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS youtube_renewal_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      membership_id INTEGER NOT NULL,
      source_id INTEGER,
      event_type TEXT NOT NULL DEFAULT 'PAYMENT',
      cycle_number INTEGER,
      cycles_added INTEGER NOT NULL DEFAULT 0,
      months_added INTEGER NOT NULL DEFAULT 0,
      amount_paid INTEGER NOT NULL DEFAULT 0,
      paid_at TEXT,
      payment_reference TEXT,
      family_label TEXT,
      previous_next_payment_at TEXT,
      next_payment_at TEXT,
      actor_id TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (membership_id) REFERENCES youtube_memberships(id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES youtube_sources(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_youtube_sources_guild
      ON youtube_sources (guild_id, status, name);
    CREATE INDEX IF NOT EXISTS idx_youtube_memberships_due
      ON youtube_memberships (guild_id, status, next_source_payment_at, snoozed_until);
    CREATE INDEX IF NOT EXISTS idx_youtube_memberships_source
      ON youtube_memberships (source_id, status, customer_expiry_at);
    CREATE INDEX IF NOT EXISTS idx_youtube_renewal_events_membership
      ON youtube_renewal_events (membership_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS youtube_warranty_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      claim_code TEXT UNIQUE NOT NULL,
      access_token_hash TEXT UNIQUE NOT NULL,
      access_token_encrypted TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      order_code TEXT NOT NULL,
      ticket_id INTEGER NOT NULL UNIQUE,
      ticket_channel_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      customer_gmail TEXT,
      status TEXT NOT NULL DEFAULT 'AWAITING_CUSTOMER',
      notification_message_id TEXT,
      submitted_at TEXT,
      completed_at TEXT,
      completed_by_id TEXT,
      completion_note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revision INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS quest_service_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      price INTEGER NOT NULL,
      regions_json TEXT NOT NULL DEFAULT '[]',
      estimated_days INTEGER NOT NULL DEFAULT 3,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS quest_service_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_code TEXT UNIQUE NOT NULL,
      client_request_id TEXT UNIQUE,
      guild_id TEXT NOT NULL,
      web_user_id TEXT,
      discord_id TEXT NOT NULL,
      discord_username TEXT,
      plan_code TEXT NOT NULL,
      quoted_price INTEGER NOT NULL,
      quest_name TEXT NOT NULL,
      game_name TEXT,
      reward_name TEXT,
      region TEXT,
      quest_deadline_at TEXT,
      customer_note TEXT,
      related_order_code TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
      progress_percent INTEGER NOT NULL DEFAULT 0,
      current_step TEXT NOT NULL DEFAULT 'Đã tiếp nhận yêu cầu',
      rejection_reason TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (plan_code) REFERENCES quest_service_plans(code) ON UPDATE CASCADE
    );

    CREATE TABLE IF NOT EXISTS quest_service_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      progress_percent INTEGER,
      actor_id TEXT,
      customer_visible INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (request_id) REFERENCES quest_service_requests(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS web_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      display_name TEXT,
      discord_id TEXT UNIQUE,
      discord_username TEXT,
      discord_avatar TEXT,
      google_id TEXT UNIQUE,
      google_email TEXT,
      auth_provider TEXT DEFAULT 'email',
      role TEXT DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES web_users(id)
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_guild_customer_status ON tickets (guild_id, customer_id, status);
    CREATE INDEX IF NOT EXISTS idx_tickets_related_order ON tickets (related_order_code, status);
    CREATE INDEX IF NOT EXISTS idx_tickets_auto_close ON tickets (auto_close_at, status);
    CREATE INDEX IF NOT EXISTS idx_orders_guild_customer_status ON orders (guild_id, customer_id, status);
    CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders (payment_status, status);
    CREATE INDEX IF NOT EXISTS idx_orders_feedback_due_at ON orders (feedback_due_at);
    CREATE INDEX IF NOT EXISTS idx_orders_payment_code ON orders (payment_code);
    CREATE INDEX IF NOT EXISTS idx_orders_payos_order_code ON orders (payos_order_code);
    CREATE INDEX IF NOT EXISTS idx_orders_payment_link_id ON orders (payment_link_id);
    CREATE INDEX IF NOT EXISTS idx_orders_queue ON orders (guild_id, queue_group, priority_rank, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_expiry_at ON orders (expiry_at, status);
    CREATE INDEX IF NOT EXISTS idx_abuse_events ON abuse_events (guild_id, user_id, action, created_at);
    CREATE INDEX IF NOT EXISTS idx_scam_fingerprint_verdict
      ON scam_image_fingerprints (verdict, last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_owner_ping_enforcement
      ON owner_ping_enforcement (guild_id, last_mention_at);
    CREATE INDEX IF NOT EXISTS idx_invite_campaign_entries_due
      ON invite_campaign_entries (event_key, status, qualifies_at);
    CREATE INDEX IF NOT EXISTS idx_invite_campaign_entries_inviter
      ON invite_campaign_entries (event_key, guild_id, inviter_id, status);
    CREATE INDEX IF NOT EXISTS idx_invite_campaign_rewards_notify
      ON invite_campaign_rewards (event_key, admin_notified_at, user_notified_at);
    CREATE INDEX IF NOT EXISTS idx_product_catalog_guild ON product_catalog (guild_id, is_active, sort_order);
    CREATE INDEX IF NOT EXISTS idx_sub_accounts_guild_status ON subscription_accounts (guild_id, status, service_type);
    CREATE INDEX IF NOT EXISTS idx_sub_accounts_renewal ON subscription_accounts (next_renewal_at, status);
    CREATE INDEX IF NOT EXISTS idx_sub_accounts_expiry ON subscription_accounts (expiry_at, status);
    CREATE INDEX IF NOT EXISTS idx_sub_accounts_related_order ON subscription_accounts (related_order_code);

    CREATE INDEX IF NOT EXISTS idx_wallet_trans_customer ON wallet_transactions (guild_id, customer_id);
    CREATE INDEX IF NOT EXISTS idx_wallet_topups_code ON wallet_topup_orders (topup_code);
    CREATE INDEX IF NOT EXISTS idx_wallet_topups_payos ON wallet_topup_orders (payos_order_code);

    CREATE TABLE IF NOT EXISTS shop_panels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT,
      image_url TEXT,
      features TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_shop_panels_guild ON shop_panels (guild_id);
    CREATE INDEX IF NOT EXISTS idx_shop_panels_message ON shop_panels (message_id);

    CREATE TABLE IF NOT EXISTS account_stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_type TEXT NOT NULL,
      credentials TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'AVAILABLE',
      order_code TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sold_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_account_stock_service ON account_stock (service_type, status);
  `);

  // Legacy releases may have created these tables without the timestamp
  // columns. Add the columns before creating indexes that reference them.
  for (const [columnName, definitionSql] of [
    ['claim_code', 'TEXT'],
    ['access_token_hash', 'TEXT'],
    ['access_token_encrypted', 'TEXT'],
    ['guild_id', 'TEXT'],
    ['order_code', 'TEXT'],
    ['ticket_id', 'INTEGER'],
    ['ticket_channel_id', 'TEXT'],
    ['customer_id', 'TEXT'],
    ['customer_gmail', 'TEXT'],
    ['status', "TEXT DEFAULT 'AWAITING_CUSTOMER'"],
    ['notification_message_id', 'TEXT'],
    ['submitted_at', 'TEXT'],
    ['completed_at', 'TEXT'],
    ['completed_by_id', 'TEXT'],
    ['completion_note', 'TEXT'],
    ['guidance_acknowledged_at', 'TEXT'],
    ['created_at', 'TEXT'],
    ['updated_at', 'TEXT'],
    ['revision', 'INTEGER NOT NULL DEFAULT 0'],
  ]) {
    ensureColumn('youtube_warranty_claims', columnName, definitionSql);
  }
  ensureColumn('quest_service_requests', 'updated_at', 'TEXT');
  db.exec(`
    UPDATE youtube_warranty_claims
    SET updated_at = COALESCE(NULLIF(updated_at, ''), created_at, CURRENT_TIMESTAMP)
    WHERE updated_at IS NULL OR TRIM(updated_at) = '';
    UPDATE quest_service_requests
    SET updated_at = COALESCE(NULLIF(updated_at, ''), created_at, CURRENT_TIMESTAMP)
    WHERE updated_at IS NULL OR TRIM(updated_at) = '';
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_youtube_warranty_claims_status
      ON youtube_warranty_claims (guild_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_youtube_warranty_claims_order
      ON youtube_warranty_claims (order_code, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_quest_service_requests_customer
      ON quest_service_requests (discord_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_quest_service_requests_queue
      ON quest_service_requests (status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_quest_service_events_request
      ON quest_service_events (request_id, created_at ASC);
  `);

  // Một số database Store 1 cũ đã có bảng Spotify Family thử nghiệm với ít
  // cột hơn. CREATE TABLE IF NOT EXISTS không nâng cấp bảng đó, vì vậy phải
  // bổ sung cột trước khi tạo index. Nếu làm ngược thứ tự, SQLite dừng toàn bộ
  // quá trình boot với lỗi "no such column" trong khi database mới vẫn chạy.
  ensureColumn('spotify_families', 'guild_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('spotify_families', 'name', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('spotify_families', 'login_email', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('spotify_families', 'login_password', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('spotify_families', 'payment_card_label', 'TEXT');
  ensureColumn('spotify_families', 'payment_card_number', 'TEXT');
  ensureColumn('spotify_families', 'renewal_cost', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('spotify_families', 'total_slots', 'INTEGER NOT NULL DEFAULT 6');
  ensureColumn('spotify_families', 'cycle_started_at', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('spotify_families', 'next_renewal_at', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('spotify_families', 'reminder_days_before', 'INTEGER NOT NULL DEFAULT 7');
  ensureColumn('spotify_families', 'reminder_stage', 'TEXT');
  ensureColumn('spotify_families', 'reminder_sent_at', 'TEXT');
  ensureColumn('spotify_families', 'reminder_for_renewal_at', 'TEXT');
  ensureColumn('spotify_families', 'reminder_message_id', 'TEXT');
  ensureColumn('spotify_families', 'reminder_channel_id', 'TEXT');
  ensureColumn('spotify_families', 'snoozed_until', 'TEXT');
  ensureColumn('spotify_families', 'times_renewed', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('spotify_families', 'status', "TEXT NOT NULL DEFAULT 'ACTIVE'");
  ensureColumn('spotify_families', 'note', 'TEXT');
  ensureColumn('spotify_families', 'created_at', 'TEXT');
  ensureColumn('spotify_families', 'updated_at', 'TEXT');

  ensureColumn('spotify_family_members', 'family_id', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('spotify_family_members', 'spotify_username', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('spotify_family_members', 'spotify_email', 'TEXT');
  ensureColumn('spotify_family_members', 'customer_name', 'TEXT');
  ensureColumn('spotify_family_members', 'discord_id', 'TEXT');
  ensureColumn('spotify_family_members', 'related_order_code', 'TEXT');
  ensureColumn('spotify_family_members', 'joined_at', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('spotify_family_members', 'purchased_months', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('spotify_family_members', 'member_expiry_at', 'TEXT');
  ensureColumn('spotify_family_members', 'status', "TEXT NOT NULL DEFAULT 'ACTIVE'");
  ensureColumn('spotify_family_members', 'note', 'TEXT');
  ensureColumn('spotify_family_members', 'created_at', 'TEXT');
  ensureColumn('spotify_family_members', 'updated_at', 'TEXT');

  const spotifyMigrationNow = nowIso();
  db.prepare(`
    UPDATE spotify_families
    SET guild_id = CASE WHEN guild_id IS NULL OR guild_id = '' THEN ? ELSE guild_id END,
        name = CASE WHEN name IS NULL OR name = '' THEN 'Spotify Family #' || id ELSE name END,
        cycle_started_at = CASE WHEN cycle_started_at IS NULL OR cycle_started_at = '' THEN ? ELSE cycle_started_at END,
        next_renewal_at = CASE WHEN next_renewal_at IS NULL OR next_renewal_at = '' THEN datetime(?, '+1 month') ELSE next_renewal_at END,
        created_at = COALESCE(created_at, ?),
        updated_at = COALESCE(updated_at, ?)
  `).run(String(config.guildId || 'WEB'), spotifyMigrationNow, spotifyMigrationNow, spotifyMigrationNow, spotifyMigrationNow);
  db.prepare(`
    UPDATE spotify_family_members
    SET joined_at = CASE WHEN joined_at IS NULL OR joined_at = '' THEN ? ELSE joined_at END,
        created_at = COALESCE(created_at, ?),
        updated_at = COALESCE(updated_at, ?)
  `).run(spotifyMigrationNow, spotifyMigrationNow, spotifyMigrationNow);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_spotify_families_due
      ON spotify_families (guild_id, status, next_renewal_at, snoozed_until);
    CREATE INDEX IF NOT EXISTS idx_spotify_family_members_family
      ON spotify_family_members (family_id, status, joined_at);
  `);

  ensureColumn('guild_settings', 'warranty_category_id', 'TEXT');
  ensureColumn('guild_settings', 'shipper_role_id', 'TEXT');
  ensureColumn('guild_settings', 'manager_role_id', 'TEXT');
  ensureColumn('guild_settings', 'staff_log_channel_id', 'TEXT');
  ensureColumn('guild_settings', 'reminder_channel_id', 'TEXT');
  ensureColumn('guild_settings', 'admin_order_category_id', 'TEXT');
  ensureColumn('guild_settings', 'admin_order_channel_id', 'TEXT');
  ensureColumn('guild_settings', 'admin_order_panel_message_id', 'TEXT');
  ensureColumn('guild_settings', 'customer_role_id', 'TEXT');
  ensureColumn('guild_settings', 'loyal_role_id', 'TEXT');
  ensureColumn('guild_settings', 'vip_role_id', 'TEXT');
  ensureColumn('guild_settings', 'blacklist_role_id', 'TEXT');
  ensureColumn('guild_settings', 'bank_alias', 'TEXT');
  ensureColumn('guild_settings', 'bank_bin', 'TEXT');
  ensureColumn('guild_settings', 'bank_account_no', 'TEXT');
  ensureColumn('guild_settings', 'bank_account_name', 'TEXT');

  ensureColumn('tickets', 'ticket_type', "TEXT NOT NULL DEFAULT 'ORDER'");
  ensureColumn('tickets', 'related_order_code', 'TEXT');
  ensureColumn('tickets', 'ticket_subject', 'TEXT');
  ensureColumn('tickets', 'auto_close_at', 'TEXT');
  ensureColumn('tickets', 'keep_open_requested', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('tickets', 'ai_status', "TEXT NOT NULL DEFAULT 'ACTIVE'");
  ensureColumn('tickets', 'support_source', 'TEXT');
  ensureColumn('tickets', 'client_request_id', 'TEXT');
  ensureColumn('tickets', 'last_activity_at', 'TEXT');

  db.exec(`
    UPDATE tickets
    SET support_source = CASE
      WHEN ticket_type = 'SUPPORT' AND (channel_id LIKE 'live-%' OR channel_id LIKE 'web-%') THEN 'WEBSITE_AI'
      WHEN ticket_type = 'ORDER' AND channel_id LIKE 'web-%' THEN 'WEBSITE_ORDER'
      WHEN ticket_type IN ('ORDER', 'WARRANTY') THEN 'DISCORD_ORDER'
      ELSE 'DISCORD_SUPPORT'
    END
    WHERE support_source IS NULL OR support_source = '';

    UPDATE tickets
    SET last_activity_at = COALESCE(last_activity_at, created_at)
    WHERE last_activity_at IS NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_client_request_id
      ON tickets (client_request_id)
      WHERE client_request_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_tickets_support_queue
      ON tickets (support_source, status, last_activity_at);
  `);

  ensureColumn('orders', 'total_amount', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('orders', 'amount_paid', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('orders', 'admin_age_reminder_1w_sent_at', 'TEXT');
  ensureColumn('orders', 'admin_age_reminder_2w_sent_at', 'TEXT');
  ensureColumn('orders', 'payment_provider', "TEXT NOT NULL DEFAULT 'PAYOS'");
  ensureColumn('orders', 'payment_code', 'TEXT');
  ensureColumn('orders', 'payos_order_code', 'INTEGER');
  ensureColumn('orders', 'payment_link_id', 'TEXT');
  ensureColumn('orders', 'payment_merchant_trade_no', 'TEXT');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_payment_merchant_trade_no
    ON orders (payment_merchant_trade_no)
    WHERE payment_merchant_trade_no IS NOT NULL`);
  ensureColumn('orders', 'payment_checkout_url', 'TEXT');
  ensureColumn('orders', 'payment_qr_code', 'TEXT');
  ensureColumn('orders', 'payment_qr_url', 'TEXT');
  ensureColumn('orders', 'payment_qr_text', 'TEXT');
  ensureColumn('orders', 'payment_status', "TEXT NOT NULL DEFAULT 'UNPAID'");
  ensureColumn('orders', 'payment_message_id', 'TEXT');
  ensureColumn('orders', 'ctv_order_log_channel_id', 'TEXT');
  ensureColumn('orders', 'ctv_order_log_message_id', 'TEXT');
  ensureColumn('orders', 'payment_expired_at', 'TEXT');
  ensureColumn('orders', 'payment_cancel_reason', 'TEXT');
  ensureColumn('orders', 'paid_at', 'TEXT');
  ensureColumn('orders', 'paid_transaction_id', 'TEXT');
  ensureColumn('orders', 'paid_transaction_content', 'TEXT');
  ensureColumn('orders', 'duration_months', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('orders', 'duration_days', 'INTEGER');
  ensureColumn('orders', 'expiry_at', 'TEXT');
  ensureColumn('orders', 'expiry_notice_3d_sent_at', 'TEXT');
  ensureColumn('orders', 'expiry_notice_2d_sent_at', 'TEXT');
  ensureColumn('orders', 'expiry_notice_1d_sent_at', 'TEXT');
  ensureColumn('orders', 'expiry_notice_expired_sent_at', 'TEXT');
  ensureColumn('orders', 'credential_profile', 'TEXT');
  ensureColumn('orders', 'credential_pin', 'TEXT');
  ensureColumn('orders', 'delivery_login_url', 'TEXT');
  ensureColumn('orders', 'payment_reminder_sent_at', 'TEXT');
  ensureColumn('orders', 'processing_reminder_sent_at', 'TEXT');
  ensureColumn('orders', 'feedback_reminder_sent_at', 'TEXT');
  ensureColumn('orders', 'warranty_completed_at', 'TEXT');
  ensureColumn('orders', 'warranty_completed_by_id', 'TEXT');
  ensureColumn('orders', 'warranty_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('orders', 'status_changed_at', 'TEXT');
  ensureColumn('orders', 'queue_group', 'TEXT');
  ensureColumn('orders', 'priority_rank', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('orders', 'claimed_by_id', 'TEXT');
  ensureColumn('orders', 'claimed_at', 'TEXT');

  ensureColumn('product_catalog', 'require_email', 'INTEGER DEFAULT 0');
  ensureColumn('product_catalog', 'require_phone', 'INTEGER DEFAULT 0');

  // Thêm các cột mới cho form website
  ensureColumn('orders', 'service_type', "TEXT DEFAULT 'netflix'");
  ensureColumn('orders', 'customer_name', 'TEXT');
  ensureColumn('orders', 'customer_discord', 'TEXT');
  ensureColumn('orders', 'customer_gmail', 'TEXT');
  ensureColumn('orders', 'spotify_owner', 'TEXT');
  ensureColumn('orders', 'spotify_member', 'TEXT');
  ensureColumn('orders', 'discord_payment_gmail', 'TEXT');
  ensureColumn('orders', 'discord_renewal_cycle', 'INTEGER');
  ensureColumn('orders', 'history_json', 'TEXT');
  ensureColumn('orders', 'discord_sku_id', 'TEXT');
  ensureColumn('orders', 'discord_product_url', 'TEXT');
  ensureColumn('orders', 'discord_original_price', 'INTEGER');
  ensureColumn('orders', 'discord_nitro_eligible', 'INTEGER DEFAULT 0');

  // Guild settings — category riêng theo loại ticket
  ensureColumn('guild_settings', 'support_category_id', 'TEXT');
  ensureColumn('guild_settings', 'complaint_category_id', 'TEXT');
  ensureColumn('guild_settings', 'partnership_category_id', 'TEXT');

  // Panel customization — title, description, image
  ensureColumn('guild_settings', 'panel_title', 'TEXT');
  ensureColumn('guild_settings', 'panel_description', 'TEXT');
  ensureColumn('guild_settings', 'panel_image_url', 'TEXT');

  // Customer flags — mute ticket (ngăn tạo ticket)
  ensureColumn('customer_flags', 'is_ticket_muted', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('customer_flags', 'ticket_mute_reason', 'TEXT');
  // Existing rows receive v1 so ownerPingGuardService can reset counters that
  // may have been inflated by Discord reply mentions before policy v2.
  ensureColumn('owner_ping_enforcement', 'policy_version', 'INTEGER NOT NULL DEFAULT 1');

  // Subscription admin workflow — staged Store 1 alerts, claim and snooze state.
  ensureColumn('subscription_accounts', 'admin_reminder_stage', 'TEXT');
  ensureColumn('subscription_accounts', 'admin_reminder_sent_at', 'TEXT');
  ensureColumn('subscription_accounts', 'admin_reminder_message_id', 'TEXT');
  ensureColumn('subscription_accounts', 'admin_reminder_channel_id', 'TEXT');
  ensureColumn('subscription_accounts', 'admin_claimed_by_id', 'TEXT');
  ensureColumn('subscription_accounts', 'admin_claimed_at', 'TEXT');
  ensureColumn('subscription_accounts', 'admin_snoozed_until', 'TEXT');
  ensureColumn('subscription_accounts', 'admin_last_action_at', 'TEXT');
  ensureColumn('subscription_accounts', 'progress_status', "TEXT NOT NULL DEFAULT 'VERIFIED'");
  ensureColumn('subscription_accounts', 'progress_review_note', 'TEXT');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sub_accounts_admin_reminder
    ON subscription_accounts (guild_id, status, admin_snoozed_until, next_renewal_at, expiry_at)`);

  // Thêm ví điện tử
  ensureColumn('customer_profiles', 'wallet_balance', 'INTEGER NOT NULL DEFAULT 0');

  // Custom emoji slots cho từng guild
  ensureColumn('guild_settings', 'custom_emojis', 'TEXT');

  ensureColumn('guild_settings', 'sale_channel_id', 'TEXT');
  ensureColumn('guild_settings', 'sale_message_id', 'TEXT');
  ensureColumn('guild_settings', 'sale_percent', 'INTEGER DEFAULT 0');

  ensureColumn('guild_settings', 'warranty_log_channel_id', 'TEXT');
  ensureColumn('guild_settings', 'public_order_log_channel_id', 'TEXT');
  ensureColumn('guild_settings', 'price_list_channel_id', 'TEXT');
  ensureColumn('guild_settings', 'price_list_message_id', 'TEXT');
  ensureColumn('guild_settings', 'price_list_title', 'TEXT');
  ensureColumn('guild_settings', 'price_list_description', 'TEXT');
  ensureColumn('guild_settings', 'price_list_image_url', 'TEXT');
  ensureColumn('guild_settings', 'price_list_category_configs', 'TEXT');

  ensureColumn('product_catalog', 'original_price', 'INTEGER DEFAULT 0');

  // Thêm các trường cho sản phẩm Claude API & Locket Gold
  ensureColumn('product_catalog', 'base_price', 'INTEGER');
  ensureColumn('product_catalog', 'base_duration_days', 'INTEGER');
  ensureColumn('product_catalog', 'additional_day_price', 'INTEGER');
  ensureColumn('product_catalog', 'minimum_days', 'INTEGER');
  ensureColumn('product_catalog', 'maximum_days', 'INTEGER');
  ensureColumn('product_catalog', 'quota_value', 'INTEGER');
  ensureColumn('product_catalog', 'quota_unit', 'TEXT');
  ensureColumn('product_catalog', 'activation_method', 'TEXT');
  ensureColumn('product_catalog', 'username_required', 'INTEGER DEFAULT 0');
  ensureColumn('product_catalog', 'login_required', 'INTEGER DEFAULT 0');
  ensureColumn('product_catalog', 'stock_status', 'TEXT');
  ensureColumn('product_catalog', 'warranty_policy', 'TEXT');
  ensureColumn('product_catalog', 'delivery_instructions', 'TEXT');
  ensureColumn('product_catalog', 'estimated_delivery_time', 'TEXT');
  ensureColumn('product_catalog', 'product_key', 'TEXT');
  ensureColumn('product_catalog', 'is_featured', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('product_catalog', 'virtual_purchase_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('product_catalog', 'image_url', 'TEXT');
  ensureColumn('feedbacks', 'product_id', 'INTEGER');
  ensureColumn('feedbacks', 'product_name', 'TEXT');
  ensureColumn('feedbacks', 'is_visible', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('feedbacks', 'updated_at', 'TEXT');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_product_catalog_key ON product_catalog (guild_id, product_key);
    CREATE INDEX IF NOT EXISTS idx_feedbacks_product ON feedbacks (product_id, is_visible, created_at);
  `);

  db.prepare(`
    UPDATE feedbacks
    SET product_name = COALESCE(
      product_name,
      (SELECT product_name FROM orders WHERE orders.id = feedbacks.order_id),
      (SELECT product_name FROM orders WHERE orders.order_code = feedbacks.order_code)
    )
    WHERE product_name IS NULL
  `).run();
  // ─── Boost Server Live ───────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS boost_server_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_code TEXT UNIQUE NOT NULL,
      guild_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      customer_tag TEXT,
      server_link TEXT NOT NULL,
      server_id TEXT NOT NULL,
      server_name TEXT,
      package TEXT NOT NULL,
      duration_months INTEGER NOT NULL DEFAULT 1,
      amount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING',
      boost_started_at TEXT,
      boost_expires_at TEXT,
      note TEXT,
      handled_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_boost_orders_guild ON boost_server_orders (guild_id, status);
    CREATE INDEX IF NOT EXISTS idx_boost_orders_customer ON boost_server_orders (customer_id, guild_id);
    CREATE INDEX IF NOT EXISTS idx_boost_orders_server ON boost_server_orders (server_id, guild_id, status);
  `);
  ensureColumn('guild_settings', 'boost_panel_channel_id', 'TEXT');
  ensureColumn('guild_settings', 'boost_panel_message_id', 'TEXT');
  ensureColumn('guild_settings', 'boost_log_channel_id', 'TEXT');
  ensureColumn('boost_server_orders', 'payos_order_code', 'INTEGER');
  ensureColumn('boost_server_orders', 'payment_checkout_url', 'TEXT');
  ensureColumn('boost_server_orders', 'payment_link_id', 'TEXT');
  ensureColumn('boost_server_orders', 'payment_status', 'TEXT NOT NULL DEFAULT "PENDING"');
  ensureColumn('boost_server_orders', 'payment_qr_code', 'TEXT');
  // ─────────────────────────────────────────────────────────────────────────

  // Add missing columns to oauth_backups for backward compatibility
  ensureColumn('oauth_backups', 'guild_id', 'TEXT NOT NULL DEFAULT ""');
  ensureColumn('oauth_backups', 'avatar', 'TEXT');
  ensureColumn('oauth_backups', 'token_expires_at', 'TEXT');
  ensureColumn('oauth_backups', 'last_refreshed_at', 'TEXT');
  ensureColumn('oauth_backups', 'scopes', 'TEXT');
  ensureColumn('oauth_backups', 'recovery_consent_at', 'TEXT');
  ensureColumn('oauth_backups', 'member_roles_json', 'TEXT NOT NULL DEFAULT "[]"');
  // CTV pricing is part of the canonical seed. Ensure this migration runs
  // before seedProductCatalog so a brand-new database can be seeded in one boot.
  ensureColumn('product_catalog', 'ctv_price', 'INTEGER DEFAULT NULL');

  // Seed product catalog data
  try {
    seedProductCatalog(db);
  } catch (err) {
    console.error('❌ Failed to seed products:', err.message);
  }

  // ═══════════════════════════════════════════════
  // Phase 8: VIP Tiers (DB-driven)
  // ═══════════════════════════════════════════════
  db.exec(`
    CREATE TABLE IF NOT EXISTS vip_tiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      name TEXT NOT NULL,
      emoji TEXT DEFAULT '⭐',
      min_spent INTEGER NOT NULL DEFAULT 0,
      min_orders INTEGER NOT NULL DEFAULT 0,
      require_first_order INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_vip_tiers_guild ON vip_tiers (guild_id, sort_order);

    CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      code TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'percent',
      value INTEGER NOT NULL DEFAULT 0,
      min_order INTEGER NOT NULL DEFAULT 0,
      max_uses INTEGER NOT NULL DEFAULT 0,
      used_count INTEGER NOT NULL DEFAULT 0,
      max_per_user INTEGER NOT NULL DEFAULT 1,
      product_filter TEXT,
      expires_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(guild_id, code)
    );
    CREATE INDEX IF NOT EXISTS idx_coupons_guild ON coupons (guild_id, code, is_active);

    CREATE TABLE IF NOT EXISTS coupon_usages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      coupon_id INTEGER NOT NULL,
      customer_id TEXT NOT NULL,
      order_code TEXT,
      discount_amount INTEGER NOT NULL DEFAULT 0,
      used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (coupon_id) REFERENCES coupons(id)
    );
    CREATE INDEX IF NOT EXISTS idx_coupon_usages ON coupon_usages (coupon_id, customer_id);

    CREATE TABLE IF NOT EXISTS referral_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      customer_id TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE,
      total_referrals INTEGER NOT NULL DEFAULT 0,
      total_earned INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_referral_codes ON referral_codes (guild_id, code);

    CREATE TABLE IF NOT EXISTS referral_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      referrer_id TEXT NOT NULL,
      referred_id TEXT NOT NULL,
      order_code TEXT,
      reward_amount INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_referral_events ON referral_events (referrer_id);

    CREATE TABLE IF NOT EXISTS loyalty_points (
      guild_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      lifetime_points INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, customer_id)
    );

    CREATE TABLE IF NOT EXISTS loyalty_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      points INTEGER NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      related_code TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_loyalty_tx ON loyalty_transactions (guild_id, customer_id);

    CREATE TABLE IF NOT EXISTS ai_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      customer_id TEXT,
      messages_json TEXT NOT NULL DEFAULT '[]',
      message_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(channel_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ai_conv ON ai_conversations (channel_id);

    CREATE TABLE IF NOT EXISTS oauth_backups (
      discord_id TEXT NOT NULL,
      guild_id   TEXT NOT NULL DEFAULT '',
      username   TEXT,
      email      TEXT,
      avatar     TEXT,
      access_token      TEXT,
      refresh_token     TEXT,
      token_expires_at  TEXT,
      last_refreshed_at TEXT,
      scopes TEXT,
      recovery_consent_at TEXT,
      member_roles_json TEXT NOT NULL DEFAULT '[]',
      verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (discord_id, guild_id)
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_guild ON oauth_backups (guild_id);

    CREATE TABLE IF NOT EXISTS guild_recovery_snapshots (
      guild_id TEXT PRIMARY KEY,
      captured_at TEXT NOT NULL,
      structure_hash TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      member_count INTEGER NOT NULL DEFAULT 0,
      authorized_member_count INTEGER NOT NULL DEFAULT 0,
      customer_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      partner_guild_id TEXT NOT NULL,
      partner_name TEXT NOT NULL,
      invite_link TEXT NOT NULL,
      member_count INTEGER NOT NULL DEFAULT 0,
      owner_id TEXT NOT NULL,
      applicant_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      review_mode TEXT NOT NULL DEFAULT 'STANDARD',
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS partner_settings (
      guild_id TEXT PRIMARY KEY,
      recruit_channel_id TEXT,
      approve_channel_id TEXT,
      partner_role_id TEXT,
      directory_channel_id TEXT,
      partner_channel_id TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ctv_settings (
      guild_id TEXT PRIMARY KEY,
      recruit_channel_id TEXT,
      approve_channel_id TEXT,
      ctv_role_id TEXT,
      category_id TEXT,
      chat_channel_id TEXT,
      order_log_channel_id TEXT,
      price_channel_id TEXT,
      price_message_id TEXT,
      price_message_ids TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ctv_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      applicant_id TEXT NOT NULL,
      source TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ctv_applications_guild_status
      ON ctv_applications (guild_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_ctv_applications_applicant
      ON ctv_applications (guild_id, applicant_id, created_at);

    CREATE TABLE IF NOT EXISTS partner_mention_usage (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      window_started_at TEXT NOT NULL,
      partner_mentions INTEGER NOT NULL DEFAULT 0,
      everyone_mentions INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS viotp_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      service_id INTEGER NOT NULL,
      service_name TEXT NOT NULL,
      price INTEGER NOT NULL,
      request_id TEXT NOT NULL UNIQUE,
      phone_number TEXT,
      otp_code TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS card_charging_orders (
      request_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      telco TEXT NOT NULL,
      code TEXT NOT NULL,
      serial TEXT NOT NULL,
      declared_value INTEGER NOT NULL,
      value INTEGER,
      amount INTEGER,
      trans_id TEXT,
      status TEXT DEFAULT 'PENDING',
      message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS card_buy_orders (
      request_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      service_code TEXT NOT NULL,
      value INTEGER NOT NULL,
      qty INTEGER NOT NULL,
      total_price INTEGER NOT NULL,
      cards_data TEXT,
      status TEXT DEFAULT 'PENDING',
      message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS music_guild_settings (
      guild_id TEXT PRIMARY KEY,
      default_volume INTEGER NOT NULL DEFAULT 80 CHECK(default_volume BETWEEN 0 AND 100),
      default_voice_channel_id TEXT,
      dj_role_id TEXT,
      allow_member_control INTEGER NOT NULL DEFAULT 1,
      max_queue_size INTEGER NOT NULL DEFAULT 100 CHECK(max_queue_size BETWEEN 1 AND 200),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS music_play_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      track_id TEXT,
      track_url TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT,
      thumbnail TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      requested_by TEXT,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'PLAYING',
      error_message TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_music_history_guild_started
      ON music_play_history (guild_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_music_history_track
      ON music_play_history (guild_id, track_id, status);

    CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_expiry_at ON orders(expiry_at);
    CREATE INDEX IF NOT EXISTS idx_tickets_customer_id ON tickets(customer_id);
  `);

  ensureColumn('guild_settings', 'cardswap_partner_id', 'TEXT DEFAULT NULL');
  ensureColumn('guild_settings', 'cardswap_partner_key', 'TEXT DEFAULT NULL');
  ensureColumn('guild_settings', 'cardswap_buy_partner_id', 'TEXT DEFAULT NULL');
  ensureColumn('guild_settings', 'cardswap_buy_partner_key', 'TEXT DEFAULT NULL');
  ensureColumn('guild_settings', 'cardswap_domain', "TEXT DEFAULT 'card2k.net'");
  db.prepare("UPDATE guild_settings SET cardswap_domain = 'card2k.net' WHERE cardswap_domain IS NULL OR TRIM(cardswap_domain) = '' OR LOWER(cardswap_domain) = 'card2k.com'").run();
  ensureColumn('guild_settings', 'cardswap_charging_fee_add', "REAL DEFAULT 3.0");
  ensureColumn('guild_settings', 'cardswap_buy_profit_add', "INTEGER DEFAULT 3000");
  ensureColumn('card_charging_orders', 'source', "TEXT NOT NULL DEFAULT 'DISCORD'");
  ensureColumn('card_charging_orders', 'fee_percent', 'REAL');
  ensureColumn('card_charging_orders', 'credited_amount', 'INTEGER');
  db.prepare(`
    UPDATE guild_settings
    SET cardswap_charging_fee_add = 3.0
    WHERE cardswap_charging_fee_add IS NULL
       OR cardswap_charging_fee_add < 2.0
       OR cardswap_charging_fee_add > 3.0
  `).run();

  // --- DISCOUNT BOARD ---
  ensureColumn('guild_settings', 'discount_board_channel_id', 'TEXT DEFAULT NULL');
  ensureColumn('guild_settings', 'discount_board_message_id', 'TEXT DEFAULT NULL');

  ensureColumn('customer_profiles', 'is_ctv', 'INTEGER DEFAULT 0');
  ensureColumn('customer_profiles', 'ctv_joined_at', 'TEXT');
  ensureColumn('product_catalog', 'ctv_price', 'INTEGER DEFAULT NULL');
  ensureColumn('partner_settings', 'partner_channel_id', 'TEXT');
  ensureColumn('partners', 'review_mode', "TEXT NOT NULL DEFAULT 'STANDARD'");
  ensureColumn('partners', 'community_profile', 'TEXT');
  ensureColumn('partners', 'weekly_activity', 'TEXT');
  ensureColumn('partners', 'collaboration_plan', 'TEXT');
  ensureColumn('partners', 'agreed_terms', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('partners', 'server_created_at', 'TEXT');
  ensureColumn('ctv_settings', 'category_id', 'TEXT');
  ensureColumn('ctv_settings', 'chat_channel_id', 'TEXT');
  ensureColumn('ctv_settings', 'order_log_channel_id', 'TEXT');
  ensureColumn('ctv_settings', 'price_channel_id', 'TEXT');
  ensureColumn('ctv_settings', 'price_message_id', 'TEXT');
  ensureColumn('ctv_settings', 'price_message_ids', 'TEXT');
  ensureColumn('ctv_settings', 'recruitment_capacity', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('ctv_settings', 'recruitment_filled', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('ctv_settings', 'recruitment_campaign_started_at', 'TEXT');
  ensureColumn('ctv_settings', 'recruitment_message_id', 'TEXT');
  ensureColumn('ctv_settings', 'recruitment_full_notice_message_id', 'TEXT');
  ensureColumn('customer_profiles', 'credit_limit', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('customer_profiles', 'credit_used', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('customer_profiles', 'credit_status', "TEXT NOT NULL DEFAULT 'ACTIVE'");

  // OAuth recovery token là credential nhạy cảm. Migrate dữ liệu legacy dạng
  // plaintext sang AES-256-GCM ngay khi khởi động, không chờ token hết hạn.
  ensureColumn('oauth_backups', 'scopes', 'TEXT');
  ensureColumn('oauth_backups', 'recovery_consent_at', 'TEXT');
  ensureColumn('oauth_backups', 'member_roles_json', 'TEXT NOT NULL DEFAULT "[]"');
  db.prepare(`
    UPDATE oauth_backups
    SET scopes = COALESCE(NULLIF(scopes, ''), 'identify guilds.join'),
        recovery_consent_at = COALESCE(recovery_consent_at, verified_at)
    WHERE refresh_token IS NOT NULL AND refresh_token != ''
  `).run();
  const legacyOauthRows = db.prepare(`
    SELECT discord_id, guild_id, access_token, refresh_token
    FROM oauth_backups
    WHERE (access_token IS NOT NULL AND access_token != '')
       OR (refresh_token IS NOT NULL AND refresh_token != '')
  `).all().filter((row) => (
    (row.access_token && !isEncrypted(row.access_token))
    || (row.refresh_token && !isEncrypted(row.refresh_token))
  ));
  if (legacyOauthRows.length > 0) {
    const migrateToken = db.prepare(`
      UPDATE oauth_backups
      SET access_token = ?, refresh_token = ?
      WHERE discord_id = ? AND guild_id = ?
    `);
    db.transaction(() => {
      for (const row of legacyOauthRows) {
        migrateToken.run(
          row.access_token ? encrypt(row.access_token) : null,
          row.refresh_token ? encrypt(row.refresh_token) : null,
          row.discord_id,
          row.guild_id,
        );
      }
    })();
    console.log(`[DB-MIGRATION] Đã mã hóa ${legacyOauthRows.length} bản ghi OAuth recovery legacy.`);
  }

  db.pragma('optimize');

}

export function nowIso() {
  return new Date().toISOString();
}

export function getDatabasePath() {
  return resolvedDatabasePath;
}

export const DEFAULT_PRODUCT_CATALOG = [
    // Discord Nitro Boost Log
    { name: 'Discord Nitro Boost 1 Tháng (Login)', description: 'Đăng nhập gia hạn. Vui lòng gửi tài khoản, mật khẩu và 4-5 mã dự phòng khi mua.', price: 90000, ctv_price: 85000, duration_months: 1, service_type: 'GAME', emoji: 'brand_nitro', original_price: 0 },
    { product_key: 'discord-nitro-boost-2-months-login-keep-mail-7-days', name: 'Discord Nitro Boost 2 Tháng (Login · Giữ Mail 7 Ngày)', aliases: ['Discord Nitro Boost 2 Tháng (Login)'], description: 'Gói login Nitro Boost 2 tháng. Khách hàng cần giữ mail tối thiểu 7 ngày, đăng nhập sớm và kiểm tra mail trong 10-30 phút sau khi nhận.', price: 115000, ctv_price: 95000, duration_months: 2, service_type: 'GAME', emoji: 'brand_nitro', original_price: 0 },
    { product_key: 'discord-nitro-boost-2-months-login-mail-guaranteed', name: 'Discord Nitro Boost 2 Tháng (Login · Mail Bao Sống)', description: 'Gói login Nitro Boost 2 tháng kèm mail bao sống. Đăng nhập sớm và kiểm tra mail trong 10-30 phút sau khi nhận; xác minh số điện thoại nếu hệ thống yêu cầu.', price: 140000, ctv_price: 95000, duration_months: 2, service_type: 'GAME', emoji: 'brand_nitro', original_price: 0 },
    { name: 'Discord Nitro Boost 4 Tháng (Login)', description: 'Đăng nhập gia hạn. Vui lòng gửi tài khoản, mật khẩu và 4-5 mã dự phòng khi mua. Gia hạn 2 tháng 1 lần.', price: 280000, ctv_price: 185000, duration_months: 4, service_type: 'GAME', emoji: 'brand_nitro', original_price: 0 },
    { name: 'Discord Nitro Boost 6 Tháng (Login)', description: 'Đăng nhập gia hạn. Vui lòng gửi tài khoản, mật khẩu và 4-5 mã dự phòng khi mua. Gia hạn 2 tháng 1 lần.', price: 380000, ctv_price: 365000, duration_months: 6, service_type: 'GAME', emoji: 'brand_nitro', original_price: 0 },
    { name: 'Discord Nitro Boost 8 Tháng (Login)', description: 'Đăng nhập gia hạn. Vui lòng gửi tài khoản, mật khẩu và 4-5 mã dự phòng khi mua. Gia hạn 2 tháng 1 lần.', price: 480000, ctv_price: 460000, duration_months: 8, service_type: 'GAME', emoji: 'brand_nitro', original_price: 0 },
    { name: 'Discord Nitro Boost 12 Tháng (Login)', description: 'Đăng nhập gia hạn. Vui lòng gửi tài khoản, mật khẩu và 4-5 mã dự phòng khi mua. Gia hạn 2 tháng 1 lần.', price: 680000, ctv_price: 580000, duration_months: 12, service_type: 'GAME', emoji: 'brand_nitro', original_price: 0 },
    { name: 'Discord Nitro Boost 1 Năm (Login)', description: 'Đăng nhập gia hạn. Vui lòng gửi tài khoản, mật khẩu và 4-5 mã dự phòng khi mua.', price: 880000, ctv_price: 795000, duration_months: 12, service_type: 'GAME', emoji: 'brand_nitro', original_price: 0 },
    { name: 'Gia hạn Discord Nitro Boost 2 Tháng', description: 'Dành cho khách hàng cũ đã từng mua Nitro 2 tháng tại shop. (Gia hạn chỉ 95k). Vui lòng gửi tài khoản, mật khẩu và 4-5 mã dự phòng khi mua.', price: 99000, ctv_price: 95000, duration_months: 2, service_type: 'GAME', emoji: 'brand_nitro', original_price: 0 },
    // Discord Nitro Boost Trial
    { product_key: 'discord-nitro-boost-trial-3-months-first-offer', name: 'Discord Nitro Boost Trial 3 Tháng (Ưu Đãi Lần Đầu)', aliases: ['Discord Nitro Boost 3 Tháng (Trail)'], description: 'Đối tượng áp dụng: tài khoản được tạo trên 1 tháng và chưa từng sử dụng Nitro; hoặc tài khoản đã từng sử dụng Nitro nhưng không dùng lại Nitro trong ít nhất 12 tháng liên tục. Vui lòng gửi tài khoản, mật khẩu và 4-5 mã dự phòng khi mua.', price: 50000, ctv_price: 45000, duration_months: 3, service_type: 'GAME', emoji: 'brand_nitro', original_price: 0 },

    // Bót Server
    { name: 'Discord Server Boost Level 2 (1 Tháng)', description: 'Nâng cấp Server Boost Level 2 trong 1 tháng. Giao hàng nhanh chóng.', price: 75000, duration_months: 1, service_type: 'GAME', emoji: 'brand_boost', original_price: 0 },
    { name: 'Discord Server Boost Level 3 (1 Tháng)', description: 'Nâng cấp Server Boost Level 3 trong 1 tháng. Giao hàng nhanh chóng.', price: 150000, ctv_price: 90000, duration_months: 1, service_type: 'GAME', emoji: 'brand_boost', original_price: 0 },
    { name: 'Discord Server Boost Level 2 (3 Tháng)', description: 'Nâng cấp Server Boost Level 2 trong 3 tháng. Giao hàng nhanh chóng.', price: 185000, duration_months: 3, service_type: 'GAME', emoji: 'brand_boost', original_price: 0 },
    { name: 'Discord Server Boost Level 3 (3 Tháng)', description: 'Nâng cấp Server Boost Level 3 trong 3 tháng. Giao hàng nhanh chóng.', price: 380000, ctv_price: 240000, duration_months: 3, service_type: 'GAME', emoji: 'brand_boost', original_price: 0 },

    // Decor Trang Trí - Có Nitro
    { name: 'Decor Discord (Acc Có Nitro) - Gói 25k', description: 'Trang trí hồ sơ cho tài khoản ĐÃ CÓ Nitro. Vui lòng gửi tài khoản, mật khẩu và 4-5 mã dự phòng.', price: 25000, duration_months: 1, service_type: 'decor', emoji: 'icon_sparkle', original_price: 66000 },
    { name: 'Decor Discord (Acc Có Nitro) - Gói 35k', description: 'Trang trí hồ sơ cho tài khoản ĐÃ CÓ Nitro. Vui lòng gửi tài khoản, mật khẩu và 4-5 mã dự phòng.', price: 35000, duration_months: 1, service_type: 'decor', emoji: 'icon_sparkle', original_price: 72000 },
    { name: 'Decor Discord (Acc Có Nitro) - Gói 50k', description: 'Trang trí hồ sơ cho tài khoản ĐÃ CÓ Nitro. Vui lòng gửi tài khoản, mật khẩu và 4-5 mã dự phòng.', price: 50000, duration_months: 1, service_type: 'decor', emoji: 'icon_sparkle', original_price: 92000 },
    { name: 'Decor Discord (Acc Có Nitro) - Gói 60k', description: 'Trang trí hồ sơ cho tài khoản ĐÃ CÓ Nitro. Vui lòng gửi tài khoản, mật khẩu và 4-5 mã dự phòng.', price: 60000, duration_months: 1, service_type: 'decor', emoji: 'icon_sparkle', original_price: 105000 },
    { name: 'Decor Discord (Acc Có Nitro) - Gói 70k', description: 'Trang trí hồ sơ cho tài khoản ĐÃ CÓ Nitro. Vui lòng gửi tài khoản, mật khẩu và 4-5 mã dự phòng.', price: 70000, duration_months: 1, service_type: 'decor', emoji: 'icon_sparkle', original_price: 111000 },
    { name: 'Decor Discord (Acc Có Nitro) - Gói 79k', description: 'Trang trí hồ sơ cho tài khoản ĐÃ CÓ Nitro. Vui lòng gửi tài khoản, mật khẩu và 4-5 mã dự phòng.', price: 79000, duration_months: 1, service_type: 'decor', emoji: 'icon_sparkle', original_price: 131000 },
    { name: 'Decor Discord (Acc Có Nitro) - Gói 88k', description: 'Trang trí hồ sơ cho tài khoản ĐÃ CÓ Nitro. Vui lòng gửi tài khoản, mật khẩu và 4-5 mã dự phòng.', price: 88000, duration_months: 1, service_type: 'decor', emoji: 'icon_sparkle', original_price: 141000 },

    // Decor Trang Trí - Không Nitro
    { name: 'Decor Discord (Acc Không Nitro) - Gói 35k', description: 'Trang trí hồ sơ cho tài khoản CHƯA CÓ Nitro. Vui lòng gửi tài khoản, mật khẩu và 4-5 mã dự phòng.', price: 35000, duration_months: 1, service_type: 'decor', emoji: 'brand_discord', original_price: 79000 },
    { name: 'Decor Discord (Acc Không Nitro) - Gói 60k', description: 'Trang trí hồ sơ cho tài khoản CHƯA CÓ Nitro. Vui lòng gửi tài khoản, mật khẩu và 4-5 mã dự phòng.', price: 60000, duration_months: 1, service_type: 'decor', emoji: 'brand_discord', original_price: 105000 },
    { name: 'Decor Discord (Acc Không Nitro) - Gói 80k', description: 'Trang trí hồ sơ cho tài khoản CHƯA CÓ Nitro. Vui lòng gửi tài khoản, mật khẩu và 4-5 mã dự phòng.', price: 80000, duration_months: 1, service_type: 'decor', emoji: 'brand_discord', original_price: 131000 },
    { name: 'Decor Discord (Acc Không Nitro) - Gói 90k', description: 'Trang trí hồ sơ cho tài khoản CHƯA CÓ Nitro. Vui lòng gửi tài khoản, mật khẩu và 4-5 mã dự phòng.', price: 90000, duration_months: 1, service_type: 'decor', emoji: 'brand_discord', original_price: 141000 },
    { name: 'Decor Discord (Acc Không Nitro) - Gói 95k', description: 'Trang trí hồ sơ cho tài khoản CHƯA CÓ Nitro. Vui lòng gửi tài khoản, mật khẩu và 4-5 mã dự phòng.', price: 95000, duration_months: 1, service_type: 'decor', emoji: 'brand_discord', original_price: 146000 },
    { name: 'Decor Discord (Acc Không Nitro) - Gói 110k', description: 'Trang trí hồ sơ cho tài khoản CHƯA CÓ Nitro. Vui lòng gửi tài khoản, mật khẩu và 4-5 mã dự phòng.', price: 110000, duration_months: 1, service_type: 'decor', emoji: 'brand_discord', original_price: 189000 },

    // Decor Trang Trí - Dạng Gift
    { name: 'Decor Discord Dạng Gift - Gói 50k', description: 'Trang trí hồ sơ dạng Gift (bấm nhận ngay). Tiết kiệm tối đa.', price: 50000, duration_months: 1, service_type: 'decor', emoji: '🎁', original_price: 66000 },
    { name: 'Decor Discord Dạng Gift - Gói 58k', description: 'Trang trí hồ sơ dạng Gift (bấm nhận ngay). Tiết kiệm tối đa.', price: 58000, duration_months: 1, service_type: 'decor', emoji: '🎁', original_price: 79000 },
    { name: 'Decor Discord Dạng Gift - Gói 70k', description: 'Trang trí hồ sơ dạng Gift (bấm nhận ngay). Tiết kiệm tối đa.', price: 70000, duration_months: 1, service_type: 'decor', emoji: '🎁', original_price: 92000 },
    { name: 'Decor Discord Dạng Gift - Gói 85k', description: 'Trang trí hồ sơ dạng Gift (bấm nhận ngay). Tiết kiệm tối đa.', price: 85000, duration_months: 1, service_type: 'decor', emoji: '🎁', original_price: 105000 },
    { name: 'Decor Discord Dạng Gift - Gói 95k', description: 'Trang trí hồ sơ dạng Gift (bấm nhận ngay). Tiết kiệm tối đa.', price: 95000, duration_months: 1, service_type: 'decor', emoji: '🎁', original_price: 131000 },
    { name: 'Decor Discord Dạng Gift - Gói 110k', description: 'Trang trí hồ sơ dạng Gift (bấm nhận ngay). Tiết kiệm tối đa.', price: 110000, duration_months: 1, service_type: 'decor', emoji: '🎁', original_price: 141000 },
    { name: 'Decor Discord Combo Gift - Gói 90k', description: 'Trang trí hồ sơ dạng Combo Gift (bấm nhận ngay). Tiết kiệm tối đa.', price: 90000, duration_months: 1, service_type: 'decor', emoji: '🎁', original_price: 118000 },
    { name: 'Decor Discord Combo Gift - Gói 110k', description: 'Trang trí hồ sơ dạng Combo Gift (bấm nhận ngay). Tiết kiệm tối đa.', price: 110000, duration_months: 1, service_type: 'decor', emoji: '🎁', original_price: 146000 },
    { name: 'Decor Discord Combo Gift - Gói 150k', description: 'Trang trí hồ sơ dạng Combo Gift (bấm nhận ngay). Tiết kiệm tối đa.', price: 150000, duration_months: 1, service_type: 'decor', emoji: '🎁', original_price: 189000 },
    { name: 'Decor Discord Combo Gift - Gói 180k', description: 'Trang trí hồ sơ dạng Combo Gift (bấm nhận ngay). Tiết kiệm tối đa.', price: 180000, duration_months: 1, service_type: 'decor', emoji: '🎁', original_price: 220000 },

    // AI & Phần Mềm
    {
      product_key: 'gemini-pro-google-one-5tb-12-months-full-warranty',
      name: 'Gemini Pro + 5 TB Google One 12 Tháng (Full BH)',
      aliases: [
        'Gemini Advanced & 5 TB Google One (1 Năm - Full BH)',
        'Gemini Pro + 5TB Google Driver (12 Tháng)',
        'Gemini Pro + 5TB Google Drive (12 Tháng)',
      ],
      description: 'Gemini Pro kèm 5 TB Google One trong 12 tháng, bảo hành full suốt thời gian sử dụng.',
      warranty_policy: 'Full 12 tháng',
      price: 130000,
      ctv_price: 80000,
      duration_months: 12,
      service_type: 'AI',
      emoji: 'brand_gemini',
      original_price: 0,
      is_featured: 1,
      virtual_purchase_count: 0,
    },
    {
      product_key: 'gemini-pro-google-one-5tb-18-months-full-warranty',
      name: 'Gemini Pro + 5 TB Google One 18 Tháng (Full BH)',
      description: 'Gemini Pro kèm 5 TB Google One trong 18 tháng, bảo hành full suốt thời gian sử dụng.',
      warranty_policy: 'Full 18 tháng',
      price: 180000,
      ctv_price: 100000,
      duration_months: 18,
      service_type: 'AI',
      emoji: 'brand_gemini',
      original_price: 0,
      is_featured: 1,
      virtual_purchase_count: 0,
    },
    {
      product_key: 'gemini-pro-google-one-5tb-12-months-4-month-warranty',
      name: 'Gemini Pro + 5 TB Google One 12 Tháng (BH 4 Tháng)',
      aliases: [
        'Gemini Advanced & 5 TB Google One (1 Năm - Không BH)',
        'Gemini Pro + 5TB Google One 12 Tháng Không Bảo Hành',
      ],
      description: 'Gói tiết kiệm có thời hạn danh nghĩa 12 tháng và được Cenar bảo hành 4 tháng đầu. Tài khoản có thể duy trì lâu hơn tùy trạng thái hệ thống, nhưng thời gian vượt phạm vi bảo hành không được cam kết.',
      warranty_policy: 'Bảo hành 4 tháng đầu',
      price: 69000,
      duration_months: 12,
      service_type: 'AI',
      emoji: 'brand_gemini',
      original_price: 0,
      is_featured: 1,
      virtual_purchase_count: 0,
    },
    { product_key: 'claude-pro-1-month', name: 'Claude Pro 1 Tháng (Full BH)', aliases: ['Claude Pro Add Team 1 Tháng (Full BH)'], description: 'Claude Pro trong 1 tháng, bảo hành trọn gói tại Cenar Store.', warranty_policy: 'Full 1 tháng', price: 530000, duration_months: 1, service_type: 'AI', emoji: 'brand_claude', original_price: 0, is_featured: 1, virtual_purchase_count: 126 },
    {
      product_key: 'chatgpt-plus-account-1-month-no-warranty',
      name: 'ChatGPT Plus 1 Tháng (Cấp Tài Khoản · Không BH)',
      aliases: ['ChatGPT Plus Cấp Acc 1 Tháng Không Bảo Hành'],
      description: 'Gói cấp tài khoản có thời hạn danh nghĩa 1 tháng nhưng không bảo hành. Tài khoản có thể mất sau 1–2 tuần hoặc duy trì lâu hơn; đây là lựa chọn thử vận may và không cam kết sống đủ tháng.',
      warranty_policy: 'Không bảo hành · có thể mất sau 1–2 tuần hoặc lâu hơn; không cam kết đủ tháng',
      price: 180000,
      duration_months: 1,
      service_type: 'AI',
      emoji: 'brand_chatgpt',
      original_price: 0,
      is_featured: 0,
      virtual_purchase_count: 0,
    },
    {
      product_key: 'chatgpt-plus-account-1-month-full-warranty',
      name: 'ChatGPT Plus 1 Tháng (Cấp Tài Khoản · Full BH)',
      aliases: ['ChatGPT Plus 1 Tháng (Cấp Tài Khoản)', 'Chat GPT Plus Cấp Acc FULL bảo Hành 1 tháng'],
      description: 'Cấp tài khoản ChatGPT Plus đã kích hoạt sẵn trong 1 tháng, bảo hành full trong suốt thời gian sử dụng.',
      warranty_policy: 'Full 1 tháng',
      price: 350000,
      duration_months: 1,
      service_type: 'AI',
      emoji: 'brand_chatgpt',
      original_price: 0,
      is_featured: 1,
      virtual_purchase_count: 0,
    },
    {
      product_key: 'chatgpt-business-workspace-1-month-full-warranty',
      name: 'ChatGPT Business 1 Tháng (Add Workspace · Chính Chủ · Full BH)',
      aliases: ['ChatGPT Plus 1 Tháng (Chính Chủ - Full BH)', 'ChatGPT Add Team Business 1 Tháng (Chính Chủ)'],
      description: 'Thêm tài khoản chính chủ của khách vào workspace ChatGPT Business, hỗ trợ gia hạn đều và bảo hành full trong suốt 1 tháng sử dụng.',
      warranty_policy: 'Full 1 tháng',
      price: 450000,
      duration_months: 1,
      service_type: 'AI',
      emoji: 'brand_chatgpt',
      original_price: 0,
      is_featured: 1,
      virtual_purchase_count: 0,
    },
    {
      product_key: 'chatgpt-plus-direct-payment-1-month-full-warranty',
      name: 'ChatGPT Plus Chính Chủ 1 Tháng (Thanh Toán Trực Tiếp · Full BH)',
      aliases: ['ChatGPT Plus Chính Chủ Pay Thẳng Trên Acc 1 Tháng'],
      description: 'Thanh toán ChatGPT Plus trực tiếp trên chính tài khoản của khách, không tham gia workspace hoặc team; bảo hành full trong suốt 1 tháng sử dụng.',
      warranty_policy: 'Full 1 tháng',
      price: 530000,
      duration_months: 1,
      service_type: 'AI',
      emoji: 'brand_chatgpt',
      original_price: 0,
      is_featured: 1,
      virtual_purchase_count: 0,
    },
    {
      product_key: 'adobe-creative-cloud-1-month',
      name: 'Adobe Creative Cloud All Apps 1 Tháng (Full BH)',
      aliases: [
        'Adobe Creative Cloud 1 Tháng',
        'Adobe Creative Cloud All Apps (1 Tháng - 2 Thiết Bị)',
      ],
      description: 'Adobe Creative Cloud All Apps trong 1 tháng, bảo hành full trong suốt thời gian sử dụng.',
      price: 150000,
      duration_months: 1,
      service_type: 'AI',
      emoji: 'brand_adobe',
      original_price: 0,
      is_featured: 1,
      virtual_purchase_count: 214,
    },
    { product_key: 'office-365-onedrive-12-months', name: 'Office 365 & 1 TB OneDrive (12 Tháng)', aliases: ['Office 365 + 1 TB One Driver (12 Tháng)'], description: 'Tài khoản bản quyền Office 365 + 1 TB lưu trữ OneDrive trong 1 năm.', price: 200000, duration_months: 12, service_type: 'AI', emoji: 'brand_office', original_price: 300000 },
    { name: 'CapCut Pro 1 Tháng (2 Thiết Bị - Cấp Acc)', description: 'Sử dụng CapCut Pro trong 1 tháng, cấp tài khoản riêng dùng tối đa 2 thiết bị.', price: 100000, duration_months: 1, service_type: 'AI', emoji: 'brand_capcut', original_price: 0 },
    { name: 'CapCut Pro 7 Ngày (2 Thiết Bị - Cấp Acc)', description: 'Sử dụng CapCut Pro trong 7 ngày, cấp tài khoản riêng dùng tối đa 2 thiết bị.', price: 20000, duration_months: 1, service_type: 'AI', emoji: 'brand_capcut', original_price: 0 },
    { name: 'CapCut Pro 12 Tháng (3 Thiết Bị - Chính Chủ)', description: 'Nâng cấp chính chủ tài khoản CapCut Pro của bạn trong 12 tháng, dùng cho 3 thiết bị.', price: 1250000, duration_months: 12, service_type: 'AI', emoji: 'brand_capcut', original_price: 0 },

    // GearUP Booster
    { name: 'Gearup Booster 3 Tháng', description: 'Gói Gearup Booster giảm giật lag chơi game 3 tháng.', price: 180000, duration_months: 3, service_type: 'gearup', emoji: 'brand_gearup', original_price: 0 },
    { name: 'Gearup Booster 6 Tháng', description: 'Gói Gearup Booster giảm giật lag chơi game 6 tháng.', price: 380000, duration_months: 6, service_type: 'gearup', emoji: 'brand_gearup', original_price: 0 },
    { name: 'Gearup Booster 12 Tháng (1 Năm)', description: 'Gói Gearup Booster giảm giật lag chơi game 12 tháng (1 năm).', price: 460000, duration_months: 12, service_type: 'gearup', emoji: 'brand_gearup', original_price: 0 },

    // Spotify Premium · bảng giá chính thức
    { product_key: 'spotify-premium-3-months', name: 'Spotify Premium 3 Tháng', description: 'Spotify Premium không quảng cáo, nghe nhạc chất lượng cao và hỗ trợ tải nhạc để nghe offline trong 3 tháng.', price: 100000, ctv_price: 80000, duration_months: 3, service_type: 'spotify', emoji: 'brand_spotify', original_price: 0, is_featured: 1, virtual_purchase_count: 0 },
    { product_key: 'spotify-premium-6-months', name: 'Spotify Premium 6 Tháng', description: 'Spotify Premium không quảng cáo, nghe nhạc chất lượng cao và hỗ trợ tải nhạc để nghe offline trong 6 tháng.', price: 200000, ctv_price: 160000, duration_months: 6, service_type: 'spotify', emoji: 'brand_spotify', original_price: 0, is_featured: 1, virtual_purchase_count: 0 },
    { product_key: 'spotify-premium-12-months', name: 'Spotify Premium 12 Tháng', description: 'Spotify Premium không quảng cáo, nghe nhạc chất lượng cao và hỗ trợ tải nhạc để nghe offline trong 12 tháng.', price: 290000, ctv_price: 260000, duration_months: 12, service_type: 'spotify', emoji: 'brand_spotify', original_price: 0, is_featured: 1, virtual_purchase_count: 0 },

    // YouTube Premium · dòng ổn định cao duy nhất đang mở bán
    { product_key: 'youtube-premium-continuous-1-month', name: 'YouTube Premium 1 Tháng (Ổn Định Cao)', aliases: ['YouTube Premium 1 Tháng (Gia Hạn Liên Tục)'], description: 'Dòng ổn định cao, không vận hành bằng cơ chế đổi Family mỗi tháng; hạn chế tối đa tình trạng mất Premium và bảo hành full trong toàn bộ 1 tháng sử dụng.', warranty_policy: 'Full 1 tháng', price: 60000, ctv_price: 55000, duration_months: 1, service_type: 'STREAMING', emoji: 'brand_youtube', original_price: 0 },
    { product_key: 'youtube-premium-continuous-3-months', name: 'YouTube Premium 3 Tháng (Ổn Định Cao)', aliases: ['YouTube Premium 3 Tháng (Gia Hạn Liên Tục)', 'YouTube Premium 3 Tháng (Gia Hạn Đều)'], description: 'Dòng ổn định cao, không vận hành bằng cơ chế đổi Family mỗi tháng; hạn chế tối đa tình trạng mất Premium và bảo hành full trong toàn bộ 3 tháng sử dụng.', warranty_policy: 'Full 3 tháng', price: 195000, ctv_price: 180000, duration_months: 3, service_type: 'STREAMING', emoji: 'brand_youtube', original_price: 0 },
    { product_key: 'youtube-premium-continuous-6-months', name: 'YouTube Premium 6 Tháng (Ổn Định Cao)', aliases: ['YouTube Premium 6 Tháng (Gia Hạn Liên Tục)', 'YouTube Premium 6 Tháng (Gia Hạn Đều)'], description: 'Dòng ổn định cao, không vận hành bằng cơ chế đổi Family mỗi tháng; hạn chế tối đa tình trạng mất Premium và bảo hành full trong toàn bộ 6 tháng sử dụng.', warranty_policy: 'Full 6 tháng', price: 320000, ctv_price: 300000, duration_months: 6, service_type: 'STREAMING', emoji: 'brand_youtube', original_price: 0 },
    { product_key: 'youtube-premium-continuous-12-months', name: 'YouTube Premium 12 Tháng (Ổn Định Cao)', aliases: ['YouTube Premium 12 Tháng (Gia Hạn Liên Tục)', 'YouTube Premium 12 Tháng (Gia Hạn Đều)'], description: 'Dòng ổn định cao, không vận hành bằng cơ chế đổi Family mỗi tháng; hạn chế tối đa tình trạng mất Premium và bảo hành full trong toàn bộ 12 tháng sử dụng.', warranty_policy: 'Full 12 tháng', price: 580000, ctv_price: 520000, duration_months: 12, service_type: 'STREAMING', emoji: 'brand_youtube', original_price: 0 },

    // Netflix · hai lựa chọn ổn định
    { product_key: 'netflix-extra-1-month-renewable', name: 'Netflix Extra 1 Tháng (Ổn Định · Có Gia Hạn)', description: 'Gói Netflix Extra ổn định trong 1 tháng và hỗ trợ gia hạn tiếp trên tài khoản đã cấp.', price: 75000, duration_months: 1, service_type: 'netflix', emoji: 'brand_netflix', original_price: 0, is_featured: 1, virtual_purchase_count: 0 },
    { product_key: 'netflix-premium-1-month-non-renewable', name: 'Netflix Premium 1 Tháng (Ổn Định · Không Gia Hạn)', aliases: ['Netflix Premium 1 Tháng (Không Gia Hạn)'], description: 'Tài khoản Netflix Premium ổn định, chất lượng Full HD/4K, sử dụng 1 tháng và bảo hành 20 ngày. Không hỗ trợ gia hạn trên tài khoản đã cấp; khi hết hạn, khách muốn sử dụng tiếp cần đổi sang tài khoản mới.', warranty_policy: '20 ngày', price: 35000, duration_months: 1, service_type: 'netflix', emoji: 'brand_netflix', original_price: 0, is_featured: 1, virtual_purchase_count: 0 },
 
    // Dịch vụ xây dựng Store · một catalog dùng chung cho Bot + Website
    { product_key: 'discord-store-launch-hosting-3-months', name: 'Setup Discord Store + Bot Custom + Hosting 3 Tháng', description: 'Gói khởi động dành cho store: setup server chuyên nghiệp, bot custom theo nhận diện, hệ thống bảng giá/nhận đơn cơ bản và tặng hosting vận hành 24/7 trong 3 tháng đầu.', price: 500000, duration_months: 3, service_type: 'SERVICE', emoji: 'brand_discord', original_price: 0, is_featured: 1, virtual_purchase_count: 0 },
    { product_key: 'discord-store-automation-pro', name: 'Bot Booking / Bảng Giá / Store Custom', description: 'Bot vận hành chuyên biệt cho store: booking, bảng giá, catalog giá nguồn, ticket, nhận đơn và luồng quản trị theo yêu cầu. Tặng hosting 3 tháng cho dự án triển khai mới.', price: 750000, duration_months: 3, service_type: 'SERVICE', emoji: 'icon_settings', original_price: 0, is_featured: 1, virtual_purchase_count: 0 },
    { product_key: 'discord-store-fullstack-website', name: 'Discord Store + Bot Custom + Website Đồng Bộ', description: 'Giải pháp đầy đủ gồm setup Discord, bot custom và website đồng bộ catalog/đơn hàng; giao diện được thiết kế theo thương hiệu của store. Tặng hosting bot 3 tháng đầu.', price: 1000000, duration_months: 3, service_type: 'SERVICE', emoji: 'icon_store', original_price: 0, is_featured: 1, virtual_purchase_count: 0 },
    { product_key: 'discord-bot-rescue-ui', name: 'Fix Bot Lỗi & Nâng Cấp Giao Diện', description: 'Kiểm tra nguyên nhân bot lỗi, sửa luồng hoạt động và làm mới giao diện thân thiện bằng Components V2 cùng emoji custom. Giá 500.000đ là mức khởi điểm; báo giá cuối dựa trên tình trạng mã nguồn.', price: 500000, duration_months: 1, service_type: 'SERVICE', emoji: 'warranty_shield', original_price: 0, is_featured: 1, virtual_purchase_count: 0 },
    
    // Nâng cấp: Claude API & Locket Gold
    { name: 'Claude API 100M', description: 'Trải nghiệm hệ sinh thái Claude mạnh mẽ, phù hợp cho lập trình, phân tích dữ liệu, viết nội dung, nghiên cứu và xử lý công việc chuyên sâu.', price: 85000, duration_months: 1, service_type: 'AI', emoji: 'brand_claude', original_price: 0, base_price: 85000, base_duration_days: 1, additional_day_price: 5000, minimum_days: 1, maximum_days: 365, quota_value: 100, quota_unit: 'M', activation_method: 'TOKEN', username_required: 0, login_required: 0 },
    { name: 'Locket Gold — 1 năm', description: 'Nâng cấp trải nghiệm Locket với nhiều tính năng cá nhân hóa, kết nối bạn bè và chia sẻ khoảnh khắc tiện lợi hơn.', price: 150000, duration_months: 12, service_type: 'premium', emoji: 'locket_gold', original_price: 0, base_price: 150000, activation_method: 'USERNAME', username_required: 1, login_required: 0 }
];

export function seedProductCatalog(dbInstance) {
  const products = DEFAULT_PRODUCT_CATALOG;

  const productKey = (product) => String(product.product_key || product.name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

  const insertStmt = dbInstance.prepare(`
    INSERT INTO product_catalog (
      guild_id, name, description, price, ctv_price, duration_months, service_type, emoji, is_active, sort_order, original_price, warranty_policy,
      base_price, base_duration_days, additional_day_price, minimum_days, maximum_days, quota_value, quota_unit, activation_method, username_required, login_required,
      product_key, is_featured, virtual_purchase_count
    )
    VALUES ('WEB', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateStmt = dbInstance.prepare(`
    UPDATE product_catalog
    SET name = ?, description = ?, price = ?, ctv_price = COALESCE(?, ctv_price), duration_months = ?, service_type = ?, emoji = ?, original_price = ?, warranty_policy = COALESCE(?, warranty_policy),
        base_price = ?, base_duration_days = ?, additional_day_price = ?, minimum_days = ?, maximum_days = ?, quota_value = ?, quota_unit = ?, activation_method = ?, username_required = ?, login_required = ?,
        is_featured = CASE WHEN product_key IS NULL THEN ? ELSE is_featured END,
        virtual_purchase_count = CASE WHEN product_key IS NULL AND virtual_purchase_count = 0 THEN ? ELSE virtual_purchase_count END,
        product_key = ?,
        is_active = 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  const findByKeyStmt = dbInstance.prepare(`SELECT id FROM product_catalog WHERE guild_id = 'WEB' AND product_key = ? ORDER BY id LIMIT 1`);
  const findByNameStmt = dbInstance.prepare(`SELECT id FROM product_catalog WHERE guild_id = 'WEB' AND LOWER(TRIM(name)) = LOWER(TRIM(?)) AND duration_months = ? ORDER BY id LIMIT 1`);
  const deactivateDuplicatesStmt = dbInstance.prepare(`UPDATE product_catalog SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE guild_id = 'WEB' AND id != ? AND (product_key = ? OR (LOWER(TRIM(name)) IN (SELECT LOWER(TRIM(value)) FROM json_each(?)) AND duration_months = ?))`);
  const retireReplacedAiCatalogStmt = dbInstance.prepare(`
    UPDATE product_catalog
    SET is_active = 0, updated_at = CURRENT_TIMESTAMP
    WHERE guild_id = 'WEB'
      AND is_active = 1
      AND (
        (
          LOWER(REPLACE(name, ' ', '')) LIKE '%chatgpt%'
          AND COALESCE(product_key, '') NOT IN (
            'chatgpt-plus-account-1-month-no-warranty',
            'chatgpt-plus-account-1-month-full-warranty',
            'chatgpt-business-workspace-1-month-full-warranty',
            'chatgpt-plus-direct-payment-1-month-full-warranty'
          )
        )
        OR (
          LOWER(name) LIKE '%adobe%'
          AND COALESCE(product_key, '') != 'adobe-creative-cloud-1-month'
        )
        OR (
          LOWER(REPLACE(name, ' ', '')) LIKE '%gemini%'
          AND COALESCE(product_key, '') NOT IN (
            'gemini-pro-google-one-5tb-12-months-full-warranty',
            'gemini-pro-google-one-5tb-18-months-full-warranty',
            'gemini-pro-google-one-5tb-12-months-4-month-warranty'
          )
        )
      )
  `);
  const retireReplacedStreamingCatalogStmt = dbInstance.prepare(`
    UPDATE product_catalog
    SET is_active = 0, updated_at = CURRENT_TIMESTAMP
    WHERE guild_id = 'WEB'
      AND is_active = 1
      AND (
        (
          LOWER(REPLACE(name, ' ', '')) LIKE '%youtubepremium%'
          AND COALESCE(product_key, '') NOT IN (
            'youtube-premium-continuous-1-month',
            'youtube-premium-continuous-3-months',
            'youtube-premium-continuous-6-months',
            'youtube-premium-continuous-12-months'
          )
        )
        OR (
          LOWER(name) LIKE '%netflix%'
          AND COALESCE(product_key, '') NOT IN (
            'netflix-extra-1-month-renewable',
            'netflix-premium-1-month-non-renewable'
          )
        )
        OR (
          LOWER(name) LIKE '%spotify%'
          AND COALESCE(product_key, '') NOT IN (
            'spotify-premium-3-months',
            'spotify-premium-6-months',
            'spotify-premium-12-months'
          )
        )
      )
  `);
  const retireReplacedServiceCatalogStmt = dbInstance.prepare(`
    UPDATE product_catalog
    SET is_active = 0, updated_at = CURRENT_TIMESTAMP
    WHERE guild_id = 'WEB'
      AND is_active = 1
      AND UPPER(COALESCE(service_type, '')) = 'SERVICE'
      AND (
        COALESCE(product_key, '') IN (
          'combo-setup-discord-bot-custom-boost-server',
          'bot-custom-discord-tuy-chinh-tinh-nang',
          'website-custom-moi-giao-dien',
          'phi-duy-tri-bot-discord-1-thang'
        )
        OR LOWER(TRIM(name)) IN (
          LOWER('Combo Setup Discord + Bot Custom + Boost Server'),
          LOWER('Bot Custom Discord — Tuỳ Chỉnh Tính Năng'),
          LOWER('Website Custom — Mọi Giao Diện'),
          LOWER('Phí Duy Trì Bot Discord (1 Tháng)')
        )
      )
  `);

  let currentSort = 100;
  
  dbInstance.transaction(() => {
    for (const p of products) {
      const key = productKey(p);
      const names = [p.name, ...(p.aliases || [])];
      const existing = findByKeyStmt.get(key)
        || names.map((name) => findByNameStmt.get(name, p.duration_months)).find(Boolean);
      if (existing) {
        updateStmt.run(
          p.name, p.description, p.price, p.ctv_price ?? null, p.duration_months, p.service_type, p.emoji, p.original_price, p.warranty_policy || null,
          p.base_price || null, p.base_duration_days || null, p.additional_day_price || null, p.minimum_days || null, p.maximum_days || null, p.quota_value || null, p.quota_unit || null, p.activation_method || null, p.username_required || 0, p.login_required || 0,
          p.is_featured ? 1 : 0, Math.max(0, Number(p.virtual_purchase_count || 0)), key, existing.id
        );
        deactivateDuplicatesStmt.run(existing.id, key, JSON.stringify(names), p.duration_months);
      } else {
        insertStmt.run(
          p.name, p.description, p.price, p.ctv_price ?? null, p.duration_months, p.service_type, p.emoji, currentSort++, p.original_price, p.warranty_policy || null,
          p.base_price || null, p.base_duration_days || null, p.additional_day_price || null, p.minimum_days || null, p.maximum_days || null, p.quota_value || null, p.quota_unit || null, p.activation_method || null, p.username_required || 0, p.login_required || 0,
          key, p.is_featured ? 1 : 0, Math.max(0, Number(p.virtual_purchase_count || 0))
        );
      }
    }

    // Danh mục mới chỉ mở bán đúng 4 gói ChatGPT và 1 gói Adobe.
    // Các hàng lịch sử vẫn được giữ trong database để bảo toàn đơn cũ, nhưng
    // không còn xuất hiện trên bot, website hoặc bảng giá Discord.
    retireReplacedAiCatalogStmt.run();
    retireReplacedStreamingCatalogStmt.run();
    retireReplacedServiceCatalogStmt.run();

    dbInstance.prepare(`
      UPDATE product_catalog
      SET is_active = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id IN (
        SELECT newer.id
        FROM product_catalog newer
        JOIN product_catalog keeper
          ON keeper.guild_id = newer.guild_id
         AND LOWER(TRIM(keeper.name)) = LOWER(TRIM(newer.name))
         AND keeper.duration_months = newer.duration_months
         AND keeper.id < newer.id
        WHERE newer.is_active = 1 AND keeper.is_active = 1
      )
    `).run();
  })();
  console.log('🌱 Successfully seeded/updated ' + products.length + ' products in catalog!');
}
