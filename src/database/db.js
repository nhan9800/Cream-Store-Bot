import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const resolvedDatabasePath = path.resolve(projectRoot, config.databasePath);

fs.mkdirSync(path.dirname(resolvedDatabasePath), { recursive: true });

// Timeout 10000ms giúp xử lý SQLITE_BUSY mặc định bằng C busy-polling
export const db = new Database(resolvedDatabasePath, { timeout: 10000 });

// Retry pattern cho lỗi SQLITE_BUSY (database is locked)
export function withRetry(operation, maxRetries = 3) {
  let retries = 0;
  while (true) {
    try {
      return operation();
    } catch (error) {
      if (error.code === 'SQLITE_BUSY' && retries < maxRetries) {
        retries++;
        // Blocking sleep nhỏ
        const start = Date.now();
        while (Date.now() - start < 100 * retries) { /* wait */ }
        continue;
      }
      throw error;
    }
  }
}

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');     // Cân bằng tốc độ và an toàn
db.pragma('cache_size = -8000');       // 8MB cache
db.pragma('temp_store = MEMORY');      // Temp tables in memory
db.pragma('mmap_size = 268435456');    // 256MB memory-mapped I/O

// WAL checkpoint định kỳ mỗi 30 phút (tránh WAL file quá lớn)
setInterval(() => {
  try {
    db.pragma('wal_checkpoint(PASSIVE)');
  } catch { /* ignore */ }
}, 30 * 60 * 1000);

function ensureColumn(tableName, columnName, definitionSql) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((column) => column.name === columnName);
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definitionSql}`);
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
      auto_close_at TEXT,
      keep_open_requested INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      closed_at TEXT,
      closed_by_id TEXT
    );

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
      payment_message_id TEXT,
      created_by_id TEXT NOT NULL,
      paid_at TEXT,
      paid_transaction_id TEXT,
      paid_transaction_content TEXT,
      duration_months INTEGER NOT NULL DEFAULT 1,
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
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    CREATE INDEX IF NOT EXISTS idx_product_catalog_guild ON product_catalog (guild_id, is_active, sort_order);
    CREATE INDEX IF NOT EXISTS idx_sub_accounts_guild_status ON subscription_accounts (guild_id, status, service_type);
    CREATE INDEX IF NOT EXISTS idx_sub_accounts_renewal ON subscription_accounts (next_renewal_at, status);
    CREATE INDEX IF NOT EXISTS idx_sub_accounts_expiry ON subscription_accounts (expiry_at, status);

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
  `);

  ensureColumn('guild_settings', 'warranty_category_id', 'TEXT');
  ensureColumn('guild_settings', 'shipper_role_id', 'TEXT');
  ensureColumn('guild_settings', 'manager_role_id', 'TEXT');
  ensureColumn('guild_settings', 'staff_log_channel_id', 'TEXT');
  ensureColumn('guild_settings', 'reminder_channel_id', 'TEXT');
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

  ensureColumn('orders', 'total_amount', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('orders', 'amount_paid', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('orders', 'payment_provider', "TEXT NOT NULL DEFAULT 'PAYOS'");
  ensureColumn('orders', 'payment_code', 'TEXT');
  ensureColumn('orders', 'payos_order_code', 'INTEGER');
  ensureColumn('orders', 'payment_link_id', 'TEXT');
  ensureColumn('orders', 'payment_checkout_url', 'TEXT');
  ensureColumn('orders', 'payment_qr_code', 'TEXT');
  ensureColumn('orders', 'payment_qr_url', 'TEXT');
  ensureColumn('orders', 'payment_qr_text', 'TEXT');
  ensureColumn('orders', 'payment_status', "TEXT NOT NULL DEFAULT 'UNPAID'");
  ensureColumn('orders', 'payment_message_id', 'TEXT');
  ensureColumn('orders', 'payment_expired_at', 'TEXT');
  ensureColumn('orders', 'payment_cancel_reason', 'TEXT');
  ensureColumn('orders', 'paid_at', 'TEXT');
  ensureColumn('orders', 'paid_transaction_id', 'TEXT');
  ensureColumn('orders', 'paid_transaction_content', 'TEXT');
  ensureColumn('orders', 'duration_months', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('orders', 'expiry_at', 'TEXT');
  ensureColumn('orders', 'expiry_notice_3d_sent_at', 'TEXT');
  ensureColumn('orders', 'expiry_notice_2d_sent_at', 'TEXT');
  ensureColumn('orders', 'expiry_notice_1d_sent_at', 'TEXT');
  ensureColumn('orders', 'credential_profile', 'TEXT');
  ensureColumn('orders', 'credential_pin', 'TEXT');
  ensureColumn('orders', 'delivery_login_url', 'TEXT');
  ensureColumn('orders', 'payment_reminder_sent_at', 'TEXT');
  ensureColumn('orders', 'processing_reminder_sent_at', 'TEXT');
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

  // Thêm ví điện tử
  ensureColumn('customer_profiles', 'wallet_balance', 'INTEGER NOT NULL DEFAULT 0');

  // Custom emoji slots cho từng guild
  ensureColumn('guild_settings', 'custom_emojis', 'TEXT');

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
  `);
}

export function nowIso() {
  return new Date().toISOString();
}

export function getDatabasePath() {
  return resolvedDatabasePath;
}
