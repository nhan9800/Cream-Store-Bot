import { db } from '../database/db.js';
import { decrypt } from '../utils/crypto.js';
import { upsertSubscriptionFromDelivery } from './subscriptionService.js';

function positiveMonths(value, fallback = 1) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function detectDeliverySubscriptionService(order) {
  const serviceType = String(order?.service_type || '').toLowerCase();
  const productName = String(order?.product_name || '').toLowerCase();
  const searchable = `${serviceType} ${productName}`;

  if (serviceType === 'netflix' || searchable.includes('netflix')) return 'netflix';
  if (serviceType === 'spotify' || searchable.includes('spotify')) return 'spotify_family';
  if (serviceType === 'youtube' || searchable.includes('youtube')) return 'youtube';
  if ((serviceType === 'discord' || searchable.includes('discord')) && searchable.includes('nitro')) return 'nitro';
  return null;
}

export function buildDeliverySubscriptionInput({
  order,
  gmailEmail,
  gmailPassword,
  profile = null,
  customerDiscordName = null,
  progressStatus = 'VERIFIED',
  progressReviewNote = null,
}) {
  const serviceType = detectDeliverySubscriptionService(order);
  if (!serviceType) return null;
  if (!String(gmailEmail || '').trim() || !String(gmailPassword || '').trim()) {
    throw new Error('Đơn dịch vụ gia hạn cần đủ Gmail và mật khẩu để đồng bộ lên website.');
  }

  const totalDurationMonths = positiveMonths(order.duration_months, 1);
  let renewalMode = 'one_time';
  let renewalCycleMonths = 0;

  if (totalDurationMonths > 1) {
    renewalMode = 'auto_cycle';
    renewalCycleMonths = 1;
  }

  return {
    guildId: order.guild_id,
    serviceType,
    renewalMode,
    gmailEmail: String(gmailEmail).trim(),
    gmailPassword: String(gmailPassword),
    customerId: order.customer_id || null,
    customerDiscordName: customerDiscordName || null,
    relatedOrderCode: order.order_code,
    purchaseDate: order.delivered_at || order.completed_at || new Date().toISOString(),
    totalDurationMonths,
    renewalCycleMonths,
    spotifyFamilyName: serviceType === 'spotify_family' ? (profile || null) : null,
    spotifySlotsUsed: 0,
    note: serviceType === 'netflix' && profile ? `Profile: ${profile}` : null,
    source: 'DELIVERY',
    progressStatus,
    progressReviewNote,
  };
}

export function syncDeliverySubscription(input) {
  const subscription = buildDeliverySubscriptionInput(input);
  return subscription ? upsertSubscriptionFromDelivery(subscription) : null;
}

export function backfillRecentDeliverySubscriptions({ lookbackDays = 3650 } = {}) {
  const safeDays = Math.min(3650, Math.max(1, Number.parseInt(String(lookbackDays), 10) || 3650));
  const candidates = db.prepare(`
    SELECT orders.*
    FROM orders
    LEFT JOIN subscription_accounts
      ON subscription_accounts.related_order_code = orders.order_code
    WHERE orders.delivered_at IS NOT NULL
      AND orders.credential_email IS NOT NULL
      AND orders.credential_password IS NOT NULL
      AND datetime(orders.delivered_at) >= datetime('now', ?)
      AND subscription_accounts.id IS NULL
    ORDER BY orders.delivered_at ASC
  `).all(`-${safeDays} days`);

  let created = 0;
  let skipped = 0;
  const failed = [];
  for (const order of candidates) {
    try {
      const deliveredAt = new Date(order.delivered_at);
      const ageDays = Number.isFinite(deliveredAt.getTime())
        ? Math.floor((Date.now() - deliveredAt.getTime()) / (24 * 60 * 60 * 1000))
        : 0;
      const needsReview = ageDays > 31;
      const result = syncDeliverySubscription({
        order,
        gmailEmail: decrypt(order.credential_email),
        gmailPassword: decrypt(order.credential_password),
        profile: order.credential_profile ? decrypt(order.credential_profile) : null,
        customerDiscordName: null,
        progressStatus: needsReview ? 'NEEDS_REVIEW' : 'VERIFIED',
        progressReviewNote: needsReview
          ? 'Đơn cũ được nhập tự động; Admin cần xác nhận số tháng đã cấp.'
          : null,
      });
      if (result) created += 1;
      else skipped += 1;
    } catch (error) {
      failed.push({ orderCode: order.order_code, error: error.message });
    }
  }

  return { scanned: candidates.length, created, skipped, failed };
}
