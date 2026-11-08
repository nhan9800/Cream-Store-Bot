import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttachmentBuilder, MessageFlags } from 'discord.js';

const databasePath = vi.hoisted(() => {
  const value = `./data/test-customer-layout-${process.pid}-${Date.now()}.sqlite`;
  Object.assign(process.env, { ENV_FILE: '.env.customer-layout-not-present', DATABASE_PATH: value,
    ENCRYPTION_KEY: 'test-layout-key', PAYOS_CLIENT_ID: 'test-client', PAYOS_API_KEY: 'test-api',
    PAYOS_CHECKSUM_KEY: 'test-checksum', PUBLIC_BASE_URL: 'https://bot.example' });
  return value;
});
vi.mock('../src/services/productCatalogService.js', async original => ({ ...await original(), getActiveProducts: vi.fn(() => []) }));
vi.mock('../src/services/emojiService.js', async original => {
  const actual = await original();
  const emoji = slot => `<:layout_${slot}:1550000000000000001>`;
  return { ...actual, getEmoji: (_guild, slot) => emoji(slot),
    getEmojiMap: () => new Proxy({}, { get: (_object, slot) => emoji(String(slot)) }) };
});
import { db, initDatabase } from '../src/database/db.js';
import { getActiveProducts } from '../src/services/productCatalogService.js';
import { buildShopPanelV2, shopPanelEditPayload, createShopPanel, getShopPanelByMessageId,
  handleShopPanelPage, refreshAllShopPanels } from '../src/services/shopPanelService.js';
import { buildGmailNitroGuidePayload } from '../src/events/messageCreate.js';
import { execute as setupShop } from '../src/commands/setup-shop.js';
import { createTicket } from '../src/services/ticketService.js';
import { createOrder, getOrderByCode } from '../src/services/orderService.js';
import { sendVietQRPayment } from '../src/services/paymentService.js';
import { countDiscordComponents } from '../src/utils/discordLayout.js';

const guildId = 'layout-fixture';
const options = { guildId, category: 'nitro', title: 'Nitro @everyone', features: 'Hỗ trợ dài hạn\nGiá theo thị trường', imageUrl: 'https://example.com/banner.png' };
const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.components || []), ...(node.accessory ? [node.accessory] : [])]);
const texts = payload => flatten(payload.components).filter(node => node.type === 10).map(node => node.content).join('\n');
const menu = payload => flatten(payload.components).find(node => node.type === 3);
const products = (count, nameLength = 0) => Array.from({ length: count }, (_, i) => ({ id: i + 1,
  name: `Nitro ${i + 1} ${'A'.repeat(nameLength)}`.trim(), service_type: 'nitro', price: 115000 + i,
  duration_months: 2, emoji: '' }));
function valid(payload) {
  expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
  expect(countDiscordComponents(payload.components)).toBeLessThanOrEqual(40);
  expect(texts(payload).length).toBeLessThanOrEqual(4000);
  expect(flatten(payload.components).some(node => node.type === 14 && node.spacing === 2)).toBe(true);
}

