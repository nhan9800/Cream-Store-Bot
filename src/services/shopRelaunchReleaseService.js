import { config } from '../config.js';
import { db } from '../database/db.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { SHOP_RELAUNCH_RELEASE } from '../config/shopRelaunchRelease20261113.js';
import { withManualAnnouncementWrite } from '../utils/manualAnnouncementWrite.js';
import { getCoreEmojiPackStatus } from './coreEmojiPackService.js';
import { prepareShopRelaunch } from '../campaigns/shopRelaunch20261113.js';
import { getShopRelaunchPublicationHealth, publishShopRelaunch } from './shopRelaunchPublicationService.js';

let status = { phase: SHOP_RELAUNCH_RELEASE.phase, status: 'NOT_STARTED', links: [], priceManifest: [] };

export function getShopRelaunchReleaseHealth() {
  return { ...status, links: [...status.links], priceManifest: status.priceManifest.map(item => ({ ...item })),
    ...(status.parts ? { parts: status.parts.map(part => ({ ...part })) } : {}) };
}

export async function runShopRelaunchRelease(client, {
  dbInstance,
  guildId = config.guildId,
  envFile = process.env.ENV_FILE,
  release = SHOP_RELAUNCH_RELEASE,
  now = Date.now,
} = {}) {
  if (String(guildId) !== STORE_ONE_GUILD_ID || envFile !== '.env') return { status: 'SKIPPED_OTHER_STORE' };
  dbInstance ??= db;
  const published = getShopRelaunchPublicationHealth({ dbInstance });
  // A completed one-off release stays completed after normal catalog updates
  // or the authorization deadline. Its original verification dates are kept.
  if (published.status === 'DONE') {
    status = { phase: release.phase, ...published };
    return getShopRelaunchReleaseHealth();
  }
  if (!['preview', 'publish'].includes(release.phase) || !Number.isFinite(Date.parse(release.authorizedUntil))
    || !Number.isFinite(now()) || now() > Date.parse(release.authorizedUntil)) {
    status = { phase: release.phase, status: 'RELEASE_EXPIRED', links: [], priceManifest: [] };
    return getShopRelaunchReleaseHealth();
  }
  if (!client?.isReady?.() || getCoreEmojiPackStatus(client).status !== 'ready') {
    status = { phase: release.phase, status: 'WAITING_CUSTOM_EMOJI', links: [], priceManifest: [] };
    return getShopRelaunchReleaseHealth();
  }
  try {
    const E = createEmojiResolver(guildId);
    const prepared = await prepareShopRelaunch({ dbInstance, E });
    status = { phase: release.phase, status: 'PREVIEW_READY', links: [],
      priceHash: prepared.priceHash, priceManifest: prepared.priceManifest,
      checkedAt: new Date(now()).toISOString() };
    if (release.phase === 'publish') {
      if (!release.reviewedPriceHash || release.reviewedPriceHash !== prepared.priceHash) {
        throw Object.assign(new Error('The live price manifest needs review.'), { code: 'RELAUNCH_PRICE_REVIEW_REQUIRED' });
      }
      const result = await publishShopRelaunch(client, { dbInstance, E,
        expectedPriceHash: release.reviewedPriceHash,
        sendMessage: (channel, payload) => withManualAnnouncementWrite({
          rest: client.rest, channelId: channel.id, nonce: payload.nonce,
        }, () => channel.send(payload)),
      });
      status = { ...status, status: result.status, links: result.links || [],
        parts: result.parts,
        priceHash: result.priceHash || prepared.priceHash,
        priceManifest: result.priceManifest || prepared.priceManifest };
    }
    console.log('[SHOP-RELAUNCH]', JSON.stringify(getShopRelaunchReleaseHealth()));
    return getShopRelaunchReleaseHealth();
  } catch (error) {
    const journal = getShopRelaunchPublicationHealth({ dbInstance });
    status = { ...status, status: 'RELEASE_FAILED', lastError: /^[A-Z0-9_]{3,80}$/.test(String(error?.code || ''))
      ? error.code : 'SHOP_RELAUNCH_FAILED', links: journal.links || [], parts: journal.parts,
      ...(error?.code === 'RELAUNCH_PUBLICATION_CONTENT_MISMATCH' && error?.publicVerification
        ? { verification: error.publicVerification } : {}) };
    console.warn('[SHOP-RELAUNCH]', JSON.stringify({ status: status.status, code: status.lastError }));
    return getShopRelaunchReleaseHealth();
  }
}
