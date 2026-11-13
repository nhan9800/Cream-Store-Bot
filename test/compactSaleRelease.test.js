import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ prepare: vi.fn(), ranking: vi.fn(), history: vi.fn(), update: vi.fn(), icons: vi.fn() }));
vi.mock('../src/config.js', () => ({ config: { guildId: '1282637033340403754' } }));
vi.mock('../src/database/db.js', () => ({ db: {} }));
vi.mock('../src/utils/emojiHelper.js', () => ({ createEmojiResolver: () => () => '' }));
vi.mock('../src/services/coreEmojiPackService.js', () => ({ getCoreEmojiPackStatus: m.icons }));
vi.mock('../src/campaigns/compactSale20261113.js', () => ({
  COMPACT_SALE: { revision: 'test-compact-sale' }, prepareCompactSale: m.prepare, readCompactSaleRanking: m.ranking,
}));
vi.mock('../src/services/compactSalePublicationService.js', () => ({
  getCompactSalePublicationHealth: m.history, updateCompactSale: m.update,
}));
import { getCompactSaleReleaseHealth, proposeCompactSaleCuts, runCompactSaleRelease } from '../src/services/compactSaleReleaseService.js';
import { consumeManualAnnouncementWrite } from '../src/utils/manualAnnouncementWrite.js';

const clock = () => Date.parse('2026-11-13T16:00:00Z');
const cfg = phase => ({ phase, selection: [1, 2, 3, 4, 5, 6], expectedPreviewHash: 'reviewed-preview', authorizedUntil: '2026-11-14T16:30:00Z' });
const selected = [
  { id: 1, price: 100000, ctvPrice: 70000 }, { id: 2, price: 200000, ctvPrice: 197000 },
  { id: 3, price: 30000, ctvPrice: 20000 }, { id: 4, price: 500000, ctvPrice: 400000 },
  { id: 5, price: 250000, ctvPrice: null }, { id: 6, price: 80000, ctvPrice: 60000 },
].map(product => ({ ...product, key: `key-${product.id}`, name: `Product ${product.id}`,
  originalPrice: 0, completedUnits: 100 + product.id, completedOrders: 50 + product.id }));
const prepared = () => ({ selection: selected.map(product => product.id), selectedProducts: selected,
  previewHash: 'reviewed-preview', priceHash: 'reviewed-prices', emojiAudit: { customEmojiCount: 24, uniqueEmojiCount: 24, nativeEmojiCount: 0 } });
let client;

beforeEach(() => {
  vi.clearAllMocks();
  client = { isReady: () => true, rest: {} };
  m.icons.mockReturnValue({ status: 'ready' });
  m.history.mockReturnValue({ status: 'NOT_STARTED', links: [] });
  m.ranking.mockReturnValue(selected);
  m.prepare.mockImplementation(() => prepared());
});
const run = overrides => runCompactSaleRelease(client, { envFile: '.env', release: cfg('preview'), now: clock, ...overrides });

describe('reviewed compact-sale release', () => {
  it('proposes no more than three bounded retail cuts and respects known CTV + 1,000 floor', () => {
    expect([...proposeCompactSaleCuts(selected)]).toEqual([[1, 97000], [4, 495000], [6, 78000]]);
    expect(proposeCompactSaleCuts([{ id: 1, price: 100000, ctvPrice: 100000 }]).size).toBe(0);
  });

  it('keeps preview read-only and logs private review data only to the operator console', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await run();
    expect(result.status).toBe('PREVIEW_READY');
    expect(m.prepare).toHaveBeenCalledTimes(2);
    expect([...m.prepare.mock.calls[1][0].priceOverrides]).toEqual([[1, 97000], [4, 495000], [6, 78000]]);
    expect(m.update).not.toHaveBeenCalled();
    expect(log.mock.calls[0][0]).toBe('[COMPACT-SALE-PREVIEW]');
    expect(log.mock.calls[0][1]).toContain('ctvPrice');
    expect(JSON.stringify(result)).not.toMatch(/ctvPrice|completedUnits|completedOrders/);
    result.selectedProducts[0].price = 1;
    expect(getCompactSaleReleaseHealth().selectedProducts[0].price).toBe(100000);
    log.mockRestore();
  });

  it('guards Store2 and inherited environment before reading any database or provider data', async () => {
    await run({ guildId: 'other-store' });
    await run({ envFile: '.env.store2' });
    expect(m.history).not.toHaveBeenCalled();
    expect(m.ranking).not.toHaveBeenCalled();
    expect(m.prepare).not.toHaveBeenCalled();
  });

  it('reads a completed journal after expiry without preparing or editing again', async () => {
    m.history.mockReturnValue({ ...prepared(), status: 'DONE', links: ['https://discord.com/channels/g/c/m'] });
    m.icons.mockReturnValue({ status: 'retry_required' });
    const result = await run({ release: cfg('publish'), now: () => Date.parse('2026-11-16') });
    expect(result.status).toBe('DONE'); expect(result.links).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/ctvPrice|completedUnits|completedOrders/);
    expect(m.prepare).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
  });

  it('waits for verified icons and rejects expired or malformed new releases', async () => {
    m.icons.mockReturnValue({ status: 'retry_required' });
    expect((await run()).status).toBe('WAITING_CUSTOM_EMOJI');
    expect((await run({ now: () => Date.parse('2026-11-16') })).status).toBe('RELEASE_EXPIRED');
    expect((await run({ release: { ...cfg('publish'), authorizedUntil: 'bad-date' } })).status).toBe('RELEASE_EXPIRED');
    expect(m.prepare).not.toHaveBeenCalled();
  });

  it('requires fixed selection and exactly reviewed current prices before editing', async () => {
    expect((await run({ release: { ...cfg('publish'), selection: null } })).lastError).toBe('COMPACT_REVIEW_REQUIRED');
    expect((await run({ release: { ...cfg('publish'), expectedPreviewHash: 'changed-preview' } })).lastError).toBe('COMPACT_PREVIEW_CHANGED');
    expect(m.update).not.toHaveBeenCalled();
    expect(m.ranking).not.toHaveBeenCalled();
  });

  it('grants one silent PATCH of the exact saved message while blocking other clients, IDs and methods', async () => {
    const message = { id: '1570837979306528850', channelId: '1515008584549797979', edit: vi.fn(async () => {
      const options = { method: 'PATCH', fullRoute: '/channels/1515008584549797979/messages/1570837979306528850',
        body: { allowed_mentions: { parse: [], users: [], roles: [] } } };
      expect(consumeManualAnnouncementWrite({}, options)).toBe(false);
      expect(consumeManualAnnouncementWrite(client.rest, { ...options, method: 'POST' })).toBe(false);
      expect(consumeManualAnnouncementWrite(client.rest, { ...options, fullRoute: '/channels/1515008584549797979/messages/1570837982162853989' })).toBe(false);
      expect(consumeManualAnnouncementWrite(client.rest, options)).toBe(true);
      expect(consumeManualAnnouncementWrite(client.rest, options)).toBe(false);
      return { id: message.id };
    }) };
    m.update.mockImplementation(async (_client, { editMessage }) => {
      await editMessage(message, { components: [], allowedMentions: { parse: [], roles: [], users: [] } });
      return { ...prepared(), status: 'DONE', links: ['https://discord.com/channels/g/c/m'] };
    });
    const result = await run({ release: cfg('publish') });
    expect(result.status).toBe('DONE'); expect(message.edit).toHaveBeenCalledTimes(1);
    expect(m.ranking).not.toHaveBeenCalled();
    expect(m.prepare.mock.calls[0][0].priceOverrides).toBeUndefined();
  });
});
