import { Collection } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  guildId: '1282637033340403754', channelId: '1515008584549797979',
  revision: 'CENAR-SALE-REVISION:AUTUMN-ATELIER-20261002',
  emojiNames: ['cenar_autumn_202610_ticket', 'cenar_autumn_202610_cup', 'cenar_autumn_202610_spark', 'cenar_autumn_202610_leaves'],
}));
vi.mock('../src/services/coreEmojiPackService.js',()=>({getCoreEmojiPackStatus:()=>({status:'ready',expected:57,available:57})}));
vi.mock('../src/services/botInterfaceRefreshService.js',()=>({getBotInterfaceRefreshStatus:()=>({status:'ready'})}));
vi.mock('../src/services/historicalBoostPresentationRepairService.js',()=>({
  getHistoricalBoostPresentationRepairStatus:()=>({status:'DONE',updated:2}),
  auditHistoricalBoostPresentation:async()=>({historyComplete:true,staleEmojiReferences:0}),
}));
vi.mock('../src/config.js', () => ({ config: { guildId: fixtures.guildId } }));
vi.mock('../src/services/productCatalogService.js', () => ({ getActiveProducts: () => [
  { product_key: 'chatgpt-own-plus', name: 'ChatGPT Plus', price: 485000, warranty_policy: 'BH gói', activation_method: 'OWN_ACCOUNT', credentials: 'private-product-stock' },
  { product_key: 'netflix', name: 'Netflix', price: 75000, private_owner: 'private-product-owner' },
] }));
vi.mock('../src/services/guildConfigService.js', () => ({ getGuildConfig: () => ({}) }));
vi.mock('../src/services/autoSetupPriceBoardService.js', () => ({
  PRICE_BOARD_VERSION: 'CENAR-CATALOG-V3.20', getPriceBoardProducts: (products) => products,
  getPriceBoardPublicationState: () => ({ status: 'completed' }),
  priceBoardInternals: { findPriceChannel: async (guild) => guild.priceChannel },
}));
vi.mock('../src/campaigns/dailyColorSale2026.js', () => ({
  DAILY_COLOR_SALE: { guildId: fixtures.guildId, promotionChannelId: fixtures.channelId, revision: fixtures.revision },
  DAILY_COLOR_SALE_EMOJIS: fixtures.emojiNames.map((name) => ({ name })),
  dailyColorSalePart: (message, botId) => message.author.id === botId
    ? Number(JSON.stringify(message.toJSON()).match(/CENAR-STORY-FLASH-SALE-V1-PART-(\d+)/)?.[1]) || null : null,
  dailyFlashSaleDateFromMessage: (message, botId) => message.author.id === botId
    ? JSON.stringify(message.toJSON()).match(/CENAR-DAILY-FLASH-SALE:(\d{4}-\d{2}-\d{2})/)?.[1] || null : null,
  dailySaleDateKey: () => '2026-10-02',
}));
vi.mock('../src/campaigns/promotionCatalog202610.js', () => ({
  PROMOTION_CATALOG_VERSION: 'PUBLIC-MANIFEST-V1',
  PROMOTION_CATALOG_ROWS: [
    { key: 'sale-chatgpt', source: 'SALE', price: 485000, priceUnit: '/ gói', label: 'ChatGPT Plus', duration: '1 tháng', account: 'Chính chủ', warranty: 'BH gói', private_customer: 'private-manifest-extra' },
    { key: 'adobe', source: 'CATALOG', price: 140000, priceUnit: '/ gói', label: 'Adobe', duration: '1 tháng', account: 'Cấp acc', warranty: 'BHF' },
  ],
}));
vi.mock('../src/services/promotionRebuildService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getPromotionRebuildStatus: vi.fn(async (revision) => ({ status: 'CLEANUP', revision,
    archivedSaleMessages: 2, deletedSaleMessages: 1,
    boardMessageIds: ['1550000000000000012'], dailyMessageId: '1550000000000000013',
    lastError: 'PROMOTION_OLD_SALE_DELETE_FAILED' })),
}));

