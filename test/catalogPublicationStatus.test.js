import express from 'express';
import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(process.env, {
  ENV_FILE: '.env.catalog-audit-not-present', DATABASE_PATH: `./data/test-publication-${process.pid}-${Date.now()}.sqlite`,
  BOT_API_KEY: 'test-publication-key', GUILD_ID: '1282637033340403754',
}));
vi.mock('../src/services/productCatalogService.js', () => ({
  getActiveProducts: () => [{ id: 1, product_key: 'test-chatgpt', name: 'ChatGPT Plus',
    price: 485000, duration_months: 1, service_type: 'AI', warranty_policy: 'BH gói',
    activation_method: 'OWN_ACCOUNT', secret_account: 'never-return-this' }],
}));
vi.mock('../src/services/guildConfigService.js', () => ({
  getGuildConfig: () => ({ price_list_channel_id: '1514606995842273280' }),
}));

import { getCatalogPublicationStatus } from '../src/services/catalogPublicationStatusService.js';
import { registerBotApiRoutes } from '../src/services/botApiRoutes.js';
import { PRICE_BOARD_VERSION } from '../src/services/autoSetupPriceBoardService.js';
import { DAILY_COLOR_SALE } from '../src/campaigns/dailyColorSale2026.js';
import { db, initDatabase } from '../src/database/db.js';

beforeAll(() => initDatabase());
afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${process.env.DATABASE_PATH}${suffix}`, { force: true });
});

function message(id, author, content) {
  return { id, author: { id: author }, url: `https://discord.com/channels/public/channel/${id}`,
    toJSON: () => ({ components: [{ components: [{ content }] }] }) };
}

describe('read-only public catalog publication evidence', () => {
  it('returns only catalog terms and marked bot boards, excluding unrelated messages', async () => {
    const boards = [
      message('1', 'bot', `${PRICE_BOARD_VERSION} ChatGPT Plus 485.000đ`),
      message('2', 'customer', `${PRICE_BOARD_VERSION} private-customer-content`),
      message('3', 'bot', 'private-unrelated-content'),
    ];
    const promotion = [message('4', 'bot', `${DAILY_COLOR_SALE.marker}-PART-1 ${DAILY_COLOR_SALE.revision}`)];
    const channel = (items) => ({ isTextBased: () => true, isThread: () => false,
      messages: { fetch: vi.fn().mockResolvedValue(new Map(items.map((item) => [item.id, item]))) } });
    const guild = { id: process.env.GUILD_ID, channels: {
      fetch: vi.fn((id) => Promise.resolve(channel(id === '1514606995842273280' ? boards : promotion))),
    }, emojis: { fetch: vi.fn(), cache: [] } };
    const result = await getCatalogPublicationStatus({ isReady: () => true, user: { id: 'bot' },
      guilds: { fetch: vi.fn().mockResolvedValue(guild) } }, { date: new Date('2026-10-02T10:00:00Z') });
    expect(result.catalog[0]).toEqual({ key: 'test-chatgpt', name: 'ChatGPT Plus', price: 485000,
      warranty: 'BH gói', activation: 'OWN_ACCOUNT' });
    expect(result.priceBoard.messages.map((item) => item.id)).toEqual(['1']);
    expect(result.promotion.messages.map((item) => item.id)).toEqual(['4']);
    expect(JSON.stringify(result)).not.toMatch(/private-customer|private-unrelated|never-return/);
  });

  it('requires the API key and fails closed while Discord is unavailable', async () => {
    const app = express();
    registerBotApiRoutes(app);
    const server = await new Promise((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    try {
      const url = `http://127.0.0.1:${server.address().port}/api/bot/catalog-publication-status`;
      expect((await fetch(url)).status).toBe(401);
      const response = await fetch(url, { headers: { 'x-bot-api-key': process.env.BOT_API_KEY } });
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ ok: false, error: 'PUBLICATION_STATUS_UNAVAILABLE' });
      const catalogResponse = await fetch(url.replace('/catalog-publication-status', '/products'), {
        headers: { 'x-bot-api-key': process.env.BOT_API_KEY },
      });
      expect(catalogResponse.status).toBe(200);
      const catalog = (await catalogResponse.json()).data;
      expect(catalog.find((product) => product.product_key === 'chatgpt-plus-own-account-1-month-package-warranty'))
        .toMatchObject({ price: 485000, activation_method: 'OWN_ACCOUNT',
          warranty_policy: 'Bảo hành gói 1 tháng · không bảo hành tài khoản' });
      expect(catalog.find((product) => product.product_key === 'claude-pro-x5-account-1-month-full-warranty'))
        .toMatchObject({ price: 2500000, activation_method: 'ACCOUNT', warranty_policy: 'Full 1 tháng (BHF)' });
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
});
