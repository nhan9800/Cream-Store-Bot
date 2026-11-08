import { describe, expect, it } from 'vitest';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, MessageFlagsBitField } from 'discord.js';
import { buildLegacyFeatureCard } from '../src/utils/featureCard.js';
import { countDiscordComponents } from '../src/utils/discordLayout.js';

function flatten(components) {
  return components.flatMap(node => [node, ...flatten(node.components || []), ...(node.accessory ? [node.accessory] : [])]);
}
const texts = result => flatten(result.components).filter(node => node.type === 10).map(node => node.content);

describe('explicit source-owned feature cards', () => {
  it('turns selected feature summaries into native Markdown groups and separators', () => {
    const original = { embeds: [new EmbedBuilder().setTitle('Ví Cenar').setDescription('Chọn tác vụ bên dưới.')
      .setColor(0x40ab90).addFields({ name: 'Số dư', value: '**115.000đ**', inline: true },
        { name: 'Mã ví', value: '`wallet:100`', inline: true })] };
    const before = original.embeds[0].toJSON();
    const result = buildLegacyFeatureCard(original);
    expect(result).toMatchObject({ content: null, embeds: [], flags: MessageFlags.IsComponentsV2 });
    expect(result.components[0]).toMatchObject({ type: 17, accent_color: 0x40ab90 });
    expect(texts(result)).toEqual(['## Ví Cenar', 'Chọn tác vụ bên dưới.', '### Số dư\n**115.000đ**', '### Mã ví\n`wallet:100`']);
    expect(flatten(result.components).filter(node => node.type === 14).length).toBeGreaterThanOrEqual(3);
    expect(original.embeds[0].toJSON()).toEqual(before);
  });

  it('preserves content/mention intent, every control and explicitly displayed file references', () => {
    const controls = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('claim:CN_123456')
      .setLabel('Nhận đơn').setEmoji({ id: '1550000000000000001', name: 'claim' }).setStyle(ButtonStyle.Primary).setDisabled(true));
    const input = { content: '<@1550000000000000002>', embeds: [{ title: 'Đơn hàng', description: 'CN_123456 · 115.000đ', image: { url: 'attachment://qr.png' } }],
      components: [controls], files: [{ attachment: Buffer.from('QR image'), name: 'qr.png' }],
      attachments: [{ id: '1', filename: 'qr.png' }], allowedMentions: { parse: [] }, nonce: 'dedup',
      flags: new MessageFlagsBitField(MessageFlags.Ephemeral | MessageFlags.SuppressNotifications) };
    const result = buildLegacyFeatureCard(input);
    expect(texts(result)[0]).toBe(input.content);
    expect(result.components.find(node => node.type === 1)).toEqual(controls.toJSON());
    for (const key of ['files', 'attachments', 'allowedMentions', 'nonce']) expect(result[key]).toBe(input[key]);
    expect(result.flags).toBe(MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral | MessageFlags.SuppressNotifications);
  });

  it('preserves description/field values literally, including code and customer formatting', () => {
    const description = 'Khách viết:\n> thật tốt 😊\n\n```json\n{"secret":"a:b"}\n```';
    const value = '||private||\n> original customer words\n### original title\nhttps://example.com/foo?a=100';
    const result = buildLegacyFeatureCard({ embeds: [{ title: 'Details', description, fields: [{ name: 'Nội dung', value }] }] });
    expect(texts(result)).toContain(description);
    expect(texts(result)).toContain(`### Nội dung\n${value}`);
  });

  it('keeps author, thumbnail, gallery, footer and original timestamp', () => {
    const embed = { title: 'Title', url: 'https://example.com/title', description: 'Body', color: 123,
      author: { name: 'Cenar Store', url: 'https://cenarstore.xyz/', icon_url: 'https://example.com/author.png' },
      thumbnail: { url: 'https://example.com/thumbnail.png' }, image: { url: 'attachment://qr.png' },
      footer: { text: 'Original date 19/10/2026', icon_url: 'https://example.com/footer.png' },
      timestamp: '2026-10-19T08:03:00.000Z' };
    const result = buildLegacyFeatureCard({ embeds: [embed] });
    const nodes = flatten(result.components);
    expect(texts(result)).toContain('-# [Cenar Store](https://cenarstore.xyz/)');
    expect(texts(result)).toContain('## [Title](https://example.com/title)');
    expect(nodes.filter(node => node.type === 11).map(node => node.media.url)).toEqual([
      embed.author.icon_url, embed.thumbnail.url, embed.footer.icon_url,
    ]);
    expect(nodes.find(node => node.type === 12).items[0].media.url).toBe('attachment://qr.png');
    expect(texts(result).at(-1)).toBe(`-# ${embed.footer.text}\n-# <t:${Date.parse(embed.timestamp) / 1000}:f>`);
    const footerIndex = result.components[0].components.findLastIndex(node => node.type === 9);
    expect(result.components[0].components[footerIndex - 1]).toMatchObject({ type: 14, spacing: 1 });
  });

  it('preserves ephemeral legacy intent and is idempotent', () => {
    const result = buildLegacyFeatureCard({ ephemeral: true, embeds: [{ description: 'Only you can see this.' }] });
    expect(result.flags).toBe(MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
    expect(result.ephemeral).toBe(true);
    expect(buildLegacyFeatureCard(result)).toBe(result);
  });

  it('keeps formerly inert embed mentions silent when converting public leaderboards', () => {
    const input = { embeds: [{ title: 'Top referral', description: '<@1550000000000000001>\n<@&1550000000000000002>\n@everyone @here' }] };
    const result = buildLegacyFeatureCard(input);
    expect(result).not.toBe(input);
    expect(result.allowedMentions).toEqual({ parse: [] });
    expect(texts(result)).toContain(input.embeds[0].description);
  });

  it('preserves an explicit safe notification policy and original content mention', () => {
    const allowedMentions = { users: ['1550000000000000001'], parse: [] };
    const result = buildLegacyFeatureCard({ content: '<@1550000000000000001>', allowedMentions,
      embeds: [{ title: 'Your order', description: 'CN_123456' }] });
    expect(result.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(result.allowedMentions).toBe(allowedMentions);
  });

  it('preserves raw API silent mention settings without adding competing camel-case settings', () => {
    const allowed_mentions = { parse: [] };
    const result = buildLegacyFeatureCard({ allowed_mentions, embeds: [{ description: '<@1550000000000000001>' }] });
    expect(result.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(result.allowed_mentions).toBe(allowed_mentions);
    expect(result).not.toHaveProperty('allowedMentions');
  });

  it('keeps an explicitly silent mention policy even when reply notification intent is set', () => {
    const allowedMentions = { parse: [], users: [], roles: [], repliedUser: true };
    const result = buildLegacyFeatureCard({ allowedMentions, embeds: [{ description: '<@1550000000000000001> @everyone' }] });
    expect(result.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(result.allowedMentions).toBe(allowedMentions);
  });

  it('keeps partial-edit semantics explicit with cleared content and embeds', () => {
    const result = buildLegacyFeatureCard({ content: null, embeds: [{ title: 'Updated panel' }], components: [] });
    expect(result).toMatchObject({ content: null, embeds: [], flags: MessageFlags.IsComponentsV2 });
    expect(result.components[0].components[0].content).toBe('## Updated panel');
  });

  it('retains URL-only embed links as clickable content', () => {
    const result = buildLegacyFeatureCard({ embeds: [{ url: 'https://cenarstore.xyz/account', description: 'Account' }] });
    expect(texts(result)).toContain('[Mở liên kết](https://cenarstore.xyz/account)');
  });

  it.each([
    { embeds: [{ type: 'video', video: { url: 'https://example.com/video.mp4' } }] },
    { embeds: [{ title: 'Unknown attribute', provider: { name: 'Unfurl' } }] },
    { embeds: [{ title: 'Unknown author metadata', author: { name: 'Original', unknown: 'Keep' } }] },
    { embeds: [{ title: 'Unknown footer metadata', footer: { text: 'Original', unknown: 'Keep' } }] },
    { embeds: [{ title: 'Poll' }], poll: { question: { text: 'Example' } } },
    { embeds: [{ title: 'TTS' }], tts: true },
    { embeds: [{ thumbnail: { url: 'https://example.com/thumbnail.png' } }] },
    { embeds: [{ title: 'Invalid asset', image: { url: 'javascript:alert(1)' } }] },
    { embeds: [{ title: 'Invalid timestamp', timestamp: 'not-a-date' }] },
    { embeds: [{ title: 'Existing V2' }], components: [{ type: 10, content: 'Native' }] },
    { embeds: [{ title: 'Invalid row' }], components: [{ type: 1, components: [{ type: 10, content: 'Native' }] }] },
    { embeds: [{ title: 'Invalid fields', fields: 'not-an-array' }] },
    { embeds: [{ title: 'File delivery' }], files: [{ attachment: Buffer.from('private'), name: 'private.txt' }] },
    { embeds: [{ title: 'File delivery' }], attachments: [{ id: '123', filename: 'private.txt' }] },
    { embeds: [{ title: 'File delivery', image: { url: 'attachment://qr.png' } }], files: ['local/qr.png'] },
    { content: '<@1550000000000000001>', embeds: [{ title: 'Implicit original notification' }] },
    { allowedMentions: { parse: ['users'] }, embeds: [{ description: '<@1550000000000000001>' }] },
    { allowedMentions: { users: ['1550000000000000001'] }, embeds: [{ description: '<@1550000000000000001>' }] },
    { allowed_mentions: { parse: ['everyone'] }, embeds: [{ description: '@everyone' }] },
    { allowedMentions: {}, embeds: [{ description: '<@1550000000000000001>' }] },
    { allowedMentions: { repliedUser: true }, embeds: [{ description: '<@1550000000000000001>' }] },
    { allowed_mentions: { replied_user: false }, embeds: [{ description: '@everyone' }] },
  ])('falls back to the original payload without truncation for unsupported input: %j', input => {
    expect(buildLegacyFeatureCard(input)).toBe(input);
  });

  it('falls back when combined V2 text exceeds 4000 even if each source embed is valid', () => {
    const input = { embeds: [{ title: 'One', description: 'a'.repeat(2100) }, { title: 'Two', description: 'b'.repeat(2100) }] };
    expect(buildLegacyFeatureCard(input)).toBe(input);
  });

  it('falls back instead of truncating a source description at the V2 limit', () => {
    const input = { embeds: [{ description: 'a'.repeat(4096) }] };
    expect(buildLegacyFeatureCard(input)).toBe(input);
  });

  it('keeps converted payloads at or below 40, and falls back when base layout would exceed it', () => {
    const small = { embeds: [{ title: 'Stats', fields: Array.from({ length: 10 }, (_, i) => ({ name: `Metric ${i}`, value: '100' })) }] };
    const result = buildLegacyFeatureCard(small);
    expect(result).not.toBe(small);
    expect(countDiscordComponents(result.components)).toBeLessThanOrEqual(40);
    const large = { embeds: [{ title: 'Stats', fields: Array.from({ length: 25 }, (_, i) => ({ name: `Metric ${i}`, value: '100' })) }] };
    expect(buildLegacyFeatureCard(large)).toBe(large);
  });
});
