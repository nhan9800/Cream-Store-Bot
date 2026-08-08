import { db } from '../database/db.js';

export const OWNER_PING_WINDOW_MS = 24 * 60 * 60 * 1000;
export const OWNER_PING_STRIKE_DECAY_MS = 30 * 24 * 60 * 60 * 1000;
export const OWNER_PING_PENALTIES_MS = [
  15 * 60 * 1000,
  24 * 60 * 60 * 1000,
  3 * 24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
  14 * 24 * 60 * 60 * 1000,
  28 * 24 * 60 * 60 * 1000,
];

function toMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function nextPenalty(level) {
  const nextLevel = Math.min(Math.max(Number(level) || 0, 0) + 1, OWNER_PING_PENALTIES_MS.length);
  return {
    penaltyLevel: nextLevel,
    timeoutMs: OWNER_PING_PENALTIES_MS[nextLevel - 1],
  };
}

export function formatOwnerPingPenalty(timeoutMs) {
  const minutes = Math.round(Number(timeoutMs) / 60_000);
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} giờ`;
  return `${Math.round(hours / 24)} ngày`;
}

export function getOwnerPingState(guildId, userId) {
  return db.prepare(`
    SELECT *
    FROM owner_ping_enforcement
    WHERE guild_id = ? AND user_id = ?
  `).get(String(guildId), String(userId)) || null;
}

export function registerOwnerPing(guildId, userId, now = new Date()) {
  const guildKey = String(guildId);
  const userKey = String(userId);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const nowIso = new Date(safeNowMs).toISOString();

  return db.transaction(() => {
    const current = getOwnerPingState(guildKey, userKey);
    if (!current) {
      db.prepare(`
        INSERT INTO owner_ping_enforcement (
          guild_id, user_id, window_started_at, mention_count,
          penalty_level, last_mention_at, updated_at
        ) VALUES (?, ?, ?, 1, 0, ?, ?)
      `).run(guildKey, userKey, nowIso, nowIso, nowIso);
      return { action: 'counted', mentionCount: 1, penaltyLevel: 0, timeoutMs: 0 };
    }

    const windowExpired = safeNowMs - toMs(current.window_started_at) >= OWNER_PING_WINDOW_MS;
    const strikeExpired = !current.last_penalty_at
      || safeNowMs - toMs(current.last_penalty_at) >= OWNER_PING_STRIKE_DECAY_MS;
    const mentionCount = windowExpired ? 1 : Number(current.mention_count || 0) + 1;
    let penaltyLevel = strikeExpired ? 0 : Number(current.penalty_level || 0);
    let lastPenaltyAt = strikeExpired ? null : current.last_penalty_at;
    let timeoutMs = 0;
    let action = 'counted';

    if (mentionCount === 3) {
      action = 'warning';
    } else if (mentionCount >= 4) {
      const penalty = nextPenalty(penaltyLevel);
      penaltyLevel = penalty.penaltyLevel;
      timeoutMs = penalty.timeoutMs;
      lastPenaltyAt = nowIso;
      action = 'timeout';
    }

    db.prepare(`
      UPDATE owner_ping_enforcement
      SET window_started_at = ?, mention_count = ?, penalty_level = ?,
          last_mention_at = ?, last_penalty_at = ?, updated_at = ?
      WHERE guild_id = ? AND user_id = ?
    `).run(
      windowExpired ? nowIso : current.window_started_at,
      mentionCount,
      penaltyLevel,
      nowIso,
      lastPenaltyAt,
      nowIso,
      guildKey,
      userKey,
    );

    return { action, mentionCount, penaltyLevel, timeoutMs };
  })();
}
