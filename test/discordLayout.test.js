import { describe, expect, it } from 'vitest';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags,
  SectionBuilder, TextDisplayBuilder, ThumbnailBuilder,
} from 'discord.js';
import { countDiscordComponents, normalizeDiscordV2Layout } from '../src/utils/discordLayout.js';

const text = (content, id) => ({ type: 10, content, ...(id ? { id } : {}) });
const card = (...components) => ({ type: 17, accent_color: 0x31b984, components });
const row = id => ({ type: 1, components: [{ type: 2, style: 1, custom_id: id, label: 'Xem đơn' }] });
const separator = (spacing = 1, divider = true, id) => ({ type: 14, spacing, divider, ...(id ? { id } : {}) });
const message = (...components) => ({ flags: MessageFlags.IsComponentsV2, components });
const normalize = (...components) => normalizeDiscordV2Layout(message(...components));

function invariantProjection(components) {
  return components.filter(node => node.type !== 14).map(node => ({
    ...node,
    ...(node.components ? { components: invariantProjection(node.components) } : {}),
  }));
}

describe('native Discord layout rhythm', () => {
  it('separates header, details and next step while retaining compact footer and action group', () => {
    const input = message(card(text('## Mua hàng'), text('**Sản phẩm:** Gemini\n**Giá:** 50.000đ'),
      text('### Tiếp theo\n1. Kiểm tra thông tin\n2. Thanh toán'), text('-# Cenar Store')), row('pay'), row('cancel'));
    const result = normalizeDiscordV2Layout(input);
    expect(result.components[0].components.map(node => node.type)).toEqual([10, 14, 10, 14, 10, 14, 10]);
    expect(result.components[0].components.filter(node => node.type === 14).map(node => node.spacing)).toEqual([2, 2, 1]);
    expect(result.components.map(node => node.type)).toEqual([17, 14, 1, 1]);
    expect(result.components[1]).toEqual(separator(2, false));
    expect(invariantProjection(result.components)).toEqual(invariantProjection(input.components));
  });

  it('improves visible group separators in place, keeping IDs and explicit invisible spacers', () => {
    const result = normalize(card(text('## Heading'), separator(1, true, 81), text('Body'),
      separator(1, false, 82), text('Other'), separator(2, true, 83), text('-# Original date 09/11/2026')));
    expect(result.components[0].components.filter(node => node.type === 14)).toEqual([
      separator(2, true, 81), separator(1, false, 82), separator(1, true, 83),
    ]);
  });

  it('does not multiply existing separators or separate consecutive field rows', () => {
    const input = message(card(text('## Order'), separator(2), separator(1, false),
      text('> **Mã đơn:** CN_123456'), text('<:price:1550000000000000001> **Giá:** 50.000đ')));
    const result = normalizeDiscordV2Layout(input);
    expect(result.components[0].components).toHaveLength(5);
    expect(result.components[0].components.filter(node => node.type === 14)).toHaveLength(2);
  });

  it('uses padding rather than extra rules around media and preserves QR/files exactly', () => {
    const gallery = { type: 12, id: 3, items: [{ media: { url: 'attachment://qr.png' }, description: 'QR CN_123456', spoiler: false }] };
    const file = { type: 13, file: { url: 'attachment://private.txt' }, spoiler: true };
    const input = message(card(text('## Thanh toán'), gallery, text('**Nội dung:** CN_123456'), file), row('pay:CN_123456'));
    const result = normalizeDiscordV2Layout(input);
    expect(result.components[0].components.filter(node => node.type === 14).every(node => node.divider === false)).toBe(true);
    expect(invariantProjection(result.components)).toEqual(invariantProjection(input.components));
    expect(result.components[0].components.find(node => node.type === 12)).toBe(gallery);
    expect(result.components[0].components.find(node => node.type === 13)).toBe(file);
  });

  it('keeps adjacent cards and consecutive action rows together', () => {
    const result = normalize(card(text('## One')), card(text('## Two')), row('one'), row('two'));
    expect(result.components.map(node => node.type)).toEqual([17, 17, 14, 1, 1]);
  });

  it('keeps a standalone section label attached to its literal paragraph', () => {
    const input = message(card(text('## Đánh giá 5/5'), separator(), text('Khách: @member'), separator(),
      text('### <:review:1550000000000000001> Khách hàng chia sẻ'), text('> Ý kiến của khách\n\n> Giữ nguyên'),
      separator(1, false), text('-# Cenar Store')));
    const result = normalizeDiscordV2Layout(input);
    expect(result.components[0].components.map(node => node.type)).toEqual([10, 14, 10, 14, 10, 10, 14, 10]);
  });

  it('never inserts a separator within Sections, accessories or ActionRows', () => {
    const section = { type: 9, id: 7, components: [text('## Preview'), text('Description')],
      accessory: { type: 2, style: 5, label: 'Mở website', url: 'https://cenarstore.xyz/' } };
    const controls = { type: 1, components: [
      { type: 3, custom_id: 'choose', options: [{ label: '1 tháng', value: '1m', emoji: { id: '1550000000000000001' } }] },
    ] };
    const result = normalize(card(section, text('Choose an item'), controls));
    const actual = result.components[0].components;
    expect(actual.map(node => node.type)).toEqual([9, 14, 10, 14, 1]);
    expect(actual[0]).toBe(section);
    expect(actual[4]).toBe(controls);
  });

  it('preserves customer prose, credentials, quotes, code, emojis and monetary text byte for byte', () => {
    const literal = '> KH: tuyệt quá 😊\n\n```json\n{"secret":"a:b","amount":50000}\n```\n'
      + '||hidden||\n### customer heading\n@everyone\n**Giá:** 50.000đ\n<:original:1550000000000000001>';
    const input = message(card(text('## Đánh giá'), text(literal), text('-# Đăng lần đầu 19/10/2026')));
    input.allowed_mentions = { parse: [], users: [] };
    input.nonce = 'keep';
    input.flags |= MessageFlags.SuppressNotifications;
    input.attachments = [{ id: '1550000000000000002', filename: 'original.txt' }];
    input.files = [{ data: Buffer.from(literal), name: 'original.txt' }];
    const result = normalizeDiscordV2Layout(input);
    expect(result.components[0].components.filter(node => node.type === 10).map(node => node.content)).toEqual([
      '## Đánh giá', literal, '-# Đăng lần đầu 19/10/2026',
    ]);
    for (const key of ['allowed_mentions', 'nonce', 'flags', 'attachments', 'files']) expect(result[key]).toBe(input[key]);
  });

  it('supports builder payloads without changing source builders', () => {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent('## Welcome'), new TextDisplayBuilder().setContent('Details'),
    );
    const controls = new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Primary).setCustomId('next').setLabel('Tiếp tục'));
    const before = container.toJSON();
    const result = normalize(container, controls);
    expect(result.components[0].components.map(node => node.type)).toEqual([10, 14, 10]);
    expect(container.toJSON()).toEqual(before);
    expect(controls.toJSON().components).toHaveLength(1);
  });

  it('does not modify frozen source payloads', () => {
    const first = Object.freeze(text('## Header'));
    const second = Object.freeze(text('Details'));
    const input = Object.freeze({ flags: 32768, components: Object.freeze([
      Object.freeze({ type: 17, components: Object.freeze([first, second]) }),
    ]) });
    expect(normalizeDiscordV2Layout(input).components[0].components).toHaveLength(3);
    expect(input.components[0].components).toHaveLength(2);
  });

  it('is idempotent before and after Discord assigns IDs to the separators', () => {
    const once = normalize(card(text('## Header'), text('Details'), text('-# Footer')), row('continue'));
    expect(normalizeDiscordV2Layout(once)).toEqual(once);
    let id = 100;
    const assign = node => ({ ...node, id: id++, ...(node.components ? { components: node.components.map(assign) } : {}) });
    const readback = { ...once, components: once.components.map(assign) };
    expect(normalizeDiscordV2Layout(readback)).toEqual(readback);
  });

  it('handles partial V2 edits without flags and leaves flags absent', () => {
    const result = normalizeDiscordV2Layout({ components: [card(text('## Header'), text('Body'))] });
    expect(result.components[0].components).toHaveLength(3);
    expect(result).not.toHaveProperty('flags');
  });

  it.each([
    { content: 'Legacy text', components: [row('x')] },
    { embeds: [{ title: 'Legacy', fields: [{ name: 'Label', value: 'Value', inline: true }] }], components: [row('x')] },
    { content: 'Must not convert', components: [card(text('## Native'), text('Body'))] },
    { embeds: [{ description: 'Mixed' }], components: [card(text('## Native'), text('Body'))] },
    { flags: 64, components: [row('x')] },
  ])('leaves legacy or mixed content/embed contracts alone: %j', input => {
    expect(normalizeDiscordV2Layout(input)).toBe(input);
  });

  it.each([
    message({ type: 99, content: 'future component' }),
    message(card({ type: 17, components: [text('Invalid nested card')] })),
    message(card({ type: 9, components: [text('No accessory')] })),
    message(card({ type: 9, components: [text('a'), text('b'), text('c'), text('d')], accessory: { type: 11 } })),
    message(card({ type: 1, components: [text('Invalid row')] })),
  ])('leaves unknown or invalid component topology alone: %j', input => {
    expect(normalizeDiscordV2Layout(input)).toBe(input);
  });
});

