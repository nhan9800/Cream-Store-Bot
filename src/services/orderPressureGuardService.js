import { createHash } from 'node:crypto';
import { db } from '../database/db.js';

export const ORDER_PRESSURE_POLICY_VERSION = 1;
export const ORDER_PRESSURE_WINDOW_MS = 30 * 60 * 1000;
export const ORDER_PRESSURE_DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
export const ORDER_PRESSURE_WARNING_COOLDOWN_MS = 15 * 60 * 1000;
export const ORDER_PRESSURE_DELETE_THRESHOLD = 2;

const DELAY_PATTERNS = [
  /(?:2|hai)\s*tuan/, /(?:14|muoi\s*bon)\s*ngay/, /chua\s*(?:tra|giao|nhan|co\s*hang)/,
  /bao\s*(?:gio|lau)\s*(?:giao|tra|nhan|co)/, /don\s*(?:dau|di|toi)\s*roi/, /tre\s*don/,
  /cham\s*(?:don|giao|tra)/, /still\s*waiting/, /where\s+is\s+my\s+order/,
  /two\s+weeks/, /order\s*(?:late|delayed)/,
];
const PRESSURE_PATTERNS = [
  /\b(?:hoi|giuc|thuc|day)\s*don\b/, /\b(?:rep|reply|tra\s*loi|phan\s*hoi)\b/,
  /\b(?:giai\s*quyet|xu\s*ly)\s*(?:ngay|gap|chua)\b/, /\b(?:gap|ngay|lien\s*tuc|spam)\b/,
  /\b(?:huy|hoan)\s*don\b/, /\b(?:answer|reply)\s*(?:me|now)\b/,
];

function safeNowMs(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : Date.now();
  const number = Number(value);
  return Number.isFinite(number) ? number : Date.now();
}

export function normalizeOrderPressureText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLowerCase()
    .replace(/(.)\1{3,}/g, '$1$1')
    .replace(/[^a-z0-9@!?\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeFingerprint(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 24);
}

function matchPatterns(text, patterns) {
  return patterns.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
}

/**
 * Deterministic, high-precision classifier. A single ordinary complaint is
 * retained as evidence; enforcement starts only when pressure/tag signals
 * are present and the same member repeats them within the rolling window.
 */
export function classifyOrderPressure(message = {}) {
  const raw = String(message.content ?? '');
  const text = normalizeOrderPressureText(raw);
  if (!text || text.length < 4) return { shouldTrack: false, text, fingerprint: null, reasons: [] };

  const delayMatches = matchPatterns(text, DELAY_PATTERNS);
  const pressureMatches = matchPatterns(text, PRESSURE_PATTERNS);
  const mentionCount = Number(message.mentions?.users?.size || 0)
    + Number(message.mentions?.roles?.size || 0);
  const everyoneMention = Boolean(message.mentions?.everyone)
    || /@\s*(?:everyone|here)\b/i.test(raw);
  const repeatedPunctuation = /[!?]{3,}/.test(raw);
  const hasDelay = delayMatches.length > 0;
  const hasPressure = pressureMatches.length > 0 || repeatedPunctuation;
  const tagPressure = everyoneMention || mentionCount >= 2 || (mentionCount >= 1 && hasPressure);
  const tagOnlyPressure = tagPressure && (hasPressure || repeatedPunctuation);
  // Track a single concrete delay statement as evidence, but do not delete
  // it until the same member repeats the pattern inside the rolling window.
  // This covers phrases such as "2 tuần rồi chưa trả đơn" without erasing a
  // legitimate first complaint.
  if (!hasDelay && !tagOnlyPressure) {
    return {
      shouldTrack: false,
      text,
      fingerprint: makeFingerprint(text),
      reasons: [],
      delayMatches,
      pressureMatches,
      mentionCount,
      everyoneMention,
    };
  }

  return {
    shouldTrack: true,
    text,
    fingerprint: makeFingerprint(text),
    reasons: [
      hasDelay && 'delay-language',
      hasPressure && 'pressure-language',
      tagPressure && 'mention-pressure',
    ].filter(Boolean),
    delayMatches,
    pressureMatches,
    mentionCount,
    everyoneMention,
  };
}

export function getOrderPressureState(guildId, userId) {
  return db.prepare(`
    SELECT * FROM order_pressure_enforcement
    WHERE guild_id = ? AND user_id = ?
  `).get(String(guildId), String(userId)) || null;
}

export function registerOrderPressure(guildId, userId, messageFingerprint, now = Date.now()) {
  const guildKey = String(guildId);
  const userKey = String(userId);
  const safeNow = safeNowMs(now);
  const nowIso = new Date(safeNow).toISOString();
  const current = getOrderPressureState(guildKey, userKey);
  const windowStartedAt = Date.parse(String(current?.window_started_at || ''));
  const lastMessageAt = Date.parse(String(current?.last_message_at || ''));
  const windowExpired = !current || !Number.isFinite(windowStartedAt)
    || safeNow - windowStartedAt >= ORDER_PRESSURE_WINDOW_MS;
  const previousCount = windowExpired ? 0 : Number(current.flagged_count || 0);
  const flaggedCount = previousCount + 1;
  const duplicate = !windowExpired
    && current?.last_fingerprint === messageFingerprint
    && Number.isFinite(lastMessageAt)
    && safeNow - lastMessageAt <= ORDER_PRESSURE_DUPLICATE_WINDOW_MS;
  const shouldDelete = duplicate || flaggedCount >= ORDER_PRESSURE_DELETE_THRESHOLD;
  const lastWarningAt = Date.parse(String(current?.last_warning_at || ''));
  const warningCooling = Number.isFinite(lastWarningAt)
    && safeNow - lastWarningAt < ORDER_PRESSURE_WARNING_COOLDOWN_MS;
  const shouldWarn = shouldDelete && !warningCooling;
  const deletedCount = (windowExpired ? 0 : Number(current?.deleted_count || 0)) + (shouldDelete ? 1 : 0);

  db.prepare(`
    INSERT INTO order_pressure_enforcement (
      guild_id, user_id, window_started_at, flagged_count, deleted_count,
      last_fingerprint, last_message_at, last_warning_at, policy_version, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      window_started_at = excluded.window_started_at,
      flagged_count = excluded.flagged_count,
      deleted_count = excluded.deleted_count,
      last_fingerprint = excluded.last_fingerprint,
      last_message_at = excluded.last_message_at,
      last_warning_at = CASE WHEN excluded.last_warning_at IS NOT NULL
        THEN excluded.last_warning_at ELSE order_pressure_enforcement.last_warning_at END,
      policy_version = excluded.policy_version,
      updated_at = excluded.updated_at
  `).run(
    guildKey,
    userKey,
    windowExpired ? nowIso : current.window_started_at,
    flaggedCount,
    deletedCount,
    messageFingerprint,
    nowIso,
    shouldWarn ? nowIso : null,
    ORDER_PRESSURE_POLICY_VERSION,
    nowIso,
  );

  return {
    action: shouldDelete ? 'delete' : 'tracked',
    shouldDelete,
    shouldWarn,
    duplicate,
    flaggedCount,
    deletedCount,
    warningCooling,
  };
}