import { getCatalogPublicationStatus } from '../src/services/catalogPublicationStatusService.js';

function message(id, text, author = 'bot', extra = {}) {
  return { id: String(id), author: { id: author }, url: `https://discord.com/channels/${fixtures.guildId}/${fixtures.channelId}/${id}`,
    toJSON: () => ({ content: text, private_member_id: 'private-raw-message-owner' }), ...extra };
}

function channel(items, overrides = {}) {
  return { isTextBased: () => true, isThread: () => false,
    messages: { fetch: vi.fn(async ({ limit = 100, before } = {}) => {
      const selected = [...items].sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1)
        .filter((item) => !before || BigInt(item.id) < BigInt(before)).slice(0, limit);
      return new Collection(selected.map((item) => [item.id, item]));
    }) }, ...overrides };
}

function clientFor(promotionChannel) {
  const priceChannel = channel([
    message('1550000000000000051', 'CENAR-CATALOG-V3.20 ChatGPT Plus 485.000đ'),
    message('1550000000000000052', 'CENAR-CATALOG-V3.20 private-customer-prices', 'customer'),
    message('1550000000000000053', 'private-unrelated-staff-post'),
  ]);
  const emojis = new Collection(fixtures.emojiNames.slice(0, 3).map((name, index) => [name, { name, id: `156000000000000000${index}`, private_owner: 'private-emoji-owner' }]));
  emojis.set('unrelated', { name: 'unrelated', id: 'private-unrelated-emoji-id' });
  const guild = { id: fixtures.guildId, priceChannel,
    channels: { fetch: vi.fn(async () => promotionChannel) },
    emojis: { fetch: vi.fn(async () => emojis), cache: emojis },
  };
  return { isReady: () => true, user: { id: 'bot' }, guilds: { fetch: vi.fn(async () => guild) } };
}

