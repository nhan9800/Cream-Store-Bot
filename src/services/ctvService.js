import { db, nowIso } from '../database/db.js';

export const CTV_RECRUITMENT_DEFAULT_OPENINGS = 3;

function recruitmentSnapshot(settings) {
  const active = Boolean(settings?.recruitment_campaign_started_at);
  const capacity = Math.max(0, Number(settings?.recruitment_capacity || 0));
  const filled = Math.min(capacity, Math.max(0, Number(settings?.recruitment_filled || 0)));
  const remaining = active ? Math.max(0, capacity - filled) : null;
  return {
    active,
    capacity,
    filled,
    remaining,
    isFull: active && remaining === 0,
    startedAt: settings?.recruitment_campaign_started_at || null,
  };
}

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

export function getCtvRecruitmentSnapshot(guildId) {
  return recruitmentSnapshot(getCtvSettings(guildId));
}

export function startCtvRecruitmentCampaign(guildId, capacity = CTV_RECRUITMENT_DEFAULT_OPENINGS) {
  const normalizedCapacity = Math.max(1, Math.min(50, Math.trunc(Number(capacity) || 0)));
  const startedAt = nowIso();
  getCtvSettings(guildId);
  db.prepare(`
    UPDATE ctv_settings
    SET recruitment_capacity = ?, recruitment_filled = 0,
        recruitment_campaign_started_at = ?, recruitment_full_notice_message_id = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE guild_id = ?
  `).run(normalizedCapacity, startedAt, guildId);
  return getCtvRecruitmentSnapshot(guildId);
}

export function ensureCtvRecruitmentCampaign(guildId, capacity = CTV_RECRUITMENT_DEFAULT_OPENINGS) {
  const current = getCtvRecruitmentSnapshot(guildId);
  return current.active ? current : startCtvRecruitmentCampaign(guildId, capacity);
}

export function setCtvRecruitmentMessage(guildId, messageId) {
  getCtvSettings(guildId);
  db.prepare(`
    UPDATE ctv_settings
    SET recruitment_message_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE guild_id = ?
  `).run(messageId ? String(messageId) : null, guildId);
  return getCtvSettings(guildId);
}

export function setCtvRecruitmentFullNotice(guildId, messageId) {
  getCtvSettings(guildId);
  db.prepare(`
    UPDATE ctv_settings
    SET recruitment_full_notice_message_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE guild_id = ?
  `).run(messageId ? String(messageId) : null, guildId);
  return getCtvSettings(guildId);
}

export function addCtvApplication(guildId, applicantId, source, reason) {
  return db.transaction(() => {
    const snapshot = getCtvRecruitmentSnapshot(guildId);
    if (snapshot.isFull) return { created: false, reason: 'FULL', snapshot, application: null };

    const existing = db.prepare(`
      SELECT * FROM ctv_applications
      WHERE guild_id = ? AND applicant_id = ? AND status = 'PENDING'
      ORDER BY id DESC LIMIT 1
    `).get(guildId, applicantId);
    if (existing) return { created: false, reason: 'PENDING', snapshot, application: existing };

    const result = db.prepare(`
      INSERT INTO ctv_applications (guild_id, applicant_id, source, reason)
      VALUES (?, ?, ?, ?)
    `).run(guildId, applicantId, source, reason);
    return {
      created: true,
      reason: null,
      snapshot,
      application: db.prepare('SELECT * FROM ctv_applications WHERE id = ?').get(result.lastInsertRowid),
    };
  }).immediate();
}

export function getCtvApplicationById(applicationId) {
  return db.prepare('SELECT * FROM ctv_applications WHERE id = ?').get(applicationId);
}

export function getPendingCtvApplication(guildId, applicantId) {
  return db.prepare(`
    SELECT * FROM ctv_applications
    WHERE guild_id = ? AND applicant_id = ? AND status = 'PENDING'
    ORDER BY id DESC LIMIT 1
  `).get(guildId, applicantId);
}

export function approveCtvApplication(guildId, applicationId, reviewerId) {
  return db.transaction(() => {
    const application = getCtvApplicationById(applicationId);
    const before = getCtvRecruitmentSnapshot(guildId);
    if (!application || application.guild_id !== guildId) {
      return { approved: false, reason: 'NOT_FOUND', application: null, snapshot: before };
    }
    if (application.status !== 'PENDING') {
      return { approved: false, reason: 'PROCESSED', application, snapshot: before };
    }
    const existingProfile = db.prepare(`
      SELECT is_ctv FROM customer_profiles WHERE guild_id = ? AND customer_id = ?
    `).get(guildId, application.applicant_id);
    if (existingProfile?.is_ctv === 1) {
      db.prepare(`
        UPDATE ctv_applications
        SET status = 'APPROVED', reviewed_by = ?, reviewed_at = ?
        WHERE id = ? AND status = 'PENDING'
      `).run(reviewerId, nowIso(), applicationId);
      return {
        approved: true,
        reason: null,
        application: getCtvApplicationById(applicationId),
        snapshot: before,
        becameFull: false,
        alreadyCtv: true,
      };
    }
    if (before.isFull) {
      return { approved: false, reason: 'FULL', application, snapshot: before };
    }

    if (before.active) {
      db.prepare(`
        UPDATE ctv_settings
        SET recruitment_filled = recruitment_filled + 1, updated_at = CURRENT_TIMESTAMP
        WHERE guild_id = ? AND recruitment_filled < recruitment_capacity
      `).run(guildId);
    }
    db.prepare(`
      UPDATE ctv_applications
      SET status = 'APPROVED', reviewed_by = ?, reviewed_at = ?
      WHERE id = ? AND status = 'PENDING'
    `).run(reviewerId, nowIso(), applicationId);

    const snapshot = getCtvRecruitmentSnapshot(guildId);
    return {
      approved: true,
      reason: null,
      application: getCtvApplicationById(applicationId),
      snapshot,
      becameFull: before.active && !before.isFull && snapshot.isFull,
    };
  }).immediate();
}

export function rejectCtvApplication(guildId, applicationId, reviewerId) {
  return db.transaction(() => {
    const application = getCtvApplicationById(applicationId);
    if (!application || application.guild_id !== guildId) {
      return { rejected: false, reason: 'NOT_FOUND', application: null };
    }
    if (application.status !== 'PENDING') {
      return { rejected: false, reason: 'PROCESSED', application };
    }
    db.prepare(`
      UPDATE ctv_applications
      SET status = 'REJECTED', reviewed_by = ?, reviewed_at = ?
      WHERE id = ? AND status = 'PENDING'
    `).run(reviewerId, nowIso(), applicationId);
    return { rejected: true, reason: null, application: getCtvApplicationById(applicationId) };
  }).immediate();
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
