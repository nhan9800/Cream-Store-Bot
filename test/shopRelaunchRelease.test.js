import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), publish: vi.fn(), icons: vi.fn(), history: vi.fn() }));
vi.mock('../src/config.js', () => ({ config: { guildId: '1282637033340403754' } }));
vi.mock('../src/database/db.js', () => ({ db: {} }));
vi.mock('../src/utils/emojiHelper.js', () => ({ createEmojiResolver: () => () => '' }));
vi.mock('../src/services/coreEmojiPackService.js', () => ({ getCoreEmojiPackStatus: mocks.icons }));
vi.mock('../src/campaigns/shopRelaunch20261113.js', () => ({ prepareShopRelaunch: mocks.prepare }));
vi.mock('../src/services/shopRelaunchPublicationService.js', () => ({
  publishShopRelaunch: mocks.publish, getShopRelaunchPublicationHealth: mocks.history,
}));
import { runShopRelaunchRelease, getShopRelaunchReleaseHealth } from '../src/services/shopRelaunchReleaseService.js';
import { consumeManualAnnouncementWrite } from '../src/utils/manualAnnouncementWrite.js';

const now = () => Date.parse('2026-11-13T16:00:00Z');
const release = phase => ({ phase, authorizedUntil: '2026-11-14T16:30:00Z', reviewedPriceHash: 'reviewed-prices' });
const manifest = [{ id: 1, name: 'Nitro', price: 100000 }];
let client;
beforeEach(() => {
  vi.clearAllMocks();
  client = { isReady: () => true, rest: {} };
  mocks.icons.mockReturnValue({ status: 'ready' });
  mocks.history.mockReturnValue({ status: 'not_started' });
  mocks.prepare.mockResolvedValue({ priceHash: 'reviewed-prices', priceManifest: manifest });
});

describe('dated owner-authorized shop release', () => {
  it('previews real public prices without publication and returns independent health arrays', async () => {
    const result = await runShopRelaunchRelease(client, { envFile: '.env', release: release('preview'), now });
    expect(result.status).toBe('PREVIEW_READY');
    expect(mocks.publish).not.toHaveBeenCalled();
    result.priceManifest[0].price = 1;
    expect(getShopRelaunchReleaseHealth().priceManifest[0].price).toBe(100000);
  });
  it('rejects other-store, inherited environment, expired and malformed releases before catalog access', async () => {
    const options = { envFile: '.env', release: release('publish'), now };
    await runShopRelaunchRelease(client, { ...options, guildId: 'another-store' });
    await runShopRelaunchRelease(client, { ...options, envFile: '.env.store2' });
    await runShopRelaunchRelease(client, { ...options, now: () => Date.parse('2026-11-15') });
    await runShopRelaunchRelease(client, { ...options, release: { ...release('publish'), authorizedUntil: 'bad-date' } });
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it('waits for the verified custom emoji pack', async () => {
    mocks.icons.mockReturnValue({ status: 'retry_required' });
    expect((await runShopRelaunchRelease(client, { envFile: '.env', release: release('publish'), now })).status)
      .toBe('WAITING_CUSTOM_EMOJI');
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('retains completed links after the deadline without publishing again or reading new prices', async () => {
    mocks.history.mockReturnValue({ status: 'DONE', links: ['https://discord.com/channels/g/c/m'],
      priceManifest: manifest, parts: [{ status: 'SENT' }] });
    const result = await runShopRelaunchRelease(client, { envFile: '.env', release: release('publish'),
      now: () => Date.parse('2026-11-16') });
    expect(result.status).toBe('DONE');
    expect(result.links).toHaveLength(1);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it('does not publish prices that differ from the reviewed production preview', async () => {
    const result = await runShopRelaunchRelease(client, { envFile: '.env',
      release: { ...release('publish'), reviewedPriceHash: 'older-prices' }, now });
    expect(result.lastError).toBe('RELAUNCH_PRICE_REVIEW_REQUIRED');
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it('grants only each exact campaign POST while keeping other clients and edits paused', async () => {
    const channel = { id: '1515008584549797979', send: vi.fn(async payload => {
      const options = { method: 'POST', fullRoute: `/channels/${channel.id}/messages`,
        body: { nonce: payload.nonce, enforce_nonce: payload.enforceNonce } };
      expect(consumeManualAnnouncementWrite({}, options)).toBe(false);
      expect(consumeManualAnnouncementWrite(client.rest, { ...options, method: 'PATCH' })).toBe(false);
      expect(consumeManualAnnouncementWrite(client.rest, options)).toBe(true);
      expect(consumeManualAnnouncementWrite(client.rest, options)).toBe(false);
      return { id: 'published' };
    }) };
    mocks.publish.mockImplementation(async (_client, { sendMessage }) => {
      await sendMessage(channel, { nonce: '1570816080459604068', enforceNonce: true });
      return { status: 'PUBLISHED', links: ['https://discord.com/channels/g/c/m'] };
    });
    const result = await runShopRelaunchRelease(client, { envFile: '.env', release: release('publish'), now });
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('PUBLISHED');
    expect(result.links).toHaveLength(1);
  });
  it('exposes a fixed error code when a publisher throws a private provider message', async () => {
    mocks.prepare.mockRejectedValue(new Error('private upstream credential or payload'));
    const result = await runShopRelaunchRelease(client, { envFile: '.env', release: release('preview'), now });
    expect(result.lastError).toBe('SHOP_RELAUNCH_FAILED');
    expect(JSON.stringify(result)).not.toContain('private');
  });
});
