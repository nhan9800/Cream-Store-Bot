import { config } from '../config.js';
import { db } from '../database/db.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { withOwnerMessageEdit } from '../utils/manualAnnouncementWrite.js';
import { getCoreEmojiPackStatus } from './coreEmojiPackService.js';
import { COMPACT_SALE_RELEASE } from '../config/compactSaleRelease20261113.js';
import { COMPACT_SALE, prepareCompactSale, readCompactSaleRanking } from '../campaigns/compactSale20261113.js';
import { getCompactSalePublicationHealth, updateCompactSale } from './compactSalePublicationService.js';

let health = { revision: COMPACT_SALE.revision, phase: COMPACT_SALE_RELEASE.phase,
  status: 'NOT_STARTED', selection: [], selectedProducts: [], links: [] };
const fail = code => Object.assign(new Error(code), { code });

function publicProduct(product) {
  const { id, key, name, price, originalPrice, durationMonths, category, service_type, warranty } = product;
  return { id, key, name, price, originalPrice, durationMonths, category, service_type, warranty };
}
function publicState(source, phase) {
  return { revision: COMPACT_SALE.revision, phase, status: source.status,
    selection: [...(source.selection || [])], selectedProducts: (source.selectedProducts || []).map(publicProduct),
    links: [...(source.links || [])], ...(source.previewHash ? { previewHash: source.previewHash } : {}),
    ...(source.priceHash ? { priceHash: source.priceHash } : {}),
    ...(source.emojiAudit ? { emojiAudit: { ...source.emojiAudit } } : {}),
    ...(source.parts ? { parts: source.parts } : {}),
    ...(source.lastError ? { lastError: source.lastError } : {}) };
}
export function getCompactSaleReleaseHealth() { return structuredClone(health); }

/** CTV is a shop retail-floor reference, not evidence of actual supplier cost. */
export function proposeCompactSaleCuts(selected) {
  const cuts = new Map();
  for (const product of selected) {
    if (cuts.size === 3) break;
    if (!Number.isSafeInteger(product.price) || product.price < 1
      || !Number.isSafeInteger(product.ctvPrice) || product.ctvPrice < 1) continue;
    const cut = Math.min(5000, Math.floor(product.price * 3 / 100 / 1000) * 1000);
    const price = product.price - cut;
    if (cut > 0 && price >= product.ctvPrice + 1000) cuts.set(product.id, price);
  }
  return cuts;
}

export async function runCompactSaleRelease(client, {
  dbInstance,
  guildId = config.guildId,
  envFile = process.env.ENV_FILE,
  release = COMPACT_SALE_RELEASE,
  now = Date.now,
} = {}) {
  // The other store inherits root environment; do not read its data at all.
  if (String(guildId) !== STORE_ONE_GUILD_ID || envFile !== '.env') return { status: 'SKIPPED_OTHER_STORE' };
  dbInstance ??= db;
  const previous = getCompactSalePublicationHealth({ dbInstance });
  if (previous.status === 'DONE') {
    health = publicState(previous, release.phase);
    return getCompactSaleReleaseHealth();
  }
  const clock = now();
  if (!['preview', 'publish'].includes(release.phase) || !Number.isFinite(clock)
    || !Number.isFinite(Date.parse(release.authorizedUntil)) || clock > Date.parse(release.authorizedUntil)) {
    health = publicState({ status: 'RELEASE_EXPIRED' }, release.phase);
    return getCompactSaleReleaseHealth();
  }
  if (!client?.isReady?.() || getCoreEmojiPackStatus(client).status !== 'ready') {
    health = publicState({ status: 'WAITING_CUSTOM_EMOJI' }, release.phase);
    return getCompactSaleReleaseHealth();
  }
  try {
    const E = createEmojiResolver(guildId);
    if (release.phase === 'preview') {
      const current = await prepareCompactSale({ dbInstance, E });
      const byId = new Map(readCompactSaleRanking(dbInstance).map(product => [product.id, product]));
      const selected = current.selection.map(id => byId.get(id));
      const cuts = proposeCompactSaleCuts(selected);
      const projected = await prepareCompactSale({ dbInstance, E, selection: current.selection, priceOverrides: cuts });
      health = publicState({ ...projected, status: 'PREVIEW_READY' }, release.phase);
      // Operator-only hosting log. Never include CTV or order counts in health.
      console.log('[COMPACT-SALE-PREVIEW]', JSON.stringify({
        selection: projected.selection, previewHash: projected.previewHash,
        priceHash: projected.priceHash, emojiAudit: projected.emojiAudit,
        products: selected.map(product => ({ id: product.id, key: product.key, name: product.name,
          currentPrice: product.price, proposedPrice: cuts.get(product.id) || product.price,
          ctvPrice: product.ctvPrice, completedUnits: product.completedUnits, completedOrders: product.completedOrders })),
      }));
    } else {
      if (!Array.isArray(release.selection) || !release.selection.length || !release.expectedPreviewHash) throw fail('COMPACT_REVIEW_REQUIRED');
      const prepared = await prepareCompactSale({ dbInstance, E, selection: release.selection });
      if (prepared.previewHash !== release.expectedPreviewHash) throw fail('COMPACT_PREVIEW_CHANGED');
      const result = await updateCompactSale(client, { dbInstance, E, selection: release.selection,
        expectedPreviewHash: release.expectedPreviewHash,
        editMessage: (message, payload) => withOwnerMessageEdit({ rest: client.rest,
          channelId: message.channelId || message.channel?.id, messageId: message.id }, () => message.edit(payload)),
      });
      health = publicState(result, release.phase);
      console.log('[COMPACT-SALE]', JSON.stringify({ status: health.status, links: health.links }));
    }
  } catch (error) {
    const journal = getCompactSalePublicationHealth({ dbInstance });
    health = publicState({ ...journal, status: 'RELEASE_FAILED',
      lastError: /^COMPACT_[A-Z_]+$/.test(error?.code || '') ? error.code : 'COMPACT_RELEASE_FAILED' }, release.phase);
    console.warn('[COMPACT-SALE]', JSON.stringify({ status: health.status, code: health.lastError }));
  }
  return getCompactSaleReleaseHealth();
}
