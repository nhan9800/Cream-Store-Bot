import { getSupplierCatalogReviewSnapshot } from './supplierAutobuyCatalogService.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';

// Owner requested a review of the excluded products and newly added identities.
// This temporary operator projection uses only the already-cached source read.
export const DOPERMIND_REVIEW = Object.freeze({
  revision: 'DOPERMIND-CATALOG-REVIEW-20261114-1',
  enabled: true,
  authorizedUntil: '2026-11-14T16:30:00.000Z',
});
const reviewed = new WeakSet();
const safeText = value => typeof value === 'string' ? value.slice(0, 1200) : null;

export function runDopermindCatalogReview(client, { guildId, envFile, now = Date.now,
  release = DOPERMIND_REVIEW, readSnapshot = getSupplierCatalogReviewSnapshot,
  log = (...args) => console.log(...args),
} = {}) {
  const time = now(), expiry = Date.parse(release.authorizedUntil);
  if (guildId !== STORE_ONE_GUILD_ID || envFile !== '.env' || release.enabled !== true
    || !Number.isFinite(time) || !Number.isFinite(expiry) || time > expiry) return { status: 'DISABLED' };
  if (!client || typeof client !== 'object' || reviewed.has(client)) return { status: 'SKIPPED' };
  const snapshot = readSnapshot('dopermind');
  if (snapshot?.status !== 'READY' || !Array.isArray(snapshot.products)) return { status: 'NOT_READY' };
  reviewed.add(client);
  const products = snapshot.products.filter(product => !['SELLABLE', 'OUT_OF_STOCK'].includes(product.reviewReason));
  log('[DOPERMIND-REVIEW]', JSON.stringify({ revision: release.revision, sourceCount: snapshot.products.length,
    excludedCount: products.length, status: 'BEGIN' }));
  for (const product of products) log('[DOPERMIND-REVIEW]', JSON.stringify({
    revision: release.revision, productKey: safeText(product.productKey), name: safeText(product.name),
    nameEn: safeText(product.nameEn), type: safeText(product.type),
    delivery: safeText(product.delivery), description: safeText(product.description),
    stock: Number.isSafeInteger(product.stock) ? product.stock : null,
    unlimited: product.unlimited === true, locked: product.locked === true,
    reviewReason: safeText(product.reviewReason),
  }));
  log('[DOPERMIND-REVIEW]', JSON.stringify({ revision: release.revision, status: 'DONE', excludedCount: products.length }));
  return { status: 'DONE', sourceCount: snapshot.products.length, excludedCount: products.length };
}
