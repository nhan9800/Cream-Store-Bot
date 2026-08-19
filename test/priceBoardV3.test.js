import { describe, expect, it } from 'vitest';
import { MessageFlags } from 'discord.js';
import { DEFAULT_PRODUCT_CATALOG } from '../src/database/db.js';
import { getActiveProducts } from '../src/services/productCatalogService.js';
import {
  PRICE_BOARD_VERSION,
  buildPriceBoardPayloads,
  groupPriceProducts,
} from '../src/services/autoSetupPriceBoardService.js';
import { buildPriceAnnouncementContent } from '../src/commands/thong-bao-bang-gia.js';

const GUILD_ID = '1282637033340403754';
const NATIVE_EMOJI = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u;
const RAW_EMOJI_NAME = /(^|[^<a]):[a-zA-Z0-9_]+:/;

function serialize(payload) {
  return JSON.stringify({
    ...payload,
    components: payload.components.map((component) => component.toJSON()),
  });
}

function collectTextContent(payload) {
  return payload.components
    .flatMap((component) => component.toJSON().components || [])
    .filter((component) => component.type === 10)
    .map((component) => component.content)
    .join('\n');
}

describe('Cenar price board V3', () => {
  it('assigns every active product to exactly one clear category', () => {
    const products = getActiveProducts(GUILD_ID);
    const panels = groupPriceProducts(products);
    const groupedIds = panels.flatMap((panel) => panel.items.map((product) => product.id));

    expect(new Set(groupedIds).size).toBe(products.length);
    expect(groupedIds).toHaveLength(products.length);
    expect(panels.find((panel) => panel.group.key === 'chatgpt')?.items.length).toBeGreaterThan(0);
    expect(panels.find((panel) => panel.group.key === 'gemini')?.items.length).toBeGreaterThan(0);
    expect(panels.find((panel) => panel.group.key === 'adobe')?.items.length).toBeGreaterThan(0);
    expect(panels.find((panel) => panel.group.key === 'streaming')?.items.length).toBeGreaterThan(0);
  });

  it('builds custom-emoji-only Components V2 panels with product selectors', () => {
    const products = getActiveProducts(GUILD_ID);
    const payloads = buildPriceBoardPayloads(GUILD_ID, {
      ticket_panel_channel_id: '1514607020098191393',
    }, products);
    const allJson = payloads.map(serialize).join('\n');

    expect(payloads.length).toBeGreaterThan(10);
    expect(payloads.every((payload) => payload.flags & MessageFlags.IsComponentsV2)).toBe(true);
    expect(allJson).toContain(PRICE_BOARD_VERSION);
    expect(allJson).toContain('cenar_price_chatgpt');
    expect(allJson).toContain('cenar_price_nitro');
    expect(allJson).not.toMatch(NATIVE_EMOJI);
    const visibleText = payloads
      .map(collectTextContent)
      .join('\n')
      .replace(/<a?:[A-Za-z0-9_]+:\d+>/g, '');
    expect(visibleText).not.toMatch(RAW_EMOJI_NAME);
    expect(allJson).toContain('https://cenarstore.xyz');

    for (const payload of payloads.slice(1)) {
      const row = payload.components.at(-1).toJSON();
      expect(row.components[0].type).toBe(3);
      expect(row.components[0].options.length).toBeGreaterThan(0);
      expect(row.components[0].options.every((option) => option.emoji?.id)).toBe(true);
    }
  });

  it('shows the seven-day CapCut product with its real duration', () => {
    const payloads = buildPriceBoardPayloads(GUILD_ID, {}, getActiveProducts(GUILD_ID));
    const creativePayload = payloads.map(serialize).find((json) => json.includes('CapCut Pro & Office 365'));
    expect(creativePayload).toContain('CapCut Pro 7 Ngày');
    expect(creativePayload).toContain('7 ngày');
  });

  it('publishes both current Nitro Login 2-month options at 115k and 140k', () => {
    const nitroSeedProducts = DEFAULT_PRODUCT_CATALOG
      .filter((product) => product.name.includes('Discord Nitro Boost 2 Tháng (Login ·'));
    const sevenDayMail = nitroSeedProducts.find((product) => product.name.includes('Giữ Mail 7 Ngày'));
    const guaranteedMail = nitroSeedProducts.find((product) => product.name.includes('Mail Bao Sống'));

    expect(sevenDayMail?.price).toBe(115000);
    expect(guaranteedMail?.price).toBe(140000);

    const products = [
      ...getActiveProducts(GUILD_ID).filter((product) => (
        !product.name.startsWith('Discord Nitro Boost 2 Tháng (Login)')
      )),
      ...nitroSeedProducts.map((product, index) => ({ ...product, id: `nitro-seed-${index + 1}` })),
    ];
    const nitroPayload = buildPriceBoardPayloads(GUILD_ID, {}, products)
      .map(serialize)
      .find((json) => json.includes('Discord Nitro'));
    expect(nitroPayload).toContain('Giữ Mail 7 Ngày');
    expect(nitroPayload).toContain('Mail Bao Sống');
    expect(nitroPayload).toContain('115.000');
    expect(nitroPayload).toContain('140.000');

    const announcement = buildPriceAnnouncementContent(GUILD_ID, nitroSeedProducts);
    expect(announcement).toContain('115.000');
    expect(announcement).toContain('140.000');
    expect(announcement).not.toContain('99k');
  });

  it('renders every product as its own consistently spaced Markdown block', () => {
    const payloads = buildPriceBoardPayloads(GUILD_ID, {}, getActiveProducts(GUILD_ID));
    for (const payload of payloads.slice(1)) {
      const container = payload.components[0].toJSON();
      const productBlocks = container.components
        .filter((component) => component.type === 10 && component.content.startsWith('### '));

      expect(productBlocks.length).toBeGreaterThan(0);
      for (const block of productBlocks) {
        expect(block.content).toContain('\n> ');
        expect(block.content).toContain('**Giá bán:**');
        expect(block.content).toContain('\n> ');
        expect(block.content).toContain('**Thời hạn:**');
        expect(block.content).not.toContain('\n\n### ');
      }
    }
  });
});
