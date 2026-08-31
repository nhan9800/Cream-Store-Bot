import { beforeAll, describe, expect, it } from 'vitest';
import { MessageFlags } from 'discord.js';
import { DEFAULT_PRODUCT_CATALOG, initDatabase } from '../src/database/db.js';
import { getActiveProducts } from '../src/services/productCatalogService.js';
import {
  PRICE_BOARD_VERSION,
  buildPriceBoardPayloads,
  getPriceBoardProducts,
  groupPriceProducts,
} from '../src/services/autoSetupPriceBoardService.js';
import { buildPriceAnnouncementContent } from '../src/commands/thong-bao-bang-gia.js';
import {
  AI_CREATIVE_PRICING_UPDATE,
  buildAiCreativePricingAnnouncement,
} from '../src/campaigns/aiCreativePricingUpdate2026.js';

const GUILD_ID = '1282637033340403754';
const NATIVE_EMOJI = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u;
const RAW_EMOJI_NAME = /(^|[^<a]):[a-zA-Z0-9_]+:/;

beforeAll(() => {
  initDatabase();
});

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
    expect(panels.find((panel) => panel.group.key === 'youtube_stable')?.items).toHaveLength(4);
    expect(panels.some((panel) => panel.group.key === 'youtube_family_switch')).toBe(false);
    expect(panels.find((panel) => panel.group.key === 'spotify')?.items).toHaveLength(3);
    expect(panels.find((panel) => panel.group.key === 'netflix')?.items).toHaveLength(2);
    expect(panels.some((panel) => panel.group.key === 'other')).toBe(false);
  });

  it('publishes only the official Spotify catalog to Discord and website', () => {
    const products = [
      ...getActiveProducts(GUILD_ID),
      {
        id: 'legacy-spotify-slot',
        product_key: '5-slot-spotify',
        name: '5 Slot Spotify',
        price: 290000,
        duration_months: 1,
        service_type: 'other',
        emoji: 'brand_spotify',
      },
      {
        id: 'unknown-product',
        product_key: 'unknown-product',
        name: 'Sản Phẩm Chưa Phân Loại',
        price: 10000,
        duration_months: 1,
        service_type: 'other',
        emoji: 'order_product',
      },
    ];
    const publicProducts = getPriceBoardProducts(products);
    const spotify = publicProducts.filter((product) => String(product.product_key || '').startsWith('spotify-premium-'));
    const serialized = buildPriceBoardPayloads(GUILD_ID, {}, products).map(serialize).join('\n');

    expect(spotify.map((product) => [product.duration_months, product.price])).toEqual([
      [3, 100000],
      [6, 200000],
      [12, 290000],
    ]);
    expect(serialized).toContain('cenar_spotify');
    expect(serialized).not.toContain('5 Slot Spotify');
    expect(serialized).not.toContain('Sản Phẩm Khác');
    expect(publicProducts.map((product) => product.name)).not.toContain('Sản Phẩm Chưa Phân Loại');
  });

  it('publishes the four new store-development services from one shared catalog', () => {
    const products = getActiveProducts(GUILD_ID);
    const servicePanel = groupPriceProducts(products)
      .find((panel) => panel.group.key === 'services');
    const serviceKeys = servicePanel?.items.map((product) => product.product_key) || [];
    const serialized = buildPriceBoardPayloads(GUILD_ID, {}, products).map(serialize).join('\n');

    expect(serviceKeys).toEqual([
      'discord-store-launch-hosting-3-months',
      'discord-store-automation-pro',
      'discord-store-fullstack-website',
      'discord-bot-rescue-ui',
    ]);
    expect(serialized).toContain('Setup Discord Store + Bot Custom + Hosting 3 Tháng');
    expect(serialized).toContain('Bot Booking / Bảng Giá / Store Custom');
    expect(serialized).toContain('Discord Store + Bot Custom + Website Đồng Bộ');
    expect(serialized).toContain('Fix Bot Lỗi & Nâng Cấp Giao Diện');
    expect(serialized).toContain('500.000');
    expect(serialized).toContain('750.000');
    expect(serialized).toContain('1.000.000');
    expect(serialized).toContain('hosting bot 3 tháng đầu');
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
    expect(allJson).toContain('<#1515008584549797979>');

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

    const nitroPanel = buildPriceBoardPayloads(GUILD_ID, {}, products)
      .map((payload) => payload.components[0].toJSON())
      .find((container) => JSON.stringify(container).includes('Discord Nitro'));
    const keepMailBlock = nitroPanel.components.find((component) => (
      component.type === 10 && component.content.includes('Giữ Mail 7 Ngày')
    ));
    expect(keepMailBlock.content).toContain('**Thời hạn:** `2 tháng`');
    expect(keepMailBlock.content).not.toContain('**Thời hạn:** `7 ngày`');

    const announcement = buildPriceAnnouncementContent(GUILD_ID, nitroSeedProducts);
    expect(announcement).toContain('115.000');
    expect(announcement).toContain('140.000');
    expect(announcement).not.toContain('99k');
  });

  it('shows the complete eligibility for the first-offer Nitro Trial 3-month package', () => {
    const trial = DEFAULT_PRODUCT_CATALOG.find((product) => (
      product.product_key === 'discord-nitro-boost-trial-3-months-first-offer'
    ));
    expect(trial?.name).toContain('Trial 3 Tháng (Ưu Đãi Lần Đầu)');
    expect(trial?.price).toBe(50000);
    expect(trial?.description).toContain('chưa từng sử dụng Nitro');
    expect(trial?.description).toContain('ít nhất 12 tháng liên tục');

    const products = [
      ...getActiveProducts(GUILD_ID).filter((product) => !/nitro.*(?:trial|trail)/i.test(product.name)),
      { ...trial, id: 'nitro-trial-seed' },
    ];
    const nitroPayload = buildPriceBoardPayloads(GUILD_ID, {}, products)
      .map(serialize)
      .find((json) => json.includes('Discord Nitro'));
    expect(nitroPayload).toContain('Đối tượng áp dụng');
    expect(nitroPayload).toContain('Tài khoản được tạo trên 1 tháng và chưa từng sử dụng Nitro.');
    expect(nitroPayload).toContain('không dùng lại Nitro trong ít nhất 12 tháng liên tục.');

    const announcement = buildPriceAnnouncementContent(GUILD_ID, products);
    expect(announcement).toContain('Nitro Trial 3 Tháng · Ưu Đãi Lần Đầu');
    expect(announcement).toContain('50.000');
    expect(announcement).toContain('ít nhất 12 tháng liên tục.');
  });

  it('shows exactly two Netflix choices with the correct renewal policy', () => {
    const netflix = DEFAULT_PRODUCT_CATALOG.find((product) => (
      product.product_key === 'netflix-premium-1-month-non-renewable'
    ));
    const netflixExtra = DEFAULT_PRODUCT_CATALOG.find((product) => (
      product.product_key === 'netflix-extra-1-month-renewable'
    ));
    expect(netflix?.price).toBe(35000);
    expect(netflix?.duration_months).toBe(1);
    expect(netflix?.name).toContain('Ổn Định · Không Gia Hạn');
    expect(netflix?.description).toContain('Full HD/4K');
    expect(netflix?.description).toContain('bảo hành 20 ngày');
    expect(netflix?.description).toContain('đổi sang tài khoản mới');
    expect(netflixExtra?.price).toBe(75000);
    expect(netflixExtra?.description).toContain('hỗ trợ gia hạn tiếp');

    const products = getActiveProducts(GUILD_ID);
    const activeNetflix = products.filter((product) => /netflix/i.test(product.name));
    expect(activeNetflix).toHaveLength(2);

    const netflixPanel = buildPriceBoardPayloads(GUILD_ID, {}, products)
      .map((payload) => serialize(payload))
      .find((json) => json.includes('Netflix Extra & Premium'));
    expect(netflixPanel).toContain('Netflix Extra 1 Tháng');
    expect(netflixPanel).toContain('Netflix Premium 1 Tháng');
    expect(netflixPanel).toContain('75.000');
    expect(netflixPanel).toContain('35.000');
    expect(netflixPanel).toContain('Full HD/4K');
    expect(netflixPanel).toContain('20 ngày');
    expect(netflixPanel).toContain('đổi sang tài khoản mới');

    const announcement = buildPriceAnnouncementContent(GUILD_ID, products);
    expect(announcement).toContain('Netflix Premium 1 Tháng · Không Gia Hạn');
    expect(announcement).toContain('35.000');
    expect(announcement).toContain('Full HD/4K');
    expect(announcement).toContain('20 ngày');
    expect(announcement).toContain('đổi sang tài khoản mới');
  });

  it('publishes only the stable YouTube line and retires monthly Family switching', () => {
    const products = getActiveProducts(GUILD_ID);
    const youtube = products.filter((product) => /youtube premium/i.test(product.name));
    expect(youtube).toHaveLength(4);
    expect(youtube.map((product) => [product.product_key, product.price])).toEqual(expect.arrayContaining([
      ['youtube-premium-continuous-1-month', 60000],
      ['youtube-premium-continuous-3-months', 195000],
      ['youtube-premium-continuous-6-months', 320000],
      ['youtube-premium-continuous-12-months', 580000],
    ]));
    expect(youtube.some((product) => product.product_key.includes('monthly-family-switch'))).toBe(false);
    expect(DEFAULT_PRODUCT_CATALOG.some((product) => (
      String(product.product_key || '').includes('monthly-family-switch')
    ))).toBe(false);
    expect(youtube.every((product) => String(product.warranty_policy).startsWith('Full '))).toBe(true);

    const panels = buildPriceBoardPayloads(GUILD_ID, {}, products).map(serialize);
    const stablePanel = panels.find((json) => json.includes('YouTube Premium · Ổn Định Cao'));
    for (const price of ['60.000', '195.000', '320.000', '580.000']) {
      expect(stablePanel).toContain(price);
    }
    expect(stablePanel).toContain('không dùng cơ chế đổi Family mỗi tháng');
    expect(stablePanel).toContain('hạn chế tối đa tình trạng mất Premium');
    expect(stablePanel).toContain('Full trong suốt thời gian sử dụng');
    expect(panels.join('\n')).not.toContain('YouTube Premium · Đổi Family Mỗi Tháng');
  });

  it('keeps only the four new ChatGPT and current Adobe packages across catalog, board and announcement', () => {
    const products = getActiveProducts(GUILD_ID);
    const chatgptProducts = products.filter((product) => /chat\s*gpt/i.test(product.name));
    const adobeProducts = products.filter((product) => /adobe/i.test(product.name));

    expect(chatgptProducts).toHaveLength(4);
    expect(chatgptProducts.map((product) => product.product_key)).toEqual(expect.arrayContaining([
      AI_CREATIVE_PRICING_UPDATE.productKeys.chatgptNoWarranty,
      AI_CREATIVE_PRICING_UPDATE.productKeys.chatgptAccount,
      AI_CREATIVE_PRICING_UPDATE.productKeys.chatgptBusiness,
      AI_CREATIVE_PRICING_UPDATE.productKeys.chatgptDirect,
    ]));
    expect(chatgptProducts.find((product) => product.product_key === AI_CREATIVE_PRICING_UPDATE.productKeys.chatgptNoWarranty)?.price).toBe(180000);
    expect(chatgptProducts.find((product) => (
      product.product_key === AI_CREATIVE_PRICING_UPDATE.productKeys.chatgptAccount
    ))?.price).toBe(350000);
    expect(chatgptProducts.find((product) => (
      product.product_key === AI_CREATIVE_PRICING_UPDATE.productKeys.chatgptBusiness
    ))?.price).toBe(450000);
    expect(chatgptProducts.find((product) => product.product_key === AI_CREATIVE_PRICING_UPDATE.productKeys.chatgptDirect)?.price).toBe(530000);
    expect(adobeProducts).toHaveLength(1);
    expect(adobeProducts[0].product_key).toBe(AI_CREATIVE_PRICING_UPDATE.productKeys.adobe);
    expect(adobeProducts[0].price).toBe(150000);

    const payloadJson = buildPriceBoardPayloads(GUILD_ID, {}, products).map(serialize).join('\n');
    expect(payloadJson).toContain('ChatGPT Plus & Business');
    expect(payloadJson).toContain('180.000');
    expect(payloadJson).toContain('350.000');
    expect(payloadJson).toContain('450.000');
    expect(payloadJson).toContain('530.000');
    expect(payloadJson).toContain('Không bảo hành');
    expect(payloadJson).toContain('1–2 tuần');
    expect(payloadJson).toContain('150.000');
    expect(payloadJson).toContain('Full trong suốt thời gian sử dụng');
    expect(payloadJson).not.toContain('Adobe Creative Cloud Trial');
    expect(payloadJson).not.toContain('Adobe Creative Cloud All Apps (2 Tháng');

    const announcement = buildAiCreativePricingAnnouncement(GUILD_ID, products);
    expect(announcement).toContain('CHATGPT · 4 LỰA CHỌN');
    expect(announcement).toContain('ChatGPT Business · Add workspace chính chủ');
    expect(announcement).toContain('Thanh toán Plus trực tiếp');
    expect(announcement).toContain('180.000');
    expect(announcement).toContain('350.000');
    expect(announcement).toContain('450.000');
    expect(announcement).toContain('530.000');
    expect(announcement).toContain('thử vận may');
    expect(announcement).toContain('150.000');
    expect(announcement).toContain(AI_CREATIVE_PRICING_UPDATE.marker);
  });

  it('synchronizes Claude Pro and the three canonical Gemini packages', () => {
    const products = getActiveProducts(GUILD_ID);
    const claudePro = products.find((product) => (
      product.product_key === AI_CREATIVE_PRICING_UPDATE.productKeys.claudePro
    ));
    const geminiProducts = products.filter((product) => /gemini/i.test(product.name));

    expect(claudePro?.price).toBe(530000);
    expect(claudePro?.original_price).toBe(0);
    expect(geminiProducts).toHaveLength(3);
    expect(geminiProducts.map((product) => [product.product_key, product.price])).toEqual(expect.arrayContaining([
      [AI_CREATIVE_PRICING_UPDATE.productKeys.gemini12Months, 130000],
      [AI_CREATIVE_PRICING_UPDATE.productKeys.gemini18Months, 180000],
      [AI_CREATIVE_PRICING_UPDATE.productKeys.geminiValue, 69000],
    ]));
    expect(geminiProducts.find((product) => (
      product.product_key === AI_CREATIVE_PRICING_UPDATE.productKeys.geminiValue
    ))?.warranty_policy).toBe('Bảo hành 4 tháng đầu');

    const payloadJson = buildPriceBoardPayloads(GUILD_ID, {}, products).map(serialize).join('\n');
    expect(payloadJson).toContain('530.000');
    expect(payloadJson).toContain('130.000');
    expect(payloadJson).toContain('180.000');
    expect(payloadJson).toContain('69.000');
    expect(payloadJson).toContain('Bảo hành 4 tháng đầu');

    const announcement = buildAiCreativePricingAnnouncement(GUILD_ID, products);
    expect(announcement).toContain('CLAUDE PRO');
    expect(announcement).toContain('GEMINI PRO + 5 TB GOOGLE ONE · 3 LỰA CHỌN');
    expect(announcement).toContain('530.000');
    expect(announcement).toContain('130.000');
    expect(announcement).toContain('180.000');
    expect(announcement).toContain('69.000');
    expect(announcement).toContain('4 tháng đầu');
    expect(announcement).toContain('không được cam kết');
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