describe('message-wide Discord component budget', () => {
  it('counts Section accessories and nested row controls, not gallery items/options', () => {
    const section = new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent('Preview'))
      .setThumbnailAccessory(new ThumbnailBuilder().setURL('https://example.com/avatar.png'));
    const input = [card(section, row('pay'), { type: 12, items: Array.from({ length: 10 }, () => ({ media: { url: 'https://example.com/a.png' } })) })];
    expect(countDiscordComponents(input)).toBe(7);
  });

  it('never sacrifices content or controls when optional separators would exceed 40', () => {
    const input = message(card(...Array.from({ length: 25 }, (_, i) => text(`Details ${i}`))),
      { type: 1, components: Array.from({ length: 5 }, (_, i) => ({ type: 2, style: 1, custom_id: `button:${i}`, label: 'Action' })) },
      { type: 9, components: [text('One'), text('Two'), text('Three')], accessory: { type: 11, media: { url: 'https://example.com/a.png' } } });
    expect(countDiscordComponents(input.components)).toBe(37);
    const result = normalizeDiscordV2Layout(input);
    expect(countDiscordComponents(result.components)).toBe(40);
    expect(invariantProjection(result.components)).toEqual(invariantProjection(input.components));
    expect(normalizeDiscordV2Layout(result)).toEqual(result);
  });

  it('uses a shared budget across multiple containers', () => {
    const input = message(...Array.from({ length: 4 }, (_, c) => card(...Array.from({ length: 8 }, (_, i) => text(`Card ${c}, detail ${i}`)))));
    const result = normalizeDiscordV2Layout(input);
    expect(countDiscordComponents(result.components)).toBe(40);
    expect(invariantProjection(result.components)).toEqual(invariantProjection(input.components));
  });

  it('can improve existing separator spacing at capacity without adding components', () => {
    const input = message(card(text('## Header'), separator(), ...Array.from({ length: 37 }, (_, i) => text(`Details ${i}`))));
    expect(countDiscordComponents(input.components)).toBe(40);
    const result = normalizeDiscordV2Layout(input);
    expect(countDiscordComponents(result.components)).toBe(40);
    expect(result.components[0].components[1].spacing).toBe(2);
  });

  it('does not attempt to truncate or repair already oversized messages', () => {
    const input = message(card(...Array.from({ length: 40 }, (_, i) => text(`Details ${i}`))));
    expect(countDiscordComponents(input.components)).toBe(41);
    expect(normalizeDiscordV2Layout(input)).toBe(input);
  });
});