describe('remaining active customer feature layouts', () => {
  beforeAll(() => initDatabase());
  beforeEach(() => { vi.clearAllMocks(); getActiveProducts.mockReturnValue(products(2)); db.exec('DELETE FROM shop_panels'); });
  afterAll(() => {
    vi.restoreAllMocks(); db.close();
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${path.resolve(databasePath)}${suffix}`, { force: true });
  });

  it('groups the actual Gmail guide and keeps its exact image, links, brand and silent mentions', () => {
    const attachment = new AttachmentBuilder(Buffer.from('synthetic image'), { name: 'gmail_update.png' });
    const payload = buildGmailNitroGuidePayload('1282637033340403754', attachment);
    valid(payload);
    expect(payload.files).toEqual([attachment]);
    expect(payload.allowedMentions).toEqual({ parse: [] });
    expect(texts(payload)).not.toContain('━━━━');
    for (const heading of ['1. DUY TRÌ', '2. CẬP NHẬT', '3. THAY ĐỔI', 'PHÁT HIỆN THIẾT BỊ LẠ', 'Cenar Store 1']) expect(texts(payload)).toContain(heading);
    for (const url of ['signinoptions/rescuephone', 'intro/recovery/email', 'myaccount.google.com/phone', 'video-verification/signin/precollection']) expect(texts(payload)).toContain(url);
    expect(flatten(payload.components).find(node => node.type === 12).items[0].media.url).toBe('attachment://gmail_update.png');
  });

  it('keeps the original guide representation if an unreferenced attachment would be hidden', () => {
    const file = new AttachmentBuilder(Buffer.from('file'), { name: 'different-file.png' });
    const payload = buildGmailNitroGuidePayload(guildId, file);
    expect(payload.flags).toBeUndefined();
    expect(payload.embeds[0].toJSON().image.url).toBe('attachment://gmail_update.png');
    expect(payload.files[0]).toBe(file);
  });

  it('pages every public catalog product with unchanged prices, option IDs and banner', () => {
    const all = products(31, 180); getActiveProducts.mockReturnValue(all);
    const found = [];
    for (let page = 0; page < 31; page++) {
      const payload = buildShopPanelV2({ ...options, page }); valid(payload);
      expect(payload.allowedMentions).toEqual({ parse: [] });
      const select = menu(payload);
      expect(select.custom_id).toBe('product:select');
      for (const option of select.options) {
        found.push(Number(option.value));
        expect(texts(payload)).toContain(all[Number(option.value) - 1].price.toLocaleString('vi-VN'));
      }
      expect(flatten(payload.components).find(node => node.type === 12).items[0].media.url).toBe(options.imageUrl);
      expect(flatten(payload.components).some(node => node.custom_id === 'shop:panel:edit')).toBe(true);
      const next = flatten(payload.components).find(node => node.custom_id === `shop:panel:page:${page + 1}`);
      if (next?.disabled) break;
    }
    expect(found).toEqual(all.map(product => product.id));
    expect(menu(buildShopPanelV2({ ...options, page: 999 })).options.at(-1).value).toBe('31');
    expect(menu(buildShopPanelV2({ ...options, page: -99 })).options[0].value).toBe('1');
  });

  it('preserves full metadata in a legacy fallback and refuses irreversible V2 downgrade', () => {
    getActiveProducts.mockReturnValue([]);
    const long = { ...options, features: 'Z'.repeat(3680) };
    const payload = buildShopPanelV2(long);
    expect(payload.flags).toBeUndefined();
    expect(payload.embeds[0].toJSON().description).toContain(long.features);
    expect(() => shopPanelEditPayload({ flags: MessageFlags.IsComponentsV2 }, payload)).toThrow('vượt giới hạn');
    expect(shopPanelEditPayload({ flags: 0 }, payload)).toBe(payload);
    const native = buildShopPanelV2(options);
    expect(shopPanelEditPayload({ flags: 0 }, native)).toMatchObject({ embeds: [], content: null, flags: MessageFlags.IsComponentsV2 });
  });

  it('navigates an existing panel without persisting catalog or panel changes', async () => {
    getActiveProducts.mockReturnValue(products(9));
    createShopPanel({ ...options, channelId: 'shop-channel', messageId: 'shop-message' });
    const before = getShopPanelByMessageId('shop-message');
    const interaction = { guildId, channelId: 'shop-channel', message: { id: 'shop-message', flags: MessageFlags.IsComponentsV2 },
      customId: 'shop:panel:page:1', update: vi.fn(), reply: vi.fn() };
    await handleShopPanelPage(interaction);
    valid(interaction.update.mock.calls[0][0]);
    expect(menu(interaction.update.mock.calls[0][0]).options[0].value).toBe('7');
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(getShopPanelByMessageId('shop-message')).toEqual(before);
    for (const override of [{ guildId: 'other' }, { channelId: 'other' }, { message: { id: 'missing' } }]) {
      const invalid = { ...interaction, ...override, reply: vi.fn(), update: vi.fn() };
      await handleShopPanelPage(invalid);
      expect(invalid.update).not.toHaveBeenCalled();
      expect(invalid.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    }
  });

  it('forwards flags through setup and refresh and clears previous embed presentation', async () => {
    const send = vi.fn().mockResolvedValue({ id: 'created-panel' });
    await setupShop({ guildId, channel: { id: 'shop-channel', send }, deferReply: vi.fn(), editReply: vi.fn(),
      options: { getString: key => ({ category: 'nitro', title: 'Nitro', features: 'Hỗ trợ' })[key] ?? null } });
    valid(send.mock.calls[0][0]);
    const edit = vi.fn().mockResolvedValue({});
    const channel = { isTextBased: () => true, messages: { fetch: vi.fn().mockResolvedValue({ flags: 0, edit }) } };
    await refreshAllShopPanels({ channels: { fetch: vi.fn().mockResolvedValue(channel) } }, guildId);
    valid(edit.mock.calls[0][0]);
    expect(edit.mock.calls[0][0]).toMatchObject({ embeds: [], content: null });
  });

  it('sends a native VietQR invoice with unchanged financial values, bytes, reference and recipient', async () => {
    const ticket = createTicket({ guildId, channelId: 'payment-ticket', customerId: '123456789012345678', openedById: '123456789012345678', ticketType: 'ORDER' });
    const order = createOrder({ orderCode: 'CN_996611', guildId, ticketId: ticket.id, ticketChannelId: ticket.channel_id,
      customerId: ticket.customer_id, productName: 'Test bank package', quantity: 2, totalAmount: 230000,
      durationMonths: 2, orderLogChannelId: 'log', createdById: ticket.customer_id });
    db.prepare(`INSERT INTO guild_settings (guild_id, ticket_category_id, order_log_channel_id, feedback_channel_id,
      bank_alias, bank_bin, bank_account_no, bank_account_name) VALUES (?, 'cat', 'log', 'feedback', 'MB', '970422', '1234567890', 'FIXTURE')`).run(guildId);
    const bytes = Buffer.from('synthetic QR bytes');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, arrayBuffer: async () => bytes });
    const send = vi.fn().mockResolvedValue({ id: 'qr-message' });
    try {
      await sendVietQRPayment({ guild: { channels: { fetch: vi.fn().mockResolvedValue({ isTextBased: () => true, send }) } }, orderCode: order.order_code });
      const payload = send.mock.calls[0][0]; valid(payload);
      expect(payload.allowedMentions).toEqual({ parse: [], users: [ticket.customer_id] });
      for (const value of ['230.000', '1234567890', 'FIXTURE', order.payment_code || order.order_code, '2x Test bank package', `<@${ticket.customer_id}>`]) expect(texts(payload)).toContain(value);
      expect(payload.files[0].attachment).toEqual(bytes);
      expect(flatten(payload.components).find(node => node.type === 12).items[0].media.url).toBe(`attachment://vietqr-${order.order_code}.png`);
      expect(getOrderByCode(order.order_code)).toMatchObject({ payment_message_id: 'qr-message', payment_status: order.payment_status, total_amount: 230000 });
    } finally { fetchMock.mockRestore(); }
  });
});
