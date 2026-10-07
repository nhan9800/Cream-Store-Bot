import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Collection, MessageFlags } from 'discord.js';

const databasePath = vi.hoisted(() => {
  process.env.ENV_FILE = '.env.test-premium-panels-not-present';
  process.env.DATABASE_PATH = `./data/test-premium-panels-${process.pid}-${Date.now()}.sqlite`;
  process.env.ENCRYPTION_KEY = 'test-premium-panels-key';
  return process.env.DATABASE_PATH;
});
import { db, initDatabase } from '../src/database/db.js';
import { CORE_UI_EMOJI_ASSETS } from '../src/config/coreEmojiPack2026.js';
import { API_CREDIT_PRODUCTS } from '../src/config/apiCreditCatalog.js';
import { buildApiCreditDetails, buildApiCreditPanel, buildApiCreditPricingReply } from '../src/services/apiCreditPanel.js';
import { buildLocketDetails, buildLocketProductPanel } from '../src/services/locketProductPanel.js';

const guildId = '1282637033340403754';
const previousClient = global.discordClient;
const inventory = new Collection([...CORE_UI_EMOJI_ASSETS.map((asset) => asset.name), 'cenar_locket', 'cenar_claude'].map((name, index) => {
  const id = String(1550000000000001000n + BigInt(index));
  return [id, { id, name, animated: false }];
}));
const packs = API_CREDIT_PRODUCTS.map((p, index) => ({ ...p, id: index + 201, is_active: 1 }));
const locket = { base_price: 150000, price: 150000 };

beforeAll(() => {
  initDatabase();
  global.discordClient = {
    guilds: { cache: new Collection([[guildId, { id: guildId, emojis: { cache: inventory } }]]) },
    application: { emojis: { cache: inventory } },
  };
});
afterAll(() => {
  global.discordClient = previousClient;
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(path.resolve(databasePath + suffix), { force: true });
});

function flatten(components) {
  return components.flatMap((component) => [component, ...flatten(component.components || [])]);
}
function inspect(payload) {
  const components = flatten(payload.components.map((c) => c.toJSON()));
  const text = components.filter((c) => c.type === 10).map((c) => c.content).join('\n');
  const serialized = JSON.stringify(components);
  // Every visible icon is backed by live guild/application inventory, including
  // menu choices and buttons. Markdown punctuation and prices are not icons.
  expect(serialized).not.toMatch(/[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u);
  expect(text).not.toMatch(/(^|[^<a]):[a-zA-Z0-9_]+:/);
  for (const match of text.matchAll(/<a?:\w+:(\d+)>/g)) expect(inventory.has(match[1])).toBe(true);
  for (const line of text.split('\n').filter(Boolean)) expect(line).toMatch(/^(?:## |>-? |\-# )?<a?:\w+:\d+>/);
  for (const button of components.filter((c) => c.type === 2)) expect(inventory.has(button.emoji?.id)).toBe(true);
  expect(payload.allowedMentions).toEqual({ parse: [] });
  return { text, components };
}

describe('compact premium Discord panels', () => {
  it('replaces the tall Locket gallery with a thumbnail and preserves the purchase actions', () => {
    const payload = buildLocketProductPanel(guildId, locket);
    const { text, components } = inspect(payload);
    expect(components.some((c) => c.type === 12)).toBe(false);
    const section = components.find((c) => c.type === 9);
    expect(section.accessory).toMatchObject({ type: 11, media: { url: 'attachment://locket-gold-banner.webp' } });
    expect(text.split('\n')).toHaveLength(7);
    expect(text).toContain('150.000đ');
    expect(text).toContain('12 tháng');
    expect(text).toContain('Không cần mật khẩu hoặc OTP');
    expect(components.filter((c) => c.type === 2).map((c) => c.custom_id)).toEqual(['product:locket:buy', 'product:locket:features', 'product:locket:policy']);
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
  });
  it('keeps exact current API prices and one real product choice per credit tier', () => {
    const { text, components } = inspect(buildApiCreditPanel(guildId, packs));
    expect(text).toContain('**Không giới hạn ngày**');
    expect(text).toContain('Bảo hành đến hết credit');
    const options = components.find((c) => c.type === 3).options;
    expect(options.map((o) => [o.value, o.label])).toEqual([
      ['201', '$10 credit · 70.000đ'], ['202', '$30 credit · 90.000đ'], ['203', '$50 credit · 110.000đ'],
      ['204', '$100 credit · 155.000đ'], ['205', '$200 credit · 250.000đ'], ['206', '$500 credit · 530.000đ'],
    ]);
    for (const option of options) expect(inventory.has(option.emoji?.id)).toBe(true);
    expect(components.filter((c) => c.type === 2).map((c) => c.custom_id)).toEqual(['product:claude:pricing', 'product:claude:models', 'product:claude:policy']);
  });
  it.each(['models', 'policy'])('uses custom Markdown and private replies for API %s', (page) => {
    const payload = buildApiCreditDetails(guildId, page);
    const { text, components } = inspect(payload);
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
    expect(text.split('\n').length).toBeLessThanOrEqual(8);
    if (page === 'models') expect(components.filter((c) => c.type === 2).map((c) => c.url)).toEqual(['https://cenarstore.xyz/huong-dan-api', 'https://cenarstore.xyz/check-token']);
    else expect(text).toContain('không hoàn tiền sau khi đã kích hoạt và sử dụng token');
  });
  it.each(['features', 'policy'])('keeps Locket %s compact, private and accurate', (page) => {
    const payload = buildLocketDetails(guildId, page, { base_price: 167000 });
    const { text } = inspect(payload);
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
    expect(text.split('\n').length).toBeLessThanOrEqual(8);
    if (page === 'features') expect(text).toContain('167.000đ');
    else expect(text).toContain('12 tháng từ ngày kích hoạt');
  });
  it('uses the same live options in private pricing and shows a clear empty catalog', () => {
    const payload = buildApiCreditPricingReply(guildId, packs);
    const { components } = inspect(payload);
    expect(components.find((c) => c.type === 3).options.every((o) => inventory.has(o.emoji?.id))).toBe(true);
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
    const empty = inspect(buildApiCreditPricingReply(guildId, []));
    expect(empty.components.some((c) => c.type === 3)).toBe(false);
    expect(empty.text).toContain('Gói đang được cập nhật');
  });
  it('works without a local image or unavailable custom emoji, with no fake artwork IDs', () => {
    global.discordClient = { guilds: { cache: new Collection() }, application: { emojis: { cache: new Collection() } } };
    try {
      const payload = buildLocketProductPanel(guildId, locket, false);
      const components = flatten(payload.components.map((c) => c.toJSON()));
      expect(components.some((c) => [9, 11, 12].includes(c.type))).toBe(false);
      expect(components.filter((c) => c.type === 2).every((c) => !c.emoji)).toBe(true);
      expect(JSON.stringify(components)).not.toMatch(/<a?:\w+:\d+>|[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u);
    } finally {
      global.discordClient = { guilds: { cache: new Collection([[guildId, { id: guildId, emojis: { cache: inventory } }]]) }, application: { emojis: { cache: inventory } } };
    }
  });
});