describe('production public promotion evidence', () => {
  it('projects public gallery banner media even when Discord has no top-level attachments', async () => {
    const media = { url: 'https://cdn.discordapp.com/attachments/public/banner.png',
      proxy_url: 'https://media.discordapp.net/attachments/public/banner.png', width: 1600, height: 600,
      attachment_id: 'private-gallery-extra' };
    const item = message('1550000000000000012', '', 'bot', {
      attachments: new Collection(),
      toJSON: () => ({ components: [{ type: 17, components: [
        { type: 10, content: `CENAR-STORY-FLASH-SALE-V1-PART-1 ${fixtures.revision}` },
        { type: 12, items: [{ media }] },
      ] }] }),
    });
    const result = await getCatalogPublicationStatus(clientFor(channel([item])));
    expect(result.promotion.messages[0].attachments).toEqual([]);
    expect(result.promotion.messages[0].media).toEqual([{ url: media.url, proxyUrl: media.proxy_url,
      width: 1600, height: 600 }]);
    expect(result.botUi).toMatchObject({ icons: { status: 'ready', available: 57 },
      refresh: { status: 'ready' }, historicalBoost: { status: 'DONE', updated: 2 },
      historicalBoostAudit: { historyComplete: true, staleEmojiReferences: 0 } });
    expect(JSON.stringify(result)).not.toContain('private-gallery-extra');
  });

  it('reports current and obsolete sales accurately during a partial cutover and exposes only public terms, artwork and aggregate job status', async () => {
    const banner = { name: 'cenar-autumn-atelier-202610.png', url: 'https://cdn.discordapp.com/attachments/public/new-banner.png', size: 1000, private_owner: 'private-attachment-owner' };
    const promotionChannel = channel([
      message('1550000000000000010', 'CENAR-STORY-FLASH-SALE-V1-PART-1 OLD-REVISION'),
      message('1550000000000000011', 'CENAR-DAILY-FLASH-SALE:2026-10-02 OLD-REVISION'),
      message('1550000000000000012', `CENAR-STORY-FLASH-SALE-V1-PART-1 ${fixtures.revision}`, 'bot', { attachments: new Collection([['banner', banner]]) }),
      message('1550000000000000013', `CENAR-DAILY-FLASH-SALE:2026-10-02 ${fixtures.revision}`),
      message('1550000000000000014', `CENAR-DAILY-FLASH-SALE:2026-10-01 ${fixtures.revision}`),
      message('1550000000000000015', `CENAR-DAILY-FLASH-SALE:2026-10-02 ${fixtures.revision} private-customer-text`, 'customer'),
      message('1550000000000000016', 'CENAR-SECURE-TRANSCRIPT-LAUNCH private-unrelated-text'),
    ]);
    const result = await getCatalogPublicationStatus(clientFor(promotionChannel), { date: new Date('2026-10-02T03:00:00Z') });
    expect(result.promotion).toMatchObject({ historyComplete: true, scannedMessages: 7,
      obsoleteSaleCount: 2, currentBoardParts: 1, currentDayPosts: 1, revision: fixtures.revision,
      rebuild: { status: 'CLEANUP', lastError: 'PROMOTION_OLD_SALE_DELETE_FAILED' } });
    expect(result.promotion.messages.map((item) => item.id)).toEqual([
      '1550000000000000014', '1550000000000000013', '1550000000000000012', '1550000000000000011', '1550000000000000010',
    ]);
    expect(result.promotion.messages.find((item) => item.id === '1550000000000000012').attachments)
      .toEqual([{ name: banner.name, url: banner.url, size: 1000 }]);
    expect(result.promotion.emojis).toEqual(fixtures.emojiNames.map((name, index) => ({
      name, available: index < 3, id: index < 3 ? `156000000000000000${index}` : null,
    })));
    expect(result.promotion.priceManifest).toHaveLength(2);
    expect(result.promotion.priceManifest[0]).toEqual({ key: 'sale-chatgpt', source: 'SALE', price: 485000, priceUnit: '/ gói', label: 'ChatGPT Plus', duration: '1 tháng', account: 'Chính chủ', warranty: 'BH gói' });
    expect(result.catalog).toEqual([{ key: 'chatgpt-own-plus', name: 'ChatGPT Plus', price: 485000, warranty: 'BH gói', activation: 'OWN_ACCOUNT' }]);
    expect(result.priceBoard.messages.map((item) => item.id)).toEqual(['1550000000000000051']);
    expect(JSON.stringify(result)).not.toMatch(/private-|credentials|snapshot_json|deleted_ids_json/);
  });

  it('finds an obsolete sale older than the newest 100 messages', async () => {
    const items = Array.from({ length: 105 }, (_, index) => message(`${1550000000000000000n + BigInt(index)}`,
      index === 0 ? 'CENAR BIRTHDAY SALE 09/08' : 'Unrelated bot guide'));
    const result = await getCatalogPublicationStatus(clientFor(channel(items)));
    expect(result.promotion).toMatchObject({ historyComplete: true, scannedMessages: 105, obsoleteSaleCount: 1,
      currentBoardParts: 0, currentDayPosts: 0 });
    expect(result.promotion.messages).toHaveLength(1);
  });

  it('fails the audit when the history exceeds its bounded exhaustive scan rather than claiming no obsolete sales', async () => {
    const items = Array.from({ length: 20001 }, (_, index) => message(`${1550000000000000000n + BigInt(index)}`, 'Unrelated bot guide'));
    await expect(getCatalogPublicationStatus(clientFor(channel(items))))
      .rejects.toMatchObject({ code: 'PROMOTION_HISTORY_LIMIT_EXCEEDED' });
  });

  it('fails the audit when the promotion channel is unavailable', async () => {
    await expect(getCatalogPublicationStatus(clientFor(channel([], { isTextBased: () => false }))))
      .rejects.toThrow('PROMOTION_CHANNEL_UNAVAILABLE');
  });

  it('fails the audit on a Discord history error rather than emitting a successful zero count', async () => {
    const unavailable = channel([]);
    unavailable.messages.fetch.mockRejectedValue(new Error('DISCORD_HISTORY_UNAVAILABLE'));
    await expect(getCatalogPublicationStatus(clientFor(unavailable))).rejects.toThrow('DISCORD_HISTORY_UNAVAILABLE');
  });
});
