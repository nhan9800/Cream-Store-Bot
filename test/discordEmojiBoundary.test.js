import { Collection, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config.js', () => ({ config: { guildId: 'emoji-boundary-guild' } }));
vi.mock('../src/database/db.js', async () => {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE guild_settings (
    guild_id TEXT PRIMARY KEY, custom_emojis TEXT, updated_at TEXT,
    ticket_category_id TEXT, order_log_channel_id TEXT, feedback_channel_id TEXT
  )`);
  return { db, nowIso: () => new Date().toISOString() };
});

import { db } from '../src/database/db.js';
import { resetAllEmojis } from '../src/services/emojiService.js';
import { installDiscordEmojiBoundary, normalizeMessagePresentation } from '../src/utils/discordEmojiBoundary.js';

const guildId = 'emoji-boundary-guild';
const channelId = '1550000000000000100';
const store = { id: '1550000000000000101', name: 'cenar_ui26_store', animated: false };
const shield = { id: '1550000000000000102', name: 'cenar_ui26_shield', animated: false };
const oldStore = { id: '1392749981332541501', name: 'cr_shop', animated: false };
const brand = { id: '1550000000000000103', name: 'renamed_brand', animated: true };
const stale = '<:unknown_deleted:1550000000000000199>';
const legacy = `<:cr_shop:${oldStore.id}>`;
const replacement = `<:${store.name}:${store.id}>`;
const previousClient = global.discordClient;
let client;
let request;

beforeEach(() => {
  db.prepare('DELETE FROM guild_settings').run();
  resetAllEmojis(guildId);
  request = vi.fn(function () { return 'original-result'; });
  client = {
    rest: { request },
    guilds: { cache: new Collection([[guildId, { id: guildId, emojis: {
      cache: new Collection([[oldStore.id, oldStore], [brand.id, brand]]),
    } }]]) },
    application: { emojis: { cache: new Collection([[store.id, store], [shield.id, shield]]) } },
    channels: { cache: new Collection([[channelId, { guildId }]]) },
  };
  global.discordClient = client;
});
afterEach(() => { global.discordClient = previousClient; });
afterAll(() => db.close());

describe('Discord live emoji message boundary', () => {
  it('blocks all send/edit requests in paused marketing channels while allowing deletion and commerce', async () => {
    installDiscordEmojiBoundary(client);
    for (const id of ['1514606987839672563', '1515008584549797979', '1531206050383134842']) {
      for (const method of ['POST', 'PATCH']) {
        await expect(client.rest.request({ method, fullRoute: `/channels/${id}/messages${method === 'PATCH' ? '/1550000000000000120' : ''}`, body: { content: '@everyone' } })).rejects.toMatchObject({ code: 'MARKETING_PAUSED' });
      }
      expect(client.rest.request({ method: 'DELETE', fullRoute: `/channels/${id}/messages/1550000000000000120` })).toBe('original-result');
      expect(client.rest.request({ method: 'GET', fullRoute: `/channels/${id}/messages` })).toBe('original-result');
    }
    expect(request).toHaveBeenCalledTimes(6);
    expect(client.rest.request({ method: 'POST', fullRoute: `/channels/${channelId}/messages`, body: { content: 'Order paid' } })).toBe('original-result');
  });
  it('normalizes channel sends/edits, interaction messages/updates and webhook messages at the final REST boundary', () => {
    expect(installDiscordEmojiBoundary(client)).toBe(true);
    const routes = [
      ['POST', `/channels/${channelId}/messages`],
      ['patch', `/channels/${channelId}/messages/1550000000000000120`],
      ['POST', '/interactions/1550000000000000121/interaction-token/callback', 4],
      ['POST', '/interactions/1550000000000000121/interaction-token/callback', 7],
      ['POST', '/webhooks/1550000000000000122/webhook-token?wait=true'],
      ['PATCH', '/webhooks/1550000000000000122/webhook-token/messages/@original'],
      ['PATCH', '/webhooks/1550000000000000122/webhook-token/messages/1550000000000000123'],
    ];
    for (const [method, fullRoute, type] of routes) {
      const message = { content: `${legacy} CN_123456 · 150.000đ ${stale}`, flags: 64 };
      const body = type ? { type, data: message } : message;
      const options = { method, fullRoute, body };
      expect(client.rest.request(options)).toBe('original-result');
      const forwarded = request.mock.calls.at(-1)[0];
      const normalized = type ? forwarded.body.data : forwarded.body;
      expect(normalized.content).toBe(`${replacement} CN_123456 · 150.000đ `);
      expect(normalized.flags).toBe(64);
      expect(type ? forwarded.body.type : undefined).toBe(type);
      expect(body).toEqual(type ? { type, data: message } : message);
      expect(message.content).toContain(legacy);
      expect(request.mock.contexts.at(-1)).toBe(client.rest);
    }
  });

  it('bypasses modal/deferred callbacks and nonmessage operations without changing protocol objects', () => {
    installDiscordEmojiBoundary(client);
    const routes = [
      ['POST', '/interactions/1550000000000000121/token/callback', { type: 9, data: { custom_id: ':cr_shop:', title: legacy, components: [] } }],
      ['POST', '/interactions/1550000000000000121/token/callback', { type: 5, data: { flags: 64 } }],
      ['POST', '/interactions/1550000000000000121/token/callback', { type: 6 }],
      ['PUT', '/applications/1550000000000000121/commands', { description: legacy }],
      ['POST', '/guilds/1550000000000000121/roles', { description: legacy }],
      ['PATCH', '/guilds/1550000000000000121/roles/1550000000000000122', { description: legacy }],
      ['POST', '/applications/1550000000000000121/emojis', { name: 'cenar_ui26_store', image: 'data:image/png;base64,unchanged' }],
      ['POST', '/guilds/1550000000000000121/emojis', { name: ':cr_shop:', image: 'unchanged' }],
      ['DELETE', `/channels/${channelId}/messages/1550000000000000120`, { content: legacy }],
      ['GET', `/channels/${channelId}/messages`, { content: legacy }],
      ['POST', '/api/payments/confirm', { content: legacy, amount: 150000, order_id: 'CN_123456' }],
      ['PATCH', '/webhooks/1550000000000000122/webhook-token', { description: legacy, name: ':cr_shop:' }],
      ['POST', `/channels/${channelId}/messages/bulk-delete`, { messages: ['1550000000000000120'] }],
    ];
    for (const [method, fullRoute, body] of routes) {
      const options = { method, fullRoute, body };
      client.rest.request(options);
      expect(request.mock.calls.at(-1)[0]).toBe(options);
      expect(request.mock.calls.at(-1)[0].body).toBe(body);
    }
    const empty = { method: 'POST', fullRoute: `/channels/${channelId}/messages` };
    client.rest.request(empty);
    expect(request.mock.calls.at(-1)[0]).toBe(empty);
  });

  it('preserves attachment buffers, files, URL fields and all action identifiers while repairing display fields', () => {
    installDiscordEmojiBoundary(client);
    const file = Buffer.from('credential :cr_shop: <:unknown_deleted:1550000000000000199>');
    const files = [{ data: file, name: 'customer.json', contentType: 'application/json' }];
    const attachments = [{ id: '0', filename: 'customer.json', description: ':cr_shop:' }];
    const url = `https://example.com/:cr_shop:/receipt?literal=${stale}`;
    const customId = `paid:CN_123456:${legacy}:credential`;
    const selectedValue = `:cr_shop:|${stale}|150000`;
    const body = {
      content: `${legacy} Tổng 150.000đ`, attachments,
      allowed_mentions: { parse: [], users: ['1550000000000000144'] }, nonce: ':cr_shop:',
      embeds: [{ title: `${legacy} Đơn hàng`, url, image: { url }, thumbnail: { url },
        footer: { text: `${legacy} Cenar`, icon_url: url }, author: { name: `${legacy} Cenar`, url, icon_url: url } }],
      components: [{ type: 1, components: [
        { type: 2, style: 1, label: `${legacy} Xác nhận`, custom_id: customId, disabled: false,
          emoji: { id: oldStore.id, name: oldStore.name } },
        { type: 2, style: 5, label: 'Thông tin', url },
      ] }, { type: 1, components: [{ type: 3, custom_id: customId, placeholder: `${legacy} Chọn gói`,
        options: [{ label: `${legacy} 1 tháng`, description: `${legacy} BH full ${stale}`, value: selectedValue,
          emoji: { id: oldStore.id, name: oldStore.name } }] }] }],
    };
    const originalContent = body.content;
    client.rest.request({ method: 'POST', fullRoute: `/channels/${channelId}/messages`, body, files });
    const forwarded = request.mock.calls.at(-1)[0];
    const result = forwarded.body;
    expect(forwarded.files).toBe(files);
    expect(forwarded.files[0].data).toBe(file);
    expect(result.attachments).toBe(attachments);
    expect(result.allowed_mentions).toBe(body.allowed_mentions);
    expect(result.nonce).toBe(':cr_shop:');
    expect(result.content).toBe(`${replacement} Tổng 150.000đ`);
    expect(body.content).toBe(originalContent);
    expect(result.embeds[0].url).toBe(url);
    expect(result.embeds[0].image).toBe(body.embeds[0].image);
    expect(result.embeds[0].thumbnail).toBe(body.embeds[0].thumbnail);
    expect(result.embeds[0].footer.icon_url).toBe(url);
    expect(result.embeds[0].author).toMatchObject({ url, icon_url: url });
    expect(result.components[0].components[0]).toMatchObject({
      label: 'Xác nhận', custom_id: customId, style: 1, disabled: false,
      emoji: { id: store.id, name: store.name, animated: false },
    });
    expect(result.components[0].components[1].url).toBe(url);
    const selector = result.components[1].components[0];
    expect(selector).toMatchObject({ custom_id: customId, placeholder: 'Chọn gói' });
    expect(selector.options[0]).toMatchObject({ label: '1 tháng', value: selectedValue,
      description: `${replacement} BH full `, emoji: { id: store.id, name: store.name, animated: false } });
  });

  it('preserves literal credentials in code fences, inline code, spoilers and text URLs exactly', () => {
    const protectedText = '20:30:15, :literal_customer_field:, `:cr_shop: secret`\n'
      + '```json\n{"password":":cr_shop:","token":"<:unknown_deleted:1550000000000000199>"}\n```\n'
      + '||:cr_shop: private-password||\nhttps://example.com/:cr_shop:?time=20:30:15';
    const result = normalizeMessagePresentation({ content: `${legacy}\n${protectedText}` }, guildId);
    expect(result.content).toBe(`${replacement}\n${protectedText}`);
  });

  it('omits unknown/deleted custom button emoji while retaining the actionable button and selection option', () => {
    const result = normalizeMessagePresentation({ components: [{ type: 1, components: [
      { type: 2, style: 1, custom_id: 'boost:confirm:BST_123456', label: 'Xác nhận thanh toán', disabled: false,
        emoji: { id: '1550000000000000199', name: 'unknown_deleted' } },
      { type: 3, custom_id: 'order:choose', options: [{ label: '1 tháng', value: 'sku:120000',
        emoji: { id: '1550000000000000199', name: 'unknown_deleted' } }] },
    ] }] }, guildId);
    expect(result.components[0].components[0]).toEqual({ type: 2, style: 1,
      custom_id: 'boost:confirm:BST_123456', label: 'Xác nhận thanh toán', disabled: false });
    expect(result.components[0].components[1].options[0]).toEqual({ label: '1 tháng', value: 'sku:120000' });
  });

  it('repairs every embed text field and nested V2 section/accessory without changing values or presentation metadata', () => {
    const result = normalizeMessagePresentation({
      embeds: [{ title: `:cr_shop: Store`, description: `:verifybadge: Khách ${stale}`, color: 0xabc123,
        fields: [{ name: `${legacy} Mã đơn`, value: `${legacy} CN_123456 / 150.000đ`, inline: true }],
        footer: { text: `${legacy} Cenar` }, author: { name: `<:old_brand:${brand.id}> Brand` }, timestamp: '2026-10-02T13:30:15Z' }],
      components: [{ type: 17, accent_color: 0xabc123, components: [{ type: 9, components: [
        { type: 10, content: `${legacy} Nội dung ${stale}` },
      ], accessory: { type: 2, style: 1, label: `${legacy} Xem đơn`, custom_id: 'view:CN_123456',
        emoji: { id: brand.id, name: 'old_brand', animated: false } } }] }],
    }, guildId);
    expect(result.embeds[0]).toMatchObject({ title: `${replacement} Store`,
      description: `<:${shield.name}:${shield.id}> Khách `, color: 0xabc123,
      fields: [{ name: `${replacement} Mã đơn`, value: `${replacement} CN_123456 / 150.000đ`, inline: true }],
      footer: { text: `${replacement} Cenar` }, author: { name: `<a:${brand.name}:${brand.id}> Brand` },
      timestamp: '2026-10-02T13:30:15Z' });
    expect(result.components[0].accent_color).toBe(0xabc123);
    const section = result.components[0].components[0];
    expect(section.components[0].content).toBe(`${replacement} Nội dung `);
    expect(section.accessory).toMatchObject({ label: 'Xem đơn', custom_id: 'view:CN_123456',
      emoji: { id: brand.id, name: brand.name, animated: true } });
  });

  it('supports already serialized REST payloads and builder presentation objects without mutating the builders', () => {
    const button = new ButtonBuilder().setCustomId('repair:BST_123456').setStyle(ButtonStyle.Primary)
      .setLabel('Sửa giao diện').setEmoji({ id: oldStore.id, name: oldStore.name });
    const embed = new EmbedBuilder().setTitle(`${legacy} Store`).setDescription(stale);
    const result = normalizeMessagePresentation({ embeds: [embed], components: [{ type: 1, components: [button] }] }, guildId);
    expect(result.embeds[0]).toMatchObject({ title: `${replacement} Store`, description: '' });
    expect(result.components[0].components[0].emoji).toEqual({ id: store.id, name: store.name, animated: false });
    expect(button.toJSON().emoji.id).toBe(oldStore.id);
    expect(embed.toJSON().title).toBe(`${legacy} Store`);
  });

  it('installs only once and preserves the original request response and binding', () => {
    expect(installDiscordEmojiBoundary({})).toBe(false);
    expect(installDiscordEmojiBoundary(client)).toBe(true);
    const wrapper = client.rest.request;
    expect(installDiscordEmojiBoundary(client)).toBe(false);
    expect(client.rest.request).toBe(wrapper);
    const response = Promise.resolve({ ok: true });
    request.mockReturnValue(response);
    const options = { method: 'POST', fullRoute: `/channels/${channelId}/messages`, body: { content: legacy } };
    expect(client.rest.request(options)).toBe(response);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.contexts[0]).toBe(client.rest);
    expect(request.mock.calls[0][0].body.content).toBe(replacement);
  });
});
